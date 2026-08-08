import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCALE_ENV, ensureBinary, repoRoot, runCli, withTempDir } from './helpers/cli'
import { en } from '../../src/i18n/messages/en'
import type { LocaleCatalog } from '../../src/i18n/types'

/**
 * The pseudo-locale end to end, through the real binary.
 *
 * `en-XA` is generated from English by `scripts/generate-locales.ts` — accented,
 * padded, and bracketed — so it answers the one question no English assertion
 * can: *did this string actually go through `t()`?* A message that did comes out
 * bracketed; a literal that was never routed stays plain ASCII.
 *
 * The `--help` case is the load-bearing one. Commander evaluates every
 * `.description()` / `.option()` string at registration time, which is why the
 * command tree is built inside `buildProgram()` after `initI18n()` rather than
 * at module scope. If that ordering ever regresses — a locale resolved in
 * `preAction`, say — help renders in English while everything else translates,
 * and only this test notices.
 *
 * Expected strings are read from the generated catalog rather than pasted in, so
 * the assertion follows the English source and the generator instead of pinning
 * a snapshot of accented text that no one can proofread.
 */

const PSEUDO = 'en-XA'

/** Env that asks for the pseudo-locale, on top of the suite's scrubbed baseline. */
const PSEUDO_ENV: Record<string, string | undefined> = { ...LOCALE_ENV, RITUAL_LOCALE: PSEUDO }

let pseudoCatalog: LocaleCatalog | null = null

/**
 * The generated `en-XA` dictionary. Read lazily and only after the binary is
 * ready, because the same build step that compiles the binary is what writes it.
 */
async function pseudo(): Promise<LocaleCatalog> {
  if (pseudoCatalog !== null) return pseudoCatalog
  await ensureBinary()
  const raw = await fs.readFile(path.join(repoRoot, 'locales', `${PSEUDO}.json`), 'utf-8')
  pseudoCatalog = JSON.parse(raw) as LocaleCatalog
  return pseudoCatalog
}

/** The pseudo-localized form of a plain-string message, for a `toContain`. */
async function pseudoText(key: string): Promise<string> {
  const value = (await pseudo())[key]
  if (typeof value !== 'string') {
    throw new Error(`${key} is not a plain-string message in the ${PSEUDO} catalog`)
  }
  return value
}

/**
 * Collapse every whitespace run to a single space.
 *
 * Commander re-wraps help text to the terminal width, so a message long enough
 * to break across lines would never match verbatim — and the pseudo-locale pads
 * everything by 40% precisely to make text long. Normalizing both sides keeps
 * the assertion about *which* text was rendered rather than about layout.
 */
function unwrap(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/** The `--output json` error envelope, as a script or agent parses it. */
type ErrorEnvelopeJson = {
  error: { code: string; messageKey?: string; message: string; details?: unknown }
}

/** Run a command that fails and return its parsed error envelope. */
async function runFailing(
  args: string[],
  dir: string,
  env: Record<string, string | undefined>,
): Promise<ErrorEnvelopeJson> {
  const result = await runCli(args, dir, env)
  expect(result.exitCode).not.toBe(0)
  return JSON.parse(result.stderr) as ErrorEnvelopeJson
}

describe('pseudo-locale (Integration)', () => {
  test('RITUAL_LOCALE=en-XA renders help in the pseudo-locale', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['--help'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(0)
      // The program description is registered before any option is parsed, so
      // seeing it bracketed is the proof that the locale was resolved before
      // the command tree was built.
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.program.description'))
      // Options registered on the root program, and a subcommand summary
      // registered by one of the `register*Command` calls, both follow.
      expect(result.stdout).toMatch(/--locale <tag>\s+\[/)
      expect(result.stdout).toMatch(/--base-dir <path>\s+\[/)
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.locale.summary'))
    })
  })

  test("Commander's own help strings are localized, not just Ritual's", async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['--help'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(0)
      // Section headings arrive through `configureHelp({ styleTitle })`, the
      // built-in flag descriptions through `.version()` / `.helpOption()`, and
      // the group headings from `commandsGroup(t(…))`. None of the three is a
      // string Ritual would otherwise author, so each is only bracketed if its
      // hook is actually wired.
      expect(result.stdout).toContain(await pseudoText('help.commander.usageTitle'))
      expect(result.stdout).toContain(await pseudoText('help.commander.optionsTitle'))
      expect(result.stdout).toContain(await pseudoText('help.commander.commandsTitle'))
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.commander.version'))
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.commander.help'))
      expect(result.stdout).toContain(await pseudoText('help.group.lists'))
    })
  })

  test("Commander's parse errors are localized, suggestion included", async () => {
    await withTempDir(async (dir) => {
      // `outputError` is handed a finished sentence rather than its arguments,
      // so these two prove the re-parse: the frame is bracketed while the flag
      // and command names inside it are untouched.
      const unknownOption = await runCli(['--bogos'], dir, PSEUDO_ENV)
      expect(unknownOption.exitCode).toBe(2)
      expect(unwrap(unknownOption.stderr)).toContain(
        (await pseudoText('help.commander.unknownOption')).replace('{flag}', '--bogos'),
      )

      // An unknown command close to a real one appends the "did you mean" tail,
      // which is split off and localized separately from the frame.
      const unknownCommand = await runCli(['dif'], dir, PSEUDO_ENV)
      expect(unknownCommand.exitCode).toBe(2)
      expect(unwrap(unknownCommand.stderr)).toContain(
        (await pseudoText('help.commander.unknownCommand')).replace('{name}', 'dif'),
      )
      expect(unwrap(unknownCommand.stderr)).toContain(
        (await pseudoText('help.commander.didYouMean')).replace('{suggestion}', 'diff'),
      )
    })
  })

  test("Commander's English is byte-identical to the unhooked library", async () => {
    await withTempDir(async (dir) => {
      // The catalog copies Commander's own literals, so an English run must be
      // indistinguishable from one with no hooks installed at all.
      const help = await runCli(['--help'], dir)
      expect(help.stdout.startsWith('Usage: ritual [options] [command]\n')).toBe(true)
      expect(help.stdout).toContain('\nOptions:\n')
      expect(help.stdout).toContain('output the version number')
      expect(help.stdout).toContain('display help for command')

      const unknownOption = await runCli(['--bogos'], dir)
      expect(unknownOption.stderr).toBe("error: unknown option '--bogos'\n")

      const unknownCommand = await runCli(['dif'], dir)
      expect(unknownCommand.stderr).toBe("error: unknown command 'dif'\n(Did you mean diff?)\n")

      const missingArgument = await runCli(['diff', 'a'], dir)
      expect(missingArgument.stderr).toBe("error: missing required argument 'listB'\n")

      const excess = await runCli(['lists', 'x', 'y'], dir)
      expect(excess.stderr).toBe(
        "error: too many arguments for 'lists'. Expected 0 arguments but got 2: x, y.\n",
      )
    })
  })

  test('--locale reaches help too, not just RITUAL_LOCALE', async () => {
    await withTempDir(async (dir) => {
      // The flag is read by the argv pre-scan, which runs before Commander
      // exists — the piece of §6.3 that has no other observable effect.
      const result = await runCli(['--locale', PSEUDO, '--help'], dir)

      expect(result.exitCode).toBe(0)
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.program.description'))
    })
  })

  test('subcommand help is pseudo-localized as well', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['locale', '--help'], dir, PSEUDO_ENV)

      expect(result.exitCode).toBe(0)
      expect(unwrap(result.stdout)).toContain(await pseudoText('help.locale.summary'))
    })
  })

  test('English help is unchanged — the pseudo-locale is opt-in', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['--help'], dir)

      expect(result.exitCode).toBe(0)
      expect(unwrap(result.stdout)).toContain(en['help.program.description'])
      expect(unwrap(result.stdout)).toContain(en['help.locale.summary'])
    })
  })

  test('--output json keeps code and messageKey stable while message follows the locale', async () => {
    await withTempDir(async (dir) => {
      const english = await runFailing(['diff', 'a', 'b', '--output', 'json'], dir, LOCALE_ENV)
      const translated = await runFailing(['diff', 'a', 'b', '--output', 'json'], dir, PSEUDO_ENV)

      // The machine contract: neither the error code nor the key moves with the
      // language, so a script or agent matching on either keeps working.
      expect(english.error.code).toBe('not_found')
      expect(translated.error.code).toBe(english.error.code)
      expect(english.error.messageKey).toBe('errors.resolveList.noLists')
      expect(translated.error.messageKey).toBe(english.error.messageKey)

      // The prose is the only part that moves.
      expect(english.error.message).toBe(en['errors.resolveList.noLists'])
      expect(translated.error.message).toBe(await pseudoText('errors.resolveList.noLists'))
    })
  })

  test('exit codes are locale-invariant', async () => {
    await withTempDir(async (dir) => {
      const english = await runCli(['diff', 'a', 'b'], dir, LOCALE_ENV)
      const translated = await runCli(['diff', 'a', 'b'], dir, PSEUDO_ENV)

      expect(translated.exitCode).toBe(english.exitCode)
      expect(english.exitCode).not.toBe(0)
    })
  })
})
