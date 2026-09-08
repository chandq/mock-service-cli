const test = require('tap').test;
const { readFileSync } = require('fs');
const { EventEmitter } = require('events');
const path = require('path');
const {
  shouldWaitForConsoleChildShutdown,
  shouldExitImmediatelyOnShutdown,
  createManagedConsoleInput
} = require('../src/lib/processShutdown');

test('Windows console shutdown avoids duplicate Ctrl+C delivery for affected servers', t => {
  t.equal(shouldWaitForConsoleChildShutdown('win32', 'staticServer', 'SIGINT'), true);
  t.equal(shouldWaitForConsoleChildShutdown('win32', 'fileExplorerServer', 'SIGINT'), true);
  t.equal(shouldWaitForConsoleChildShutdown('win32', 'mockServer', 'SIGINT'), false);
  t.equal(shouldWaitForConsoleChildShutdown('win32', 'staticServer', 'SIGTERM'), false);
  t.equal(shouldWaitForConsoleChildShutdown('linux', 'staticServer', 'SIGINT'), false);
  t.equal(shouldWaitForConsoleChildShutdown('darwin', 'fileExplorerServer', 'SIGINT'), false);
  t.end();
});

test('Windows affected servers exit synchronously without owning console input', t => {
  const root = path.resolve(__dirname, '..');
  const staticSource = readFileSync(path.join(root, 'src/lib/staticServer.js'), 'utf8');
  const explorerSource = readFileSync(path.join(root, 'src/lib/fileExplorerServer.js'), 'utf8');

  t.equal(shouldExitImmediatelyOnShutdown('win32', 'SIGINT'), true);
  t.equal(shouldExitImmediatelyOnShutdown('win32', 'SIGTERM'), false);
  t.equal(shouldExitImmediatelyOnShutdown('linux', 'SIGINT'), false);
  t.equal(shouldExitImmediatelyOnShutdown('darwin', 'SIGINT'), false);
  t.notMatch(staticSource, /require\(['"]readline['"]\)|process\.stdin/);
  t.notMatch(explorerSource, /require\(['"]readline['"]\)|process\.stdin/);
  t.end();
});

test('Windows parent CLI owns interactive input and restores it before shutdown', t => {
  const input = new EventEmitter();
  input.isTTY = true;
  const output = { isTTY: true };
  let resumeCount = 0;
  let pauseCount = 0;
  input.resume = () => {
    resumeCount += 1;
  };
  input.pause = () => {
    pauseCount += 1;
  };

  const consoleInput = createManagedConsoleInput({
    platform: 'win32',
    serverName: 'staticServer',
    input,
    output
  });

  t.type(consoleInput.close, 'function');
  t.equal(resumeCount, 1);
  t.equal(input.listenerCount('data'), 1);
  input.emit('data', Buffer.from('typed text\r\n'));
  consoleInput.close();
  t.equal(input.listenerCount('data'), 0);
  t.equal(pauseCount, 1);
  consoleInput.close();
  t.equal(pauseCount, 1, 'close is idempotent');
  t.end();
});

test('console input ownership is not enabled for pipes, other platforms, or mock server', t => {
  const input = new EventEmitter();
  input.isTTY = true;
  let resumeCount = 0;
  input.resume = () => {
    resumeCount += 1;
  };
  input.pause = () => {};
  const baseOptions = {
    input,
    output: { isTTY: true }
  };

  t.equal(createManagedConsoleInput({ ...baseOptions, platform: 'linux', serverName: 'staticServer' }), null);
  t.equal(createManagedConsoleInput({ ...baseOptions, platform: 'win32', serverName: 'mockServer' }), null);
  t.equal(
    createManagedConsoleInput({
      ...baseOptions,
      platform: 'win32',
      serverName: 'fileExplorerServer',
      input: { isTTY: false }
    }),
    null
  );
  t.equal(resumeCount, 0);
  t.end();
});
