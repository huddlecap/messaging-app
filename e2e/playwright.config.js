const path = require('path')
const { defineConfig, devices } = require('@playwright/test')

const repoRoot = path.resolve(__dirname, '..')

module.exports = defineConfig({
  testDir: './tests',
  // Chromium only.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  // All specs share one test database — never run them in parallel.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Strip leftovers from a previous crashed run, then clean up after this one.
  globalSetup: require.resolve('./global-setup.js'),
  globalTeardown: require.resolve('./global-teardown.js'),
  webServer: [
    {
      // NODE_ENV=test makes db.js load .env.test instead of .env, so the suite
      // can never touch the dev/production database.
      command: 'npx cross-env NODE_ENV=test node src/index.js',
      cwd: path.join(repoRoot, 'backend'),
      url: 'http://localhost:3000/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      cwd: path.join(repoRoot, 'frontend'),
      url: 'http://localhost:5173/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})