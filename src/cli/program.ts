/**
 * The root `ritual` program: Commander setup, the global options, the root
 * `preAction` hook, and the localization of Commander's own strings.
 *
 * The command tree is data handed in by the caller — see
 * {@link BuildProgramOptions}. Nothing here imports `src/commands`; the
 * registry and the backfill predicate are injected so this module can be built
 * from a test with any subset of commands.
 */

import { Command, InvalidArgumentError } from 'commander'
import { version } from '../config/version'
import { applyCliLocale } from './locale'
import { t, type ParameterlessKey } from '../i18n/t'
import { divertConsoleLogToStderr } from '../util/stdout-guard'
import {
  isCacheServerAddressError,
  parseCacheServerBaseUrl,
  resolveCacheServerAddress,
  setCacheServerAddressOverride,
} from '../cache/config'
import { isBaseDirError, parseBaseDir, resolveBaseDir, setBaseDir } from '../config/base-dir'
import { resolveNoInput, setNoInputOverride } from '../util/no-input'
import { ensureCardIdsForAllLists } from '../list/ensure-card-ids'
import { isConfigParseError, parseUiLocale, refreshRitualConfig } from '../config/ritual-config'
import { ExitCode, CardCommandError } from '../util/errors'

/** Registers one command tree onto a program, e.g. `registerImportCommand`. */
export type CommandRegistrar = (program: Command) => void

/** One `--help` section: its localized heading key and the commands under it, in order. */
export type CommandGroup = {
  titleKey: ParameterlessKey
  commands: readonly CommandRegistrar[]
}

export type BuildProgramOptions = {
  /** The command groups, registered in this order. */
  groups: readonly CommandGroup[]
  /** Whether the root preAction hook should run the card-ID backfill for this invocation. */
  backfill: (actionCommand: Command) => boolean
}

/**
 * Commander argParser for `--cache-server`: a malformed address is a bad flag
 * value like any other, so it exits 2 (usage error) rather than reaching the
 * preAction hook as a runtime failure.
 */
function parseCacheServerOption(value: string): string {
  const parsed = parseCacheServerBaseUrl(value)
  if (isCacheServerAddressError(parsed)) {
    throw new InvalidArgumentError(parsed.error)
  }
  return value
}

/**
 * Commander argParser for `--locale`: a tag the engine does not recognize is a
 * bad flag value, so it exits 2 like any other. Only the flag is strict — a
 * malformed `RITUAL_LOCALE` or `uiLocale` degrades to the next tier, because an
 * interface language is cosmetic and refusing to run over one would be worse
 * than the misconfiguration. A value typed by hand is a typo worth reporting.
 *
 * The parser returns the canonical tag (`de-at` → `de-AT`), so the preAction
 * hook never has to re-canonicalize what it reads back.
 */
function parseLocaleOption(value: string): string {
  const parsed = parseUiLocale(value)
  if (isConfigParseError(parsed)) {
    throw new InvalidArgumentError(parsed.error)
  }
  return parsed
}

// ---------------------------------------------------------------------------
// Commander's own strings
// ---------------------------------------------------------------------------
//
// Everything below localizes text Commander authors rather than text Ritual
// authors, through the four hooks the library exposes for it: `.version()`,
// `.helpOption()`, `.helpCommand()`, `configureHelp({ styleTitle })` and
// `configureOutput({ outputError })`. The English in `help.commander.*` is a
// byte-for-byte copy of the library's literals, so an English run is
// indistinguishable from an unhooked one and only a translated run diverges.
//
// The error path is a *rendered string* rather than structured arguments —
// `outputError` is the only override point Commander offers, and it is handed
// the finished sentence. Each rule therefore re-parses one known message shape
// and re-renders it from the catalog. An unmatched message falls through
// verbatim, so a Commander upgrade that rewords a diagnostic degrades to
// English instead of breaking; the diagnostics with no hook at all (the
// `commander.` prefixed exception messages the library throws for programmer
// error) stay English by necessity.

/**
 * Commander's help section headings, keyed by the exact literal the library
 * hands `styleTitle`. Ritual's own command-group headings reach the same hook
 * already localized (`program.commandsGroup(t(…))`) and pass through untouched.
 */
export const COMMANDER_SECTION_TITLES = new Map<string, ParameterlessKey>([
  ['Usage:', 'help.commander.usageTitle'],
  ['Arguments:', 'help.commander.argumentsTitle'],
  ['Options:', 'help.commander.optionsTitle'],
  ['Global Options:', 'help.commander.globalOptionsTitle'],
  ['Commands:', 'help.commander.commandsTitle'],
])

export function localizeHelpTitle(title: string): string {
  const key = COMMANDER_SECTION_TITLES.get(title)
  return key === undefined ? title : t(key)
}

/** One recognized Commander diagnostic and how to re-render it from the catalog. */
type CommanderErrorRule = {
  pattern: RegExp
  render: (match: RegExpMatchArray) => string
}

/** A capture that is only optionally present, as a plain string. */
function capture(match: RegExpMatchArray, index: number): string {
  return match[index] ?? ''
}

/**
 * One side of a conflicting-option message: Commander composes it from either
 * the flag spelling or the environment variable that supplied the value, so the
 * two alternatives arrive as two adjacent captures of which exactly one matched.
 */
function conflictSide(match: RegExpMatchArray, flagsIndex: number, envIndex: number): string {
  return match[flagsIndex] === undefined
    ? t('help.commander.conflictEnv', { name: capture(match, envIndex) })
    : t('help.commander.conflictOption', { flags: capture(match, flagsIndex) })
}

export const COMMANDER_ERROR_RULES: readonly CommanderErrorRule[] = [
  {
    pattern: /^error: unknown option '(.*)'$/,
    render: (match) => t('help.commander.unknownOption', { flag: capture(match, 1) }),
  },
  {
    pattern: /^error: unknown command '(.*)'$/,
    render: (match) => t('help.commander.unknownCommand', { name: capture(match, 1) }),
  },
  {
    pattern: /^error: missing required argument '(.*)'$/,
    render: (match) => t('help.commander.missingArgument', { name: capture(match, 1) }),
  },
  {
    pattern: /^error: option '(.*)' argument missing$/,
    render: (match) => t('help.commander.optionArgumentMissing', { flags: capture(match, 1) }),
  },
  {
    pattern: /^error: required option '(.*)' not specified$/,
    render: (match) => t('help.commander.requiredOption', { flags: capture(match, 1) }),
  },
  {
    pattern:
      /^error: too many arguments for '([^']*)'\. Expected (\d+) arguments? but got (\d+): (.*)\.$/s,
    render: (match) =>
      t('help.commander.excessArgumentsFor', {
        count: Number(capture(match, 2)),
        command: capture(match, 1),
        expected: capture(match, 2),
        received: capture(match, 3),
        details: capture(match, 4),
      }),
  },
  {
    pattern: /^error: too many arguments\. Expected (\d+) arguments? but got (\d+): (.*)\.$/s,
    render: (match) =>
      t('help.commander.excessArguments', {
        count: Number(capture(match, 1)),
        expected: capture(match, 1),
        received: capture(match, 2),
        details: capture(match, 3),
      }),
  },
  {
    pattern:
      /^error: (?:option '([^']*)'|environment variable '([^']*)') cannot be used with (?:option '([^']*)'|environment variable '([^']*)')$/,
    render: (match) =>
      t('help.commander.conflictingOption', {
        source: conflictSide(match, 1, 2),
        other: conflictSide(match, 3, 4),
      }),
  },
  {
    // A validator's own reason is appended after the frame, already localized
    // by whoever threw the InvalidArgumentError, so it is carried through as-is.
    pattern: /^error: option '([^']*)' argument '(.*)' is invalid\.(.*)$/s,
    render: (match) =>
      t('help.commander.invalidOptionArgument', {
        flags: capture(match, 1),
        value: capture(match, 2),
      }) + capture(match, 3),
  },
  {
    pattern: /^error: option '([^']*)' value '(.*)' from env '([^']*)' is invalid\.(.*)$/s,
    render: (match) =>
      t('help.commander.invalidOptionEnv', {
        flags: capture(match, 1),
        value: capture(match, 2),
        env: capture(match, 3),
      }) + capture(match, 4),
  },
  {
    pattern: /^error: command-argument value '(.*)' is invalid for argument '([^']*)'\.(.*)$/s,
    render: (match) =>
      t('help.commander.invalidCommandArgument', {
        value: capture(match, 1),
        name: capture(match, 2),
      }) + capture(match, 3),
  },
]

/** Commander's "did you mean" tail, appended on its own line after some errors. */
const COMMANDER_SUGGESTION = /\n\((?:Did you mean (one of )?(.*)\?)\)$/s

function localizeCommanderErrorBody(body: string): string {
  for (const rule of COMMANDER_ERROR_RULES) {
    const match = body.match(rule.pattern)
    if (match !== null) return rule.render(match)
  }
  return body
}

/**
 * Localize one finished Commander diagnostic, preserving its trailing newline.
 * Unrecognized text is returned unchanged — see the section comment above.
 */
export function localizeCommanderError(raw: string): string {
  const newline = raw.endsWith('\n') ? '\n' : ''
  const message = newline === '' ? raw : raw.slice(0, -1)
  const suggestion = message.match(COMMANDER_SUGGESTION)
  if (suggestion === null) return `${localizeCommanderErrorBody(message)}${newline}`

  const body = message.slice(0, message.length - suggestion[0].length)
  const list = capture(suggestion, 2)
  const rendered =
    suggestion[1] === undefined
      ? t('help.commander.didYouMean', { suggestion: list })
      : t('help.commander.didYouMeanOneOf', { suggestions: list })
  return `${localizeCommanderErrorBody(body)}\n${rendered}${newline}`
}

// Commander stores `--no-input` as `input: false` (attribute `input`, default true).
export type GlobalOptions = {
  cacheServer?: string
  baseDir?: string
  input?: boolean
  locale?: string
}

/**
 * Build the command tree.
 *
 * Commander evaluates every `.description()` / `.option()` / `.argument()`
 * string at registration time, so the whole tree is built here rather than at
 * module scope: `main()` resolves the UI locale first, and only then does help
 * text get authored. The commands themselves are injected as `groups` (the CLI
 * passes `COMMAND_GROUPS` from `src/commands/registry.ts`), as is the card-ID
 * `backfill` predicate, so nothing in `src/cli` reaches into `src/commands`.
 */
export function buildProgram(build: BuildProgramOptions): Command {
  const program = new Command()
  // Subcommands created after this inherit the override, so commander throws
  // CommanderError instead of calling process.exit — letting the catch below map
  // usage errors to ExitCode.UsageError and async action rejections to
  // ExitCode.RuntimeError instead of an unhandled-rejection stack trace.
  program.exitOverride()

  // Both configurations are copied by reference into every subcommand created
  // after this point (`copyInheritedSettings`), so they must be installed before
  // the `register` calls in the group loop below rather than after.
  program.configureHelp({ styleTitle: localizeHelpTitle })
  program.configureOutput({
    outputError: (message, write) => write(localizeCommanderError(message)),
  })

  program
    .name('ritual')
    .description(t('help.program.description'))
    // The flags are passed only so the description can be: Commander takes them
    // positionally, and these are the spellings it would have defaulted to.
    .version(version, '-V, --version', t('help.commander.version'))
  program.helpOption('-h, --help', t('help.commander.help'))
  // `[command]` is an argument name shown in the usage line, not prose; the one
  // description Commander uses for both the flag and the command is shared.
  program.helpCommand('help [command]', t('help.commander.help'))

  program.option('--cache-server <host:port>', t('help.global.cacheServer'), parseCacheServerOption)
  program.option('--base-dir <path>', t('help.global.baseDir'))
  program.option('--no-input', t('help.global.noInput'))
  program.option('--locale <tag>', t('help.global.locale'), parseLocaleOption)

  // Commander passes the hooked command first (always the root program here) and
  // the command whose action is about to run second — everything per-invocation
  // must be derived from `actionCommand`.
  program.hook('preAction', async (_program, actionCommand) => {
    // The MCP stdio transport uses stdout as its JSON-RPC channel; divert any stray
    // logging (config init, card-ID backfill, etc.) to stderr before it can run.
    // (`src/mcp/run.ts` diverts again for the stdio transport, but only once the
    // action starts — too late for this hook's own logging.)
    if (actionCommand.name() === 'mcp') {
      divertConsoleLogToStderr()
    }

    const options = actionCommand.optsWithGlobals<GlobalOptions>()
    // A base dir that isn't an existing directory is a usage error, not an empty
    // workspace: reading a typo would report "(no lists)" and writing one would
    // fork the user's data into a stray tree.
    const requestedBaseDir = resolveBaseDir(options.baseDir, process.env.RITUAL_BASE_DIR)
    if (requestedBaseDir !== undefined) {
      const parsed = await parseBaseDir(requestedBaseDir)
      if (isBaseDirError(parsed)) {
        throw new CardCommandError('usage_error', parsed.error, ExitCode.UsageError)
      }
      setBaseDir(parsed)
    }
    const resolved = resolveCacheServerAddress(options.cacheServer, process.env.RITUAL_CACHE_SERVER)
    if (resolved) {
      // The flag itself is validated by its argParser (exit 2); this catches a
      // malformed RITUAL_CACHE_SERVER with the same usage error. A *blank* env
      // var never reaches here — `resolveCacheServerAddress` reads blank as
      // "unset", the usual environment convention, whereas explicitly passing
      // `--cache-server ""` is a bad flag value and still exits 2.
      const parsedCacheServer = parseCacheServerBaseUrl(resolved)
      if (isCacheServerAddressError(parsedCacheServer)) {
        throw new CardCommandError('usage_error', parsedCacheServer.error, ExitCode.UsageError)
      }
    }
    setCacheServerAddressOverride(resolved)

    // `--no-input` can only turn prompting off; when absent (`input` stays true),
    // RITUAL_NO_INPUT decides.
    setNoInputOverride(
      resolveNoInput(options.input === false ? true : undefined, process.env.RITUAL_NO_INPUT),
    )

    await refreshRitualConfig()
    // The authoritative locale pass: `--base-dir` has been applied, so the
    // `uiLocale` tier reads the config file this run will actually use, and the
    // flag has already been validated by its argParser. `initI18n()` ran before
    // registration purely so help text could be authored in the right language.
    applyCliLocale({ flag: options.locale })

    if (build.backfill(actionCommand)) {
      await ensureCardIdsForAllLists()
    }
  })

  for (const group of build.groups) {
    program.commandsGroup(t(group.titleKey))
    for (const register of group.commands) register(program)
  }

  return program
}
