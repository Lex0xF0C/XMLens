import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /e2e\.spec\.ts$/,
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]],
  outputDir: '../../test-results',
  use: {
    baseURL: 'http://127.0.0.1:3100/',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command:
      'npx vite preview --config spikes/codemirror/vite.config.ts --host 127.0.0.1 --port 3100',
    cwd: '../..',
    url: 'http://127.0.0.1:3100/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
