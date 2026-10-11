const { test, expect } = require('@playwright/test');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const http = require('http');
const { createClientServer } = require('../../src/lib/apiClient/server');
let client;
let root;
let base;
let target;
let upstream;
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'msc-client-browser-'));
  client = createClientServer({ root });
  base = `http://127.0.0.1:${(await client.listen()).port}`;
  upstream = http.createServer((req, res) => {
    if (req.url === '/slow') return setTimeout(() => res.end('late'), 5000).unref();
    if (req.url === '/html') return res.end('<script>window.compromised=true</script>');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/attachment')
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.json");
    res.end(
      JSON.stringify({ message: 'Hello API Client', url: req.url, count: 42, authorization: req.headers.authorization })
    );
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  target = `http://127.0.0.1:${upstream.address().port}`;
});
test.afterAll(async () => {
  await client.close();
  await new Promise(resolve => {
    upstream.close(resolve);
    upstream.closeAllConnections?.();
  });
  await fs.rm(root, { recursive: true, force: true });
});
test.beforeEach(async ({ page }) => {
  await page.goto(base);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
});

test('send, save, restore tabs and inspect JSON tree', async ({ page }) => {
  await page.getByLabel('请求名称', { exact: true }).fill('读取用户');
  await page.getByLabel('请求 URL', { exact: true }).fill(`${target}/users?x=1&x=2`);
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click();
  await expect(page.locator('#metrics')).toContainText('200');
  await expect(page.locator('#response-content')).toContainText('Hello API Client');
  await page.getByRole('button', { name: /保存 ⌘ S/ }).click();
  await expect(page.locator('#save-state')).toHaveText('已保存到项目');
  await page.getByLabel('响应格式').selectOption('tree');
  await expect(page.locator('#response-content')).toContainText('count: 42');
  await page.getByLabel('主题').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByLabel('请求名称', { exact: true })).toHaveValue('读取用户');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: '.cache/api-client-desktop.png', fullPage: true });
});
test('response downloads use media types and upstream Unicode filenames', async ({ page }) => {
  for (const [route, filename] of [
    ['/download', 'response.json'],
    ['/attachment', '报告.json']
  ]) {
    await page.getByLabel('请求 URL', { exact: true }).fill(`${target}${route}`);
    await page.locator('#send').click();
    await expect(page.locator('#response-content')).toContainText(route);
    const pending = page.waitForEvent('download');
    await page.locator('#response-download').click();
    const downloaded = await pending;
    expect(downloaded.suggestedFilename()).toBe(filename);
    const body = JSON.parse(await fs.readFile(await downloaded.path(), 'utf8'));
    expect(body.message).toBe('Hello API Client');
    expect(body.url).toBe(route);
  }
});
test('import compatibility preview, environment variables and collection runner', async ({ page }) => {
  await page.locator('#import').click();
  await page.getByLabel('导入内容').fill(`curl '${target}/imported'`);
  await page.getByRole('button', { name: '预览兼容性' }).click();
  await expect(page.locator('#modal-body')).toContainText('包含 1 个请求');
  await page.getByRole('button', { name: '确认导入' }).click();
  await page.locator('#tree').getByText('导入的 cURL', { exact: true }).click();
  await page.locator('#environments').click();
  await page.getByLabel('环境名称', { exact: true }).fill('Local');
  await page.locator('#modal-body').getByRole('button', { name: '＋ 添加', exact: true }).click();
  await page.locator('#modal-body').getByLabel('Key', { exact: true }).fill('base');
  await page.locator('#modal-body').getByLabel('Value', { exact: true }).fill(target);
  await page.getByRole('button', { name: '保存并启用环境' }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.getByLabel('请求 URL', { exact: true }).fill('{{base}}/environment');
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click();
  await expect(page.locator('#response-content')).toContainText('/environment');
  await page.locator('#request-panels').getByRole('button', { name: 'Tests', exact: true }).click();
  await page.getByRole('button', { name: '＋ 添加断言' }).click();
  await page.locator('#save').click();
  await expect(page.locator('#save-state')).toHaveText('已保存到项目');
  await page.locator('#run').click();
  await page.getByRole('button', { name: '开始运行' }).click();
  await expect(page.locator('#modal-body')).toContainText('completed');
  await expect(page.locator('#modal-body')).toContainText('1/1 断言通过');
});
test('cancel and safely display untrusted response HTML', async ({ page }) => {
  await page.getByLabel('请求 URL', { exact: true }).fill(`${target}/slow`);
  await page.locator('#send').click();
  await expect(page.locator('#cancel')).toBeVisible();
  await page.locator('#cancel').click();
  await expect(page.locator('#response-content')).toContainText('已取消');
  await page.getByLabel('请求 URL', { exact: true }).fill(`${target}/html`);
  await page.locator('#send').click();
  await expect(page.locator('#response-content')).toContainText('<script>');
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();
  await page.getByLabel('响应格式').selectOption('tree');
  await expect(page.locator('#response-content')).toContainText('此响应不是 JSON');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.cache/api-client-mobile.png', fullPage: true });
});
test('keyboard shortcuts focus search and send; CodeMirror loads on demand', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await expect(page.locator('#search')).toBeFocused();
  await page.getByLabel('请求 URL', { exact: true }).fill(target);
  await page.getByLabel('HTTP 方法').selectOption('POST');
  await page.locator('#request-panels').getByRole('button', { name: 'Body', exact: true }).click();
  await page.getByLabel('正文类型').selectOption('json');
  await expect(page.locator('.cm-editor')).toBeVisible();
  await page.locator('.cm-content').fill('{"hello":true}');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#metrics')).toContainText('200');
  await expect(page.locator('#cancel')).toBeHidden();
  const sent = page.waitForRequest(req => req.url().endsWith('/executions') && req.method() === 'POST');
  await page.keyboard.press('Meta+Enter');
  await sent;
  await expect(page.locator('#cancel')).toBeHidden();
});
test('secrets remain in memory and are isolated between environments', async ({ page }) => {
  const addEnvironment = async (name, value) => {
    await page.locator('#environments').click();
    await page.getByLabel('编辑环境').selectOption('');
    await page.getByLabel('环境名称', { exact: true }).fill(name);
    await page.locator('#modal-body').getByRole('button', { name: '＋ 添加', exact: true }).click();
    await page.locator('#modal-body').getByLabel('Key', { exact: true }).fill('token');
    await page.locator('#modal-body').getByLabel('Value', { exact: true }).fill(value);
    await page.getByLabel('Secret 变量').check();
    await page.getByRole('button', { name: '保存并启用环境' }).click();
    await expect(page.locator('#modal')).not.toBeVisible();
    return page.locator('#environment').inputValue();
  };
  const first = await addEnvironment('First secret', 'alpha-private');
  const second = await addEnvironment('Second secret', 'beta-private');
  await page.locator('#url').fill(`${target}/auth`);
  await page.locator('#request-panels').getByRole('button', { name: 'Headers', exact: true }).click();
  await page.locator('#request-content').getByRole('button', { name: '＋ 添加', exact: true }).click();
  await page.locator('#request-content').getByLabel('Key', { exact: true }).fill('Authorization');
  await page.locator('#request-content').getByLabel('Value', { exact: true }).fill('Bearer {{token}}');
  for (const [environment, token] of [
    [first, 'alpha-private'],
    [second, 'beta-private'],
    [first, 'alpha-private']
  ]) {
    await page.locator('#environment').selectOption(environment);
    await page.locator('#send').click();
    await expect(page.locator('#response-content')).toContainText(`Bearer ${token}`);
    await expect(page.locator('#cancel')).toBeHidden();
  }
  await page.waitForTimeout(300);
  const stored = await page.evaluate(async () => {
    const db = await new Promise(resolve => {
      const opening = indexedDB.open('mock-service-api-client', 1);
      opening.onsuccess = () => resolve(opening.result);
    });
    return new Promise(resolve => {
      const req = db.transaction('ui').objectStore('ui').getAll();
      req.onsuccess = () => {
        resolve(JSON.stringify(req.result));
        db.close();
      };
    });
  });
  expect(stored).not.toContain('alpha-private');
  expect(stored).not.toContain('beta-private');
  const environments = await client.workspace.list('environments');
  expect(JSON.stringify(environments)).not.toContain('alpha-private');
  expect(JSON.stringify(environments)).not.toContain('beta-private');
  await page.locator('#environments').click();
  await page.locator('#modal-body').getByLabel('启用参数').uncheck();
  await page.getByRole('button', { name: '保存并启用环境' }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.locator('#send').click();
  await expect(page.locator('#response-content')).toContainText('未定义变量: token');
});
