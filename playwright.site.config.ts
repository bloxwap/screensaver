import { defineConfig, devices } from '@playwright/test';

const deployed = process.env.DOCS_URL;
const baseURL = (deployed ?? 'http://127.0.0.1:3907/screensaver/').replace(/\/?$/, '/');

export default defineConfig({
  testDir: './tests/site',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: 'test-results/site',
  use: { baseURL, screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'site-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'site-webkit-mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } },
  ],
  webServer: deployed ? undefined : {
    command: 'npm run docs:preview',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
