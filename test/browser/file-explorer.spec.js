const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '../..');

let cli;
let cliOutput = '';
let directory;
let base;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForExplorer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (cli.exitCode !== null) throw new Error(`file explorer exited early:\n${cliOutput}`);
    try {
      const response = await fetch(`${base}/__api/config`);
      if (response.ok) return;
    } catch (error) {
      // The server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`file explorer did not start:\n${cliOutput}`);
}

async function stopExplorer() {
  if (!cli || cli.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') cli.kill('SIGKILL');
        else process.kill(-cli.pid, 'SIGKILL');
      } catch (error) {
        // The process group may already be gone.
      }
      resolve();
    }, 2000);
    cli.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      if (process.platform === 'win32') cli.kill('SIGTERM');
      else process.kill(-cli.pid, 'SIGTERM');
    } catch (error) {
      clearTimeout(timer);
      resolve();
    }
  });
}

test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'msc-explorer-search-'));
  fs.writeFileSync(path.join(directory, 'alpha.txt'), 'alpha');
  fs.writeFileSync(path.join(directory, 'beta.txt'), 'beta');
  fs.mkdirSync(path.join(directory, 'sub'));
  fs.writeFileSync(path.join(directory, 'sub', 'gamma.txt'), 'gamma');

  const port = await getFreePort();
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  cli = spawn(
    process.execPath,
    [path.join(root, 'src/bin/mock-service-cli'), '-e', directory, '--edit', '-p', String(port), '-s'],
    {
      cwd: root,
      detached: process.platform !== 'win32',
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  cli.stdout.on('data', chunk => {
    cliOutput += chunk.toString();
  });
  cli.stderr.on('data', chunk => {
    cliOutput += chunk.toString();
  });
  await waitForExplorer();
});

test.afterAll(async () => {
  await stopExplorer();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

test('refresh keeps the active search filter', async ({ page }) => {
  await page.goto(base);
  await expect(page.locator('.file-item')).toHaveCount(3);

  await page.locator('#searchInput').fill('alpha');
  await expect(page.locator('.file-item')).toHaveCount(1);
  await expect(page.locator('.file-name')).toHaveText('alpha.txt');

  // Post-operation reloads (upload, rename, delete) and the refresh button
  // both call loadDirectory(currentPath), so this covers the shared path.
  await page.locator('.refresh-btn').click();
  await expect(page.locator('#searchInput')).toHaveValue('alpha');
  await expect(page.locator('.file-item')).toHaveCount(1);
  await expect(page.locator('.file-name')).toHaveText('alpha.txt');
});

test('navigating to another directory clears the search', async ({ page }) => {
  await page.goto(base);
  await page.locator('#searchInput').fill('sub');
  await expect(page.locator('.file-item')).toHaveCount(1);

  await page.locator('.file-item').click();
  await expect(page.locator('#searchInput')).toHaveValue('');
  await expect(page.locator('.file-name')).toHaveText('gamma.txt');
});
