import { defineConfig, devices } from '@playwright/test';

// Runs against the built static site. Locally it can reuse the system Chrome
// (PW_CHANNEL=chrome); CI installs Playwright's own Chromium. PW_PORT picks the
// preview port, so several worktrees can test at once.
const port = Number(process.env.PW_PORT || 4321);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}`, channel: process.env.PW_CHANNEL || undefined },
  webServer: {
    command: `npx astro preview --port ${port} --ignore-lock`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL || undefined } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined } },
  ],
});
