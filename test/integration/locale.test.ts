import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  LOCALE_ENV,
  TEST_BUNDLED_LOCALES,
  runCli,
  withTempDir,
  type CliResult,
} from './helpers/cli'

/**
 * UI locale resolution through the real binary: `--locale` → `RITUAL_LOCALE` →
 * `uiLocale` → OS detection → `en`.
 *
 * Precedence is asserted through `ritual locale --output json`, never through
 * translated prose: `source` is a machine contract value, so these assertions
 * stay valid once messages actually get translated.
 *
 * `LOCALE_ENV` already clears every POSIX locale variable and pins
 * `RITUAL_LOCALE=en`; each case opts back out of the pieces it is exercising.
 */

/** One `--detect` probe finding, as a client sees it. */
type LocaleProbeJson = {
  source: string
  ran: boolean
  origin: string
  raw?: string
  tag?: string
}

/** The `ritual locale --output json` payload, as a client sees it. */
type LocaleReportJson = {
  uiLocale: string
  source: string
  requested?: string
  availableLocales: string[]
  detectedOsLocale?: string
  defaultLanguage: string
  ignored: { source: string; value: string; error: string }[]
  probes?: LocaleProbeJson[]
  suggestedUiLocale?: string
}

/**
 * What this binary can render: English plus whatever the test build baked in.
 * English is always first — it is the catalog's source language, not a loaded
 * dictionary.
 */
// `TEST_BUNDLED_LOCALES` is the comma-separated `RITUAL_BUNDLED_LOCALES` value, so
// it is split rather than spread as one element — baking a second test locale must
// not silently produce `['en', 'en-XA,de']`.
const AVAILABLE_LOCALES = ['en', ...TEST_BUNDLED_LOCALES.split(',')]

/** Env with no locale signal at all — the "nothing is configured" baseline. */
const NO_LOCALE_ENV: Record<string, string | undefined> = {
  ...LOCALE_ENV,
  RITUAL_LOCALE: undefined,
}

async function runLocale(
  dir: string,
  env: Record<string, string | undefined>,
  globalArgs: string[] = [],
  commandArgs: string[] = [],
): Promise<LocaleReportJson> {
  const result = await runCli(
    [...globalArgs, 'locale', ...commandArgs, '--output', 'json'],
    dir,
    env,
  )
  expect(result.stderr).toBe('')
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout) as LocaleReportJson
}

async function writeUiLocaleConfig(dir: string, uiLocale: string): Promise<void> {
  await fs.writeFile(
    path.join(dir, 'ritual.config.json'),
    `${JSON.stringify({ uiLocale }, null, 2)}\n`,
  )
}

describe('locale resolution (Integration)', () => {
  test('falls back to English when nothing names a locale', async () => {
    await withTempDir(async (dir) => {
      const report = await runLocale(dir, NO_LOCALE_ENV)

      expect(report.uiLocale).toBe('en')
      expect(report.source).toBe('default')
      expect(report.availableLocales).toEqual(AVAILABLE_LOCALES)
      expect(report.ignored).toEqual([])
    })
  })

  test('RITUAL_LOCALE wins over the built-in default', async () => {
    await withTempDir(async (dir) => {
      const report = await runLocale(dir, { ...LOCALE_ENV, RITUAL_LOCALE: 'fr' })

      expect(report.uiLocale).toBe('fr')
      expect(report.source).toBe('env')
    })
  })

  test('uiLocale is used when no flag or env names one, and is canonicalized', async () => {
    await withTempDir(async (dir) => {
      await writeUiLocaleConfig(dir, 'de-at')
      const report = await runLocale(dir, NO_LOCALE_ENV)

      expect(report.uiLocale).toBe('de-AT')
      expect(report.source).toBe('config')
    })
  })

  test('RITUAL_LOCALE outranks uiLocale, and --locale outranks both', async () => {
    await withTempDir(async (dir) => {
      await writeUiLocaleConfig(dir, 'de-AT')

      const fromEnv = await runLocale(dir, { ...LOCALE_ENV, RITUAL_LOCALE: 'fr' })
      expect(fromEnv.uiLocale).toBe('fr')
      expect(fromEnv.source).toBe('env')

      const fromFlag = await runLocale(dir, { ...LOCALE_ENV, RITUAL_LOCALE: 'fr' }, [
        '--locale',
        'ja',
      ])
      expect(fromFlag.uiLocale).toBe('ja')
      expect(fromFlag.source).toBe('flag')
    })
  })

  test('the OS environment is detected but only wins when a matching locale ships', async () => {
    await withTempDir(async (dir) => {
      const report = await runLocale(dir, { ...NO_LOCALE_ENV, LANG: 'de_DE.UTF-8' })

      // Detection ran and normalized the POSIX value…
      expect(report.detectedOsLocale).toBe('de-DE')
      // …but no German dictionary ships, so nothing was negotiated.
      expect(report.uiLocale).toBe('en')
      expect(report.source).toBe('default')
    })
  })

  test('a malformed RITUAL_LOCALE degrades to the next tier and is reported', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['locale', '--output', 'json'], dir, {
        ...LOCALE_ENV,
        RITUAL_LOCALE: 'zz-ZZ',
      })

      expect(result.exitCode).toBe(0)
      const report = JSON.parse(result.stdout) as LocaleReportJson
      expect(report.uiLocale).toBe('en')
      expect(report.source).toBe('default')
      expect(report.ignored).toHaveLength(1)
      expect(report.ignored[0]?.source).toBe('env')
      expect(report.ignored[0]?.value).toBe('zz-ZZ')
      expect(result.stderr).toContain('RITUAL_LOCALE')
    })
  })

  test('an unrecognized --locale is a usage error', async () => {
    await withTempDir(async (dir) => {
      const result: CliResult = await runCli(['--locale', 'zz-ZZ', 'locale'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('zz-ZZ')
    })
  })

  test('a structurally invalid --locale is a usage error', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['--locale', 'not a locale', 'locale'], dir)

      expect(result.exitCode).toBe(2)
    })
  })

  test('text output shows the UI locale and the card language side by side', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['locale'], dir, { ...LOCALE_ENV, RITUAL_LOCALE: 'de-AT' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('UI locale: de-AT (RITUAL_LOCALE)')
      expect(result.stdout).toContain('Card language (defaultLanguage): en')
      expect(result.stdout).toContain(`Available UI locales: ${AVAILABLE_LOCALES.join(', ')}`)
    })
  })

  test('locale is read-only: it writes no config file', async () => {
    await withTempDir(async (dir) => {
      await runCli(['locale'], dir)

      expect(await fs.exists(path.join(dir, 'ritual.config.json'))).toBe(false)
    })
  })

  /**
   * `--detect` is the only path that spawns a subprocess for a locale. These
   * run on whatever platform the suite is on, so they assert only what holds
   * everywhere: the environment probe is first, so a `LANG` that names a
   * language decides the outcome regardless of which OS probe was applicable.
   */
  describe('--detect', () => {
    test('reports every source and offers the detected locale without prompting', async () => {
      await withTempDir(async (dir) => {
        const result = await runCli(['--no-input', 'locale', '--detect'], dir, {
          ...NO_LOCALE_ENV,
          LANG: 'de_DE.UTF-8',
        })

        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Detection probes:')
        expect(result.stdout).toContain('Environment (LANG): de_DE.UTF-8 → de-DE')
        // Both OS probes are named whether or not they applied, so the report
        // says what was *not* asked too.
        expect(result.stdout).toContain('Windows UI culture')
        expect(result.stdout).toContain('macOS system locale')
        expect(result.stdout).toContain('Detected de-DE, but the interface is using en')
        // --no-input: the offer degrades to the command that would apply it.
        expect(result.stdout).toContain('prompts are disabled')
        expect(result.stdout).toContain('ritual config set uiLocale de-DE')
        expect(result.stderr).toBe('')

        // The offer was printed, not taken.
        expect(await fs.exists(path.join(dir, 'ritual.config.json'))).toBe(false)
      })
    })

    // No `--no-input` here on purpose: JSON output cannot share stdout with
    // prompt UI, so the payload is the offer even on an interactive terminal.
    test('structured output carries the findings instead of an offer', async () => {
      await withTempDir(async (dir) => {
        const report = await runLocale(
          dir,
          { ...NO_LOCALE_ENV, LANG: 'de_DE.UTF-8' },
          [],
          ['--detect'],
        )

        expect(report.suggestedUiLocale).toBe('de-DE')
        const environment = report.probes?.find((probe) => probe.source === 'environment')
        expect(environment).toEqual({
          source: 'environment',
          ran: true,
          origin: 'LANG',
          raw: 'de_DE.UTF-8',
          tag: 'de-DE',
        })
        expect(report.probes?.map((probe) => probe.source)).toEqual([
          'environment',
          'windows',
          'macos',
        ])
        expect(await fs.exists(path.join(dir, 'ritual.config.json'))).toBe(false)
      })
    })

    // The comparison is by exact tag, not by language: `en-US` and `en` format
    // dates and numbers differently, so offering to move between them is a real
    // change, not noise.
    test('nothing is offered when detection agrees with the active locale', async () => {
      await withTempDir(async (dir) => {
        const result = await runCli(['--no-input', 'locale', '--detect'], dir, {
          ...LOCALE_ENV,
          RITUAL_LOCALE: 'en-US',
          LANG: 'en_US.UTF-8',
        })

        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Detection agrees with the interface locale (en-US)')
        expect(result.stdout).not.toContain('config set uiLocale')
      })
    })

    test('the probes are absent unless --detect asked for them', async () => {
      await withTempDir(async (dir) => {
        const report = await runLocale(dir, { ...NO_LOCALE_ENV, LANG: 'de_DE.UTF-8' })

        expect(report.probes).toBeUndefined()
        expect(report.suggestedUiLocale).toBeUndefined()
      })
    })
  })

  test('config set uiLocale persists a canonical tag and rejects a bad one', async () => {
    await withTempDir(async (dir) => {
      const ok = await runCli(['config', 'set', 'uiLocale', 'de-at'], dir)
      expect(ok.exitCode).toBe(0)
      expect(ok.stdout.trim()).toBe('Set uiLocale = de-AT')

      const written = JSON.parse(
        await fs.readFile(path.join(dir, 'ritual.config.json'), 'utf-8'),
      ) as { uiLocale: string }
      expect(written.uiLocale).toBe('de-AT')

      const bad = await runCli(['config', 'set', 'uiLocale', 'zz-ZZ'], dir)
      expect(bad.exitCode).toBe(2)
      expect(bad.stderr).toContain('zz-ZZ')
    })
  })
})
