import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import prompts from 'prompts'
import { startAdminServer } from '../admin/server'
import {
  adminUserExists,
  createAdminUser,
  getAdminUsername,
  getTotpSecret,
  resetAdminPassword,
  setTotpSecret,
} from '../admin/auth'
import { appendAuditLog, createAuditEntry } from '../admin/audit-log'
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, MIN_PASSWORD_LENGTH } from '../admin/validation'
import { runHttpServer } from '../mcp/run'
import { resolveMcpToken } from '../mcp/token'
import { getBaseDir } from '../config/base-dir'
import { ensureFreshCardCache } from '../cache/freshness'
import { sellModeWarning, warmCardKingdomFeed } from '../cardkingdom'
import {
  addRefreshOption,
  addSellModeOption,
  applySellModeOverride,
  addScriptingOptions,
  parsePort,
} from '../cli/options'
import type { RefreshMode } from '../cache/refresh'
import { isRunningFromSource } from '../config/runtime'
import {
  generateAllThemesCss,
  isThemeName,
  resolveThemeName,
  themeFlameStops,
  themeNames,
  type ThemeName,
} from '../theme/themes'
import { appBootScript, BOOT_SCRIPT_FILE, renderAppShell } from '../site/html-shell'
import { bakedDictionaries } from '../generated/locales'
import { en } from '../i18n/messages/en'
import { DEFAULT_LOCALE } from '../i18n/runtime'
import { t } from '../i18n/t'
import type { LocaleTag } from '../i18n/types'
import { getUiLocale } from '../config/ritual-config'
import { buildFlameSvg } from '../theme/flame'
import { localizedCommandError, ExitCode } from '../util/errors'
import { runCommandAction } from '../cli/action'
import { requireInteractive } from '../util/no-input'
import { readPasswordFromStdin } from '../cli/prompts'
import { emitOutput, normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'

type AdminCommandOptions = {
  port: number
  host: string
  theme?: string
  refresh: RefreshMode
  mcp?: boolean
  mcpPort: number
  mcpToken?: string
  /**
   * Offer sell mode for this run whatever `site.sellMode` says (enable-only;
   * absent follows the config). The admin used to force sell mode on
   * unconditionally; it now follows the same gate as every other surface, so a
   * workspace that never opted in is never made to download a ~70 MB buylist.
   */
  sellMode?: boolean
}

/** Validated settings for the embedded MCP endpoint (`--mcp`). */
type EmbeddedMcpConfig = {
  port: number
  token: string
}

function buildIndexHtml(initialTheme: ThemeName, locale: LocaleTag): string {
  // In source/dev mode, pull in the live-reload client so the browser refreshes when the dev
  // orchestrator restarts the server after a source edit. External (not inline) to satisfy CSP.
  const devReload = isRunningFromSource() ? '\n  <script src="__dev_reload.js"></script>' : ''
  return renderAppShell({
    lang: locale,
    // i18n-exempt: the product name, a proper noun that is the same in every locale
    title: 'Ritual Admin',
    initialTheme,
    extraHead: devReload,
  })
}

/**
 * Write the boot script and every bundled dictionary into `.admin-dist`.
 *
 * The admin regenerates that directory on every start, so the dictionaries ride
 * along with `app.js` and `styles.css` and need no separate build step. The
 * admin's *initial* locale still comes from `GET /api/config`, which is why
 * changing `uiLocale` there takes effect with no rebuild at all.
 */
async function writeAdminBootAssets(adminDistDir: string): Promise<void> {
  await Bun.write(path.join(adminDistDir, BOOT_SCRIPT_FILE), appBootScript)
  const localesDir = path.join(adminDistDir, 'locales')
  await fs.mkdir(localesDir, { recursive: true })
  // English is inline in the bundle and never fetched; written anyway so the
  // admin's locale list is discoverable from the same directory as the rest.
  await Bun.write(path.join(localesDir, `${DEFAULT_LOCALE}.json`), JSON.stringify(en))
  for (const { tag, catalog } of bakedDictionaries) {
    await Bun.write(path.join(localesDir, `${tag}.json`), JSON.stringify(catalog))
  }
}

async function buildAdminJs(srcDir: string, adminDistDir: string): Promise<void> {
  const { SolidPlugin } = await import('@dschz/bun-plugin-solid')
  const result = await Bun.build({
    entrypoints: [path.join(srcDir, 'admin', 'site', 'app.tsx')],
    outdir: adminDistDir,
    target: 'browser',
    format: 'esm',
    naming: 'app.js',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [SolidPlugin()],
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error('Admin SPA JS build failed')
  }
}

async function buildAdminCss(srcDir: string, adminDistDir: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [path.join(srcDir, 'admin', 'site', 'styles.css')],
    target: 'browser',
    minify: false,
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error('Admin SPA CSS build failed')
  }
  const cssOutput = result.outputs.find((o) => o.path.endsWith('.css'))
  if (!cssOutput) throw new Error('Admin SPA CSS build produced no .css output')
  const compiled = await cssOutput.text()
  await Bun.write(path.join(adminDistDir, 'styles.css'), `${generateAllThemesCss()}\n${compiled}`)
}

export function registerAdminCommand(program: Command): void {
  const admin = addRefreshOption(program.command('admin').description(t('help.admin.description')))
    .option('-p, --port <number>', t('help.admin.port'), parsePort, 8080)
    .option('--host <address>', t('help.admin.host'), '0.0.0.0')
    .option('--theme <name>', t('help.admin.theme', { themes: themeNames.join(', ') }), 'default')
    .option('--mcp', t('help.admin.mcp'))
    .option('--mcp-port <number>', t('help.admin.mcpPort'), parsePort, 8765)
    .option('--mcp-token <secret>', t('help.admin.mcpToken'))
    .action(async (options: AdminCommandOptions) => {
      // Set before the buylist warm and before the server starts answering
      // requests, so the startup refresh and the sell/buylist routes agree.
      applySellModeOverride(options)

      const port = options.port
      const host = options.host
      const adminDistDir = path.join(getBaseDir(), '.admin-dist')

      const themeName = resolveThemeName(options.theme)
      if (!isThemeName(themeName)) {
        console.error(themeName)
        process.exitCode = ExitCode.UsageError
        return
      }

      // Validate the embedded-MCP flags before any server starts listening, so
      // a bad combination never leaves a half-started admin server behind.
      let embeddedMcp: EmbeddedMcpConfig | undefined
      if (options.mcp) {
        const mcpToken = resolveMcpToken(options.mcpToken)
        if (!mcpToken) {
          console.error(t('cli.admin.mcpTokenRequired'))
          process.exitCode = ExitCode.UsageError
          return
        }
        if (options.mcpPort === port) {
          console.error(t('cli.admin.mcpPortConflict'))
          process.exitCode = ExitCode.UsageError
          return
        }
        embeddedMcp = { port: options.mcpPort, token: mcpToken }
      }

      console.log(t('cli.admin.preparing'))

      await ensureFreshCardCache(options.refresh)

      // The admin's buylist routes read a cached feed and never download; a
      // day-old one quotes yesterday's offers, so startup brings it current.
      // Gated on sell mode exactly like every other surface: `site.sellMode`, or
      // this run's `--sell-mode`. A workspace with no buylist is left alone.
      const buylistWarning = sellModeWarning(await warmCardKingdomFeed(options.refresh))
      if (buylistWarning !== undefined) console.warn(buylistWarning)

      await fs.rm(adminDistDir, { recursive: true, force: true })
      await fs.mkdir(adminDistDir, { recursive: true })

      if (isRunningFromSource()) {
        const adminSrcDir = path.join(import.meta.dir, '..', '..', 'src')
        await Promise.all([
          buildAdminJs(adminSrcDir, adminDistDir),
          buildAdminCss(adminSrcDir, adminDistDir),
        ])
      } else {
        // Lazy import: keeps `.compiled.{js,css}` text imports out of the
        // source-mode module graph (those files are gitignored). The path must
        // stay a literal string so `bun build --compile` can embed the module.
        const { getBundledAdminCss, getBundledAdminJs } = await import('../admin/bundled-assets')
        await Bun.write(path.join(adminDistDir, 'app.js'), getBundledAdminJs())
        await Bun.write(
          path.join(adminDistDir, 'styles.css'),
          `${generateAllThemesCss()}\n${getBundledAdminCss()}`,
        )
      }

      await writeAdminBootAssets(adminDistDir)
      // The shell's `lang` is the configured locale; the app re-resolves it from
      // `GET /api/config` (and the user's own stored choice) once it boots, so
      // this only has to be right for the first paint.
      await Bun.write(
        path.join(adminDistDir, 'index.html'),
        buildIndexHtml(themeName, getUiLocale()),
      )
      // Flame favicon tinted to the baked theme so the browser tab matches the
      // in-app logo (the admin has no live theme switcher, so this is static).
      await Bun.write(path.join(adminDistDir, 'app.svg'), buildFlameSvg(themeFlameStops(themeName)))

      console.log(t('cli.admin.ready'))

      const adminServer = await startAdminServer({ port, host, distDir: adminDistDir })

      // Same process, separate port; bearer-token auth like standalone `ritual mcp`.
      const mcpServer = embeddedMcp
        ? await runHttpServer({
            port: embeddedMcp.port,
            host,
            auth: { kind: 'bearer', token: embeddedMcp.token },
          })
        : undefined

      // Both listeners hold the process open, so Ctrl-C has to stop both; with
      // nothing left holding the loop the process then exits on its own (the
      // stdio MCP leg's teardown works the same way). Dropping active
      // connections is what lets the dev live-reload stream's `cancel()` run and
      // clear its keep-alive timer.
      // `allSettled` so one listener refusing to close still lets the other; the
      // results are read rather than discarded, because a teardown that failed is
      // a port left bound, and the next `ritual admin` failing to start is a much
      // worse way to learn about it (`ritual mcp` logs its own the same way).
      const labels = ['MCP HTTP', 'Admin'] as const
      const shutdown = (): void => {
        void Promise.allSettled([mcpServer?.stop(true), adminServer.stop(true)]).then((results) => {
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.error(
                t('cli.admin.teardownFailed', { label: labels[index] ?? '' }),
                result.reason,
              )
            }
          })
        })
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
    })
  // The shared `--sell-mode` flag; registered through the same helper as
  // `build-site`, `serve` and `mcp` so the four can never describe the same
  // switch differently. Commander collects options at parse time, so this sits
  // beside the built command rather than mid-chain.
  addSellModeOption(admin, t('help.admin.sellMode'))

  registerSetupSubcommand(admin)
  registerResetPasswordSubcommand(admin)
  registerDisableTotpSubcommand(admin)
}

// ---------------------------------------------------------------------------
// Headless account subcommands (`admin setup`, `admin reset-password`,
// `admin disable-totp`) — credential recovery without a running server.
// ---------------------------------------------------------------------------

type AccountSubcommandOptions = {
  username?: string
  passwordStdin?: boolean
} & Partial<ScriptingOptions>

type AdminSetupResult = {
  username: string
  created: boolean
}

type AdminResetPasswordResult = {
  username: string
  passwordReset: boolean
}

type AdminDisableTotpResult = {
  totpDisabled: boolean
}

async function promptForPassword(): Promise<string> {
  const response = await prompts({
    type: 'password',
    name: 'password',
    message: t('cli.admin.promptPassword'),
  })
  if (typeof response.password !== 'string') {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.admin.passwordCancelled')
  }
  return response.password
}

/**
 * Resolve the password for an account subcommand: `--password-stdin` drains
 * stdin; otherwise an interactive prompt is used, which refuses (usage error)
 * when stdin is not a terminal.
 */
async function resolvePassword(options: AccountSubcommandOptions): Promise<string> {
  if (options.passwordStdin) {
    return readPasswordFromStdin()
  }
  requireInteractive('--password-stdin')
  return promptForPassword()
}

/** Validate an optional username against the same limits as the HTTP setup handler. */
function validateUsername(username: string): void {
  if (username.length > MAX_USERNAME_LENGTH) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.admin.usernameTooLong')
  }
}

/** Validate password length against the same limits as the HTTP setup handler. */
function validatePassword(password: string): void {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.admin.passwordTooLong')
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.admin.passwordTooShort', {
      min: MIN_PASSWORD_LENGTH,
    })
  }
}

/** Append an admin-account event to the same audit log the login endpoint writes. */
async function auditAccountEvent(username: string, reason: string): Promise<void> {
  await appendAuditLog(createAuditEntry('cli', username, true, reason, 'ritual-cli'))
}

/** Fail with a not-found unless the admin credentials file exists. */
async function requireAdminUser(): Promise<void> {
  if (!(await adminUserExists())) {
    throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.admin.noUser')
  }
}

function registerSetupSubcommand(admin: Command): void {
  addScriptingOptions(
    admin
      .command('setup')
      .description(t('help.admin.setup'))
      .option('--username <username>', t('help.admin.setupUsername'))
      .option('--password-stdin', t('help.admin.setupPasswordStdin'), false),
    'text',
  ).action(async (options: AccountSubcommandOptions) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    await runCommandAction(scripting, async () => {
      const username = options.username
      if (!username) {
        throw localizedCommandError(
          'usage_error',
          ExitCode.UsageError,
          'cli.admin.usernameRequired',
        )
      }
      validateUsername(username)

      if (await adminUserExists()) {
        throw localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.admin.userExists')
      }

      const password = await resolvePassword(options)
      validatePassword(password)

      await createAdminUser(username, password)
      await auditAccountEvent(username, 'Admin account created via CLI')

      if (scripting.output === 'text') {
        if (!scripting.quiet) {
          emitOutput(t('cli.admin.userCreated', { username }), scripting)
        }
        return
      }
      const result: AdminSetupResult = { username, created: true }
      emitOutput(result, scripting)
    })
  })
}

function registerResetPasswordSubcommand(admin: Command): void {
  addScriptingOptions(
    admin
      .command('reset-password')
      .description(t('help.admin.resetPassword'))
      .option('--username <username>', t('help.admin.resetPasswordUsername'))
      .option('--password-stdin', t('help.admin.resetPasswordStdin'), false),
    'text',
  ).action(async (options: AccountSubcommandOptions) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    await runCommandAction(scripting, async () => {
      await requireAdminUser()
      if (options.username !== undefined) {
        validateUsername(options.username)
      }

      const password = await resolvePassword(options)
      validatePassword(password)

      const username = await resetAdminPassword(password, options.username)
      await auditAccountEvent(username, 'Admin password reset via CLI')

      if (scripting.output === 'text') {
        if (!scripting.quiet) {
          emitOutput(t('cli.admin.passwordReset', { username }), scripting)
        }
        return
      }
      const result: AdminResetPasswordResult = { username, passwordReset: true }
      emitOutput(result, scripting)
    })
  })
}

function registerDisableTotpSubcommand(admin: Command): void {
  addScriptingOptions(
    admin.command('disable-totp').description(t('help.admin.disableTotp')),
    'text',
  ).action(async (options: Partial<ScriptingOptions>) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    await runCommandAction(scripting, async () => {
      await requireAdminUser()

      // Gate on the raw secret, not isTotpEnabled(): a stuck `pending:`
      // enrollment is exactly the lockout this command recovers from, so
      // both active and pending secrets must be clearable.
      const secret = await getTotpSecret()
      if (secret === null) {
        throw localizedCommandError(
          'runtime_error',
          ExitCode.RuntimeError,
          'cli.admin.totpNotEnabled',
        )
      }

      await setTotpSecret(null)
      const username = (await getAdminUsername()) ?? 'admin'
      await auditAccountEvent(username, 'TOTP disabled via CLI')

      if (scripting.output === 'text') {
        if (!scripting.quiet) {
          emitOutput(t('cli.admin.totpDisabled'), scripting)
        }
        return
      }
      const result: AdminDisableTotpResult = { totpDisabled: true }
      emitOutput(result, scripting)
    })
  })
}
