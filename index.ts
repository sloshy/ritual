#!/usr/bin/env bun
import { setupGlobalFetch } from './src/http'
import { version } from './src/version'
// Apply global fetch patch immediately
setupGlobalFetch()

import { Command, CommanderError, InvalidArgumentError } from 'commander'
import { registerNewCommand } from './src/commands/new'
import { registerRenameCommand } from './src/commands/rename'
import { registerDeleteCommand } from './src/commands/delete'
import { registerListsCommand } from './src/commands/lists'
import { registerDiffCommand } from './src/commands/diff'
import { registerImportCommand } from './src/commands/import'
import { registerPriceCommand } from './src/commands/price'
import { registerBuildSiteCommand } from './src/commands/build-site'
import { registerServeCommand } from './src/commands/serve'
import { registerAddCardCommand } from './src/commands/add-card'
import { registerNoteCommand } from './src/commands/note'
import { registerRemoveCardCommand } from './src/commands/remove-card'
import { registerSetCardCommand } from './src/commands/set-card'
import { registerCacheCommand } from './src/commands/cache'
import { registerLoginCommand } from './src/commands/login'

import { registerImportAccountCommand } from './src/commands/import-account'
import { registerImportChangesCommand } from './src/commands/import-changes'
import { registerScryCommand } from './src/commands/scry'
import { registerSellCommand } from './src/commands/sell'
import { registerCardCommand } from './src/commands/card'
import { registerGetPrimerCommand } from './src/commands/get-primer'
import { registerInitSiteCommand } from './src/commands/init-site'
import { registerAdminCommand } from './src/commands/admin'
import { registerLicenseCommand } from './src/commands/license'
import { registerDepLicenseCommand } from './src/commands/dep-license'
import { registerDetectChangesCommand } from './src/commands/detect-changes'
import { registerDeckSyncCommand } from './src/commands/deck-sync'
import { registerCollectionSyncCommand } from './src/commands/collection-sync'
import { registerEditCommand } from './src/commands/edit'
import { registerMoveCommand } from './src/commands/move'
import { registerHistoryCommand } from './src/commands/history'
import { registerExportCommand } from './src/commands/export'
import { registerCleanupCommand } from './src/commands/cleanup'
import { registerConfigCommand } from './src/commands/config'
import { registerMetadataCommand } from './src/commands/metadata'
import { registerSetListImageCommand } from './src/commands/set-list-image'
import { registerListAllCardsCommand } from './src/commands/list-all-cards'
import { registerMcpCommand } from './src/commands/mcp'
import { registerSkillsCommand } from './src/commands/skills'
import { applyCliLocale, initI18n, registerLocaleCommand } from './src/commands/locale'
import { registerCliMessages } from './src/i18n/register/cli'
import { t, type ParameterlessKey } from './src/i18n/t'
import { divertConsoleLogToStderr } from './src/mcp/stdout-guard'
import {
  isCacheServerAddressError,
  parseCacheServerBaseUrl,
  resolveCacheServerAddress,
  setCacheServerAddressOverride,
} from './src/cache/config'
import { isBaseDirError, parseBaseDir, resolveBaseDir, setBaseDir } from './src/base-dir'
import { resolveNoInput, setNoInputOverride } from './src/no-input'
import { ensureCardIdsForAllLists } from './src/ensure-card-ids'
import { shouldBackfillCardIds } from './src/commands/id-backfill'
import { isConfigParseError, parseUiLocale, refreshRitualConfig } from './src/ritual-config'
import { ExitCode, markStdoutClosed } from './src/commands/scripting'
import { CardCommandError, getErrorMessage, isBrokenPipeError } from './src/errors'

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
const COMMANDER_SECTION_TITLES = new Map<string, ParameterlessKey>([
  ['Usage:', 'help.commander.usageTitle'],
  ['Arguments:', 'help.commander.argumentsTitle'],
  ['Options:', 'help.commander.optionsTitle'],
  ['Global Options:', 'help.commander.globalOptionsTitle'],
  ['Commands:', 'help.commander.commandsTitle'],
])

function localizeHelpTitle(title: string): string {
  const key = COMMANDER_SECTION_TITLES.get(title)
  return key === undefined ? title : t(key)
}

/** One recognized Commander diagnostic and how to re-render it from the catalog. */
type CommanderErrorRule = {
  pattern: RegExp
  render: (match: RegExpMatchArray) => string
}

/** A capture that is only optionally present, as a plain string. */
function group(match: RegExpMatchArray, index: number): string {
  return match[index] ?? ''
}

/**
 * One side of a conflicting-option message: Commander composes it from either
 * the flag spelling or the environment variable that supplied the value, so the
 * two alternatives arrive as two adjacent captures of which exactly one matched.
 */
function conflictSide(match: RegExpMatchArray, flagsIndex: number, envIndex: number): string {
  return match[flagsIndex] === undefined
    ? t('help.commander.conflictEnv', { name: group(match, envIndex) })
    : t('help.commander.conflictOption', { flags: group(match, flagsIndex) })
}

const COMMANDER_ERROR_RULES: readonly CommanderErrorRule[] = [
  {
    pattern: /^error: unknown option '(.*)'$/,
    render: (match) => t('help.commander.unknownOption', { flag: group(match, 1) }),
  },
  {
    pattern: /^error: unknown command '(.*)'$/,
    render: (match) => t('help.commander.unknownCommand', { name: group(match, 1) }),
  },
  {
    pattern: /^error: missing required argument '(.*)'$/,
    render: (match) => t('help.commander.missingArgument', { name: group(match, 1) }),
  },
  {
    pattern: /^error: option '(.*)' argument missing$/,
    render: (match) => t('help.commander.optionArgumentMissing', { flags: group(match, 1) }),
  },
  {
    pattern: /^error: required option '(.*)' not specified$/,
    render: (match) => t('help.commander.requiredOption', { flags: group(match, 1) }),
  },
  {
    pattern:
      /^error: too many arguments for '([^']*)'\. Expected (\d+) arguments? but got (\d+): (.*)\.$/s,
    render: (match) =>
      t('help.commander.excessArgumentsFor', {
        count: Number(group(match, 2)),
        command: group(match, 1),
        expected: group(match, 2),
        received: group(match, 3),
        details: group(match, 4),
      }),
  },
  {
    pattern: /^error: too many arguments\. Expected (\d+) arguments? but got (\d+): (.*)\.$/s,
    render: (match) =>
      t('help.commander.excessArguments', {
        count: Number(group(match, 1)),
        expected: group(match, 1),
        received: group(match, 2),
        details: group(match, 3),
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
        flags: group(match, 1),
        value: group(match, 2),
      }) + group(match, 3),
  },
  {
    pattern: /^error: option '([^']*)' value '(.*)' from env '([^']*)' is invalid\.(.*)$/s,
    render: (match) =>
      t('help.commander.invalidOptionEnv', {
        flags: group(match, 1),
        value: group(match, 2),
        env: group(match, 3),
      }) + group(match, 4),
  },
  {
    pattern: /^error: command-argument value '(.*)' is invalid for argument '([^']*)'\.(.*)$/s,
    render: (match) =>
      t('help.commander.invalidCommandArgument', {
        value: group(match, 1),
        name: group(match, 2),
      }) + group(match, 3),
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
function localizeCommanderError(raw: string): string {
  const newline = raw.endsWith('\n') ? '\n' : ''
  const message = newline === '' ? raw : raw.slice(0, -1)
  const suggestion = message.match(COMMANDER_SUGGESTION)
  if (suggestion === null) return `${localizeCommanderErrorBody(message)}${newline}`

  const body = message.slice(0, message.length - suggestion[0].length)
  const list = group(suggestion, 2)
  const rendered =
    suggestion[1] === undefined
      ? t('help.commander.didYouMean', { suggestion: list })
      : t('help.commander.didYouMeanOneOf', { suggestions: list })
  return `${localizeCommanderErrorBody(body)}\n${rendered}${newline}`
}

// Commander stores `--no-input` as `input: false` (attribute `input`, default true).
type GlobalOptions = {
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
 * text get authored. Imports stay top-level; only the invocations moved.
 */
function buildProgram(): Command {
  const program = new Command()
  // Subcommands created after this inherit the override, so commander throws
  // CommanderError instead of calling process.exit — letting the catch below map
  // usage errors to ExitCode.UsageError and async action rejections to
  // ExitCode.RuntimeError instead of an unhandled-rejection stack trace.
  program.exitOverride()

  // Both configurations are copied by reference into every subcommand created
  // after this point (`copyInheritedSettings`), so they must be installed before
  // the `register*Command` calls below rather than after.
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

    if (shouldBackfillCardIds(actionCommand)) {
      await ensureCardIdsForAllLists()
    }
  })

  program.commandsGroup(t('help.group.lists'))
  registerListsCommand(program)
  registerNewCommand(program)
  registerRenameCommand(program)
  registerDeleteCommand(program)
  registerEditCommand(program)
  registerMetadataCommand(program)
  registerSetListImageCommand(program)
  registerHistoryCommand(program)
  registerDiffCommand(program)
  registerGetPrimerCommand(program)

  program.commandsGroup(t('help.group.cards'))
  registerAddCardCommand(program)
  registerRemoveCardCommand(program)
  registerSetCardCommand(program)
  registerNoteCommand(program)
  registerMoveCommand(program)

  program.commandsGroup(t('help.group.importExport'))
  registerImportCommand(program)
  registerImportAccountCommand(program)
  registerImportChangesCommand(program)
  registerExportCommand(program)

  program.commandsGroup(t('help.group.lookupPricing'))
  registerCardCommand(program)
  registerScryCommand(program)
  registerPriceCommand(program)
  registerSellCommand(program)

  program.commandsGroup(t('help.group.site'))
  registerBuildSiteCommand(program)
  registerServeCommand(program)
  registerInitSiteCommand(program)
  registerAdminCommand(program)

  program.commandsGroup(t('help.group.integrations'))
  registerLoginCommand(program)
  registerDeckSyncCommand(program)
  registerCollectionSyncCommand(program)
  registerMcpCommand(program)
  registerSkillsCommand(program)

  program.commandsGroup(t('help.group.cache'))
  registerCacheCommand(program)

  program.commandsGroup(t('help.group.utilities'))
  registerCleanupCommand(program)
  registerDetectChangesCommand(program)
  registerListAllCardsCommand(program)
  registerConfigCommand(program)
  registerLocaleCommand(program)

  program.commandsGroup(t('help.group.legal'))
  registerLicenseCommand(program)
  registerDepLicenseCommand(program)

  return program
}

// Wrapped in a function because the compiled binary (bun build --bytecode)
// does not support top-level await.
async function main(): Promise<void> {
  // `ritual … --output ndjson | head` closes stdout mid-stream. That is a normal
  // end of output for a Unix tool, not a failure: stop quietly instead of
  // dumping an EPIPE stack trace. The shared writers in
  // src/commands/scripting.ts absorb the synchronous throw; this handler covers
  // asynchronous emissions and any console.log that bypasses them.
  //
  // A throw from inside an emitter callback would escape the try/catch below as
  // an unhandled exception, so a genuine (non-EPIPE) stream failure is reported
  // here with the same runtime-error exit code the catch would have given it.
  const handleStreamError = (error: unknown): void => {
    if (isBrokenPipeError(error)) {
      // Every shared writer checks this flag, so the rest of the run produces
      // no further output. The exit code is deliberately left alone: a broken
      // pipe is not a failure, but it must not erase one the command already
      // recorded either.
      markStdoutClosed()
      return
    }
    process.stderr.write(`${getErrorMessage(error)}\n`)
    process.exitCode = ExitCode.RuntimeError
  }
  process.stdout.on('error', handleStreamError)
  process.stderr.on('error', (error: unknown) => {
    if (isBrokenPipeError(error)) return
    process.exitCode = ExitCode.RuntimeError
  })

  // Hand the runtime its English catalog. Namespaces are import boundaries
  // (plan §4.2), so nothing is registered until a surface asks for it — the CLI
  // is the surface that asks for all seven. Must precede `initI18n()`, and
  // therefore every `t()` call in the process.
  registerCliMessages()

  // Resolve the UI locale before the command tree exists: Commander evaluates
  // help strings at registration time, so this is the last moment at which
  // `--help` can still be authored in the user's language. The preAction hook
  // re-resolves authoritatively once the flag and base dir are parsed.
  initI18n()
  const program = buildProgram()

  try {
    await program.parseAsync()
  } catch (error) {
    if (isBrokenPipeError(error)) {
      // See handleStreamError: benign end of output, existing exit code stands.
      markStdoutClosed()
    } else if (error instanceof CommanderError) {
      // Commander already printed its message (usage error, help, or version).
      process.exitCode = error.exitCode === 0 ? ExitCode.Success : ExitCode.UsageError
    } else if (error instanceof CardCommandError) {
      // A structured failure that escaped its command (or came from the
      // preAction hook) carries its own exit code — 2 for usage errors — which
      // the generic branch below would flatten to 1.
      process.stderr.write(`${error.message}\n`)
      process.exitCode = error.exitCode
    } else {
      process.stderr.write(`${getErrorMessage(error)}\n`)
      if (!process.exitCode) process.exitCode = ExitCode.RuntimeError
    }
  }
}

void main()
