const test = require('tap').test;
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

const node = process.execPath;
const root = path.resolve(__dirname, '..');

function isCoverageMode() {
  return Boolean(process.env.NYC_CONFIG || process.env.NYC_PROCESS_ID || process.env.NYC_PROCESSINFO_EXTERNAL_ID);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForExplorer(baseUrl, child, output) {
  const startTime = Date.now();
  let lastError;

  while (Date.now() - startTime < 5000) {
    try {
      const response = await fetch(`${baseUrl}/__api/list?path=%2F`);
      if (response.ok) {
        return response.json();
      }
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (child.exitCode !== null && output.value) {
      lastError = new Error(output.value);
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw lastError || new Error('File explorer did not start');
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || `Unexpected status ${response.status}`);
  }

  return data;
}

function stopCliProcess(child) {
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch (error) {
    // The CLI parent may exit after spawning the server; the process group cleanup is best effort.
  }
}

function getCliEnv() {
  const env = { ...process.env };

  delete env.NODE_OPTIONS;
  Object.keys(env).forEach(key => {
    if (key === 'TAP' || key.startsWith('TAP_') || key.startsWith('NYC_')) {
      delete env[key];
    }
  });

  return env;
}

async function assertFileExplorerCli(t, entryFile) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-entry-'));
  const marker = 'source-debug.txt';
  writeFileSync(path.join(tempDir, marker), 'ok');

  const port = await getFreePort();
  const output = { value: '' };
  const child = spawn(node, [entryFile, '-e', tempDir, '-p', String(port), '-s'], {
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

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    let data = await waitForExplorer(baseUrl, child, output);
    t.ok(data.files.some(file => file.name === marker), `${entryFile} can start file explorer`);

    const html = await fetch(baseUrl).then(response => response.text());
    t.ok(html.includes('id="editModeToggle"'), `${entryFile} exposes edit mode toggle`);
    t.ok(html.includes('edit-only'), `${entryFile} marks edit-only controls`);

    await requestJson(`${baseUrl}/__api/path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath: '/', name: 'new-folder', type: 'directory' })
    });
    t.ok(existsSync(path.join(tempDir, 'new-folder')), `${entryFile} can create directory`);

    await requestJson(`${baseUrl}/__api/path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath: '/', name: 'new-file.txt', type: 'file' })
    });
    t.ok(existsSync(path.join(tempDir, 'new-file.txt')), `${entryFile} can create file`);

    await requestJson(`${baseUrl}/__api/path`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/new-file.txt', name: 'renamed-file.txt' })
    });
    t.ok(existsSync(path.join(tempDir, 'renamed-file.txt')), `${entryFile} can rename file`);

    await requestJson(`${baseUrl}/__api/paths`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['/new-folder', '/renamed-file.txt'] })
    });
    t.notOk(existsSync(path.join(tempDir, 'new-folder')), `${entryFile} can batch delete directory`);
    t.notOk(existsSync(path.join(tempDir, 'renamed-file.txt')), `${entryFile} can batch delete file`);

    data = await requestJson(`${baseUrl}/__api/list?path=%2F`);
    t.notOk(data.files.some(file => file.name === 'new-folder'), `${entryFile} refresh data excludes deleted paths`);
  } finally {
    stopCliProcess(child);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (!isCoverageMode()) {
  test('source cli can start file explorer server directly', async t => {
    await assertFileExplorerCli(t, path.join(root, 'src/bin/mock-service-cli'));
  });

  test('built cli can start file explorer server through dist wrapper', async t => {
    const entryFile = path.join(root, 'bin/mock-service-cli');
    const runtimeFile = path.join(root, 'dist/runtime.js');

    if (!existsSync(runtimeFile)) {
      t.skip('dist/runtime.js does not exist; run npm run build first');
      return;
    }

    await assertFileExplorerCli(t, entryFile);
  });
}
