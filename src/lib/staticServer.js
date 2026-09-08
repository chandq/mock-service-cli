const express = require('express');
const { closeSync, existsSync, lstatSync, openSync, promises: fsPromises, readFileSync, readSync } = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const mime = require('mime');
const { spawn } = require('child_process');
const chokidar = require('chokidar');
const { createProxyMiddleware } = require('http-proxy-middleware');
const colors = require('colors/safe');
const portfinder = require('portfinder');
const { shouldExitImmediatelyOnShutdown } = require('./processShutdown');
const {
  dateFormat,
  logger,
  getServerHost,
  getServerUrls,
  hostAllowlistMiddleware,
  getDirectoryHiddenNames
} = require('./utils');

const log = logger(process.env.SILENT);
const argv = JSON.parse(process.env.ARGV);
// `--no-os-hidden` → OS_HIDDEN_ENABLED=false：跳过 Windows 隐藏属性判定，仅按点号命名判隐藏。
const osHiddenEnabled = process.env.OS_HIDDEN_ENABLED !== 'false' && process.env.OS_HIDDEN_ENABLED !== '0';
const LIVE_RELOAD_PATH = '/__mock-service-cli/live-reload';
const LIVE_RELOAD_CLIENT_PATH = '/__mock-service-cli/live-reload.js';
const STATIC_FAVICON_PATH = '/__mock-service-cli/favicon.svg';
const TEXT_SAMPLE_SIZE = 8192;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function detectTextCharset(filePath, stats) {
  if (stats.size === 0) return 'utf-8';
  const buffer = Buffer.allocUnsafe(Math.min(stats.size, TEXT_SAMPLE_SIZE));
  let fileDescriptor;
  try {
    fileDescriptor = openSync(filePath, 'r');
    const bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (sample[0] === 0xff && sample[1] === 0xfe) return 'utf-16le';
    if (sample[0] === 0xfe && sample[1] === 0xff) return 'utf-16be';
    for (const byte of sample) {
      if (byte === 0 || byte < 0x09 || (byte > 0x0d && byte < 0x20)) return null;
    }
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return 'utf-8';
  } catch (error) {
    return null;
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
  }
}

function setStaticHeaders(res, filePath, stats) {
  res.setHeader('Content-Disposition', 'inline');
  const contentType = mime.lookup(filePath);
  if (!contentType || contentType === 'application/octet-stream') {
    const charset = detectTextCharset(filePath, stats);
    if (charset) res.setHeader('Content-Type', `text/plain; charset=${charset}`);
  }
}

function parseHeaderList(value) {
  if (typeof value !== 'string') return {};
  return value.split(/\s*,\s*/).reduce((headers, item) => {
    const separator = item.indexOf('=');
    if (separator <= 0) return headers;
    headers[item.slice(0, separator).trim()] = item.slice(separator + 1).trim();
    return headers;
  }, {});
}

function parseProxyOptions() {
  if (!process.env.PROXY_OPTIONS) return {};
  try {
    const value = JSON.parse(process.env.PROXY_OPTIONS);
    return isPlainObject(value) ? value : {};
  } catch (error) {
    throw new Error(`Invalid proxy options: ${error.message}`);
  }
}

function normalizePublicPath(value, label, allowEmptyRoot) {
  if (typeof value !== 'string') throw new Error(`${label} must be a path`);
  if (!value && allowEmptyRoot) return '/';
  if (!value) throw new Error(`${label} must be a non-empty path`);
  const normalized = '/' + value.replace(/^\/+|\/+$/g, '');
  if (normalized !== '/' && (normalized.includes('..') || normalized.includes('?') || normalized.includes('#'))) {
    throw new Error(`${label} must be a root-relative path`);
  }
  return normalized;
}

function normalizeAccessLog(value, label, configDir) {
  if (value === undefined) return null;
  if (!isPlainObject(value)) throw new Error(`${label}.accessLog must be an object`);
  const accessLog = {};
  ['success', 'failure'].forEach(name => {
    if (value[name] === undefined) return;
    if (typeof value[name] !== 'string' || !value[name])
      throw new Error(`${label}.accessLog.${name} must be a file path`);
    accessLog[name] = path.resolve(configDir, value[name]);
  });
  if (Object.keys(accessLog).length === 0) throw new Error(`${label}.accessLog requires success or failure`);
  return accessLog;
}

function normalizeRequestHeaders(value, label) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  return Object.entries(value).reduce((headers, [name, headerValue]) => {
    if (!name || headerValue === null || typeof headerValue === 'object') {
      throw new Error(`${label}.${name} must be a primitive value`);
    }
    headers[name] = String(headerValue);
    return headers;
  }, {});
}

function normalizeApplicationOptions(value, label, configDir) {
  if (value.cors !== undefined && typeof value.cors !== 'boolean') throw new Error(`${label}.cors must be boolean`);
  if (value.headers !== undefined && !isPlainObject(value.headers))
    throw new Error(`${label}.headers must be an object`);
  if (value.secure !== undefined && typeof value.secure !== 'boolean')
    throw new Error(`${label}.secure must be boolean`);
  return {
    cors: value.cors === true,
    headers: isPlainObject(value.headers) ? value.headers : {},
    // Preserve the static server's previous proxy behavior for self-signed local HTTPS targets.
    secure: value.secure === true,
    requestHeaders: normalizeRequestHeaders(value.requestHeaders, `${label}.requestHeaders`),
    accessLog: normalizeAccessLog(value.accessLog, label, configDir)
  };
}

function normalizeSpaFallback(value, directory, label) {
  if (value === undefined || value === false) return false;
  if (typeof value !== 'string' || !value || !value.startsWith('/') || value.includes('..')) {
    throw new Error(`${label} must be a root-relative path`);
  }
  if (!directory) throw new Error(`${label} requires an application directory`);
  const fallbackPath = getStaticPath(directory, value);
  if (!fallbackPath || !/\.html?$/i.test(fallbackPath)) throw new Error(`${label} does not exist: ${value}`);
  return value;
}

function normalizeProxyTable(value, label, allowStringValues) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  return Object.entries(value).reduce((table, [prefix, rule]) => {
    const normalizedPrefix = normalizePublicPath(prefix, `${label} route`);
    if (Object.prototype.hasOwnProperty.call(table, normalizedPrefix)) {
      throw new Error(`Duplicate proxy route: ${normalizedPrefix}`);
    }
    let target = rule;
    let rewrite = false;
    let requestHeaders = {};
    if (isPlainObject(rule)) {
      target = rule.target;
      rewrite = rule.rewrite === true;
      requestHeaders = normalizeRequestHeaders(rule.requestHeaders, `${label}[${prefix}].requestHeaders`);
      if (rule.rewrite !== undefined && typeof rule.rewrite !== 'boolean') {
        throw new Error(`${label}[${prefix}].rewrite must be boolean`);
      }
    } else if (!allowStringValues || typeof rule !== 'string') {
      throw new Error(`${label}[${prefix}] must contain target and rewrite`);
    }
    if (typeof target !== 'string' || !/^https?:\/\//.test(target))
      throw new Error(`Invalid proxy target for ${prefix}`);
    table[normalizedPrefix] = { target, rewrite, requestHeaders };
    return table;
  }, {});
}

function hasPathPrefix(prefix, requestPath) {
  return prefix === '/' || requestPath === prefix || requestPath.startsWith(`${prefix}/`);
}

function validateMountPaths(mounts) {
  const rootMounts = mounts.filter(mount => mount.path === '/');
  if (rootMounts.length > 1) throw new Error('mounts can only contain one root path');
  const nonRootMounts = mounts.filter(mount => mount.path !== '/');
  nonRootMounts.forEach((mount, index) => {
    nonRootMounts.forEach((other, otherIndex) => {
      if (index === otherIndex) return;
      if (hasPathPrefix(mount.path, other.path)) {
        throw new Error(`mounts paths cannot overlap: ${mount.path} and ${other.path}`);
      }
    });
  });
}

// A watcher can fail to watch one path (e.g. a file locked by another process on
// Windows) without breaking the whole watcher. chokidar keeps scanning and still
// emits 'ready', so these transient lock/permission errors must not stop the server.
function isTransientWatchError(error) {
  const code = error && error.code;
  return ['EBUSY', 'EPERM', 'EACCES', 'ENOENT', 'ENOTDIR'].includes(code);
}

function readWatchEnabledEnv() {
  if (process.env.WATCH_ENABLED === undefined) return undefined;
  return process.env.WATCH_ENABLED === 'true' || process.env.WATCH_ENABLED === '1';
}

function normalizeConfig() {
  const defaults = {
    open: false,
    browser: 'default',
    watch: {
      enabled: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
      delay: 100,
      fullReload: false,
      depth: undefined,
      interval: 250
    },
    injectTag: 'body',
    https: false
  };
  if (process.env.WATCH_DEPTH !== undefined) {
    const cliDepth = Number(process.env.WATCH_DEPTH);
    if (!Number.isInteger(cliDepth) || cliDepth < 0) throw new Error('watch.depth must be a non-negative integer');
  }
  if (process.env.WATCH_INTERVAL !== undefined) {
    const cliInterval = Number(process.env.WATCH_INTERVAL);
    if (!Number.isInteger(cliInterval) || cliInterval < 1) throw new Error('watch.interval must be a positive integer');
  }
  const cliWatchEnabled = readWatchEnabledEnv();
  const cliWatchInterval = process.env.WATCH_INTERVAL === undefined ? undefined : Number(process.env.WATCH_INTERVAL);
  const cliDirectory = process.env.STATIC_DIRECTORY ? path.resolve(process.env.STATIC_DIRECTORY) : null;
  if (process.env.STATIC_CONFIG && argv['spa-fallback'] !== undefined) {
    throw new Error('--spa-fallback cannot be used with --static-config');
  }
  const cliSpaFallback = process.env.STATIC_CONFIG
    ? false
    : normalizeSpaFallback(argv['spa-fallback'], cliDirectory, 'spaFallback');
  if (!process.env.STATIC_CONFIG) {
    if (!cliDirectory) throw new Error('Static server requires -R <directory> or --static-config <file>');
    if (!existsSync(cliDirectory) || !lstatSync(cliDirectory).isDirectory()) {
      throw new Error(`static-server: directory does not exist: ${cliDirectory}`);
    }
    const cliProxy = normalizeProxyTable(parseProxyOptions(), 'proxy', true);
    if (argv.r || argv.rewrite) Object.values(cliProxy).forEach(rule => (rule.rewrite = true));
    return {
      ...defaults,
      open: process.env.OPEN_API_OVERVIEW ? true : defaults.open,
      watch: {
        ...defaults.watch,
        enabled: cliWatchEnabled === undefined ? defaults.watch.enabled : cliWatchEnabled,
        interval: cliWatchInterval === undefined ? defaults.watch.interval : cliWatchInterval,
        depth: process.env.WATCH_DEPTH === undefined ? undefined : Number(process.env.WATCH_DEPTH)
      },
      configDir: process.cwd(),
      mounts: [
        {
          path: '/',
          directory: cliDirectory,
          spaFallback: cliSpaFallback,
          proxy: cliProxy,
          cors: false,
          headers: {},
          secure: false,
          requestHeaders: {},
          accessLog: null
        }
      ]
    };
  }

  const configPath = path.resolve(process.env.STATIC_CONFIG);
  let supplied;
  try {
    supplied = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read static config: ${error.message}`);
  }
  if (!isPlainObject(supplied)) throw new Error('Static config must contain a JSON object');

  const configDir = path.dirname(configPath);
  const watch = isPlainObject(supplied.watch) ? supplied.watch : {};
  if (watch.enabled !== undefined && typeof watch.enabled !== 'boolean') {
    throw new Error('watch.enabled must be boolean');
  }
  if (watch.interval !== undefined && (!Number.isInteger(watch.interval) || watch.interval < 1)) {
    throw new Error('watch.interval must be a positive integer');
  }
  const depthValue = process.env.WATCH_DEPTH !== undefined ? Number(process.env.WATCH_DEPTH) : watch.depth;
  if (depthValue !== undefined && (!Number.isInteger(depthValue) || depthValue < 0)) {
    throw new Error('watch.depth must be a non-negative integer');
  }
  const enabledValue =
    cliWatchEnabled === undefined
      ? watch.enabled === undefined
        ? defaults.watch.enabled
        : watch.enabled
      : cliWatchEnabled;
  const intervalValue =
    cliWatchInterval === undefined
      ? watch.interval === undefined
        ? defaults.watch.interval
        : watch.interval
      : cliWatchInterval;
  if (process.env.PROXY_OPTIONS) throw new Error('--proxy-options/--rewrite cannot be used with --static-config');
  const rootApplicationFields = [
    'directory',
    'spaFallback',
    'proxy',
    'cors',
    'headers',
    'secure',
    'requestHeaders',
    'accessLog'
  ];
  const suppliedRootField = rootApplicationFields.find(field => supplied[field] !== undefined);
  if (suppliedRootField) throw new Error(`${suppliedRootField} must be declared on a mount in static config`);
  const mounts = supplied.mounts === undefined ? [] : supplied.mounts;
  if (!Array.isArray(mounts)) throw new Error('mounts must be an array');
  if (mounts.length === 0) throw new Error('Static config requires at least one mount');
  const normalizedMounts = mounts.map((mount, index) => {
    if (!isPlainObject(mount)) {
      throw new Error(`mounts[${index}] must be an object`);
    }
    const mountPath = mount.path === undefined ? '/' : normalizePublicPath(mount.path, `mounts[${index}].path`, true);
    if (mount.directory !== undefined && typeof mount.directory !== 'string') {
      throw new Error(`mounts[${index}].directory must be a string`);
    }
    const directory = mount.directory === undefined ? null : path.resolve(configDir, mount.directory);
    if (directory && (!existsSync(directory) || !lstatSync(directory).isDirectory())) {
      throw new Error(`Mount directory does not exist: ${directory}`);
    }
    const normalizedMount = {
      path: mountPath,
      directory,
      spaFallback: normalizeSpaFallback(mount.spaFallback, directory, `mounts[${index}].spaFallback`),
      proxy: normalizeProxyTable(mount.proxy, `mounts[${index}].proxy`, false),
      ...normalizeApplicationOptions(mount, `mounts[${index}]`, configDir)
    };
    if (!normalizedMount.directory && Object.keys(normalizedMount.proxy).length === 0) {
      throw new Error(`mounts[${index}] requires directory or proxy`);
    }
    if (normalizedMount.accessLog && !normalizedMount.spaFallback) {
      throw new Error(`mounts[${index}].accessLog requires spaFallback`);
    }
    return normalizedMount;
  });
  validateMountPaths(normalizedMounts);
  const httpsConfig = supplied.https;
  let normalizedHttps = false;
  if (httpsConfig === true) throw new Error('https requires cert and key paths');
  if (isPlainObject(httpsConfig) && httpsConfig.enable !== false) {
    if (typeof httpsConfig.cert !== 'string' || typeof httpsConfig.key !== 'string') {
      throw new Error('https requires cert and key paths');
    }
    normalizedHttps = {
      cert: path.resolve(configDir, httpsConfig.cert),
      key: path.resolve(configDir, httpsConfig.key),
      passphrase: typeof httpsConfig.passphrase === 'string' ? httpsConfig.passphrase : undefined
    };
  }
  return {
    ...defaults,
    open: process.env.OPEN_API_OVERVIEW
      ? supplied.open || true
      : supplied.open === undefined
        ? defaults.open
        : supplied.open,
    browser: supplied.browser === undefined ? defaults.browser : supplied.browser,
    configDir,
    watch: {
      enabled: enabledValue,
      ignore: Array.isArray(watch.ignore) ? watch.ignore : defaults.watch.ignore,
      delay: Number.isFinite(watch.delay) && watch.delay >= 0 ? watch.delay : defaults.watch.delay,
      fullReload: watch.fullReload === true,
      depth: depthValue,
      interval: intervalValue
    },
    injectTag: supplied.injectTag === 'head' ? 'head' : 'body',
    mounts: normalizedMounts,
    https: normalizedHttps
  };
}

function getStaticPath(root, requestPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(requestPath);
  } catch (error) {
    return null;
  }
  const candidate = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!existsSync(candidate) || lstatSync(candidate).isDirectory()) return null;
  return candidate;
}

function getStaticDirectory(root, requestPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(requestPath);
  } catch (error) {
    return null;
  }
  const candidate = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(candidate)) return null;
  return lstatSync(candidate).isDirectory() ? candidate : null;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
  );
}

function joinPublicPath(basePath, localPath) {
  if (basePath === '/') return localPath;
  return `${basePath}${localPath === '/' ? '/' : localPath}`.replace(/\/+/g, '/');
}

async function getDirectoryIndexData(directoryPath, requestPath, showHidden, basePath) {
  const entries = await fsPromises.readdir(directoryPath, { withFileTypes: true });
  // Windows 下逐文件 spawnSync attrib 会随文件数线性阻塞（每个约 10-20ms）；
  // 这里批量读取隐藏状态，避免大目录目录页请求被拖慢。
  const hiddenNames = await getDirectoryHiddenNames(directoryPath, entries.map(entry => entry.name), {
    osHidden: osHiddenEnabled
  });
  const entriesWithHidden = entries.map(entry => ({
    entry,
    hidden: hiddenNames.has(entry.name)
  }));
  const visibleEntries = entriesWithHidden.filter(item => showHidden || !item.hidden);
  visibleEntries.sort((left, right) => {
    if (left.entry.isDirectory() !== right.entry.isDirectory()) return left.entry.isDirectory() ? -1 : 1;
    return left.entry.name.localeCompare(right.entry.name);
  });
  const decodedPath = decodeURIComponent(requestPath);
  const normalizedPath = decodedPath === '/' ? '/' : `/${decodedPath.replace(/^\/+|\/+$/g, '')}/`;
  const parentPath = normalizedPath === '/' ? null : normalizedPath.split('/').slice(0, -2).join('/') || '/';
  return {
    currentPath: normalizedPath,
    parentPath,
    basePath,
    showHidden,
    entries: visibleEntries.map(({ entry, hidden }) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isHidden: hidden
    }))
  };
}

function encodeDirectoryPath(directoryPath) {
  if (directoryPath === '/') return '/';
  return `/${directoryPath
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/')}/`;
}

function renderDirectoryIndex(data) {
  const normalizedPath = data.currentPath;
  const publicCurrentPath = joinPublicPath(data.basePath, normalizedPath);
  const publicParentPath = data.parentPath ? joinPublicPath(data.basePath, data.parentPath) : null;
  const encodedDirectoryPath = encodeDirectoryPath(publicCurrentPath);
  const encodedApplicationRootPath = encodeDirectoryPath(joinPublicPath(data.basePath, '/'));
  const withVisibility = url => (data.showHidden ? `${url}?showHidden=1` : url);
  const breadcrumbParts = normalizedPath.split('/').filter(Boolean);
  let breadcrumbPath = '';
  const breadcrumb = [
    `<a href="${withVisibility(encodedApplicationRootPath)}">根目录</a>`,
    ...breadcrumbParts.map(part => {
      breadcrumbPath += `/${part}`;
      const target = withVisibility(encodeDirectoryPath(joinPublicPath(data.basePath, breadcrumbPath)));
      return `<a href="${target}">${escapeHtml(part)}</a>`;
    })
  ].join('<span aria-hidden="true"> / </span>');
  const items = data.entries
    .map(entry => {
      const suffix = entry.isDirectory ? '/' : '';
      const href = `${encodedDirectoryPath}${encodeURIComponent(entry.name)}${suffix}`.replace(/\/+/g, '/');
      const target = entry.isDirectory ? withVisibility(href) : href;
      return `<li${entry.isHidden ? ' class="is-hidden"' : ''}><a href="${target}">${entry.isDirectory ? '📁' : '📄'} ${escapeHtml(
        entry.name
      )}${suffix}</a></li>`;
    })
    .join('');
  const parent = data.parentPath
    ? `<p id="directoryParent"><a href="${withVisibility(encodeDirectoryPath(publicParentPath))}">← 返回上级</a></p>`
    : '<p id="directoryParent" hidden></p>';
  const visibilityToggleUrl = data.showHidden ? encodedDirectoryPath : `${encodedDirectoryPath}?showHidden=1`;
  const visibilityToggle = `<a class="visibility-toggle" href="${visibilityToggleUrl}">${
    data.showHidden ? '隐藏隐藏项目' : '显示隐藏项目'
  }</a>`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="icon" type="image/svg+xml" href="${STATIC_FAVICON_PATH}"><title>目录索引 ${escapeHtml(
    publicCurrentPath
  )}</title><style>body{font:14px system-ui,sans-serif;margin:32px;max-width:900px}a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}.directory-header{display:flex;align-items:center;gap:12px;margin:12px 0;flex-wrap:wrap}.directory-header h1{font-size:20px;margin:0}.directory-header nav{color:#4b5563;min-width:0;flex:1;overflow-wrap:anywhere}.directory-header nav span{padding:0 5px;color:#9ca3af}.visibility-toggle{color:#374151;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;padding:5px 8px;white-space:nowrap}.visibility-toggle:hover{background:#f3f4f6;text-decoration:none}.is-hidden{opacity:.55}ul{list-style:none;padding:0}li{padding:7px 0;border-bottom:1px solid #eee}</style></head><body><header class="directory-header"><h1>目录索引</h1><nav aria-label="路径导航">${breadcrumb}</nav>${visibilityToggle}</header>${parent}<ul>${items || '<li>（空目录）</li>'}</ul></body></html>`;
  return html;
}

function getLiveReloadClient(config) {
  const delay = JSON.stringify(config.watch.delay);
  const fullReload = JSON.stringify(config.watch.fullReload);
  return `(function(){const delay=${delay};const fullReload=${fullReload};let source;let timer;const dispose=function(){clearTimeout(timer);if(source){source.close();source=null}};const connect=function(){if(source)return;source=new EventSource('${LIVE_RELOAD_PATH}');source.onmessage=function(event){let change;try{change=JSON.parse(event.data)}catch(_){return}clearTimeout(timer);timer=setTimeout(function(){if(!fullReload&&change.type==='css'){const target=new URL(change.path,location.href).pathname;let updated=false;document.querySelectorAll('link[rel~="stylesheet"][href]').forEach(function(link){if(new URL(link.href,location.href).pathname===target){const url=new URL(link.href,location.href);url.searchParams.set('mock-service-cli-reload',Date.now());link.href=url.href;updated=true}});if(updated)return}location.reload()},delay)}};window.addEventListener('pagehide',dispose);window.addEventListener('pageshow',connect);connect()})();`;
}

function injectLiveReload(html, config) {
  const iconPattern = /<link\b[^>]*\brel\s*=\s*["'][^"']*\bicon\b[^"']*["'][^>]*>/i;
  if (!iconPattern.test(html)) {
    const favicon = `<link rel="icon" type="image/svg+xml" href="${STATIC_FAVICON_PATH}">`;
    const headIndex = html.toLowerCase().lastIndexOf('</head>');
    html = headIndex === -1 ? `${favicon}${html}` : `${html.slice(0, headIndex)}${favicon}${html.slice(headIndex)}`;
  }
  // The favicon stays even when watching is off; only the reload client is skipped.
  if (config.watch.enabled === false) return html;
  const script = `<script src="${LIVE_RELOAD_CLIENT_PATH}" data-mock-service-cli-live-reload="true"></script>`;
  const closingTag = config.injectTag === 'head' ? '</head>' : '</body>';
  const index = html.toLowerCase().lastIndexOf(closingTag);
  return index === -1 ? `${html}${script}` : `${html.slice(0, index)}${script}${html.slice(index)}`;
}

function openBrowser(url, browser) {
  if (!browser || browser === false) return;
  let command;
  let args;
  if (isPlainObject(browser)) {
    if (typeof browser.command !== 'string' || !browser.command) return;
    command = browser.command;
    args = Array.isArray(browser.args) ? browser.args.map(String) : [];
    args.push(url);
  } else if (browser !== 'default') {
    command = String(browser);
    args = [url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function createStaticServer(config) {
  const app = express();
  const cliHeaders = parseHeaderList(argv.A || argv['append-headers']);
  const clients = new Set();
  const watchers = [];
  let pendingChanges = [];
  let reloadTimer = null;
  let closing = false;
  const pendingLogWrites = new Set();

  const applications = config.mounts.map(mount => ({ ...mount, basePath: mount.path }));
  const rootApplication = applications.find(application => application.basePath === '/' && application.directory);
  const root = rootApplication ? rootApplication.directory : null;

  app.use(hostAllowlistMiddleware());
  app.use((req, res, next) => {
    Object.entries(cliHeaders).forEach(([key, value]) => res.setHeader(key, String(value)));
    next();
  });

  function applyApplicationOptions(application) {
    return (req, res, next) => {
      Object.entries({ ...application.headers, ...cliHeaders }).forEach(([key, value]) =>
        res.setHeader(key, String(value))
      );
      if (application.cors) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') return res.status(204).end();
      }
      return next();
    };
  }

  function writeAccessLog(application, req, res) {
    if (!application.accessLog) return;
    const logFile = res.statusCode >= 400 ? application.accessLog.failure : application.accessLog.success;
    if (!logFile) return;
    const entry = `${JSON.stringify({
      timestamp: new Date().toISOString(),
      application: application.basePath,
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode
    })}\n`;
    const write = fsPromises
      .mkdir(path.dirname(logFile), { recursive: true })
      .then(() => fsPromises.appendFile(logFile, entry, 'utf8'))
      .catch(error => log.info(colors.red(`static-server access log failed: ${error.message}`)));
    pendingLogWrites.add(write);
    write.finally(() => pendingLogWrites.delete(write));
  }

  function createAccessLogMiddleware(application) {
    if (!application.accessLog) return (_req, _res, next) => next();
    return (req, res, next) => {
      res.once('finish', () => writeAccessLog(application, req, res));
      next();
    };
  }

  app.get(LIVE_RELOAD_PATH, (req, res) => {
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    res.flushHeaders();
    res.write('retry: 1000\n\n');
    clients.add(res);
    const removeClient = () => clients.delete(res);
    req.once('close', removeClient);
    res.once('close', removeClient);
  });
  app.get(LIVE_RELOAD_CLIENT_PATH, (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-store').send(getLiveReloadClient(config));
  });
  app.get(STATIC_FAVICON_PATH, (req, res) => {
    res.sendFile(path.resolve(__dirname, './favicon-static-server.svg'));
  });

  const proxyRoutes = [];
  const proxyOwners = new Map();
  applications.forEach(application => {
    Object.entries(application.proxy || {}).forEach(([prefix, rule]) => {
      if (proxyOwners.has(prefix)) throw new Error(`Duplicate proxy route: ${prefix}`);
      proxyOwners.set(prefix, application.basePath);
      proxyRoutes.push({ prefix, application, ...rule });
    });
  });
  proxyRoutes.sort((left, right) => right.prefix.length - left.prefix.length);
  proxyRoutes.forEach(route => {
    const pathRewrite = route.rewrite
      ? requestPath => {
          if (route.prefix === '/') return requestPath;
          if (requestPath === route.prefix) return '/';
          return requestPath.startsWith(`${route.prefix}/`)
            ? requestPath.slice(route.prefix.length) || '/'
            : requestPath;
        }
      : undefined;
    app.use(
      route.prefix,
      applyApplicationOptions(route.application),
      createAccessLogMiddleware(route.application),
      createProxyMiddleware({
        target: route.target,
        changeOrigin: true,
        ws: true,
        secure: route.application.secure,
        headers: { ...route.application.requestHeaders, ...route.requestHeaders },
        pathRewrite
      })
    );
  });

  const sendHtml = async (filePath, res, next) => {
    try {
      const html = await fsPromises.readFile(filePath, 'utf8');
      res.type('html').send(injectLiveReload(html, config));
    } catch (error) {
      next(error);
    }
  };

  function createApplicationRouter(application) {
    const router = express.Router();
    router.use(applyApplicationOptions(application));
    router.use(createAccessLogMiddleware(application));
    router.get('*', async (req, res, next) => {
      if (req.path.startsWith('/__mock-service-cli/')) return next();
      const filePath = getStaticPath(application.directory, req.path);
      if (filePath && /\.html?$/i.test(filePath)) return sendHtml(filePath, res, next);
      if (!application.spaFallback) {
        const directoryPath = getStaticDirectory(application.directory, req.path);
        if (directoryPath) {
          try {
            const data = await getDirectoryIndexData(
              directoryPath,
              req.path,
              req.query.showHidden === '1',
              application.basePath
            );
            return res
              .type('html')
              .set('Cache-Control', 'no-store')
              .send(injectLiveReload(renderDirectoryIndex(data), config));
          } catch (error) {
            return next(error);
          }
        }
      }
      next();
    });
    router.use(
      express.static(application.directory, {
        dotfiles: 'allow',
        index: false,
        redirect: false,
        setHeaders: setStaticHeaders
      })
    );
    if (application.spaFallback) {
      const fallbackPath = getStaticPath(application.directory, application.spaFallback);
      if (!fallbackPath || !/\.html?$/i.test(fallbackPath)) {
        throw new Error(`SPA fallback does not exist: ${application.spaFallback}`);
      }
      router.get('*', (req, res, next) => {
        if (req.path.startsWith('/__mock-service-cli/')) return next();
        sendHtml(fallbackPath, res, next);
      });
    }
    return router;
  }

  const mountApplications = applications.filter(application => application.basePath !== '/' && application.directory);
  mountApplications.forEach(application => {
    const router = createApplicationRouter(application);
    app.use(application.basePath, (req, res, next) => {
      router.handle(req, res, error => {
        if (error) return next(error);
        if (!res.headersSent) return res.status(404).send('Not Found');
        return undefined;
      });
    });
  });
  if (rootApplication) app.use(createApplicationRouter(rootApplication));
  app.use((req, res) => res.status(404).send('Not Found'));

  // Express recognizes an error handler only when all four arguments are declared.
  app.use((error, req, res, _next) => {
    log.info(colors.red(`static-server request failed: ${error.message}`));
    res.status(500).send('Static server request failed');
  });

  function toUrlPath(changedPath) {
    const mount = config.mounts.find(item => {
      if (!item.directory) return false;
      const relative = path.relative(item.directory, changedPath);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
    if (mount) {
      const relative = path.relative(mount.directory, changedPath).split(path.sep).join('/');
      return `${mount.path.replace(/\/$/, '')}/${relative}`.replace(/\/+/g, '/');
    }
    if (root) {
      const rootRelative = path.relative(root, changedPath);
      if (!rootRelative.startsWith('..') && !path.isAbsolute(rootRelative))
        return `/${rootRelative.split(path.sep).join('/')}`;
    }
    return '/';
  }
  function notifyClients() {
    const changes = pendingChanges;
    pendingChanges = [];
    const cssOnly = changes.length > 0 && changes.every(change => /\.css$/i.test(change));
    const payload = JSON.stringify({
      type: !config.watch.fullReload && cssOnly ? 'css' : 'reload',
      path: changes[0] || '/'
    });
    clients.forEach(client => client.write(`data: ${payload}\n\n`));
  }
  function scheduleReload(changedPath) {
    pendingChanges.push(toUrlPath(changedPath));
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(notifyClients, config.watch.delay);
  }
  function startWatchers() {
    const targets = [...new Set(applications.map(application => application.directory).filter(Boolean))];
    if (config.watch.enabled === false || targets.length === 0) return Promise.resolve();
    // Node 24's Windows fs.watch backend can abort the process for some short
    // temporary paths. Polling is limited to that runtime combination, and its
    // interval is configurable for large trees.
    const usePolling = process.platform === 'win32' && Number.parseInt(process.versions.node, 10) >= 24;
    const pollInterval = usePolling ? config.watch.interval : undefined;
    const watcher = chokidar.watch(targets, {
      ignoreInitial: true,
      ignored: config.watch.ignore,
      depth: config.watch.depth,
      usePolling,
      interval: pollInterval,
      binaryInterval: pollInterval,
      awaitWriteFinish: { stabilityThreshold: Math.max(config.watch.delay, 50), pollInterval: 20 }
    });
    watcher.on('all', (event, changedPath) => {
      if (['add', 'change', 'unlink', 'addDir', 'unlinkDir'].includes(event)) scheduleReload(changedPath);
    });
    watchers.push(watcher);
    return new Promise((resolve, reject) => {
      let ready = false;
      watcher.once('ready', () => {
        ready = true;
        resolve();
      });
      watcher.on('error', error => {
        // Transient lock/permission errors (Windows EBUSY, editors, antivirus) hit
        // individual paths and chokidar still emits 'ready'; only a real watcher
        // startup failure before 'ready' is fatal.
        if (isTransientWatchError(error)) {
          log.info(colors.yellow(`static-server watcher: ${error.message}`));
          return;
        }
        log.info(colors.red(`static-server watcher failed: ${error.message}`));
        if (!ready) reject(error);
      });
    });
  }

  const server = config.https
    ? https.createServer(
        {
          cert: readFileSync(config.https.cert),
          key: readFileSync(config.https.key),
          passphrase: config.https.passphrase
        },
        app
      )
    : http.createServer(app);
  server.on('close', () => clients.clear());
  return {
    server,
    root,
    protocol: config.https ? 'https' : 'http',
    proxyRoutes,
    startWatchers,
    close: async () => {
      if (closing) return;
      closing = true;
      clearTimeout(reloadTimer);
      clients.forEach(client => client.end());
      await Promise.all(watchers.map(watcher => watcher.close()));
      await Promise.all([...pendingLogWrites]);
      await new Promise(resolve => {
        if (!server.listening) return resolve();
        server.close(resolve);
        // Do not let keep-alive requests prevent SIGTERM from completing.
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      });
    }
  };
}

function startServer() {
  const config = normalizeConfig();
  const instance = createStaticServer(config);
  const port = Number.parseInt(process.env.PORT, 10);
  let shuttingDown = false;
  const shutdown = signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (shouldExitImmediatelyOnShutdown(process.platform, signal)) {
      // Windows releases sockets and watcher handles when the process exits.
      log.info(colors.red('static-server process stopped.'));
      process.exit();
    }
    instance.close().finally(() => {
      log.info(colors.red('static-server process stopped.'));
      process.exit();
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // Do not report the server as ready until the watcher has completed its
  // initial scan. Otherwise a save immediately after startup can be missed.
  instance
    .startWatchers()
    .then(() => {
      if (shuttingDown) return;
      instance.server.listen(port, getServerHost(), () => {
        const urls = getServerUrls(port).map(url => url.replace(/^http:/, `${instance.protocol}:`));
        console.info(
          [
            colors.yellow('\nStarting up Static Server, serving '),
            colors.cyan(instance.root || config.configDir),
            colors.yellow(`  ${dateFormat('YYYY-mm-dd HH:MM:SS', new Date())}`)
          ].join('')
        );
        console.info(colors.yellow('\n Static Server available on:\n'));
        urls.forEach(url => console.info('    ' + url.replace(String(port), colors.green(port))));
        if (instance.proxyRoutes.length > 0) {
          log.info(colors.yellow('\n Static application proxy routes:\n'));
          instance.proxyRoutes.forEach(route => {
            log.info(
              `    ${colors.cyan(route.application.basePath)} ${colors.green(route.prefix)} -> ${colors.magenta(route.target)}${
                route.rewrite ? colors.yellow(' (rewrite)') : ''
              }`
            );
          });
        }
        if (config.open) {
          const openPath = typeof config.open === 'string' ? config.open : '/';
          openBrowser(`${urls[0]}${openPath.startsWith('/') ? openPath : `/${openPath}`}`, config.browser);
        }
      });
    })
    .catch(error => {
      console.error(colors.red(`static-server watcher failed: ${error.message}`));
      shutdown('SIGTERM');
    });
}

if (!process.env.PORT) {
  portfinder.basePort = 8090;
  portfinder.getPort((error, port) => {
    if (error) throw error;
    process.env.PORT = port;
    startServer();
  });
} else {
  startServer();
}

module.exports = { normalizeConfig, createStaticServer };
