const test = require('tap').test;
const { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require('fs');
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
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForExplorer(baseUrl, child, output, options) {
  const startTime = Date.now();
  let lastError;

  while (Date.now() - startTime < 5000) {
    try {
      const response = await fetch(`${baseUrl}/__api/list?path=%2F`, options);
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

function startExplorer(entryFile, tempDir, port, editMode, authPassword) {
  const output = { value: '' };
  const args = [entryFile, '-e', tempDir, '-p', String(port), '-s'];
  if (editMode) args.push('--edit');
  if (authPassword) args.push(`--auth=${authPassword}`);
  const child = spawn(node, args, {
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
  return { child, output };
}

async function uploadFiles(baseUrl, files, password) {
  const formData = new FormData();
  formData.append('parentPath', '/');
  files.forEach(({ name, content }) => formData.append('files', new Blob([content]), name));
  const response = await fetch(`${baseUrl}/__api/upload`, {
    method: 'POST',
    headers: password ? { 'X-File-Explorer-Password': password } : undefined,
    body: formData
  });
  return { response, data: await response.json() };
}

async function assertFileExplorerCli(t, entryFile) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-entry-'));
  const marker = 'source-debug.txt';
  const binaryMarker = 'source-binary.bin';
  writeFileSync(path.join(tempDir, marker), 'ok');
  writeFileSync(path.join(tempDir, binaryMarker), Buffer.from([0, 255, 1, 0, 128, 64, 10]));

  const port = await getFreePort();
  const { child, output } = startExplorer(entryFile, tempDir, port, true);

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    let data = await waitForExplorer(baseUrl, child, output);
    t.ok(data.files.some(file => file.name === marker), `${entryFile} can start file explorer`);

    const html = await fetch(baseUrl).then(response => response.text());
    t.notOk(html.includes('id="editModeToggle"'), `${entryFile} does not expose an edit mode toggle`);
    t.ok(html.includes('edit-only'), `${entryFile} marks edit-only controls`);
    t.ok(html.includes('virtual-content'), `${entryFile} includes virtualized file rendering`);
    t.ok(html.includes('id="icon-folder"'), `${entryFile} defines a reusable folder icon`);
    t.ok(html.includes("use.setAttribute('href', iconInfo.symbol)"), `${entryFile} reuses the file icon with <use>`);
    t.ok(html.includes('more-actions-btn'), `${entryFile} uses a compact action menu in list view`);
    t.ok(html.includes('positionVirtualItem'), `${entryFile} positions reusable virtual items by their file index`);
    t.notOk(html.includes('will-change: transform'), `${entryFile} avoids an oversized composited virtual layer`);
    t.ok(html.includes('renderedItems: new Map()'), `${entryFile} only updates files entering the virtual window`);
    t.ok(html.includes('freeItems: []'), `${entryFile} reuses items released at virtual window boundaries`);
    t.ok(html.includes('download=1'), `${entryFile} uses the raw download endpoint`);
    t.ok(html.includes("window.addEventListener('pageshow'"), `${entryFile} restores explorer state from bfcache`);
    t.ok(html.includes('event.persisted'), `${entryFile} only restores after a persisted page lifecycle event`);

    const downloadResponse = await fetch(`${baseUrl}/__api/file?path=%2F${binaryMarker}&download=1`);
    t.equal(downloadResponse.status, 200, `${entryFile} serves explicit downloads`);
    t.match(downloadResponse.headers.get('content-disposition'), /attachment/, `${entryFile} marks explicit downloads as attachments`);
    t.same(
      Buffer.from(await downloadResponse.arrayBuffer()),
      readFileSync(path.join(tempDir, binaryMarker)),
      `${entryFile} streams binary downloads without text conversion`
    );

    const config = await requestJson(`${baseUrl}/__api/config`);
    t.equal(config.editMode, true, `${entryFile} enables edits with --edit`);

    if (process.platform !== 'win32') {
      const externalDir = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-external-'));
      try {
        symlinkSync(externalDir, path.join(tempDir, 'outside-link'));
        const blockedResponse = await fetch(`${baseUrl}/__api/list?path=%2Foutside-link`);
        t.equal(blockedResponse.status, 403, `${entryFile} blocks symlinks outside the explorer root`);
      } finally {
        rmSync(externalDir, { recursive: true, force: true });
      }
    }

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

async function assertReadOnlyFileExplorerCli(t, entryFile) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-readonly-'));
  const port = await getFreePort();
  const { child, output } = startExplorer(entryFile, tempDir, port, false);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForExplorer(baseUrl, child, output);
    const config = await requestJson(`${baseUrl}/__api/config`);
    t.equal(config.editMode, false, `${entryFile} is read-only by default`);

    const response = await fetch(`${baseUrl}/__api/path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath: '/', name: 'blocked.txt', type: 'file' })
    });
    t.equal(response.status, 403, `${entryFile} rejects writes without --edit`);
    t.notOk(existsSync(path.join(tempDir, 'blocked.txt')), `${entryFile} does not write in read-only mode`);
  } finally {
    stopCliProcess(child);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function assertAuthenticatedExplorerCli(t, entryFile) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-auth-'));
  const port = await getFreePort();
  const password = 'test-password';
  const { child, output } = startExplorer(entryFile, tempDir, port, true, password);
  const baseUrl = `http://127.0.0.1:${port}`;
  const authHeaders = { 'X-File-Explorer-Password': password };

  try {
    await waitForExplorer(baseUrl, child, output, { headers: authHeaders });
    const loginResponse = await fetch(`${baseUrl}/__login`);
    t.equal(loginResponse.status, 200, `${entryFile} serves the login page`);
    t.match(await loginResponse.text(), /访问密码/, `${entryFile} login page asks for a password`);

    const unauthenticatedResponse = await fetch(`${baseUrl}/__api/list?path=%2F`);
    t.equal(unauthenticatedResponse.status, 401, `${entryFile} protects explorer APIs`);
    const invalidResponse = await fetch(`${baseUrl}/__api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' })
    });
    t.equal(invalidResponse.status, 401, `${entryFile} rejects an invalid password`);

    const config = await requestJson(`${baseUrl}/__api/config`, { headers: authHeaders });
    t.equal(config.authEnabled, true, `${entryFile} reports that authentication is enabled`);

    const firstUpload = await uploadFiles(baseUrl, [
      { name: 'first.txt', content: 'first' },
      { name: 'folder/second.txt', content: 'second' }
    ], password);
    t.equal(firstUpload.response.status, 200, `${entryFile} accepts authenticated multipart uploads`);
    t.equal(firstUpload.data.uploaded.length, 2, `${entryFile} reports uploaded files`);
    t.equal(readFileSync(path.join(tempDir, 'folder', 'second.txt'), 'utf8'), 'second', `${entryFile} preserves upload folders`);

    const partialUpload = await uploadFiles(baseUrl, [
      { name: 'first.txt', content: 'replacement' },
      { name: 'different.txt', content: 'different' }
    ], password);
    t.equal(partialUpload.response.status, 207, `${entryFile} reports upload conflicts without rejecting other files`);
    t.equal(partialUpload.data.uploaded.length, 1, `${entryFile} uploads non-conflicting files`);
    t.equal(partialUpload.data.failed.length, 1, `${entryFile} reports conflicting files`);
    t.equal(readFileSync(path.join(tempDir, 'first.txt'), 'utf8'), 'first', `${entryFile} never overwrites existing files`);
  } finally {
    stopCliProcess(child);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (!isCoverageMode()) {
  test('source cli can start file explorer server directly', async t => {
    await assertReadOnlyFileExplorerCli(t, path.join(root, 'src/bin/mock-service-cli'));
    await assertFileExplorerCli(t, path.join(root, 'src/bin/mock-service-cli'));
    await assertAuthenticatedExplorerCli(t, path.join(root, 'src/bin/mock-service-cli'));
  });

  test('built cli can start file explorer server through dist wrapper', async t => {
    const entryFile = path.join(root, 'bin/mock-service-cli');
    const runtimeFile = path.join(root, 'dist/runtime.js');

    if (!existsSync(runtimeFile)) {
      t.skip('dist/runtime.js does not exist; run npm run build first');
      return;
    }

    await assertReadOnlyFileExplorerCli(t, entryFile);
    await assertFileExplorerCli(t, entryFile);
    await assertAuthenticatedExplorerCli(t, entryFile);
  });
}
