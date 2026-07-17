#!/usr/bin/env bun
import { setupGlobalFetch } from './src/http'
import { version } from './src/version'
// Apply global fetch patch immediately
setupGlobalFetch()

import { Command, CommanderError } from 'commander'
import { registerNewDeckCommand } from './src/commands/new-deck'
import { registerImportCommand } from './src/commands/import'
import { registerPriceCommand } from './src/commands/price'
import { registerBuildSiteCommand } from './src/commands/build-site'
import { registerServeCommand } from './src/commands/serve'
import { registerServeSiteCommand } from './src/commands/serve-site'
import { registerAddCardCommand } from './src/commands/add-card'
import { registerAddNoteCommand } from './src/commands/add-note'
import { registerClearNoteCommand } from './src/commands/clear-note'
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
import { registerConfigSetCommand } from './src/commands/config-set'
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
type GlobalOptions = { cacheServer?: string; baseDir?: string }

const COMMANDS_WITHOUT_LIST_IDS = new Set([
  'login',
  'cache',
  'card',
  'scry',
  'random',
  'license',
  'dep-license',
  'git-detect-changes',
  'config-set',
  'skills',
])

program.hook('preAction', async (command) => {
  // The MCP stdio transport uses stdout as its JSON-RPC channel; divert any stray
  // logging (config init, card-ID backfill, etc.) to stderr before it can run.
  if (command.name() === 'mcp') {
    divertConsoleLogToStderr()
  }

  const options = command.optsWithGlobals<GlobalOptions>()
  if (options.baseDir) {
    setBaseDir(options.baseDir)
  }
  const resolved = resolveCacheServerAddress(options.cacheServer, process.env.RITUAL_CACHE_SERVER)
  if (resolved) {
    toCacheServerBaseUrl(resolved)
  }
  setCacheServerAddressOverride(resolved)

  await initRitualConfig()

  const leaf = command.name()
  const parent = command.parent?.name()
  if (COMMANDS_WITHOUT_LIST_IDS.has(leaf) || (parent && COMMANDS_WITHOUT_LIST_IDS.has(parent))) {
    return
  }
  await ensureCardIdsForAllLists()
})

program.commandsGroup('Account & Auth')
registerLoginCommand(program)

program.commandsGroup('Scripting')
registerAddCardCommand(program)
registerAddNoteCommand(program)
registerClearNoteCommand(program)

program.commandsGroup('Deck Management')
registerNewDeckCommand(program)
registerImportCommand(program)
registerImportAccountCommand(program)
registerGetPrimerCommand(program)
registerDeckSyncCommand(program)

program.commandsGroup('Card Management')
registerEditCommand(program)
registerPriceCommand(program)
registerMoveCommand(program)
registerHistoryCommand(program)
registerImportCsvCommand(program)
registerImportChangesCommand(program)
registerExportCommand(program)

program.commandsGroup('Card Lookup')
registerCardCommand(program)
registerScryCommand(program)
registerRandomCommand(program)

program.commandsGroup('Site')
registerBuildSiteCommand(program)
registerServeCommand(program)
registerServeSiteCommand(program)
registerInitSiteCommand(program)
registerAdminCommand(program)

program.commandsGroup('Integrations')
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
registerConfigSetCommand(program)

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
