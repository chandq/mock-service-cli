const { test } = require('tap');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const { createClientServer } = require('../src/lib/apiClient/server');

async function session(base, password) {
  let response;
  if (password)
    response = await fetch(`${base}/__api-client/api/session`, {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
  else response = await fetch(base);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  const config = await (await fetch(`${base}/__api-client/api/config`, { headers: { Cookie: cookie } })).json();
  return { Cookie: cookie, 'X-Api-Client-Token': config.token, Origin: base };
}
test('HTTP API authentication, origin isolation, imports, writes and ownership', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msc-client-server-'));
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }));
  const client = createClientServer({ root: path.join(dir, 'workspace'), password: 'test-password' });
  t.teardown(() => client.close());
  const address = await client.listen();
  const base = `http://127.0.0.1:${address.port}`;
  t.equal((await fetch(base, { redirect: 'manual' })).status, 302);
  t.equal((await fetch(`${base}/__api-client/api/config`)).status, 401);
  t.equal(
    (
      await fetch(`${base}/__api-client/api/session`, {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' })
      })
    ).status,
    401
  );
  const headers = await session(base, 'test-password');
  t.equal((await fetch(base, { headers })).status, 200);
  t.equal((await fetch(`${base}/__api-client/api/collections`, { headers: { Cookie: headers.Cookie } })).status, 403);
  t.equal(
    (await fetch(`${base}/__api-client/api/collections`, { headers: { ...headers, Origin: 'http://attacker.test' } }))
      .status,
    403
  );
  const invalidHostStatus = await new Promise((resolve, reject) => {
    http
      .get(
        `${base}/__api-client/api/collections`,
        { headers: { ...headers, Host: `attacker.test:${address.port}` } },
        response => {
          response.resume();
          resolve(response.statusCode);
        }
      )
      .on('error', reject);
  });
  t.equal(invalidHostStatus, 403);
  t.equal(
    (await fetch(`${base}/__api-client/api/collections`, { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } }))
      .status,
    403
  );
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
  const imported = await (
    await fetch(`${base}/__api-client/api/imports/preview`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ format: 'curl', text: 'curl https://example.com' })
    })
  ).json();
  t.equal(imported.count, 1);
  await t.rejects(fs.stat(path.join(dir, 'workspace')), { code: 'ENOENT' });
  const id = imported.collection.id;
  const saved = await (
    await fetch(`${base}/__api-client/api/collections/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(imported.collection)
    })
  ).json();
  t.ok(saved.revision);
  t.equal(
    (
      await fetch(`${base}/__api-client/api/collections/${id}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(imported.collection)
      })
    ).status,
    409
  );
  const uploaded = await (
    await fetch(`${base}/__api-client/api/uploads`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream', 'X-File-Name': 'sample.txt' },
      body: 'hello'
    })
  ).json();
  t.ok(uploaded.uploadId);
  const other = await session(base, 'test-password');
  t.equal(
    (await fetch(`${base}/__api-client/api/uploads/${uploaded.uploadId}`, { method: 'DELETE', headers: other })).status,
    404
  );
  const upstream = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<script>globalThis.compromised=true</script>');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.teardown(() => new Promise(resolve => upstream.close(resolve)));
  const result = await fetch(`${base}/__api-client/api/executions`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      request: {
        id: crypto.randomUUID(),
        name: 'xss',
        method: 'GET',
        url: `http://127.0.0.1:${upstream.address().port}`
      }
    })
  });
  t.equal(result.status, 202);
  const job = await result.json();
  let finished;
  for (let i = 0; i < 100; i++) {
    finished = await (await fetch(`${base}/__api-client/api/executions/${job.executionId}`, { headers })).json();
    if (finished.state === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  t.equal(finished.state, 'completed');
  const downloadId = finished.results[0].downloadId;
  t.equal((await fetch(`${base}/__api-client/api/executions/${job.executionId}`, { headers: other })).status, 404);
  t.equal((await fetch(`${base}/__api-client/api/downloads/${downloadId}`, { headers: other })).status, 404);
  const download = await fetch(`${base}/__api-client/api/downloads/${downloadId}`, { headers });
  t.match(download.headers.get('content-type'), /octet-stream/);
  t.match(download.headers.get('content-disposition'), /attachment/);
  t.match(download.headers.get('content-disposition'), /filename="response.html"/);
  t.equal(finished.results[0].downloadName, 'response.html');
  t.equal(await download.text(), '<script>globalThis.compromised=true</script>');
  const report = await (
    await fetch(`${base}/__api-client/api/executions/${job.executionId}/report`, { headers })
  ).json();
  t.notOk(report.results[0].body);
  t.notOk(report.results[0].url);
  await fetch(`${base}/__api-client/api/session`, { method: 'DELETE', headers });
  t.equal(client.engine.files.bytes, 0);
  t.equal((await fetch(base, { headers, redirect: 'manual' })).status, 302);
});

test('CLI validates mode conflicts and ports', t => {
  const root = path.resolve(__dirname, '..');
  for (const args of [
    ['--api-client', '-e', '.'],
    ['--api-client', '-d', '.'],
    ['--api-client', '--port', '-1']
  ]) {
    const child = spawnSync(process.execPath, ['src/bin/mock-service-cli', ...args], { cwd: root, encoding: 'utf8' });
    t.equal(child.status, 1);
    t.match(child.stderr, /api-client|port/);
  }
  const help = spawnSync(process.execPath, ['src/bin/mock-service-cli', '--help'], { cwd: root, encoding: 'utf8' });
  t.match(help.stdout, /--api-client/);
  t.end();
});
for (const entry of ['src/bin/mock-service-cli', 'bin/mock-service-cli']) {
  test(`${entry} server reports a port taken after discovery`, async t => {
    const occupied = http.createServer((req, res) => res.end('existing server'));
    t.teardown(() => new Promise(resolve => occupied.close(resolve)));
    await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
    const port = occupied.address().port;
    const password = 'startup-test-secret';
    const serverEntry = entry.startsWith('src/') ? 'src/lib/apiClientServer.js' : 'dist/apiClientServer.js';
    const child = spawnSync(process.execPath, [serverEntry], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        PORT: String(port),
        SERVER_HOST: '127.0.0.1',
        API_CLIENT_AUTH: password,
        SILENT: 'true'
      },
      encoding: 'utf8',
      timeout: 10000
    });
    t.error(child.error, 'failed startup exits without hanging');
    t.equal(child.status, 1);
    t.match(child.stderr, `端口 ${port} 已被占用（EADDRINUSE）`);
    t.match(child.stderr, '--api-client --port 0');
    t.notMatch(child.stderr + child.stdout, password);
    t.notMatch(child.stdout, 'API Client available on:');
    t.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'existing server');
  });
  for (const mode of ['system-assigned port', 'occupied port', 'host only', 'auth only', 'host and auth']) {
    test(`${entry} launches API Client with ${mode} and releases its port`, async t => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msc-client-cli-'));
      t.teardown(() => fs.rm(dir, { recursive: true, force: true }));
      let requestedPort = 0;
      if (mode === 'occupied port') {
        const occupied = http.createServer((req, res) => res.end('existing server'));
        t.teardown(() => new Promise(resolve => occupied.close(resolve)));
        await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
        requestedPort = occupied.address().port;
      }
      const flags = [];
      const password = mode.includes('auth') ? 'cli-auth-secret' : undefined;
      if (mode.includes('host')) flags.push('--host');
      if (password) flags.push('--auth', password);
      const child = spawn(process.execPath, [entry, '--api-client', dir, '--port', String(requestedPort), ...flags], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, NODE_OPTIONS: '', SILENT: '' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      child.stdout.on('data', chunk => {
        output += chunk;
      });
      child.stderr.on('data', chunk => {
        output += chunk;
      });
      t.teardown(() => {
        if (child.exitCode !== null) return;
        if (process.platform === 'win32')
          spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
        else child.kill('SIGTERM');
      });
      let url;
      for (let i = 0; i < 150; i++) {
        url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (url || child.exitCode !== null) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      t.ok(url, output || 'CLI emits its actual bound port');
      if (!url) return;
      if (requestedPort) {
        t.ok(Number(new URL(url).port) > requestedPort, 'portfinder skips the occupied port');
        t.equal(await (await fetch(`http://127.0.0.1:${requestedPort}`)).text(), 'existing server');
      }
      t.equal((await fetch(url, { redirect: 'manual' })).status, password ? 302 : 200);
      t.notMatch(output, 'cli-auth-secret');
      const headers = await session(url, password);
      const execution = await (
        await fetch(`${url}/__api-client/api/executions`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request: {
              name: 'Packaged worker',
              method: 'GET',
              url: `${url}/login`,
              assertions: [{ source: 'status', op: 'equals', value: 200 }]
            }
          })
        })
      ).json();
      let result;
      for (let attempt = 0; attempt < 100; attempt++) {
        result = await (await fetch(`${url}/__api-client/api/executions/${execution.executionId}`, { headers })).json();
        if (!['running', 'queued'].includes(result.state)) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      t.equal(result.results[0]?.assertions[0]?.passed, true, 'standalone assertion worker executes from this entry');

      if (process.platform === 'win32') {
        t.skip('native console Ctrl+C is checked in Windows CI adapter tests');
        return;
      }
      const exit = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGINT');
      await Promise.race([
        exit,
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('CLI did not stop')), 5000);
          timer.unref();
        })
      ]);
      await t.rejects(fetch(url), 'server port is closed');
    });
  }
}
