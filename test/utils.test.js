const test = require('tap').test;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  getLogger,
  dateFormat,
  logger,
  SupportMethods,
  DefaultHeaders,
  isValidMethod,
  getFileLatestContent,
  filePath2ApiUrl,
  getDataType,
  isEmptyObj,
  writeStream,
  readStream,
  debounce,
  throttle,
  getServerHost,
  getServerUrls,
  parseHostAllowlist,
  isAddressAllowed,
  isHiddenPath
} = require('../src/lib/utils');

test('getLogger function - with args', async t => {
  t.plan(2);

  const logDir = path.resolve(__dirname, '../');
  const logInstance = getLogger(logDir);

  t.ok(logInstance.log, 'log function exists');
  t.ok(logInstance.error, 'error function exists');

  t.end();
});

test('dateFormat function - with args', t => {
  t.plan(4);

  const now = new Date();
  const fullDate = dateFormat('YYYY-mm-dd HH:MM:SS:fff', now);
  const shortDate = dateFormat('YYYY-mm-dd', now);

  t.ok(fullDate.length > 0, 'full date format');
  t.ok(shortDate.length > 0, 'short date format');
  t.equal(dateFormat('YYYY', now), now.getFullYear().toString(), 'year');
  t.equal(dateFormat('mm', now), String(now.getMonth() + 1).padStart(2, '0'), 'month');

  t.end();
});

test('logger function - with args', t => {
  t.plan(4);

  const logSilent = logger(true);
  const logNormal = logger(false);

  t.ok(logSilent.info, 'silent info function');
  t.ok(logSilent.assert, 'silent assert function');
  t.ok(logNormal.info, 'normal info function');
  t.ok(logNormal.assert, 'normal assert function');

  t.end();
});

test('isValidMethod function - with args', t => {
  t.plan(8);

  t.ok(isValidMethod('GET'), 'GET is valid');
  t.ok(isValidMethod('POST'), 'POST is valid');
  t.ok(isValidMethod('put'), 'put is valid');
  t.ok(isValidMethod('DELETE'), 'DELETE is valid');
  t.ok(isValidMethod('OPTIONS'), 'OPTIONS is valid');
  t.ok(isValidMethod('PATCH'), 'PATCH is valid');
  t.notOk(isValidMethod('INVALID'), 'INVALID is not valid');
  t.notOk(isValidMethod(''), 'empty string is not valid');

  t.end();
});

test('filePath2ApiUrl function - with args', t => {
  t.plan(1);

  const filePath = path.join('path', 'to', 'file');
  const apiUrl = filePath2ApiUrl(filePath);

  t.ok(apiUrl.includes('/') || apiUrl.includes(path.sep), 'converts separators');

  t.end();
});

test('getDataType function - with args', t => {
  t.plan(10);

  t.equal(getDataType('string'), 'string', 'string type');
  t.equal(getDataType(123), 'number', 'number type');
  t.equal(getDataType(true), 'boolean', 'boolean type');
  t.equal(getDataType({}), 'object', 'object type');
  t.equal(getDataType([]), 'array', 'array type');
  t.equal(getDataType(null), 'null', 'null type');
  t.equal(getDataType(undefined), 'undefined', 'undefined type');
  t.equal(
    getDataType(() => {}),
    'function',
    'function type'
  );
  t.equal(getDataType(new Date()), 'date', 'date type');
  t.equal(getDataType(/regex/), 'regexp', 'regexp type');

  t.end();
});

test('isEmptyObj function - with args', t => {
  t.plan(4);

  t.ok(isEmptyObj({}), 'empty object');
  t.notOk(isEmptyObj({ key: 'value' }), 'non-empty object');
  t.notOk(isEmptyObj([]), 'array is not empty object');
  t.notOk(isEmptyObj(null), 'null is not empty object');

  t.end();
});

test('writeStream and readStream functions - with args', async t => {
  t.plan(3);

  const testFile = path.resolve(__dirname, './test-stream.txt');
  const testContent = 'Test content for stream';

  await writeStream(testFile, testContent);
  t.ok(fs.existsSync(testFile), 'file is written');

  const readContent = await readStream(testFile);
  t.equal(readContent, testContent, 'content matches');

  fs.unlinkSync(testFile);
  t.notOk(fs.existsSync(testFile), 'file is deleted');

  t.end();
});

test('debounce function - with args', t => {
  t.plan(1);

  let count = 0;
  const debouncedFn = debounce(() => count++, 10);

  debouncedFn();
  debouncedFn();
  debouncedFn();

  setTimeout(() => {
    t.equal(count, 1, 'debounced');
    t.end();
  }, 100);
});

test('throttle function - with args', t => {
  t.plan(1);

  let count = 0;
  const throttledFn = throttle(() => count++, 10, true);

  throttledFn();
  throttledFn();
  throttledFn();

  t.equal(count, 1, 'throttled');
  t.end();
});

test('debounce cancel function', t => {
  t.plan(1);

  let count = 0;
  const debouncedFn = debounce(() => count++, 10);

  debouncedFn();
  debouncedFn.cancel();

  setTimeout(() => {
    t.equal(count, 0, 'canceled');
    t.end();
  }, 100);
});

test('throttle cancel function', t => {
  t.plan(1);

  let count = 0;
  const throttledFn = throttle(() => count++, 10, true);

  throttledFn();
  throttledFn.cancel();

  t.equal(count, 1, 'initial call executed');
  t.end();
});

test('getFileLatestContent function - with args', t => {
  t.plan(2);

  const testModule = path.resolve(__dirname, './test-module.js');
  fs.writeFileSync(testModule, 'module.exports = { test: "value" };');

  const content = getFileLatestContent(testModule);
  t.equal(content.test, 'value', 'reads module content');

  fs.unlinkSync(testModule);

  const originalConsoleError = console.error;
  let errorContent;
  try {
    console.error = () => {};
    errorContent = getFileLatestContent('/non/existent/path.js');
  } finally {
    console.error = originalConsoleError;
  }
  t.equal(errorContent, 'getFileLatestContent_ERROR', 'returns error on invalid path');

  t.end();
});

test('SupportMethods and DefaultHeaders constants', t => {
  t.plan(2);

  t.ok(Array.isArray(SupportMethods), 'SupportMethods is array');
  t.ok(typeof DefaultHeaders === 'string', 'DefaultHeaders is string');

  t.end();
});

test('server host helpers use loopback by default and expose interfaces on demand', t => {
  const previousHost = process.env.SERVER_HOST;
  delete process.env.SERVER_HOST;
  t.equal(getServerHost(), '127.0.0.1', 'uses IPv4 loopback by default');

  process.env.SERVER_HOST = '0.0.0.0';
  t.equal(getServerHost(), '0.0.0.0', 'uses all IPv4 interfaces when requested');
  t.ok(getServerUrls(8090).includes('http://127.0.0.1:8090'), 'includes local IPv4 URL');

  if (previousHost === undefined) {
    delete process.env.SERVER_HOST;
  } else {
    process.env.SERVER_HOST = previousHost;
  }
  t.end();
});

test('host allowlist parses gitignore-style lines and supports IP/CIDR matching', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-allowlist-'));
  const allowlistPath = path.join(tempDir, 'allowed-ips.txt');
  fs.writeFileSync(allowlistPath, '# office network\n192.168.10.4\n10.20.0.0/16\n2001:db8::/32\n');

  try {
    const rules = parseHostAllowlist(allowlistPath);
    t.equal(rules.length, 3, 'reads non-comment allowlist entries');
    t.ok(isAddressAllowed('127.0.0.1', rules), 'always allows IPv4 loopback');
    t.ok(isAddressAllowed('10.20.50.8', rules), 'allows IPv4 CIDR match');
    t.ok(isAddressAllowed('2001:db8::42', rules), 'allows IPv6 CIDR match');
    t.notOk(isAddressAllowed('10.21.50.8', rules), 'rejects addresses outside the allowlist');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  t.end();
});

test('test logger function with silent mode', t => {
  t.plan(3);

  const silentLogger = logger(true);
  t.ok(typeof silentLogger === 'object', 'logger returns object');
  t.ok(typeof silentLogger.info === 'function', 'info is a function');
  t.ok(typeof silentLogger.assert === 'function', 'assert is a function');

  silentLogger.info('test silent info');
  silentLogger.assert(true, 'test silent assert');

  t.end();
});

test('test logger function with non-silent mode', t => {
  t.plan(3);

  const normalLogger = logger(false);
  t.ok(typeof normalLogger === 'object', 'logger returns object');
  t.ok(typeof normalLogger.info === 'function', 'info is a function');
  t.ok(typeof normalLogger.assert === 'function', 'assert is a function');

  t.end();
});

test('test throttle function - edge cases', t => {
  t.plan(3);

  const func = () => {};

  const throttled = throttle(func, 100, false);
  t.ok(typeof throttled === 'function', 'throttle returns a function');
  t.ok(typeof throttled.cancel === 'function', 'throttle function has cancel method');

  // Test immediate case
  let immediateCounter = 0;
  const immediateFunc = () => {
    immediateCounter++;
  };
  const immediateThrottled = throttle(immediateFunc, 100, true);
  immediateThrottled();
  t.equal(immediateCounter, 1, 'immediate execution works');

  t.end();
});

test('test throttle function - delayed call', t => {
  t.plan(2);

  const func = () => {};

  const throttled = throttle(func, 50, false);

  // First call
  throttled();

  // Test cancel
  throttled.cancel();

  t.pass('cancel works');

  setTimeout(() => {
    t.pass('test completed');
    t.end();
  }, 100);
});

test('isHiddenPath rejects invalid input', t => {
  t.plan(4);

  t.equal(isHiddenPath(''), false, 'empty string is not hidden');
  t.equal(isHiddenPath(null), false, 'null is not hidden');
  t.equal(isHiddenPath(undefined), false, 'undefined is not hidden');
  t.equal(isHiddenPath(42), false, 'non-string is not hidden');

  t.end();
});

test('isHiddenPath treats dotfile basenames as hidden on every platform', t => {
  t.plan(3);

  t.equal(isHiddenPath(path.join(os.tmpdir(), '.secret')), true, 'dotfile is hidden');
  t.equal(isHiddenPath(path.join(os.tmpdir(), '..')), false, 'parent dir reference is not hidden');
  t.equal(isHiddenPath(path.join(os.tmpdir(), 'README.md')), false, 'plain file is not hidden');

  t.end();
});

test('isHiddenPath honors the Windows hidden attribute', t => {
  if (process.platform !== 'win32') {
    t.skip('Windows hidden attribute only applies on win32');
    t.end();
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-hidden-'));
  const plainFile = path.join(tempDir, 'plain.txt');
  const hiddenFile = path.join(tempDir, 'secret.txt');
  const plainDir = path.join(tempDir, 'plain-dir');
  const hiddenDir = path.join(tempDir, 'secret-dir');
  fs.writeFileSync(plainFile, 'x');
  fs.writeFileSync(hiddenFile, 'x');
  fs.mkdirSync(plainDir);
  fs.mkdirSync(hiddenDir);
  spawnSync('attrib', ['+H', hiddenFile]);
  spawnSync('attrib', ['+H', hiddenDir]);

  try {
    t.equal(isHiddenPath(plainFile), false, 'normal file is visible');
    t.equal(isHiddenPath(hiddenFile), true, 'file with hidden attribute is hidden');
    t.equal(isHiddenPath(plainDir), false, 'normal directory is visible');
    t.equal(isHiddenPath(hiddenDir), true, 'directory with hidden attribute is hidden');
  } finally {
    spawnSync('attrib', ['-H', hiddenFile]);
    spawnSync('attrib', ['-H', hiddenDir]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  t.end();
});
