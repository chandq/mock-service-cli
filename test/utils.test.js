const test = require('tap').test;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
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
  isHiddenPath,
  getDirectoryHiddenNames,
  openPathInFileManager
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

test('getDirectoryHiddenNames never spawns outside win32 and follows naming rules', async t => {
  t.plan(4);

  const directory = path.join(os.tmpdir(), 'mock-service-cli-hidden-names');
  let execCalls = 0;
  const hidden = await getDirectoryHiddenNames(directory, ['.secret', 'plain.txt', '.dir', 'photo.jpg'], {
    platform: 'linux',
    cache: false,
    execFile: () => {
      execCalls += 1;
    }
  });

  t.equal(execCalls, 0, 'does not spawn a child process on non-Windows platforms');
  t.ok(hidden.has('.secret'), 'dotfile basename is hidden');
  t.ok(hidden.has('.dir'), 'dot directory basename is hidden');
  t.notOk(hidden.has('photo.jpg'), 'plain file is visible');

  t.end();
});

test('getDirectoryHiddenNames checks small win32 dirs with async per-entry attrib, not PowerShell', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-hidden-small-'));

  let execCalls = 0;
  let attribCalls = 0;
  const hidden = await getDirectoryHiddenNames(tempDir, ['.config', 'plain.txt', 'secret.txt'], {
    platform: 'win32',
    cache: false,
    execFile: () => {
      execCalls += 1;
    },
    attribExecFile: (command, args, options, callback) => {
      attribCalls += 1;
      const filePath = args[0];
      const isHidden = path.basename(filePath) === 'secret.txt';
      callback(null, (isHidden ? 'A  H  ' : 'A     ') + `C:\\tmp\\${path.basename(filePath)}`);
    }
  });

  fs.rmSync(tempDir, { recursive: true, force: true });

  t.equal(execCalls, 0, 'does not batch small directories through PowerShell');
  t.equal(attribCalls, 2, 'checks each non-dot candidate with a per-entry attrib');
  t.ok(hidden.has('.config'), 'dotfile basename is hidden');
  t.notOk(hidden.has('plain.txt'), 'normal file is visible');
  t.ok(hidden.has('secret.txt'), 'candidate with the hidden attribute is detected');

  t.end();
});

test('getDirectoryHiddenNames batches large win32 directories through one PowerShell call', async t => {
  t.plan(6);

  const directory = path.join(os.tmpdir(), 'mock-service-cli-hidden-bulk');
  const names = [];
  for (let index = 0; index < 10; index += 1) names.push(`photo${index}.jpg`);
  names.push('秘密.bin', '普通.txt', '.config');

  let captured;
  const hidden = await getDirectoryHiddenNames(directory, names, {
    platform: 'win32',
    cache: false,
    execFile: (command, args, options, callback) => {
      captured = { command, args };
      const output = ['photo1.jpg\t0', 'photo3.jpg\t1', '秘密.bin\t1', '普通.txt\t0'].join('\r\n');
      callback(null, output);
    }
  });

  t.equal(captured.command, 'powershell.exe', 'uses PowerShell to read hidden attributes');
  t.match(captured.args.join(' '), /Get-ChildItem/, 'lists children with attributes');
  t.ok(hidden.has('.config'), 'dotfile basename is hidden');
  t.ok(hidden.has('photo3.jpg'), 'hidden ASCII file is detected');
  t.ok(hidden.has('秘密.bin'), 'hidden non-ASCII file is detected');
  t.notOk(hidden.has('photo1.jpg'), 'visible file stays visible');

  t.end();
});

test('getDirectoryHiddenNames falls back to per-entry attrib when PowerShell fails', async t => {
  t.plan(3);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-hidden-fallback-'));
  const names = [];
  for (let index = 0; index < 10; index += 1) {
    const name = `file${index}.txt`;
    fs.writeFileSync(path.join(tempDir, name), 'x');
    names.push(name);
  }

  const hidden = await getDirectoryHiddenNames(tempDir, [...names, '.secret'], {
    platform: 'win32',
    cache: false,
    execFile: (command, args, options, callback) => {
      callback(new Error('ENOENT'));
    }
  });

  fs.rmSync(tempDir, { recursive: true, force: true });

  t.notOk(hidden.has('file0.txt'), 'falls back without throwing for visible files');
  t.ok(hidden.has('.secret'), 'dotfile basename stays hidden');
  t.equal(hidden.size, 1, 'no OS-hidden files are reported when the bulk read fails');

  t.end();
});

test('getDirectoryHiddenNames skips OS attribute detection when osHidden is false', async t => {
  t.plan(4);

  const directory = path.join(os.tmpdir(), 'mock-service-cli-hidden-skip-os');
  const names = [];
  for (let index = 0; index < 10; index += 1) names.push(`photo${index}.jpg`);
  names.push('秘密.bin', '.config');

  let execCalls = 0;
  const hidden = await getDirectoryHiddenNames(directory, names, {
    platform: 'win32',
    cache: false,
    osHidden: false,
    execFile: () => {
      execCalls += 1;
    }
  });

  t.equal(execCalls, 0, 'never spawns PowerShell or attrib when osHidden is false');
  t.ok(hidden.has('.config'), 'dotfile basename is hidden');
  t.notOk(hidden.has('photo0.jpg'), 'plain file is visible without OS-attribute detection');
  t.notOk(hidden.has('秘密.bin'), 'OS-hidden files are treated as visible when osHidden is false');

  t.end();
});

test('getDirectoryHiddenNames caches per-entry attrib results within the TTL', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-hidden-attrib-cache-'));
  const names = ['plain.txt', 'secret.txt'];
  let attribCalls = 0;
  const options = {
    platform: 'win32',
    cache: true,
    attribExecFile: (command, args, options, callback) => {
      attribCalls += 1;
      const isHidden = path.basename(args[0]) === 'secret.txt';
      callback(null, (isHidden ? 'A  H  ' : 'A     ') + `C:\\tmp\\${path.basename(args[0])}`);
    }
  };

  const first = await getDirectoryHiddenNames(tempDir, names, options);
  t.equal(attribCalls, 2, 'first listing checks each candidate once');
  t.ok(first.has('secret.txt'), 'hidden candidate is detected on the first listing');

  const second = await getDirectoryHiddenNames(tempDir, names, options);
  t.equal(attribCalls, 2, 'second listing within the TTL reuses cached attrib results');
  t.ok(second.has('secret.txt'), 'hidden candidate stays hidden on the second listing');

  fs.rmSync(tempDir, { recursive: true, force: true });
  t.end();
});

function makeFakeChild() {
  const child = new EventEmitter();
  child.unref = () => {};
  return child;
}

test('openPathInFileManager selects the platform opener and spawns detached', async t => {
  t.plan(10);

  const winChild = makeFakeChild();
  let winSpawn;
  const winPromise = openPathInFileManager('D:/demo', {
    platform: 'win32',
    spawn: (command, args, options) => {
      winSpawn = { command, args, options };
      return winChild;
    }
  });
  winChild.emit('spawn');
  const winResult = await winPromise;
  t.equal(winSpawn.command, 'explorer.exe', 'win32 uses explorer.exe');
  t.deepEqual(winSpawn.args, ['D:/demo'], 'win32 passes the folder path');
  t.equal(winSpawn.options.detached, true, 'spawns detached');
  t.equal(winSpawn.options.stdio, 'ignore', 'ignores stdio');
  t.equal(winResult.ok, true, 'win32 resolves ok once the process is spawned');
  t.equal(winResult.command, 'explorer.exe', 'win32 reports the command used');

  const macChild = makeFakeChild();
  let macSpawn;
  const macPromise = openPathInFileManager('/Users/demo', {
    platform: 'darwin',
    spawn: (command, args) => {
      macSpawn = { command, args };
      return macChild;
    }
  });
  macChild.emit('spawn');
  const macResult = await macPromise;
  t.equal(macSpawn.command, 'open', 'darwin uses open');
  t.equal(macResult.ok, true, 'darwin resolves ok');

  const linuxChild = makeFakeChild();
  let linuxSpawn;
  const linuxPromise = openPathInFileManager('/tmp/demo', {
    platform: 'linux',
    spawn: (command, args) => {
      linuxSpawn = { command, args };
      return linuxChild;
    }
  });
  linuxChild.emit('spawn');
  const linuxResult = await linuxPromise;
  t.equal(linuxSpawn.command, 'xdg-open', 'linux uses xdg-open');
  t.equal(linuxResult.ok, true, 'linux resolves ok');

  t.end();
});

test('openPathInFileManager ignores a later non-zero exit on win32', async t => {
  t.plan(2);

  const child = makeFakeChild();
  const promise = openPathInFileManager('D:/demo', {
    platform: 'win32',
    spawn: () => child
  });
  child.emit('spawn');
  const spawned = await promise;
  t.equal(spawned.ok, true, 'succeeds when explorer.exe starts');

  // Windows explorer.exe hands the request to the already-running Explorer shell and
  // then exits with code 1 even after opening the folder; that must not become a failure.
  child.emit('exit', 1);
  t.equal(spawned.ok, true, 'non-zero exit after spawn is not treated as failure');

  t.end();
});

test('openPathInFileManager surfaces launch errors', async t => {
  t.plan(3);

  const child = makeFakeChild();
  const promise = openPathInFileManager('/tmp/demo', {
    platform: 'linux',
    spawn: () => child
  });
  child.emit('error', new Error('ENOENT'));
  const result = await promise;
  t.equal(result.ok, false, 'fails when the opener cannot be launched');
  t.equal(result.unsupported, false, 'not an unsupported-platform failure');
  t.match(result.error.message, /ENOENT/, 'keeps the spawn error');

  t.end();
});

test('openPathInFileManager rejects unsupported platforms without spawning', async t => {
  t.plan(4);

  let spawned = false;
  const result = await openPathInFileManager('/x', {
    platform: 'freebsd',
    spawn: () => {
      spawned = true;
      return makeFakeChild();
    }
  });
  t.equal(spawned, false, 'does not spawn on unsupported platforms');
  t.equal(result.ok, false, 'unsupported platform is a failure');
  t.equal(result.unsupported, true, 'marks the failure as unsupported platform');
  t.equal(result.error.message, 'Unsupported platform', 'reports the platform error');

  t.end();
});
