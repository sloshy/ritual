/**
 * The root `ritual` program: Commander setup, the global options, the root
 * `preAction` hook, and the localization of Commander's own strings.
 *
 * The command tree is data handed in by the caller — see
 * {@link BuildProgramOptions}. Nothing here imports `src/commands`; the
 * registry and the backfill predicate are injected so this module can be built
 * from a test with any subset of commands.
 */

import {
  type Argument,
  Command,
  CommanderError,
  InvalidArgumentError,
  type Option,
} from 'commander'
import { version } from '../config/version'
import { applyCliLocale } from './locale'
import { qualifiedCommandName } from './command-name'
import { t, type ParameterlessKey } from '../i18n/t'
import { formatUnitList } from '../i18n/format'
import { currentLocale } from '../i18n/runtime'
import { divertConsoleLogToStderr } from '../util/stdout-guard'
import {
  isCacheServerAddressError,
  parseCacheServerBaseUrl,
  resolveCacheServerAddress,
  setCacheServerAddressOverride,
} from '../cache/config'
import { parseBaseDir, resolveBaseDir, setBaseDir } from '../config/base-dir'
import { resolveNoInput, setNoInputOverride } from '../util/no-input'
import { ensureCardIdsForAllLists } from '../list/ensure-card-ids'
import {
  cacheDirCheckContext,
  getRitualConfig,
  isConfigParseError,
  parseCacheDir,
  parseUiLocale,
  refreshRitualConfig,
} from '../config/ritual-config'
import { nonBlank } from '../util/user-dirs'
import { ExitCode, CardCommandError, messageCommandError } from '../util/errors'
import { isMessageParseError } from '../sync/message'
import { PreActionFailure } from './action'
import { messageArgParser } from './options'
import { OUTPUT_FORMATS, type OutputFormat, type ScriptingOptions } from './output'
import { ENV_VAR } from '../util/cli-tokens'

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
  /**
   * The pending-migration check, run before the config load: it offers to
   * migrate, or prints a one-line notice, and never fails the command. The CLI
   * passes `checkWorkspaceMigrations`; it decides its own exemptions.
   */
  workspaceCheck: (actionCommand: Command) => Promise<void>
  /**
   * The update-available notice: `start` runs at the end of the preAction hook
   * and may begin a releases lookup beside the command; `finish` runs as the
   * postAction hook and prints the notice after the command's output. Neither
   * fails the command. The CLI passes `createUpdateNotice()`.
   */
  updateNotice: UpdateNoticeHooks
}

/** The two halves of the update-available notice the program's hooks call. */
export type UpdateNoticeHooks = {
  start: (actionCommand: Command) => Promise<void>
  finish: (actionCommand: Command) => Promise<void>
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
const parseLocaleOption = messageArgParser(parseUiLocale)

// ---------------------------------------------------------------------------
// Commander's own strings
// ---------------------------------------------------------------------------
//
// Everything below localizes text Commander authors rather than text Ritual
// authors, through the hooks the library exposes for it: `.version()`,
// `.helpOption()`, `.helpCommand()`, `configureHelp({ styleTitle,
// optionDescription, argumentDescription })` and
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
 * The catalog key for one of Commander's help section headings, matched on the
 * exact literal the library hands `styleTitle` — Commander's own English, which
 * is only ever compared here, never shown. Ritual's own command-group headings
 * reach the same hook already localized (`program.commandsGroup(t(…))`) and
 * have no key here. Commander's "Global Options:" heading is absent on purpose:
 * it prints only under `showGlobalOptions`, which Ritual never enables.
 */
function commanderSectionTitleKey(title: string): ParameterlessKey | undefined {
  switch (title) {
    case 'Usage:':
      return 'help.commander.usageTitle'
    case 'Arguments:':
      return 'help.commander.argumentsTitle'
    case 'Options:':
      return 'help.commander.optionsTitle'
    case 'Commands:':
      return 'help.commander.commandsTitle'
    default:
      return undefined
  }
}

export function localizeHelpTitle(title: string): string {
  const key = commanderSectionTitleKey(title)
  return key === undefined ? title : t(key)
}

/**
 * Join items the way Commander joins them (`a, b, c`), in the reader's
 * language: a unit list, which English renders with Commander's own `, `.
 */
function commanderList(items: readonly string[]): string {
  return formatUnitList(currentLocale(), items)
}

/**
 * A help row's description with its annotations — `(choices: …, default: …)` —
 * appended, or the bare description when there are none. Commander's own
 * layout: one space, then the parenthesized list.
 */
function annotatedDescription(description: string, annotations: readonly string[]): string {
  if (annotations.length === 0) return description
  const suffix = t('help.commander.annotations', { annotations: commanderList(annotations) })
  return description === '' ? suffix : `${description} ${suffix}`
}

/** The `choices: "a", "b"` annotation; each value JSON-quoted, as Commander shows it. */
function choicesAnnotation(choices: readonly string[]): string {
  return t('help.commander.annotationChoices', {
    choices: commanderList(choices.map((choice) => JSON.stringify(choice))),
  })
}

/**
 * `Help.optionDescription`, re-rendered from the catalog: the same annotations
 * under the same conditions as the library's (`lib/help.js`) — except a
 * boolean flag's default, which is left out — with only the words translated. The values — choices, defaults, presets, the environment
 * variable — are spec data and stay verbatim.
 */
export function localizedOptionDescription(option: Option): string {
  const annotations: string[] = []
  if (option.argChoices) annotations.push(choicesAnnotation(option.argChoices))
  if (option.defaultValue !== undefined) {
    // A value-taking option's default is shown, as Commander shows it. A
    // boolean flag's is not, where Commander would print `(default: false)`:
    // a switch is off until given, and saying so on every `--quiet` row of
    // every command is noise.
    if (!option.isBoolean()) {
      annotations.push(
        t('help.commander.annotationDefault', {
          value: option.defaultValueDescription || JSON.stringify(option.defaultValue),
        }),
      )
    }
  }
  if (option.presetArg !== undefined && option.optional) {
    annotations.push(
      t('help.commander.annotationPreset', { value: JSON.stringify(option.presetArg) }),
    )
  }
  if (option.envVar !== undefined) {
    annotations.push(t('help.commander.annotationEnv', { name: option.envVar }))
  }
  return annotatedDescription(option.description, annotations)
}

/** `Help.argumentDescription`, re-rendered the same way as {@link localizedOptionDescription}. */
export function localizedArgumentDescription(argument: Argument): string {
  const annotations: string[] = []
  if (argument.argChoices) annotations.push(choicesAnnotation(argument.argChoices))
  if (argument.defaultValue !== undefined) {
    annotations.push(
      t('help.commander.annotationDefault', {
        value: argument.defaultValueDescription || JSON.stringify(argument.defaultValue),
      }),
    )
  }
  return annotatedDescription(argument.description, annotations)
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

/**
 * The reason `.choices()` gives when a value is not one of them, as the tail of
 * an invalid-value frame: ` Allowed choices are a, b.` (`lib/option.js`,
 * `lib/argument.js`). Commander has already joined the choices with `, `, so
 * they are split back on it — sound for every choice list Ritual declares,
 * none of which holds a comma.
 */
const COMMANDER_CHOICES_REASON = /^ Allowed choices are (.*)\.$/s

/**
 * The reason appended after an invalid-value frame. A validator's own reason
 * arrives already localized by whoever threw the `InvalidArgumentError` and is
 * carried through as-is; Commander's `.choices()` reason is its own English and
 * is re-rendered from the catalog.
 */
function invalidValueReason(tail: string): string {
  const choices = tail.match(COMMANDER_CHOICES_REASON)
  if (choices === null) return tail
  return ` ${t('help.commander.allowedChoices', {
    choices: commanderList(capture(choices, 1).split(', ')),
  })}`
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
    // The value's reason follows the frame; see `invalidValueReason`.
    pattern: /^error: option '([^']*)' argument '(.*)' is invalid\.(.*)$/s,
    render: (match) =>
      t('help.commander.invalidOptionArgument', {
        flags: capture(match, 1),
        value: capture(match, 2),
      }) + invalidValueReason(capture(match, 3)),
  },
  {
    pattern: /^error: option '([^']*)' value '(.*)' from env '([^']*)' is invalid\.(.*)$/s,
    render: (match) =>
      t('help.commander.invalidOptionEnv', {
        flags: capture(match, 1),
        value: capture(match, 2),
        env: capture(match, 3),
      }) + invalidValueReason(capture(match, 4)),
  },
  {
    pattern: /^error: command-argument value '(.*)' is invalid for argument '([^']*)'\.(.*)$/s,
    render: (match) =>
      t('help.commander.invalidCommandArgument', {
        value: capture(match, 1),
        name: capture(match, 2),
      }) + invalidValueReason(capture(match, 3)),
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
  program.configureHelp({
    styleTitle: localizeHelpTitle,
    optionDescription: localizedOptionDescription,
    argumentDescription: localizedArgumentDescription,
  })
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
    try {
      await prepareAction(build, actionCommand)
    } catch (error) {
      // An error Commander raised itself (a hook calling `command.error()`) has
      // already been printed by Commander, and the top level handles it as such.
      if (error instanceof CommanderError) throw error
      // The top level has no command in hand to report with: carry the one this
      // run invoked, so a refusal here honours its `--output json` like one
      // raised inside the action would.
      throw new PreActionFailure(error, invokedScripting(actionCommand))
    }
  })

  // Runs after an action that resolved — including one that reported failure
  // through `process.exitCode` — but not after one that threw.
  program.hook('postAction', async (_program, actionCommand) => {
    await build.updateNotice.finish(actionCommand)
  })

  for (const group of build.groups) {
    program.commandsGroup(t(group.titleKey))
    for (const register of group.commands) register(program)
  }

  return program
}

/**
 * The output mode the invoked command was asked for: its parsed `--output` and
 * `--quiet`, or text for a command that has neither. Narrowed at runtime: a
 * command-specific format (`scry`/`sell --output csv`) is not a scripting mode
 * and reports a failure as text does, so anything outside {@link OUTPUT_FORMATS}
 * reads as `text`.
 */
function invokedScripting(actionCommand: Command): ScriptingOptions {
  const { output, quiet } = actionCommand.opts<Record<string, unknown>>()
  return {
    output: isOutputFormat(output) ? output : 'text',
    quiet: quiet === true,
  }
}

function isOutputFormat(value: unknown): value is OutputFormat {
  return typeof value === 'string' && (OUTPUT_FORMATS as readonly string[]).includes(value)
}

/**
 * The root `preAction` hook's work: everything per-invocation, derived from the
 * command whose action is about to run.
 */
async function prepareAction(build: BuildProgramOptions, actionCommand: Command): Promise<void> {
  // The MCP stdio transport uses stdout as its JSON-RPC channel; divert any stray
  // logging (config init, card-ID backfill, etc.) to stderr before it can run.
  // (`src/mcp/run.ts` diverts again for the stdio transport, but only once the
  // action starts — too late for this hook's own logging.)
  if (qualifiedCommandName(actionCommand) === 'mcp') {
    divertConsoleLogToStderr()
  }

  const options = actionCommand.optsWithGlobals<GlobalOptions>()
  // A base dir that isn't an existing directory is a usage error, not an empty
  // workspace: reading a typo would report "(no lists)" and writing one would
  // fork the user's data into a stray tree.
  const requestedBaseDir = resolveBaseDir(options.baseDir, process.env.RITUAL_BASE_DIR)
  if (requestedBaseDir !== undefined) {
    const parsed = await parseBaseDir(requestedBaseDir)
    if (isMessageParseError(parsed)) {
      // Worded in the language `initI18n()` chose: `--locale`, `RITUAL_LOCALE`
      // or the OS — the requested directory's config is never read.
      throw messageCommandError('usage_error', ExitCode.UsageError, parsed.error)
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
    resolveNoInput(options.input === false ? true : undefined, process.env[ENV_VAR.noInput]),
  )

  // Needs the base dir (whose config it reads) and the no-input state (whether
  // it may prompt), and must precede the config load: a yes migrates the file
  // that load then reads, and the notice comes before any warnings the load
  // prints about keys a migration would change.
  await build.workspaceCheck(actionCommand)

  // `ritual migrate` reads the raw config itself: it must run against a file
  // the loader would reject or warn about, since fixing that file is its job.
  // Only the top-level command — a subcommand that happens to be named
  // `migrate` loads the config like any other.
  const isMigrate = qualifiedCommandName(actionCommand) === 'migrate'
  if (!isMigrate) {
    await refreshRitualConfig()
  }
  // A RITUAL_CACHE_DIR naming a folder the cache must never take over (a
  // root, the home folder, the workspace, a list folder) is a usage error,
  // like a malformed RITUAL_CACHE_SERVER — checked against the list folders
  // the config just loaded names.
  const envCacheDir = nonBlank(process.env[ENV_VAR.cacheDir])
  if (envCacheDir !== undefined) {
    const parsedCacheDir = parseCacheDir(
      envCacheDir,
      cacheDirCheckContext(getRitualConfig()),
      ENV_VAR.cacheDir,
    )
    if (isConfigParseError(parsedCacheDir)) {
      throw messageCommandError('usage_error', ExitCode.UsageError, parsedCacheDir.error)
    }
  }
  // The authoritative locale pass: `--base-dir` has been applied, so the
  // `uiLocale` tier reads the config file this run will actually use, and the
  // flag has already been validated by its argParser. `initI18n()` ran before
  // registration purely so help text could be authored in the right language.
  applyCliLocale({ flag: options.locale })

  // After the locale (a server prints the notice right here) and before the
  // backfill, so a lookup gets as much of the run as possible to answer in.
  await build.updateNotice.start(actionCommand)

  if (build.backfill(actionCommand)) {
    await ensureCardIdsForAllLists()
  }
}
