import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/integration/playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30_000,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'public-site',
      testDir: './test/integration/playwright/public-site',
      use: {
        baseURL: 'http://localhost:3456',
        browserName: 'chromium',
      },
    },
    {
      name: 'admin-auth',
      testDir: './test/integration/playwright/admin',
      testMatch: 'auth-setup.spec.ts',
      fullyParallel: false,
      use: {
        baseURL: 'http://localhost:8456',
        browserName: 'chromium',
      },
    },
    {
      name: 'admin',
      testDir: './test/integration/playwright/admin',
      testIgnore: 'auth-setup.spec.ts',
      dependencies: ['admin-auth'],
      use: {
        baseURL: 'http://localhost:8456',
        browserName: 'chromium',
      },
    },
  ],
  globalSetup: './test/integration/playwright/helpers/global-setup.ts',
  globalTeardown: './test/integration/playwright/helpers/global-teardown.ts',
})
