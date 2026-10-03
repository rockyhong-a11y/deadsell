import { defineConfig, devices } from '@playwright/test';

/** Mobile landscape (touch, 844×390) against the Vite dev server. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5177',
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: devices['Pixel 7'].userAgent,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [{ name: 'mobile-landscape', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npx vite --port 5177 --strictPort',
    url: 'http://localhost:5177',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
