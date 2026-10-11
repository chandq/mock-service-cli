const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './test/browser',
  timeout: 30000,
  workers: 1,
  use: { browserName: 'chromium', viewport: { width: 1440, height: 960 }, headless: true },
  reporter: 'list',
  outputDir: '.cache/playwright'
});
