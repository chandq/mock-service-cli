const { test } = require('tap');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { CookieJar } = require('tough-cookie');
const { Engine } = require('../src/lib/apiClient/engine');
const { request, LIMITS } = require('../src/lib/apiClient/model');
const { preview } = require('../src/lib/apiClient/importers');
function listen(server) {
  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
  );
}
function close(server) {
  return new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}
function input(url, extra = {}) {
  return request({ method: 'GET', url, ...extra });
}
async function finished(engine, job) {
  while (['queued', 'running'].includes(job.state)) await new Promise(resolve => setTimeout(resolve, 10));
  return engine.view(job);
}

test('cURL with managed headers executes using generated transport headers', async t => {
  const engine = new Engine();
  t.teardown(() => engine.close());
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.end(JSON.stringify({ headers: req.headers, body: Buffer.concat(chunks).toString() }));
  });
  const base = await listen(upstream);
  t.teardown(() => close(upstream));
  const imported = preview(
    'curl',
    `curl '${base}' -H 'Connection: close' -H 'Host: wrong.test' -H 'Content-Length: 9999' -H 'Content-Type: application/json' -H 'X-Custom: kept' --data-raw '{"ok":true}'`
  ).collection.items[0];
  const execute = value => engine.execute(value, 'curl', new CookieJar(), new AbortController().signal);
  const result = await execute(imported);
  t.equal(result.status, 200);
  const received = JSON.parse(result.body);
  t.equal(received.body, '{"ok":true}');
  t.equal(received.headers.host, new URL(base).host);
  t.equal(received.headers['content-length'], String(Buffer.byteLength(received.body)));
  t.equal(received.headers['content-type'], 'application/json');
  t.equal(received.headers['x-custom'], 'kept');
  imported.headers[0].enabled = true;
  await t.rejects(execute(imported), /Connection.*由客户端管理/, 'manual overrides remain rejected');
});

test('transport preserves params/headers, streams uploads and decodes compressed responses', async t => {
  const engine = new Engine();
  t.teardown(() => engine.close());
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url === '/gzip') {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.json");
      res.end(zlib.gzipSync(JSON.stringify({ works: true })));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Repeat', ['one', 'two']);
    res.end(JSON.stringify({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }));
  });
  const base = await listen(upstream);
  t.teardown(() => close(upstream));
  const execute = value => engine.execute(value, 'a', new CookieJar(), new AbortController().signal);
  const result = await execute(
    input(`${base}/echo`, {
      method: 'POST',
      query: [
        { key: 'x', value: 'a b' },
        { key: 'x', value: '2' }
      ],
      headers: [
        { key: 'X-A', value: 'a' },
        { key: 'X-A', value: 'b' }
      ],
      body: { type: 'form', fields: [{ key: 'k', value: 'a & b' }] },
      assertions: [{ source: 'status', op: 'equals', value: 200 }]
    })
  );
  const body = JSON.parse(result.body);
  t.equal(body.url, '/echo?x=a+b&x=2');
  t.equal(body.headers['x-a'], 'a, b');
  t.equal(body.body, 'k=a+%26+b');
  t.equal(result.headers.filter(row => row.key === 'X-Repeat').length, 2);
  t.equal(result.assertions[0].passed, true);
  const compressed = await execute(input(`${base}/gzip`));
  t.same(JSON.parse(compressed.body), { works: true });
  t.equal(compressed.downloadName, '报告.json');
  const saved = engine.files.get(compressed.downloadId, 'a');
  t.equal(saved.name, '报告.json');
  t.same(JSON.parse(await fs.readFile(saved.path, 'utf8')), { works: true });
  const file = await engine.files.create('a');
  file.name = 'hello.txt';
  await fs.writeFile(file.path, 'uploaded');
  engine.files.add(file, 8);
  const multi = await execute(
    input(`${base}/echo`, {
      method: 'POST',
      body: {
        type: 'multipart',
        fields: [
          { key: 'file', value: '', file: true, uploadId: file.id },
          { key: 'a', value: 'value' }
        ]
      }
    })
  );
  t.match(JSON.parse(multi.body).body, /filename="hello.txt"/);
  t.match(JSON.parse(multi.body).body, /uploaded/);
  await t.rejects(
    engine.execute(
      input(`${base}/echo`, { method: 'POST', body: { type: 'binary', uploadId: file.id } }),
      'other',
      new CookieJar(),
      new AbortController().signal
    ),
    /不存在/
  );
  await t.rejects(
    execute(
      input(`${base}/echo`, {
        auth: { type: 'bearer', token: 'secret' },
        headers: [{ key: 'Authorization', value: 'explicit' }]
      })
    ),
    /冲突/
  );
  await t.rejects(execute(input('file:///etc/passwd')), /HTTP/);
});
test('redirects strip credentials across origins and honor POST conversion', async t => {
  const engine = new Engine();
  t.teardown(() => engine.close());
  const receiver = http.createServer((req, res) =>
    res.end(JSON.stringify({ method: req.method, headers: req.headers, url: req.url }))
  );
  const destination = await listen(receiver);
  t.teardown(() => close(receiver));
  const source = http.createServer((req, res) => {
    res.writeHead(req.url === '/keep' ? 307 : 302, { location: `${destination}/next` });
    res.end();
  });
  const base = await listen(source);
  t.teardown(() => close(source));
  const result = await engine.execute(
    input(`${base}/redirect`, {
      method: 'POST',
      headers: [
        { key: 'Cookie', value: 'private=1' },
        { key: 'X-API-Key', value: 'key' },
        { key: 'X-Keep', value: 'ok' }
      ],
      auth: { type: 'bearer', token: 'secret' },
      body: { type: 'text', text: 'hello' }
    }),
    'a',
    new CookieJar(),
    new AbortController().signal
  );
  const received = JSON.parse(result.body);
  t.equal(received.method, 'GET');
  t.notOk(received.headers.authorization);
  t.notOk(received.headers.cookie);
  t.notOk(received.headers['x-api-key']);
  t.equal(received.headers['x-keep'], 'ok');
  t.equal(result.redirects.length, 1);
  const kept = await engine.execute(
    input(`${base}/keep`, { method: 'POST', body: { type: 'text', text: 'hello' } }),
    'a',
    new CookieJar(),
    new AbortController().signal
  );
  t.equal(JSON.parse(kept.body).method, 'POST');
});
test('sequential runner extracts variables, clones cookies, cancels and cleans files', async t => {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/slow') return setTimeout(() => res.end('slow'), 2000).unref();
    if (req.url === '/first') {
      res.setHeader('Set-Cookie', 'session=value; Path=/');
      res.end('{"id":42}');
      return;
    }
    res.end(JSON.stringify({ url: req.url, cookie: req.headers.cookie }));
  });
  const base = await listen(upstream);
  t.teardown(() => close(upstream));
  const engine = new Engine();
  t.teardown(() => engine.close());
  const jar = new CookieJar();
  const job = engine.submit(
    'a',
    {
      requests: [
        input(`${base}/first`, { extractors: [{ name: 'next', source: 'json', path: '/id' }] }),
        input(`${base}/{{next}}`, {
          assertions: [{ source: 'json', path: '/cookie', op: 'equals', value: 'session=value' }]
        })
      ]
    },
    jar
  );
  const result = await finished(engine, job);
  t.equal(result.state, 'completed');
  t.match(result.results[1].body, /42/);
  t.equal(result.results[1].assertions[0].passed, true);
  t.equal(await jar.getCookieString(base), '');
  const single = engine.submit('a', { request: input(`${base}/first`) }, jar);
  await finished(engine, single);
  t.equal(await jar.getCookieString(base), 'session=value');
  const slow = engine.submit('a', { request: input(`${base}/slow`) });
  engine.cancel(slow);
  t.equal((await finished(engine, slow)).state, 'cancelled');
  const timeout = await finished(
    engine,
    engine.submit('a', { request: input(`${base}/slow`, { settings: { timeout: 1000 } }) })
  );
  t.match(timeout.results[0].error, /超时/);
  await t.rejects(
    Promise.resolve().then(() => engine.get(job.id, 'other')),
    { status: 404 }
  );
  await engine.remove(job);
  await engine.remove(single);
  t.equal(engine.files.bytes, 0);
});
test('preview truncation and decompression limits release partial files', async t => {
  const engine = new Engine();
  t.teardown(() => engine.close());
  const upstream = http.createServer((req, res) => {
    res.setHeader('content-encoding', 'gzip');
    res.end(zlib.gzipSync(Buffer.alloc(req.url === '/huge' ? LIMITS.response + 1 : LIMITS.preview + 200, 97)));
  });
  const base = await listen(upstream);
  t.teardown(() => close(upstream));
  const result = await engine.execute(input(base), 'a', new CookieJar(), new AbortController().signal);
  t.equal(result.truncated, true);
  t.equal(Buffer.byteLength(result.body), LIMITS.preview);
  t.equal(result.size, LIMITS.preview + 200);
  const before = engine.files.bytes;
  await t.rejects(engine.execute(input(`${base}/huge`), 'a', new CookieJar(), new AbortController().signal), /50 MiB/);
  t.equal(engine.files.bytes, before);
});
test('TLS validation is on by default and may be explicitly disabled per request', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msc-client-tls-'));
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-subj',
        '/CN=localhost',
        '-days',
        '1'
      ],
      { stdio: 'ignore' }
    );
  } catch {
    t.skip('openssl unavailable');
    return;
  }
  const server = https.createServer({ key: await fs.readFile(key), cert: await fs.readFile(cert) }, (req, res) =>
    res.end('secure')
  );
  const base = (await listen(server)).replace('http:', 'https:');
  t.teardown(() => close(server));
  const engine = new Engine();
  t.teardown(() => engine.close());
  await t.rejects(engine.execute(input(base), 'a', new CookieJar(), new AbortController().signal), /TLS/);
  const result = await engine.execute(
    input(base, { settings: { verifyTls: false } }),
    'a',
    new CookieJar(),
    new AbortController().signal
  );
  t.equal(result.body, 'secure');
  t.equal(result.tlsVerified, false);
});
test('100 sequential requests return temporary storage and sockets to bounded baseline', async t => {
  const engine = new Engine();
  t.teardown(() => engine.close());
  const server = http.createServer((req, res) => res.end('{"ok":true}'));
  const base = await listen(server);
  t.teardown(() => close(server));
  for (let i = 0; i < 100; i++) {
    const job = engine.submit('a', { request: input(base) });
    await finished(engine, job);
    await engine.remove(job);
  }
  t.equal(engine.files.bytes, 0);
  t.equal(engine.files.files.size, 0);
  t.equal(engine.jobs.size, 0);
  t.equal(engine.active, 0);
  t.equal(engine.activeOwners.size, 0);
  t.ok(Object.values(engine.httpAgent.freeSockets).flat().length <= 4);
});
test('scheduler enforces per-session, global and queued limits; queued cancellation releases capacity', async t => {
  const engine = new Engine();
  t.teardown(() => engine.close());
  const releases = [];
  engine.execute = () => new Promise(resolve => releases.push(() => resolve({ assertions: [], extracted: {} })));
  for (let i = 0; i < 5; i++) engine.submit('a', { request: input('http://localhost') });
  for (const owner of ['b', 'c', 'd'])
    for (let i = 0; i < 4; i++) engine.submit(owner, { request: input('http://localhost') });
  t.equal(engine.activeOwners.get('a'), 4);
  t.equal(engine.active, 16);
  t.equal(engine.queue.length, 1);
  const queued = engine.queue[0].job;
  engine.cancel(queued);
  t.equal(engine.queue.length, 0);
  t.equal(queued.state, 'cancelled');
  for (let i = 0; i < 100; i++) engine.submit('z', { request: input('http://localhost') });
  t.throws(() => engine.submit('z', { request: input('http://localhost') }), { status: 429 });
  for (const item of [...engine.queue]) engine.cancel(item.job);
  for (const release of releases) release();
  await Promise.all([...engine.jobs.values()].map(job => job.promise));
  t.equal(engine.active, 0);
});
