const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Chrome extensions require headed mode (or --headless=new on newer Chrome)
    headless: false,
    viewport: { width: 1280, height: 800 },
  },
  // Single project — all tests share the same browser channel
  projects: [
    {
      name: 'chrome-extension',
      use: { channel: 'chromium' },
    },
  ],
});
