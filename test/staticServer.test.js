const test = require('tap').test;
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, appendFileSync } = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function getCliEnv() {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  Object.keys(env).forEach(key => {
    if (key === 'TAP' || key.startsWith('TAP_') || key.startsWith('NYC_')) delete env[key];
  });
  return env;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function stop(child) {
  return new Promise(resolve => {
    let settled = false;
    let forceKillTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      resolve();
    };
    child.once('exit', finish);
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch (error) {
      finish();
      return;
    }
    if (child.exitCode !== null) finish();
    forceKillTimer = setTimeout(() => {
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else if (child.exitCode === null) child.kill('SIGKILL');
      } catch (error) {
        // Process group already stopped.
      }
      finish();
    }, 1000);
  });
}

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        text += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    req.on('error', reject);
  });
}

async function waitForServer(url, child, output) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await request(url);
      if (response.status >= 200 && response.status < 300) return response;
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (child.exitCode !== null) throw new Error(output.value || 'Static server exited');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('Static server did not start');
}

function waitForSse(url, expectedType) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const request = http.get(url, { agent: false }, response => {
      let body = '';
      response.on('data', chunk => {
        body += chunk.toString();
        const match = body.match(/data: (.+)\n/);
        if (!match) return;
        try {
          const payload = JSON.parse(match[1]);
          if (payload.type === expectedType) {
            request.destroy();
            finish(resolve, payload);
          }
        } catch (error) {
          finish(reject, error);
        }
      });
    });
    request.on('error', error => {
      if (error.code !== 'ECONNRESET') finish(reject, error);
    });
    timeout = setTimeout(() => {
      request.destroy();
      finish(reject, new Error(`Timed out waiting for ${expectedType} reload event`));
    }, 5000);
  });
}

function executeReloadClient(script) {
  const listeners = {};
  const sources = [];
  let reloads = 0;
  class EventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      sources.push(this);
    }

    close() {
      this.closed = true;
    }
  }
  vm.runInNewContext(script, {
    EventSource,
    URL,
    clearTimeout,
    setTimeout: callback => {
      callback();
      return 1;
    },
    document: { querySelectorAll: () => [] },
    location: { href: 'http://127.0.0.1:8090/index.html', reload: () => (reloads += 1) },
    window: {
      addEventListener: (name, callback) => {
        listeners[name] = callback;
      }
    }
  });
  return { listeners, reloads: () => reloads, sources };
}

test('static server development behaviors', async t => {
  await t.test('injects live reload, applies config, serves mounts, fallback, and CSS events', async t => {
  const staticRoot = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-'));
  const mountRoot = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-mount-'));
  const port = await getFreePort();
  const output = { value: '' };
  let child;
  const upstream = http.createServer((req, res) => res.end(`proxied:${req.url}`));
  const upstreamPort = await new Promise((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(0, '127.0.0.1', () => resolve(upstream.address().port));
  });

  try {
    writeFileSync(path.join(staticRoot, 'index.html'), '<html><body><link rel="stylesheet" href="/site.css">home</body></html>');
    writeFileSync(path.join(staticRoot, 'site.css'), 'body { color: black; }');
    writeFileSync(path.join(mountRoot, 'asset.txt'), 'mounted');
    writeFileSync(
      path.join(staticRoot, 'static-server.json'),
      JSON.stringify({
        cors: true,
        headers: { 'X-Static-Config': 'enabled' },
        spaFallback: '/index.html',
        mounts: [{ path: '/vendor', directory: mountRoot }],
        proxy: { '/api': `http://127.0.0.1:${upstreamPort}` },
        watch: { delay: 20, ignore: ['**/node_modules/**'] }
      })
    );

    child = spawn(
      process.execPath,
      [
        'src/bin/mock-service-cli',
        '-R',
        staticRoot,
        '-p',
        String(port),
        '-s',
        '-A',
        'X-Static-Config=cli',
        '--static-config',
        path.join(staticRoot, 'static-server.json')
      ],
      { cwd: root, detached: process.platform !== 'win32', env: getCliEnv(), stdio: ['ignore', 'pipe', 'pipe'] }
    );
    child.stdout.on('data', chunk => {
      output.value += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      output.value += chunk.toString();
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const home = await waitForServer(`${baseUrl}/`, child, output);
    const html = home.text;
    t.match(html, /__mock-service-cli\/live-reload\.js/, 'injects live reload client into HTML');
    t.match(html, /__mock-service-cli\/favicon\.svg/, 'injects the static server favicon when the page has none');
    t.equal((await request(`${baseUrl}/__mock-service-cli/favicon.svg`)).status, 200, 'serves the static server favicon');
    const reloadClient = (await request(`${baseUrl}/__mock-service-cli/live-reload.js`)).text;
    t.match(reloadClient, /pagehide/, 'registers a navigation lifecycle handler');
    t.match(reloadClient, /pageshow/, 'reconnects after a bfcache page restore');
    t.match(reloadClient, /source\.close/, 'closes live reload connections on page navigation');
    const reloadRuntime = executeReloadClient(reloadClient);
    t.equal(reloadRuntime.sources.length, 1, 'opens a live reload connection in the browser client');
    reloadRuntime.sources[0].onmessage({ data: JSON.stringify({ type: 'reload', path: '/index.html' }) });
    t.equal(reloadRuntime.reloads(), 1, 'reloads the page after a server reload event');
    reloadRuntime.listeners.pagehide();
    reloadRuntime.listeners.pageshow();
    t.equal(reloadRuntime.sources.length, 2, 'reopens the connection after bfcache restoration');
    t.equal(home.headers['access-control-allow-origin'], '*', 'enables configured CORS');
    t.equal(home.headers['x-static-config'], 'cli', 'CLI headers override configured headers');
    t.equal((await request(`${baseUrl}/vendor/asset.txt`)).text, 'mounted', 'serves configured mounts');
    t.equal((await request(`${baseUrl}/api/example`)).text, 'proxied:/api/example', 'forwards configured proxy routes');
    t.match((await request(`${baseUrl}/missing-route`)).text, /home/, 'serves SPA fallback for missing paths');

    const cssEvent = waitForSse(`${baseUrl}/__mock-service-cli/live-reload`, 'css');
    await new Promise(resolve => setTimeout(resolve, 100));
    appendFileSync(path.join(staticRoot, 'site.css'), '\nbody { color: red; }');
    const payload = await cssEvent;
    t.equal(payload.path, '/site.css', 'publishes a CSS-specific reload event');
  } finally {
    if (child) await stop(child);
    await new Promise(resolve => upstream.close(resolve));
    rmSync(staticRoot, { recursive: true, force: true });
    rmSync(mountRoot, { recursive: true, force: true });
  }
  });

  await t.test('browses directories by default and only serves an SPA entry when configured', async t => {
  const staticRoot = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-index-'));
  const port = await getFreePort();
  const output = { value: '' };
  let child;

  try {
    mkdirSync(path.join(staticRoot, 'nested'));
    mkdirSync(path.join(staticRoot, '.git'));
    writeFileSync(path.join(staticRoot, 'index.html'), '<html><body>AUTO_INDEX_MARKER</body></html>');
    writeFileSync(path.join(staticRoot, 'nested', 'note.txt'), 'nested content');
    writeFileSync(path.join(staticRoot, 'nested', 'preview.txt'), 'preview inline');
    writeFileSync(path.join(staticRoot, '.coveralls.yml'), 'service_name: coveralls');
    writeFileSync(path.join(staticRoot, '.git', 'config'), '[core]\nrepositoryformatversion = 0\n');
    writeFileSync(path.join(staticRoot, 'LICENSE'), 'license preview');
    writeFileSync(path.join(staticRoot, '.editorconfig'), 'root = true');
    writeFileSync(path.join(staticRoot, 'unknown-binary'), Buffer.from([0, 1, 2, 3]));
    child = spawn(process.execPath, ['src/bin/mock-service-cli', '-R', staticRoot, '-p', String(port), '-s'], {
      cwd: root,
      detached: process.platform !== 'win32',
      env: getCliEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => {
      output.value += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      output.value += chunk.toString();
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const rootHtml = (await waitForServer(`${baseUrl}/`, child, output)).text;
    t.match(rootHtml, /目录索引/, 'shows a directory index at the root');
    t.match(rootHtml, /__mock-service-cli\/favicon\.svg/, 'declares the static server favicon for directory pages');
    t.match(rootHtml, /__mock-service-cli\/live-reload\.js/, 'injects live reload into directory indexes');
    t.notMatch(rootHtml, /__mock-service-cli\/directory-index\.js/, 'does not load a directory navigation client');
    t.notMatch(rootHtml, /data-directory/, 'uses ordinary anchor navigation');
    t.match(rootHtml, /href="\/nested\/"/, 'links subdirectories for navigation');
    t.match(rootHtml, /显示隐藏项目/, 'offers a server-rendered hidden item toggle');
    t.notMatch(rootHtml, /\.coveralls\.yml/, 'hides dotfiles by default');
    t.notMatch(rootHtml, /\.git/, 'hides dot-directories by default');
    t.notMatch(rootHtml, /AUTO_INDEX_MARKER/, 'does not automatically serve index.html');
    const rootWithHidden = await request(`${baseUrl}/?showHidden=1`);
    t.match(rootWithHidden.text, /\.coveralls\.yml/, 'shows hidden files when requested');
    t.match(rootWithHidden.text, /class="is-hidden"/, 'renders shown hidden entries with reduced emphasis');
    t.match(rootWithHidden.text, /href="\/\.git\/\?showHidden=1"/, 'preserves hidden visibility while navigating directories');
    const nestedIndex = await request(`${baseUrl}/nested/`);
    t.match(nestedIndex.text, /note\.txt/, 'shows a nested directory index');
    t.equal(nestedIndex.headers['cache-control'], 'no-store', 'prevents old directory pages from being retained in browser cache');
    t.match(nestedIndex.text, /路径导航/, 'renders path navigation');
    t.match(nestedIndex.text, /href="\/"/, 'links the root from path navigation');
    t.notMatch(nestedIndex.text, /history\.pushState/, 'uses ordinary browser navigation for directories');
    const nestedWithHidden = await request(`${baseUrl}/nested/?showHidden=1`);
    t.match(nestedWithHidden.text, 'href="/?showHidden=1"', 'builds valid root breadcrumbs with hidden state');
    t.notMatch(nestedWithHidden.text, /href="\/\/nested/, 'does not create malformed breadcrumb paths');
    t.match((await request(`${baseUrl}/index.html`)).text, /AUTO_INDEX_MARKER/, 'serves index.html only when explicitly requested');
    t.equal((await request(`${baseUrl}/.coveralls.yml`)).text, 'service_name: coveralls', 'serves files beginning with a dot');
    const preview = await request(`${baseUrl}/nested/preview.txt`);
    t.equal(preview.headers['content-disposition'], 'inline', 'marks browser-previewable files as inline');
    t.equal(preview.text, 'preview inline', 'serves previewable files directly');
    const license = await request(`${baseUrl}/LICENSE`);
    t.match(license.headers['content-type'], /^text\/plain/, 'serves extensionless LICENSE files as text');
    t.equal(license.text, 'license preview', 'renders LICENSE content inline');
    t.match((await request(`${baseUrl}/.editorconfig`)).headers['content-type'], /^text\/plain/, 'serves editor config files as text');
    const gitConfig = await request(`${baseUrl}/.git/config`);
    t.match(gitConfig.headers['content-type'], /^text\/plain/, 'detects extensionless Git config as text');
    t.match(gitConfig.text, /repositoryformatversion/, 'renders Git config inline');
    t.notMatch(String((await request(`${baseUrl}/unknown-binary`)).headers['content-type']), /^text\/plain/, 'does not mislabel binary data as text');
  } finally {
    if (child) await stop(child);
    rmSync(staticRoot, { recursive: true, force: true });
  }
  });
});
