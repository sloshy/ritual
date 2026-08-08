import { defineConfig } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './test/e2e/helpers/auth-helper'
import { registerCliMessages } from './src/i18n/register/cli'

// Hand the runtime its English catalog, exactly as `main()` in `index.ts` and
// `test/preload.ts` do. Namespaces are import boundaries (plan §4.2), so `t()`
// renders the key string until a surface entry point registers them — and a
// Playwright process runs no entry point. That matters on both sides of the
// wire: `test/e2e/helpers/mock-admin.ts` renders admin API prose through
// `apiMessage`, and `editor-nav.ts` builds locators out of `listTypeTitle`, both
// of which would otherwise select on `domain.listType.deck` rather than "Decks".
// The CLI's set is registered because that is what the servers this suite drives
// register; it is idempotent, so the workers that also load this file pay once.
//
// This file is evaluated by the runner *and* by every worker, which is what
// makes it the right place for both of these.
registerCliMessages()

// Missing message keys and missing plural/select parameters are fatal for the
// whole e2e run (plan §10). `t()` degrades in production — a gap renders the key
// string rather than throwing, because a missing translation must never take a
// page down — and that degradation is silent, so a spec asserting on rendered
// prose would pass against a key that was never wired.
//
// Set on the runner's own environment rather than per project, because Playwright
// has no project-level `env` and this suite has no `webServer` block: the site and
// admin servers are spawned by `globalSetup` (which runs in this process and
// inherits it), and the test workers are forked from here. That covers every
// Node-side render — the build, the admin API, the served HTML shell. Code
// running *inside* the browser is unaffected: `isStrictI18n()` reads
// `process.env`, which the bundles do not carry.
process.env.RITUAL_I18N_STRICT = '1'

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
    // Every project inherits this (none override `locale`): the specs assert on
    // English UI chrome, so the browser context must not follow whatever locale
    // the developer's machine happens to have. Project-level `use` merges over
    // this one, so a future locale-switching spec can still opt out per test.
    locale: 'en-US',
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
        // Session cookie captured by auth-setup.spec.ts (admin-auth project),
        // so admin specs start already authenticated instead of logging in
        // per test. Specs that exercise the login flow itself opt out with
        // `test.use({ storageState: { cookies: [], origins: [] } })`.
        storageState: ADMIN_STORAGE_STATE,
      },
    },
  ],
  globalSetup: './test/e2e/helpers/global-setup.ts',
  globalTeardown: './test/e2e/helpers/global-teardown.ts',
})
