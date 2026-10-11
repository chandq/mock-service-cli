const { test, expect } = require('@playwright/test');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { createClientServer } = require('../../src/lib/apiClient/server');
const { request } = require('../../src/lib/apiClient/model');

test('performance budgets: startup, 1000 requests, 10 MiB JSON worker and initial assets', async ({
  page,
  browser
}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'msc-client-perf-'));
  const client = createClientServer({ root });
  try {
    await client.workspace.write('collections', crypto.randomUUID(), {
      name: 'Performance',
      items: Array.from({ length: 1000 }, (_, index) =>
        request({ id: crypto.randomUUID(), name: `Request ${index}`, method: 'GET', url: `http://localhost/${index}` })
      )
    });
    const address = await client.listen();
    await page.addInitScript(() => {
      window.longTasks = [];
      new PerformanceObserver(list => window.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe(
        { type: 'longtask', buffered: true }
      );
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    const interactive = await page.evaluate(() => performance.now());
    expect(interactive).toBeLessThan(1000);
    expect(await page.locator('#tree .tree-row').count()).toBeLessThan(80);
    const timings = await page.evaluate(async () => {
      const samples = [];
      const switches = [];
      const search = document.querySelector('#search');
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        search.value = `Request ${i}`;
        search.dispatchEvent(new Event('input'));
        await new Promise(requestAnimationFrame);
        samples.push(performance.now() - start);
        const switchStart = performance.now();
        document.querySelector(`#tree [aria-label="Request ${i}"]`).click();
        await new Promise(requestAnimationFrame);
        switches.push(performance.now() - switchStart);
      }
      return { search: samples.sort((a, b) => a - b), switches: switches.sort((a, b) => a - b) };
    });
    expect(timings.search[18]).toBeLessThan(100);
    expect(timings.switches[18]).toBeLessThan(100);
    const workerTiming = await page.evaluate(async () => {
      window.longTasks = [];
      const started = performance.now();
      const worker = new Worker('/worker.js');
      const data = `{"large":"${'a'.repeat(10 * 1024 * 1024)}"}`;
      const result = await new Promise(resolve => {
        worker.onmessage = event => resolve(event.data);
        worker.postMessage({ id: 1, action: 'load', value: data });
      });
      worker.terminate();
      await new Promise(resolve => setTimeout(resolve, 80));
      return {
        duration: performance.now() - started,
        longestTask: Math.max(0, ...window.longTasks),
        json: result.result.json
      };
    });
    expect(workerTiming.json).toBe(true);
    expect(workerTiming.longestTask).toBeLessThan(200);
    const assets = path.resolve(__dirname, '../../src/lib/apiClient/browser');
    const initial =
      zlib.gzipSync(await fs.readFile(path.join(assets, 'client.js'))).length +
      zlib.gzipSync(await fs.readFile(path.join(assets, 'client.css'))).length;
    expect(initial).toBeLessThan(250 * 1024);
    console.log(
      JSON.stringify({
        node: process.version,
        browser: browser.version(),
        platform: `${process.platform}/${process.arch}`,
        interactiveMs: Math.round(interactive),
        searchP95Ms: timings.search[18],
        switchP95Ms: timings.switches[18],
        worker10MiB: workerTiming,
        initialGzipBytes: initial
      })
    );
  } finally {
    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
