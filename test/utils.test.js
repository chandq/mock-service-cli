const test = require('tap').test;
const fs = require('fs');
const path = require('path');
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
  throttle
} = require('../lib/utils');

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

  const errorContent = getFileLatestContent('/non/existent/path.js');
  t.equal(errorContent, 'getFileLatestContent_ERROR', 'returns error on invalid path');

  t.end();
});

test('SupportMethods and DefaultHeaders constants', t => {
  t.plan(2);

  t.ok(Array.isArray(SupportMethods), 'SupportMethods is array');
  t.ok(typeof DefaultHeaders === 'string', 'DefaultHeaders is string');

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

  let counter = 0;
  const func = () => {
    counter++;
  };

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

  let counter = 0;
  const func = () => {
    counter++;
  };

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
