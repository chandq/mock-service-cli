const test = require('tap').test;
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, appendFileSync } = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
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

function stopParent(child) {
  return new Promise(resolve => {
    let settled = false;
    let forceKillTimer;
    const finish = forced => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      resolve({ forced });
    };
    child.once('exit', () => finish(false));
    child.kill('SIGINT');
    forceKillTimer = setTimeout(() => {
      const forced = child.exitCode === null;
      if (forced) child.kill('SIGKILL');
      finish(forced);
    }, 1000);
  });
}

async function waitForPortRelease(port) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => server.close(resolve));
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw lastError || new Error(`Port ${port} was not released`);
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

function requestWithMethod(url, method) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const req = http.request(
      {
        hostname: requestUrl.hostname,
        port: requestUrl.port,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method,
        agent: false
      },
      response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          text += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function waitForFileText(filePath) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf8');
        if (content) return content;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw lastError || new Error(`Timed out waiting for ${filePath}`);
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
  await t.test('releases the port when the CLI parent receives SIGINT', async t => {
    if (process.platform === 'win32') {
      t.skip('child.kill(SIGINT) does not generate a Windows console Ctrl+C event');
      return;
    }
    const staticRoot = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-shutdown-'));
    const port = await getFreePort();
    const output = { value: '' };
    let child;

    try {
      writeFileSync(path.join(staticRoot, 'index.html'), '<html><body>shutdown</body></html>');
      child = spawn(process.execPath, ['src/bin/mock-service-cli', '-R', staticRoot, '-p', String(port), '-s'], {
        cwd: root,
        env: getCliEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.stdout.on('data', chunk => {
        output.value += chunk.toString();
      });
      child.stderr.on('data', chunk => {
        output.value += chunk.toString();
      });

      await waitForServer(`http://127.0.0.1:${port}/`, child, output);
      const result = await stopParent(child);
      t.notOk(result.forced, 'CLI exits gracefully without a forced kill');
      await waitForPortRelease(port);
      t.pass('CLI shutdown also stops the static server child');
    } finally {
      if (child && child.exitCode === null) await stop(child);
      rmSync(staticRoot, { recursive: true, force: true });
    }
  });

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
      writeFileSync(
        path.join(staticRoot, 'index.html'),
        '<html><body><link rel="stylesheet" href="/site.css">home</body></html>'
      );
      writeFileSync(path.join(staticRoot, 'site.css'), 'body { color: black; }');
      writeFileSync(path.join(mountRoot, 'asset.txt'), 'mounted');
      writeFileSync(
        path.join(staticRoot, 'static-server.json'),
        JSON.stringify({
          mounts: [
            {
              path: '/',
              directory: '.',
              cors: true,
              headers: { 'X-Static-Config': 'enabled' },
              spaFallback: '/index.html',
              proxy: { '/api': { target: `http://127.0.0.1:${upstreamPort}`, rewrite: false } }
            },
            { path: '/vendor', directory: mountRoot }
          ],
          watch: { delay: 20, ignore: ['**/node_modules/**'] }
        })
      );

      child = spawn(
        process.execPath,
        [
          'src/bin/mock-service-cli',
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
      t.equal(
        (await request(`${baseUrl}/__mock-service-cli/favicon.svg`)).status,
        200,
        'serves the static server favicon'
      );
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
      t.equal(
        (await request(`${baseUrl}/api/example`)).text,
        'proxied:/api/example',
        'forwards configured proxy routes'
      );
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
      writeFileSync(path.join(staticRoot, 'nested', '.hidden-note'), 'hidden nested content');
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
      t.match(rootHtml, /href="\/nested\/"/, 'links subdirectories for navigation');
      t.match(rootHtml, /显示隐藏项目/, 'offers a server-rendered hidden item toggle');
      t.notMatch(rootHtml, /AUTO_INDEX_MARKER/, 'does not automatically serve index.html');
      const rootWithHidden = await request(`${baseUrl}/?showHidden=1`);
      t.match(rootWithHidden.text, /\.coveralls\.yml/, 'shows root hidden files when requested');
      t.match(
        rootWithHidden.text,
        /href="\/\.git\/\?showHidden=1"/,
        'preserves hidden visibility while navigating directories'
      );
      const nestedIndex = await request(`${baseUrl}/nested/`);
      t.match(nestedIndex.text, /note\.txt/, 'shows a nested directory index');
      t.equal(
        nestedIndex.headers['cache-control'],
        'no-store',
        'prevents old directory pages from being retained in browser cache'
      );
      t.match(nestedIndex.text, /路径导航/, 'renders path navigation');
      t.match(nestedIndex.text, /href="\/"/, 'links the root from path navigation');
      t.notMatch(nestedIndex.text, /history\.pushState/, 'uses ordinary browser navigation for directories');
      t.notMatch(nestedIndex.text, /\.hidden-note/, 'hides nested dotfiles by default');
      const nestedWithHidden = await request(`${baseUrl}/nested/?showHidden=1`);
      t.match(nestedWithHidden.text, /\.hidden-note/, 'shows nested hidden files when requested');
      t.match(nestedWithHidden.text, 'href="/?showHidden=1"', 'builds valid root breadcrumbs with hidden state');
      t.notMatch(nestedWithHidden.text, /href="\/\/nested/, 'does not create malformed breadcrumb paths');
      t.match(
        (await request(`${baseUrl}/index.html`)).text,
        /AUTO_INDEX_MARKER/,
        'serves index.html only when explicitly requested'
      );
      t.equal(
        (await request(`${baseUrl}/.coveralls.yml`)).text,
        'service_name: coveralls',
        'serves files beginning with a dot'
      );
      const preview = await request(`${baseUrl}/nested/preview.txt`);
      t.equal(preview.headers['content-disposition'], 'inline', 'marks browser-previewable files as inline');
      t.equal(preview.text, 'preview inline', 'serves previewable files directly');
      const license = await request(`${baseUrl}/LICENSE`);
      t.match(license.headers['content-type'], /^text\/plain/, 'serves extensionless LICENSE files as text');
      t.equal(license.text, 'license preview', 'renders LICENSE content inline');
      t.match(
        (await request(`${baseUrl}/.editorconfig`)).headers['content-type'],
        /^text\/plain/,
        'serves editor config files as text'
      );
      const gitConfig = await request(`${baseUrl}/.git/config`);
      t.match(gitConfig.headers['content-type'], /^text\/plain/, 'detects extensionless Git config as text');
      t.match(gitConfig.text, /repositoryformatversion/, 'renders Git config inline');
      t.notMatch(
        String((await request(`${baseUrl}/unknown-binary`)).headers['content-type']),
        /^text\/plain/,
        'does not mislabel binary data as text'
      );
    } finally {
      if (child) await stop(child);
      rmSync(staticRoot, { recursive: true, force: true });
    }
  });

  await t.test('isolates mount applications and applies full-path proxy rules', async t => {
    const configDirectory = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-config-'));
    const rootDirectory = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-root-'));
    const ordersDirectory = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-orders-'));
    const docsDirectory = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-docs-'));
    const port = await getFreePort();
    const output = { value: '' };
    let child;
    const rootUpstream = http.createServer((req, res) => {
      res.setHeader('X-Upstream-Application', req.headers['x-application-request'] || '');
      res.setHeader('X-Upstream-Route', req.headers['x-route-request'] || '');
      res.end(`root:${req.url}`);
    });
    const ordersUpstream = http.createServer((req, res) => {
      res.setHeader('X-Upstream-Application', req.headers['x-application-request'] || '');
      res.setHeader('X-Upstream-Route', req.headers['x-route-request'] || '');
      res.end(`orders:${req.url}`);
    });
    const rootUpstreamPort = await new Promise((resolve, reject) => {
      rootUpstream.once('error', reject);
      rootUpstream.listen(0, '127.0.0.1', () => resolve(rootUpstream.address().port));
    });
    const ordersUpstreamPort = await new Promise((resolve, reject) => {
      ordersUpstream.once('error', reject);
      ordersUpstream.listen(0, '127.0.0.1', () => resolve(ordersUpstream.address().port));
    });

    try {
      mkdirSync(path.join(docsDirectory, 'nested'));
      writeFileSync(path.join(rootDirectory, 'index.html'), '<html><body>ROOT_SPA</body></html>');
      writeFileSync(path.join(ordersDirectory, 'index.html'), '<html><body>ORDERS_SPA</body></html>');
      writeFileSync(path.join(docsDirectory, 'nested', 'guide.txt'), 'guide');
      const configPath = path.join(configDirectory, 'static-server.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          mounts: [
            {
              path: '/',
              directory: rootDirectory,
              spaFallback: '/index.html',
              proxy: {
                '/api': {
                  target: `http://127.0.0.1:${rootUpstreamPort}`,
                  rewrite: false,
                  requestHeaders: { 'X-Route-Request': 'root-route' }
                }
              },
              cors: true,
              headers: { 'X-Application': 'root' },
              requestHeaders: { 'X-Application-Request': 'root-application' },
              secure: false,
              accessLog: { success: './logs/root-success.jsonl', failure: './logs/root-failure.jsonl' }
            },
            {
              path: '/orders',
              directory: ordersDirectory,
              spaFallback: '/index.html',
              proxy: {
                '/api/orders': {
                  target: `http://127.0.0.1:${ordersUpstreamPort}`,
                  rewrite: true,
                  requestHeaders: { 'X-Route-Request': 'orders-route' }
                }
              },
              headers: { 'X-Application': 'orders' },
              requestHeaders: { 'X-Application-Request': 'orders-application' },
              secure: false,
              accessLog: { success: './logs/orders-success.jsonl', failure: './logs/orders-failure.jsonl' }
            },
            { path: '/docs', directory: docsDirectory, cors: true, headers: { 'X-Application': 'docs' }, secure: false }
          ]
        })
      );

      child = spawn(
        process.execPath,
        ['src/bin/mock-service-cli', '-R', '--static-config', configPath, '-p', String(port)],
        {
          cwd: root,
          detached: process.platform !== 'win32',
          env: getCliEnv(),
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );
      child.stdout.on('data', chunk => {
        output.value += chunk.toString();
      });
      child.stderr.on('data', chunk => {
        output.value += chunk.toString();
      });

      const baseUrl = `http://127.0.0.1:${port}`;
      const rootResponse = await waitForServer(`${baseUrl}/`, child, output);
      t.match(rootResponse.text, /ROOT_SPA/, 'starts from config with a bare -R flag');
      t.equal(rootResponse.headers['x-application'], 'root', 'applies root response headers');
      t.equal(rootResponse.headers['access-control-allow-origin'], '*', 'applies root CORS');
      const ordersFallback = await request(`${baseUrl}/orders/not-found`);
      t.match(ordersFallback.text, /ORDERS_SPA/, 'mount SPA fallback remains inside the mount');
      t.equal(ordersFallback.headers['x-application'], 'orders', 'applies mount response headers');
      t.notOk(ordersFallback.headers['access-control-allow-origin'], 'does not inherit root CORS into a mount');
      t.match((await request(`${baseUrl}/outside`)).text, /ROOT_SPA/, 'root SPA fallback serves root routes');
      const docsIndex = await request(`${baseUrl}/docs/`);
      t.match(docsIndex.text, /href="\/docs\/nested\/"/, 'mount directory links retain the mount base path');
      t.equal(docsIndex.headers['x-application'], 'docs', 'applies headers to non-SPA mounts');
      t.equal(docsIndex.headers['access-control-allow-origin'], '*', 'applies CORS to non-SPA mounts');
      const nestedDocsIndex = await request(`${baseUrl}/docs/nested/`);
      t.match(nestedDocsIndex.text, /guide\.txt/, 'non-SPA mount serves its own directory index');
      t.match(nestedDocsIndex.text, /href="\/docs\/"/, 'mount directory breadcrumbs retain the mount base path');
      t.equal(
        (await request(`${baseUrl}/docs/missing`)).status,
        404,
        'non-SPA mount does not fall through to root fallback'
      );
      const ordersProxyResponse = await request(`${baseUrl}/api/orders/items?source=test`);
      t.equal(ordersProxyResponse.text, 'orders:/items?source=test', 'longest proxy route rewrites its full prefix');
      t.equal(
        ordersProxyResponse.headers['x-upstream-application'],
        'orders-application',
        'forwards mount request headers to its proxy'
      );
      t.equal(
        ordersProxyResponse.headers['x-upstream-route'],
        'orders-route',
        'forwards route request headers to its proxy'
      );
      const rootProxyResponse = await request(`${baseUrl}/api/orders2`);
      t.equal(rootProxyResponse.text, 'root:/api/orders2', 'proxy matching observes path boundaries');
      t.equal(
        rootProxyResponse.headers['x-upstream-application'],
        'root-application',
        'forwards root request headers to its proxy'
      );
      t.equal(
        rootProxyResponse.headers['x-upstream-route'],
        'root-route',
        'forwards root route request headers to its proxy'
      );
      const ansiColorPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
      const plainOutput = output.value.replace(ansiColorPattern, '');
      t.match(plainOutput, /Static application proxy routes/, 'prints the static application proxy summary');
      t.match(plainOutput, /\/orders\s+\/api\/orders.*rewrite/, 'prints the proxy owner and rewrite mode');
      const failedOrdersRequest = await requestWithMethod(`${baseUrl}/orders/not-found`, 'POST');
      t.equal(failedOrdersRequest.status, 404, 'returns a failure status for non-GET SPA requests');
      const rootSuccessLog = await waitForFileText(path.join(configDirectory, 'logs', 'root-success.jsonl'));
      t.match(rootSuccessLog, /"application":"\/"/, 'writes successful root SPA requests to the configured file');
      const ordersSuccessLog = await waitForFileText(path.join(configDirectory, 'logs', 'orders-success.jsonl'));
      t.match(
        ordersSuccessLog,
        /"application":"\/orders"/,
        'writes successful mount SPA requests to the configured file'
      );
      const ordersFailureLog = await waitForFileText(path.join(configDirectory, 'logs', 'orders-failure.jsonl'));
      t.match(ordersFailureLog, /"method":"POST".*"status":404/, 'writes failed SPA requests to the configured file');

      const conflictingDirectory = spawnSync(
        process.execPath,
        ['src/bin/mock-service-cli', '-R', rootDirectory, '--static-config', configPath, '-s'],
        { cwd: root, env: getCliEnv(), encoding: 'utf8' }
      );
      t.equal(conflictingDirectory.status, 1, 'rejects a directory together with static config');
      t.match(conflictingDirectory.stderr, /cannot be combined/, 'reports conflicting static inputs');
      const conflictingProxy = spawnSync(
        process.execPath,
        ['src/bin/mock-service-cli', '--static-config', configPath, '-O', '/api|http://127.0.0.1:1', '-s'],
        { cwd: root, env: getCliEnv(), encoding: 'utf8' }
      );
      t.equal(conflictingProxy.status, 1, 'rejects CLI proxy settings in config mode');

      const topLevelApplicationConfigPath = path.join(configDirectory, 'top-level-application.json');
      writeFileSync(
        topLevelApplicationConfigPath,
        JSON.stringify({ directory: rootDirectory, mounts: [{ path: '/orders', directory: ordersDirectory }] })
      );
      const topLevelApplication = spawnSync(process.execPath, ['src/lib/staticServer.js'], {
        cwd: root,
        env: { ...getCliEnv(), ARGV: '{}', STATIC_CONFIG: topLevelApplicationConfigPath, PORT: '0' },
        encoding: 'utf8'
      });
      t.equal(topLevelApplication.status, 1, 'rejects top-level application fields');
      t.match(
        topLevelApplication.stderr,
        /directory must be declared on a mount/,
        'reports the mounts-only configuration rule'
      );

      const nestedMountConfigPath = path.join(configDirectory, 'nested-mounts.json');
      writeFileSync(
        nestedMountConfigPath,
        JSON.stringify({
          mounts: [
            { path: '/orders', directory: ordersDirectory },
            { path: '/orders/admin', directory: docsDirectory }
          ]
        })
      );
      const nestedMounts = spawnSync(process.execPath, ['src/lib/staticServer.js'], {
        cwd: root,
        env: { ...getCliEnv(), ARGV: '{}', STATIC_CONFIG: nestedMountConfigPath, PORT: '0' },
        encoding: 'utf8'
      });
      t.equal(nestedMounts.status, 1, 'rejects nested mount paths');
      t.match(nestedMounts.stderr, /mounts paths cannot overlap/, 'reports mount path conflicts');

      const duplicateProxyConfigPath = path.join(configDirectory, 'duplicate-proxy.json');
      writeFileSync(
        duplicateProxyConfigPath,
        JSON.stringify({
          mounts: [
            {
              path: '/',
              directory: rootDirectory,
              proxy: { '/shared': { target: `http://127.0.0.1:${rootUpstreamPort}`, rewrite: false } }
            },
            {
              path: '/orders',
              directory: ordersDirectory,
              proxy: { '/shared': { target: `http://127.0.0.1:${ordersUpstreamPort}`, rewrite: false } }
            }
          ]
        })
      );
      const duplicateProxy = spawnSync(process.execPath, ['src/lib/staticServer.js'], {
        cwd: root,
        env: { ...getCliEnv(), ARGV: '{}', STATIC_CONFIG: duplicateProxyConfigPath, PORT: '0' },
        encoding: 'utf8'
      });
      t.equal(duplicateProxy.status, 1, 'rejects duplicate proxy paths across applications');
      t.match(duplicateProxy.stderr, /Duplicate proxy route/, 'reports duplicate proxy paths');
    } finally {
      if (child) await stop(child);
      await new Promise(resolve => rootUpstream.close(resolve));
      await new Promise(resolve => ordersUpstream.close(resolve));
      rmSync(configDirectory, { recursive: true, force: true });
      rmSync(rootDirectory, { recursive: true, force: true });
      rmSync(ordersDirectory, { recursive: true, force: true });
      rmSync(docsDirectory, { recursive: true, force: true });
    }
  });

  await t.test('enables SPA fallback from the single-directory CLI mode', async t => {
    const staticRoot = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-cli-spa-'));
    const port = await getFreePort();
    const output = { value: '' };
    let child;

    try {
      writeFileSync(path.join(staticRoot, 'index.html'), '<html><body>CLI_SPA</body></html>');
      child = spawn(
        process.execPath,
        ['src/bin/mock-service-cli', '-R', staticRoot, '--spa-fallback', '/index.html', '-p', String(port), '-s'],
        { cwd: root, detached: process.platform !== 'win32', env: getCliEnv(), stdio: ['ignore', 'pipe', 'pipe'] }
      );
      child.stdout.on('data', chunk => {
        output.value += chunk.toString();
      });
      child.stderr.on('data', chunk => {
        output.value += chunk.toString();
      });
      const baseUrl = `http://127.0.0.1:${port}`;
      t.match(
        (await waitForServer(`${baseUrl}/any/client/route`, child, output)).text,
        /CLI_SPA/,
        'uses CLI SPA fallback for missing routes'
      );
    } finally {
      if (child) await stop(child);
      rmSync(staticRoot, { recursive: true, force: true });
    }
  });

  await t.test('defaults an omitted mount path to root and mixes static and SPA applications', async t => {
    const configDirectory = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-mount-only-config-'));
    const mountDirectory = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-mount-only-app-'));
    const staticDirectory = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-mount-only-static-'));
    const spaDirectory = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-mount-only-spa-'));
    const port = await getFreePort();
    const output = { value: '' };
    let child;

    try {
      writeFileSync(path.join(mountDirectory, 'asset.txt'), 'mount-only');
      writeFileSync(path.join(staticDirectory, 'index.html'), '<html><body>SECOND_STATIC</body></html>');
      writeFileSync(path.join(spaDirectory, 'index.html'), '<html><body>MOUNT_SPA</body></html>');
      const configPath = path.join(configDirectory, 'static-server.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          mounts: [
            { directory: mountDirectory, headers: { 'X-Root-Mount': 'true' } },
            { path: '/static', directory: staticDirectory },
            { path: '/spa', directory: spaDirectory, spaFallback: '/index.html' }
          ]
        })
      );
      child = spawn(
        process.execPath,
        ['src/bin/mock-service-cli', '--static-config', configPath, '-p', String(port), '-s'],
        {
          cwd: root,
          detached: process.platform !== 'win32',
          env: getCliEnv(),
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );
      child.stdout.on('data', chunk => {
        output.value += chunk.toString();
      });
      child.stderr.on('data', chunk => {
        output.value += chunk.toString();
      });
      const baseUrl = `http://127.0.0.1:${port}`;
      const response = await waitForServer(`${baseUrl}/asset.txt`, child, output);
      t.equal(response.text, 'mount-only', 'defaults a directory mount without path to root');
      t.equal(response.headers['x-root-mount'], 'true', 'applies root static mount headers');
      const staticIndex = await request(`${baseUrl}/static/`);
      t.match(staticIndex.text, /目录索引/, 'keeps non-SPA mounts in directory-index mode');
      t.notMatch(staticIndex.text, /SECOND_STATIC/, 'does not infer a fallback from index.html');
      t.match(
        (await request(`${baseUrl}/static/index.html`)).text,
        /SECOND_STATIC/,
        'serves a non-SPA HTML file only when explicitly requested'
      );
      t.match(
        (await request(`${baseUrl}/spa/client/route`)).text,
        /MOUNT_SPA/,
        'serves an SPA mount beside the root static application'
      );
    } finally {
      if (child) await stop(child);
      rmSync(configDirectory, { recursive: true, force: true });
      rmSync(mountDirectory, { recursive: true, force: true });
      rmSync(staticDirectory, { recursive: true, force: true });
      rmSync(spaDirectory, { recursive: true, force: true });
    }
  });

  await t.test('disables live reload while serving static files with --no-watch', async t => {
    const staticRoot = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-no-watch-'));
    const port = await getFreePort();
    const output = { value: '' };
    let child;

    try {
      writeFileSync(path.join(staticRoot, 'index.html'), '<html><head></head><body>NO_WATCH</body></html>');
      child = spawn(
        process.execPath,
        [
          'src/bin/mock-service-cli',
          '-R',
          staticRoot,
          '--no-watch',
          '--watch-interval',
          '300',
          '-p',
          String(port),
          '-s'
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
      const home = await waitForServer(`${baseUrl}/index.html`, child, output);
      t.match(home.text, /NO_WATCH/, 'still serves the static HTML file');
      t.notMatch(home.text, /__mock-service-cli\/live-reload\.js/, 'does not inject live reload when watching is off');
      const rootIndex = await request(`${baseUrl}/`);
      t.match(rootIndex.text, /目录索引/, 'keeps serving directory indexes');
      t.notMatch(rootIndex.text, /live-reload\.js/, 'directory indexes skip the reload client too');
    } finally {
      if (child) await stop(child);
      rmSync(staticRoot, { recursive: true, force: true });
    }
  });

  await t.test('serves directory indexes with --no-os-hidden', async t => {
    const staticRoot = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-no-os-hidden-'));
    const port = await getFreePort();
    const output = { value: '' };
    let child;

    try {
      writeFileSync(path.join(staticRoot, 'plain.txt'), 'plain');
      writeFileSync(path.join(staticRoot, '.secret'), 'secret');
      child = spawn(
        process.execPath,
        ['src/bin/mock-service-cli', '-R', staticRoot, '--no-os-hidden', '-p', String(port), '-s'],
        { cwd: root, detached: process.platform !== 'win32', env: getCliEnv(), stdio: ['ignore', 'pipe', 'pipe'] }
      );
      child.stdout.on('data', chunk => {
        output.value += chunk.toString();
      });
      child.stderr.on('data', chunk => {
        output.value += chunk.toString();
      });
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForServer(`${baseUrl}/plain.txt`, child, output);
      const rootIndex = await request(`${baseUrl}/`);
      t.equal(rootIndex.status, 200, 'serves the directory index with --no-os-hidden');
      t.match(rootIndex.text, /目录索引/, 'renders the directory index');
      t.match(rootIndex.text, /plain\.txt/, 'lists a plain file');
      t.notMatch(rootIndex.text, /\.secret/, 'dotfile names stay hidden by the naming rule');
    } finally {
      if (child) await stop(child);
      rmSync(staticRoot, { recursive: true, force: true });
    }
  });

  await t.test('validates watch configuration and interval inputs', async t => {
    const staticRoot = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-static-watch-validation-'));

    try {
      const badIntervalConfig = path.join(staticRoot, 'bad-interval.json');
      writeFileSync(badIntervalConfig, JSON.stringify({ mounts: [{ directory: staticRoot }], watch: { interval: 0 } }));
      const badInterval = spawnSync(process.execPath, ['src/lib/staticServer.js'], {
        cwd: root,
        env: { ...getCliEnv(), ARGV: '{}', STATIC_CONFIG: badIntervalConfig, PORT: '0' },
        encoding: 'utf8'
      });
      t.equal(badInterval.status, 1, 'rejects a non-positive watch.interval');
      t.match(badInterval.stderr, /watch\.interval must be a positive integer/, 'reports the interval error');

      const badEnabledConfig = path.join(staticRoot, 'bad-enabled.json');
      writeFileSync(
        badEnabledConfig,
        JSON.stringify({ mounts: [{ directory: staticRoot }], watch: { enabled: 'yes' } })
      );
      const badEnabled = spawnSync(process.execPath, ['src/lib/staticServer.js'], {
        cwd: root,
        env: { ...getCliEnv(), ARGV: '{}', STATIC_CONFIG: badEnabledConfig, PORT: '0' },
        encoding: 'utf8'
      });
      t.equal(badEnabled.status, 1, 'rejects a non-boolean watch.enabled');
      t.match(badEnabled.stderr, /watch\.enabled must be boolean/, 'reports the enabled error');

      const badCliInterval = spawnSync(
        process.execPath,
        ['src/bin/mock-service-cli', '-R', staticRoot, '--watch-interval', 'abc', '-s'],
        { cwd: root, env: getCliEnv(), encoding: 'utf8' }
      );
      t.equal(badCliInterval.status, 1, 'rejects a non-integer --watch-interval');
      t.match(badCliInterval.stderr, /positive integer/, 'reports the CLI interval error');
    } finally {
      rmSync(staticRoot, { recursive: true, force: true });
    }
  });
});
