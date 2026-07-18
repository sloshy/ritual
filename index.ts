#!/usr/bin/env bun
import { setupGlobalFetch } from './src/http'
import { version } from './src/version'
// Apply global fetch patch immediately
setupGlobalFetch()

import { Command, CommanderError } from 'commander'
import { registerNewCommand } from './src/commands/new'
import { registerRenameCommand } from './src/commands/rename'
import { registerDeleteCommand } from './src/commands/delete'
import { registerListsCommand } from './src/commands/lists'
import { registerDiffCommand } from './src/commands/diff'
import { registerImportCommand } from './src/commands/import'
import { registerPriceCommand } from './src/commands/price'
import { registerBuildSiteCommand } from './src/commands/build-site'
import { registerServeCommand } from './src/commands/serve'
import { registerServeSiteCommand } from './src/commands/serve-site'
import { registerAddCardCommand } from './src/commands/add-card'
import { registerNoteCommand } from './src/commands/note'
import { registerRemoveCardCommand } from './src/commands/remove-card'
import { registerSetCardCommand } from './src/commands/set-card'
import { registerCacheCommand } from './src/commands/cache'
import { registerCacheServerCommand } from './src/commands/cache-server'
import { registerCacheFeedCommand } from './src/commands/cache-feed'
import { registerLoginCommand } from './src/commands/login'

import { registerImportAccountCommand } from './src/commands/import-account'
import { registerImportCsvCommand } from './src/commands/import-csv'
import { registerImportChangesCommand } from './src/commands/import-changes'
import { registerScryCommand } from './src/commands/scry'
import { registerCardCommand } from './src/commands/card'
import { registerRandomCommand } from './src/commands/random'
import { registerGetPrimerCommand } from './src/commands/get-primer'
import { registerInitSiteCommand } from './src/commands/init-site'
import { registerAdminCommand } from './src/commands/admin'
import { registerLicenseCommand } from './src/commands/license'
import { registerDepLicenseCommand } from './src/commands/dep-license'
import { registerGitDetectChangesCommand } from './src/commands/git-detect-changes'
import { registerDeckSyncCommand } from './src/commands/deck-sync'
import { registerEditCommand } from './src/commands/edit'
import { registerMoveCommand } from './src/commands/move'
import { registerHistoryCommand } from './src/commands/history'
import { registerExportCommand } from './src/commands/export'
import { registerCleanupCommand } from './src/commands/cleanup'
import { registerConfigCommand } from './src/commands/config'
import { registerHashCommand } from './src/commands/hash'
import { registerListAllCardsCommand } from './src/commands/list-all-cards'
import { registerMcpCommand } from './src/commands/mcp'
import { registerSkillsCommand } from './src/commands/skills'
import { divertConsoleLogToStderr } from './src/mcp/stdout-guard'
import {
  resolveCacheServerAddress,
  setCacheServerAddressOverride,
  toCacheServerBaseUrl,
} from './src/cache/config'
import { setBaseDir } from './src/base-dir'
import { resolveNoInput, setNoInputOverride } from './src/no-input'
import { ensureCardIdsForAllLists } from './src/ensure-card-ids'
import { initRitualConfig } from './src/ritual-config'
import { ExitCode } from './src/commands/scripting'
import { getErrorMessage } from './src/errors'

const program = new Command()
// Subcommands created after this inherit the override, so commander throws
// CommanderError instead of calling process.exit — letting the catch below map
// usage errors to ExitCode.UsageError and async action rejections to
// ExitCode.RuntimeError instead of an unhandled-rejection stack trace.
program.exitOverride()

program.name('ritual').description('Ritual, a Magic: The Gathering toolkit').version(version)
program.option(
  '--cache-server <host:port>',
  'Use a cache server for card and pricing cache (overrides local cache files)',
)
program.option('--base-dir <path>', 'Use this directory instead of the current working directory')
program.option(
  '--no-input',
  'Never prompt; fail or use documented defaults where input would be required',
)
// Commander stores `--no-input` as `input: false` (attribute `input`, default true).
type GlobalOptions = { cacheServer?: string; baseDir?: string; input?: boolean }
type DryRunOptions = { dryRun?: boolean }

const COMMANDS_WITHOUT_LIST_IDS = new Set([
  'login',
  'cache',
  'serve',
  'cache-server',
  'cache-feed',
  'card',
  'scry',
  'random',
  'license',
  'dep-license',
  'git-detect-changes',
  'config',
  'skills',
  // Read-only list commands must not trigger the file-writing ID backfill.
  'lists',
  'diff',
  // Admin account subcommands never touch list files (leaf names; bare
  // 'admin' still backfills, which suits the server).
  'setup',
  'reset-password',
  'disable-totp',
])

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
  if (options.baseDir) {
    setBaseDir(options.baseDir)
  }
  const resolved = resolveCacheServerAddress(options.cacheServer, process.env.RITUAL_CACHE_SERVER)
  if (resolved) {
    toCacheServerBaseUrl(resolved)
  }
  setCacheServerAddressOverride(resolved)

  // `--no-input` can only turn prompting off; when absent (`input` stays true),
  // RITUAL_NO_INPUT decides.
  setNoInputOverride(
    resolveNoInput(options.input === false ? true : undefined, process.env.RITUAL_NO_INPUT),
  )

  await initRitualConfig()

  const leaf = actionCommand.name()
  const parent = actionCommand.parent?.name()
  if (COMMANDS_WITHOUT_LIST_IDS.has(leaf) || (parent && COMMANDS_WITHOUT_LIST_IDS.has(parent))) {
    return
  }
  // A dry run must write nothing — including the card-ID backfill.
  if (actionCommand.opts<DryRunOptions>().dryRun === true) {
    return
  }
  await ensureCardIdsForAllLists()
})

program.commandsGroup('Lists')
registerListsCommand(program)
registerNewCommand(program)
registerRenameCommand(program)
registerDeleteCommand(program)
registerEditCommand(program)
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
registerImportCsvCommand(program)
registerImportAccountCommand(program)
registerImportChangesCommand(program)
registerExportCommand(program)

program.commandsGroup('Lookup & Pricing')
registerCardCommand(program)
registerScryCommand(program)
registerRandomCommand(program)
registerPriceCommand(program)

program.commandsGroup('Site')
registerBuildSiteCommand(program)
registerServeCommand(program)
registerServeSiteCommand(program)
registerInitSiteCommand(program)
registerAdminCommand(program)

program.commandsGroup('Integrations')
registerLoginCommand(program)
registerDeckSyncCommand(program)
registerMcpCommand(program)
registerSkillsCommand(program)

program.commandsGroup('Cache')
registerCacheCommand(program)
registerCacheServerCommand(program)
registerCacheFeedCommand(program)

program.commandsGroup('Utilities')
registerCleanupCommand(program)
registerGitDetectChangesCommand(program)
registerHashCommand(program)
registerListAllCardsCommand(program)
registerConfigCommand(program)

program.commandsGroup('Legal')
registerLicenseCommand(program)
registerDepLicenseCommand(program)

// Wrapped in a function because the compiled binary (bun build --bytecode)
// does not support top-level await.
async function main(): Promise<void> {
  try {
    await program.parseAsync()
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander already printed its message (usage error, help, or version).
      process.exitCode = error.exitCode === 0 ? 0 : ExitCode.UsageError
    } else {
      process.stderr.write(`${getErrorMessage(error)}\n`)
      if (!process.exitCode) process.exitCode = ExitCode.RuntimeError
    }
  }
}

void main()
