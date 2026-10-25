import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/site/**',
  outputDir: 'test-results/renderer',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:5174', screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } },
  ],
  // A developer's Vite dev server may already use 5173 and does not serve the
  // built service worker. Always verify the production artifact on its own port.
  webServer: { command: 'npm run preview -- --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: false },
});
