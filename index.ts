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
import { registerListAllCardsCommand } from './src/commands/list-all-cards'
import { registerMcpCommand } from './src/commands/mcp'
import { registerSkillsCommand } from './src/commands/skills'
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
import { refreshRitualConfig } from './src/ritual-config'
import { ExitCode, markStdoutClosed } from './src/commands/scripting'
import { CardCommandError, getErrorMessage, isBrokenPipeError } from './src/errors'

const program = new Command()
// Subcommands created after this inherit the override, so commander throws
// CommanderError instead of calling process.exit — letting the catch below map
// usage errors to ExitCode.UsageError and async action rejections to
// ExitCode.RuntimeError instead of an unhandled-rejection stack trace.
program.exitOverride()

program.name('ritual').description('Ritual, a Magic: The Gathering toolkit').version(version)
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

program.option(
  '--cache-server <host:port>',
  'Use a cache server for card and pricing cache (overrides local cache files)',
  parseCacheServerOption,
)
program.option('--base-dir <path>', 'Use this directory instead of the current working directory')
program.option(
  '--no-input',
  'Never prompt; fail or use documented defaults where input would be required',
)
// Commander stores `--no-input` as `input: false` (attribute `input`, default true).
type GlobalOptions = { cacheServer?: string; baseDir?: string; input?: boolean }

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

  if (shouldBackfillCardIds(actionCommand)) {
    await ensureCardIdsForAllLists()
  }
})

program.commandsGroup('Lists')
registerListsCommand(program)
registerNewCommand(program)
registerRenameCommand(program)
registerDeleteCommand(program)
registerEditCommand(program)
registerMetadataCommand(program)
registerHistoryCommand(program)
registerDiffCommand(program)
registerGetPrimerCommand(program)

program.commandsGroup('Cards')
registerAddCardCommand(program)
registerRemoveCardCommand(program)
registerSetCardCommand(program)
registerNoteCommand(program)
registerMoveCommand(program)

program.commandsGroup('Import & Export')
registerImportCommand(program)
registerImportAccountCommand(program)
registerImportChangesCommand(program)
registerExportCommand(program)

program.commandsGroup('Lookup & Pricing')
registerCardCommand(program)
registerScryCommand(program)
registerPriceCommand(program)
registerSellCommand(program)

program.commandsGroup('Site')
registerBuildSiteCommand(program)
registerServeCommand(program)
registerInitSiteCommand(program)
registerAdminCommand(program)

program.commandsGroup('Integrations')
registerLoginCommand(program)
registerDeckSyncCommand(program)
registerCollectionSyncCommand(program)
registerMcpCommand(program)
registerSkillsCommand(program)

program.commandsGroup('Cache')
registerCacheCommand(program)

program.commandsGroup('Utilities')
registerCleanupCommand(program)
registerDetectChangesCommand(program)
registerListAllCardsCommand(program)
registerConfigCommand(program)

program.commandsGroup('Legal')
registerLicenseCommand(program)
registerDepLicenseCommand(program)

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
