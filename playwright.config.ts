import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
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
      testDir: './test/e2e/public-site',
      use: {
        baseURL: 'http://localhost:3456',
        browserName: 'chromium',
      },
    },
    {
      name: 'admin-auth',
      testDir: './test/e2e/admin',
      testMatch: 'auth-setup.spec.ts',
      fullyParallel: false,
      use: {
        baseURL: 'http://localhost:8456',
        browserName: 'chromium',
      },
    },
    {
      name: 'admin',
      testDir: './test/e2e/admin',
      testIgnore: 'auth-setup.spec.ts',
      dependencies: ['admin-auth'],
      use: {
        baseURL: 'http://localhost:8456',
        browserName: 'chromium',
      },
    },
  ],
  globalSetup: './test/e2e/helpers/global-setup.ts',
  globalTeardown: './test/e2e/helpers/global-teardown.ts',
})
