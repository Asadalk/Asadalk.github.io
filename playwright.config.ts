import { defineConfig, devices } from '@playwright/test';

// Runs against the built static site. Locally it can reuse the system Chrome
// (PW_CHANNEL=chrome); CI installs Playwright's own Chromium.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4321', channel: process.env.PW_CHANNEL || undefined },
  webServer: {
    command: 'npx astro preview --port 4321 --ignore-lock',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL || undefined } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined } },
  ],
});
