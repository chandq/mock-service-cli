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
const { dateFormat, logger, getServerHost, getServerUrls, hostAllowlistMiddleware } = require('./utils');

const log = logger(process.env.SILENT);
const argv = JSON.parse(process.env.ARGV);
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

function normalizeConfig() {
  const defaults = {
    open: false,
    browser: 'default',
    watch: { ignore: ['**/node_modules/**', '**/.git/**'], delay: 100, fullReload: false },
    injectTag: 'body',
    spaFallback: false,
    mounts: [],
    proxy: {},
    https: false,
    cors: false,
    headers: {}
  };
  if (!process.env.STATIC_CONFIG) return { ...defaults, configDir: process.cwd() };

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
  const mounts = Array.isArray(supplied.mounts) ? supplied.mounts : [];
  const normalizedMounts = mounts.map((mount, index) => {
    if (!isPlainObject(mount) || typeof mount.path !== 'string' || typeof mount.directory !== 'string') {
      throw new Error(`mounts[${index}] requires path and directory strings`);
    }
    const mountPath = '/' + mount.path.replace(/^\/+|\/+$/g, '');
    if (mountPath === '/') throw new Error('Mount path cannot be /');
    const directory = path.resolve(configDir, mount.directory);
    if (!existsSync(directory) || !lstatSync(directory).isDirectory()) throw new Error(`Mount directory does not exist: ${directory}`);
    return { path: mountPath === '/' ? '/' : mountPath, directory };
  });
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
  const spaFallback = typeof supplied.spaFallback === 'string' ? supplied.spaFallback : false;
  if (spaFallback && (!spaFallback.startsWith('/') || spaFallback.includes('..'))) {
    throw new Error('spaFallback must be a root-relative path');
  }
  return {
    ...defaults,
    ...supplied,
    configDir,
    watch: {
      ignore: Array.isArray(watch.ignore) ? watch.ignore : defaults.watch.ignore,
      delay: Number.isFinite(watch.delay) && watch.delay >= 0 ? watch.delay : defaults.watch.delay,
      fullReload: watch.fullReload === true
    },
    injectTag: supplied.injectTag === 'head' ? 'head' : 'body',
    mounts: normalizedMounts,
    proxy: isPlainObject(supplied.proxy) ? supplied.proxy : {},
    https: normalizedHttps,
    cors: supplied.cors === true,
    headers: isPlainObject(supplied.headers) ? supplied.headers : {},
    spaFallback
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

function isHiddenDirectoryEntry(entry) {
  // POSIX dotfiles are the only portable hidden-file signal Node exposes.
  return entry.name.startsWith('.') && entry.name !== '.' && entry.name !== '..';
}

async function getDirectoryIndexData(directoryPath, requestPath, showHidden) {
  const entries = await fsPromises.readdir(directoryPath, { withFileTypes: true });
  const visibleEntries = entries.filter(entry => showHidden || !isHiddenDirectoryEntry(entry));
  visibleEntries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  const decodedPath = decodeURIComponent(requestPath);
  const normalizedPath = decodedPath === '/' ? '/' : `/${decodedPath.replace(/^\/+|\/+$/g, '')}/`;
  const parentPath = normalizedPath === '/' ? null : normalizedPath.split('/').slice(0, -2).join('/') || '/';
  return {
    currentPath: normalizedPath,
    parentPath,
    showHidden,
    entries: visibleEntries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isHidden: isHiddenDirectoryEntry(entry)
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
  const encodedDirectoryPath = encodeDirectoryPath(normalizedPath);
  const withVisibility = url => (data.showHidden ? `${url}?showHidden=1` : url);
  const breadcrumbParts = normalizedPath.split('/').filter(Boolean);
  let breadcrumbPath = '';
  const breadcrumb = [
    `<a href="${withVisibility('/')}">根目录</a>`,
    ...breadcrumbParts.map(part => {
      breadcrumbPath += `/${part}`;
      const target = withVisibility(encodeDirectoryPath(breadcrumbPath));
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
    ? `<p id="directoryParent"><a href="${withVisibility(encodeDirectoryPath(data.parentPath))}">← 返回上级</a></p>`
    : '<p id="directoryParent" hidden></p>';
  const visibilityToggleUrl = data.showHidden ? encodedDirectoryPath : `${encodedDirectoryPath}?showHidden=1`;
  const visibilityToggle = `<a class="visibility-toggle" href="${visibilityToggleUrl}">${
    data.showHidden ? '隐藏隐藏项目' : '显示隐藏项目'
  }</a>`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="icon" type="image/svg+xml" href="${STATIC_FAVICON_PATH}"><title>目录索引 ${escapeHtml(
    normalizedPath
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
  const root = path.resolve(process.env.STATIC_DIRECTORY);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new Error(`static-server: directory does not exist: ${root}`);

  const headers = { ...config.headers, ...parseHeaderList(argv.A || argv['append-headers']) };
  const proxyTable = { ...config.proxy, ...parseProxyOptions() };
  const clients = new Set();
  const watchers = [];
  let pendingChanges = [];
  let reloadTimer = null;
  let closing = false;

  app.use(hostAllowlistMiddleware());
  app.use((req, res, next) => {
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, String(value)));
    if (config.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });

  Object.entries(proxyTable).forEach(([prefix, target]) => {
    if (typeof target !== 'string' || !/^https?:\/\//.test(target)) throw new Error(`Invalid proxy target for ${prefix}`);
    app.use(prefix, createProxyMiddleware({ target, changeOrigin: true, ws: true, secure: false }));
  });

  config.mounts.forEach(mount => {
    app.use(
      mount.path,
      express.static(mount.directory, {
        dotfiles: 'allow',
        index: false,
        redirect: false,
        setHeaders: setStaticHeaders
      })
    );
  });

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
  const sendHtml = async (filePath, res, next) => {
    try {
      const html = await fsPromises.readFile(filePath, 'utf8');
      res.type('html').send(injectLiveReload(html, config));
    } catch (error) {
      next(error);
    }
  };
  app.get('*', async (req, res, next) => {
    if (req.path.startsWith('/__mock-service-cli/')) return next();
    const filePath = getStaticPath(root, req.path);
    if (filePath && /\.html?$/i.test(filePath)) return sendHtml(filePath, res, next);
    // SPA mode deliberately owns directory and unknown routes. Without it,
    // each directory request renders a fresh document with ordinary links.
    if (!config.spaFallback) {
      const directoryPath = getStaticDirectory(root, req.path);
      if (directoryPath) {
        try {
          const data = await getDirectoryIndexData(directoryPath, req.path, req.query.showHidden === '1');
          return res.type('html').set('Cache-Control', 'no-store').send(injectLiveReload(renderDirectoryIndex(data), config));
        } catch (error) {
          return next(error);
        }
      }
    }
    next();
  });
  app.use(
    express.static(root, {
      dotfiles: 'allow',
      index: false,
      redirect: false,
      setHeaders: setStaticHeaders
    })
  );
  if (config.spaFallback) {
    const fallbackPath = getStaticPath(root, config.spaFallback);
    if (!fallbackPath || !/\.html?$/i.test(fallbackPath)) throw new Error(`SPA fallback does not exist: ${config.spaFallback}`);
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/__mock-service-cli/')) return next();
      sendHtml(fallbackPath, res, next);
    });
  }
  // Express recognizes an error handler only when all four arguments are declared.
  app.use((error, req, res, _next) => {
    log.info(colors.red(`static-server request failed: ${error.message}`));
    res.status(500).send('Static server request failed');
  });

  function toUrlPath(changedPath) {
    const rootRelative = path.relative(root, changedPath);
    if (!rootRelative.startsWith('..') && !path.isAbsolute(rootRelative)) return `/${rootRelative.split(path.sep).join('/')}`;
    const mount = config.mounts.find(item => {
      const relative = path.relative(item.directory, changedPath);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
    if (!mount) return '/';
    const relative = path.relative(mount.directory, changedPath).split(path.sep).join('/');
    return `${mount.path.replace(/\/$/, '')}/${relative}`.replace(/\/+/g, '/');
  }
  function notifyClients() {
    const changes = pendingChanges;
    pendingChanges = [];
    const cssOnly = changes.length > 0 && changes.every(change => /\.css$/i.test(change));
    const payload = JSON.stringify({ type: !config.watch.fullReload && cssOnly ? 'css' : 'reload', path: changes[0] || '/' });
    clients.forEach(client => client.write(`data: ${payload}\n\n`));
  }
  function scheduleReload(changedPath) {
    pendingChanges.push(toUrlPath(changedPath));
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(notifyClients, config.watch.delay);
  }
  function startWatchers() {
    const targets = [root, ...config.mounts.map(mount => mount.directory)];
    // Node 24's Windows fs.watch backend can abort the process for some short
    // temporary paths. Polling is limited to that runtime combination.
    const usePolling = process.platform === 'win32' && Number.parseInt(process.versions.node, 10) >= 24;
    const watcher = chokidar.watch(targets, {
      ignoreInitial: true,
      ignored: config.watch.ignore,
      usePolling,
      interval: usePolling ? 250 : undefined,
      binaryInterval: usePolling ? 250 : undefined,
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
        log.info(colors.red(`static-server watcher failed: ${error.message}`));
        if (!ready) reject(error);
      });
    });
  }

  const server = config.https
    ? https.createServer({ cert: readFileSync(config.https.cert), key: readFileSync(config.https.key), passphrase: config.https.passphrase }, app)
    : http.createServer(app);
  server.on('close', () => clients.clear());
  return {
    server,
    root,
    protocol: config.https ? 'https' : 'http',
    startWatchers,
    close: async () => {
      if (closing) return;
      closing = true;
      clearTimeout(reloadTimer);
      clients.forEach(client => client.end());
      await Promise.all(watchers.map(watcher => watcher.close()));
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
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    instance.close().finally(() => {
      log.info(colors.red('static-server process stopped.'));
      process.exit();
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

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
            colors.cyan(instance.root),
            colors.yellow(`  ${dateFormat('YYYY-mm-dd HH:MM:SS', new Date())}`)
          ].join('')
        );
        console.info(colors.yellow('\n Static Server available on:\n'));
        urls.forEach(url => console.info('    ' + url.replace(String(port), colors.green(port))));
        if (config.open) {
          const openPath = typeof config.open === 'string' ? config.open : '/';
          openBrowser(`${urls[0]}${openPath.startsWith('/') ? openPath : `/${openPath}`}`, config.browser);
        }
      });
    })
    .catch(error => {
      console.error(colors.red(`static-server watcher failed: ${error.message}`));
      shutdown();
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
