import { defineConfig, devices } from '@playwright/test'
import { APP_ORIGIN } from './e2e/ports.mjs'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,  // WebGL can be flaky when parallelised
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: APP_ORIGIN,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // WebGL requires hardware acceleration
    launchOptions: {
      args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
    },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // build.js inherits JSCAD_WEB_PORT, so it listens on APP_ORIGIN.
  webServer: {
    command: 'node build.js --dev --skipDocs',
    url: APP_ORIGIN,
    reuseExistingServer: true,
    timeout: 90_000,
  },
})
