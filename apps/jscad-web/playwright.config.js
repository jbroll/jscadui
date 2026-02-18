import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,  // WebGL can be flaky when parallelised
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:5120',
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

  webServer: {
    command: 'node build.js --dev --skipDocs',
    url: 'http://localhost:5120',
    reuseExistingServer: true,
    timeout: 90_000,
  },
})
