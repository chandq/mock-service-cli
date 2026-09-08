const WINDOWS_CONSOLE_SERVERS = new Set(['staticServer', 'fileExplorerServer']);

function shouldWaitForConsoleChildShutdown(platform, serverName, signal) {
  // Windows sends Ctrl+C to every process sharing the console.
  return platform === 'win32' && signal === 'SIGINT' && WINDOWS_CONSOLE_SERVERS.has(serverName);
}

function shouldExitImmediatelyOnShutdown(platform, signal) {
  // Avoid async handles keeping the console alive after its Ctrl+C event.
  return platform === 'win32' && signal === 'SIGINT';
}

function createManagedConsoleInput(options) {
  const { platform, serverName, input, output } = options;
  if (
    platform !== 'win32' ||
    !WINDOWS_CONSOLE_SERVERS.has(serverName) ||
    !input ||
    input.isTTY !== true ||
    !output ||
    output.isTTY !== true
  ) {
    return null;
  }

  // Keep Windows console input in its normal cooked mode. Reading the stream
  // lets the console echo keys and newlines without readline/raw-mode changes.
  const consumeInput = () => {};
  let closed = false;
  input.on('data', consumeInput);
  input.resume();

  return {
    close() {
      if (closed) return;
      closed = true;
      input.removeListener('data', consumeInput);
      input.pause();
    }
  };
}

module.exports = {
  shouldWaitForConsoleChildShutdown,
  shouldExitImmediatelyOnShutdown,
  createManagedConsoleInput
};
