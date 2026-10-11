const { test } = require('tap');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { request, resource, interpolate, variables, evaluate, redact } = require('../src/lib/apiClient/model');
const { Workspace } = require('../src/lib/apiClient/store');
const { preview, exportCurl } = require('../src/lib/apiClient/importers');
const { shouldWaitForConsoleChildShutdown } = require('../src/lib/processShutdown');
const fresh = () => request({ method: 'GET', url: 'http://localhost/', name: 'sample' });

test('request validation and variable precedence preserve repeated parameters', t => {
  const value = request({
    ...fresh(),
    query: [
      { key: 'a', value: '{{x}}' },
      { key: 'a', value: '2' }
    ]
  });
  const vars = variables([{ key: 'x', value: 'collection' }], [{ key: 'x', value: 'env' }], { x: 'runtime' });
  t.equal(interpolate(value, vars).query[0].value, 'runtime');
  t.equal(value.query.length, 2);
  t.throws(() => interpolate('{{missing}}', vars), /未定义变量/);
  t.throws(() => request({ ...fresh(), method: 'TRACE' }), /HTTP/);
  t.throws(() => request({ ...fresh(), settings: { timeout: 0 } }), /超时/);
  t.throws(() => resource('collections', JSON.parse('{"name":"x","__proto__":{}}')), /字段/);
  t.throws(
    () =>
      resource('collections', {
        name: 'x',
        items: [
          { ...fresh(), id: 'same' },
          { ...fresh(), id: 'same' }
        ]
      }),
    /唯一/
  );
  t.equal(shouldWaitForConsoleChildShutdown('win32', 'apiClientServer', 'SIGINT'), true);
  t.end();
});
test('declarative assertions and JSON Pointer extraction', t => {
  const result = evaluate(
    {
      assertions: [
        { source: 'status', op: 'equals', value: 200 },
        { source: 'json', path: '/a~1b/~0key/0', op: 'type', value: 'number' },
        { source: 'header', path: 'x-id', op: 'contains', value: 'foo' },
        { source: 'time', op: 'lessThan', value: 100 },
        { source: 'json', path: '/missing', op: 'exists' }
      ],
      extractors: [
        { name: 'next', source: 'json', path: '/a~1b/~0key/0' },
        { name: '__proto__', source: 'status' }
      ]
    },
    { status: 200, duration: 20, headers: [{ key: 'X-ID', value: 'foobar' }] },
    { 'a/b': { '~key': [3] } }
  );
  t.same(
    result.assertions.map(row => row.passed),
    [true, true, true, true, false]
  );
  t.equal(result.extracted.next, '3');
  t.equal(result.extractionErrors.length, 1);
  t.same(
    redact({
      auth: { type: 'bearer', token: 'private' },
      headers: [{ key: 'Authorization', value: 'secret' }],
      variables: [
        { key: 'x', value: '123', secret: true },
        { key: 'token', value: '{{token}}' }
      ]
    }),
    {
      auth: { type: 'bearer', token: '' },
      headers: [{ key: 'Authorization', value: '' }],
      variables: [
        { key: 'x', value: '', secret: true },
        { key: 'token', value: '{{token}}' }
      ]
    }
  );
  t.end();
});
test('workspace initializes on save, detects conflicts, rejects symlinks and strips secrets', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msc-client-store-'));
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'workspace');
  const store = new Workspace(root);
  const id = crypto.randomUUID();
  t.same(await store.list('collections'), []);
  await t.rejects(fs.stat(root), { code: 'ENOENT' });
  const saved = await store.write('collections', id, {
    name: 'test',
    items: [{ ...fresh(), auth: { type: 'bearer', token: 'never-save' } }]
  });
  t.ok(saved.revision);
  t.equal((await store.read('collections', id)).items[0].auth.token, '');
  await t.rejects(store.write('collections', id, { ...saved, name: 'conflict' }), { status: 409 });
  await fs.writeFile(path.join(root, 'collections', `${id}.json`), JSON.stringify({ ...saved, name: 'external' }));
  await t.rejects(store.write('collections', id, saved, saved.revision), { status: 409 });
  const latest = await store.read('collections', id);
  t.equal(latest.name, 'external');
  await store.write('collections', id, null, latest.revision, true);
  t.same(await store.list('collections'), []);
  await t.rejects(store.read('collections', '../x'), /ID/);
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(dir, 'outside'), path.join(root, 'collections', `${id}.json`));
    await t.rejects(store.read('collections', id), /无效/);
    await fs.rm(path.join(root, 'collections'), { recursive: true });
    await fs.mkdir(path.join(dir, 'outside'));
    await fs.symlink(path.join(dir, 'outside'), path.join(root, 'collections'));
    await t.rejects(store.write('collections', id, { name: 'x', items: [] }), /符号链接/);
  }
});
test('cURL imports quoting, repeated headers, forms and rejects executable input', t => {
  const report = preview(
    'curl',
    "curl 'https://example.com/path?a=1&a=2' -X POST -H 'X-A: first' -H 'X-A: second' --data-raw '{\"name\":\"hello\"}'"
  );
  t.equal(report.count, 1);
  const value = report.collection.items[0];
  t.equal(value.method, 'POST');
  t.equal(value.headers.length, 2);
  t.equal(value.body.text, '{"name":"hello"}');
  t.throws(() => preview('curl', 'curl https://example.com; echo secret'), /shell/);
  t.throws(() => preview('curl', 'curl $(cat token)'), /shell/);
  t.throws(() => preview('curl', 'curl https://example.com --output /tmp/x'), /不支持/);
  t.match(preview('curl', 'curl https://example.com -F file=@secret.txt').warnings.join(), /选择/);
  const output = exportCurl({
    ...fresh(),
    method: 'POST',
    body: { type: 'json', text: '{"value":"a\u0027b"}' },
    auth: { type: 'bearer', token: 'secret' }
  });
  t.notMatch(output, /secret/);
  t.match(output, /\{\{token\}\}/);
  t.equal(preview('curl', output).count, 1);
  t.end();
});
test('Postman import reports scripts and preserves folders and supported auth', t => {
  const report = preview(
    'postman',
    JSON.stringify({
      info: { name: 'Migration', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      event: [{ script: {} }],
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
      variable: [{ key: 'baseUrl', value: 'http://localhost' }],
      item: [
        {
          name: 'folder',
          item: [
            {
              name: 'request',
              request: {
                method: 'GET',
                url: {
                  raw: '{{baseUrl}}/x?q=1',
                  query: [
                    { key: 'q', value: '1' },
                    { key: 'q', value: '2' }
                  ]
                }
              }
            }
          ]
        }
      ]
    })
  );
  t.equal(report.count, 1);
  t.match(report.warnings.join(), /脚本/);
  t.equal(report.collection.items[0].items[0].query.length, 2);
  t.equal(report.collection.items[0].items[0].auth.token, '{{token}}');
  t.end();
});
test('OpenAPI YAML imports internal references, examples, auth and warns external references', t => {
  const report = preview(
    'openapi',
    `openapi: 3.1.0
info:
  title: Demo
servers:
  - url: https://example.com
components:
  parameters:
    id:
      name: id
      in: path
      example: 42
  securitySchemes:
    token:
      type: http
      scheme: bearer
security:
  - token: []
paths:
  /users/{id}:
    get:
      tags: [Users]
      parameters:
        - $ref: '#/components/parameters/id'
        - $ref: 'file:///etc/passwd'
      summary: Read user
`
  );
  t.equal(report.count, 1);
  const value = report.collection.items[0].items[0];
  t.equal(value.url, 'https://example.com/users/42');
  t.equal(value.auth.type, 'bearer');
  t.match(report.warnings.join(), /外部引用/);
  t.throws(() => preview('native', '{"schemaVersion":2,"name":"x"}'), /schemaVersion/);
  t.throws(() => preview('openapi', 'a: &a [*a]'), /嵌套/);
  t.end();
});
test('disabled parameters do not resolve variables; nested templates detect cycles', t => {
  t.same(interpolate([{ key: 'disabled', value: '{{missing}}', enabled: false }], {}), [
    { key: 'disabled', value: '{{missing}}', enabled: false }
  ]);
  t.equal(
    interpolate('{{base}}/users', { base: '{{origin}}/api', origin: 'https://example.com' }),
    'https://example.com/api/users'
  );
  t.throws(() => interpolate('{{a}}', { a: '{{b}}', b: '{{a}}' }), /循环/);
  t.same(redact({ headers: [{ key: 'Authorization', value: 'Bearer {{token}}' }] }), {
    headers: [{ key: 'Authorization', value: 'Bearer {{token}}' }]
  });
  t.end();
});

test('exports remove literal credentials in URL query strings', t => {
  t.equal(
    redact({ url: 'https://example.com/?api_key=private&token={{token}}&q=ok' }).url,
    'https://example.com/?api_key=&token={{token}}&q=ok'
  );
  t.end();
});

test('environment scope overrides collection secrets and unfilled secrets block sending', t => {
  const vars = variables(
    [{ key: 'x', value: 'collection-secret', secret: true }],
    [{ key: 'x', value: 'environment' }]
  );
  t.equal(interpolate('{{x}}', vars), 'environment');
  const missing = variables([{ key: 'x', value: 'collection' }], [{ key: 'x', secret: true }]);
  t.throws(() => interpolate('{{x}}', missing), /未定义变量/);
  t.end();
});
