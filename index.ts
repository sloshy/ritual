#!/usr/bin/env bun
import { setupGlobalFetch } from './src/http'
import { version } from './src/version'
// Apply global fetch patch immediately
setupGlobalFetch()

import { Command } from 'commander'
import { registerNewDeckCommand } from './src/commands/new-deck'
import { registerImportCommand } from './src/commands/import'
import { registerPriceDeckCommand } from './src/commands/price'
import { registerBuildSiteCommand } from './src/commands/build-site'
import { registerServeCommand } from './src/commands/serve'
import { registerAddCardCommand } from './src/commands/add-card'
import { registerCacheCommand } from './src/commands/cache'
import { registerCacheServerCommand } from './src/commands/cache-server'
import { registerLoginCommand } from './src/commands/login'

import { registerImportAccountCommand } from './src/commands/import-account'
import { registerCollectionCommand } from './src/commands/collection'
import { registerPriceCollectionCommand } from './src/commands/price-collection'
import { registerWantedListCommand } from './src/commands/wanted'
import { registerPriceWantedListCommand } from './src/commands/price-wanted'
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
import { registerMoveCommand } from './src/commands/move'
import { registerConfigSetCommand } from './src/commands/config-set'
import { registerHashCommand } from './src/commands/hash'
import { registerListAllCardsCommand } from './src/commands/list-all-cards'
import {
  resolveCacheServerAddress,
  setCacheServerAddressOverride,
  toCacheServerBaseUrl,
} from './src/cache/config'
import { setBaseDir } from './src/base-dir'
import { ensureCardIdsForAllLists } from './src/ensure-card-ids'
import { initRitualConfig } from './src/ritual-config'

const program = new Command()

program.name('ritual').description('Ritual, a Magic: The Gathering toolkit').version(version)
program.option(
  '--cache-server <host:port>',
  'Use a cache server for card and pricing cache (overrides local cache files)',
)
program.option('--base-dir <path>', 'Use this directory instead of the current working directory')
type GlobalOptions = { cacheServer?: string; baseDir?: string }
type CommandWithGlobals = Command & { optsWithGlobals: () => GlobalOptions }

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
])

program.hook('preAction', async (command) => {
  const commandWithGlobals = command as CommandWithGlobals
  const options = commandWithGlobals.optsWithGlobals()
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

program.commandsGroup('Deck Management')
registerNewDeckCommand(program)
registerImportCommand(program)
registerImportAccountCommand(program)
registerGetPrimerCommand(program)
registerDeckSyncCommand(program)
registerPriceDeckCommand(program)

program.commandsGroup('Collection Management')
registerCollectionCommand(program)
registerPriceCollectionCommand(program)

program.commandsGroup('Wanted List Management')
registerWantedListCommand(program)
registerPriceWantedListCommand(program)

program.commandsGroup('Card Management')
registerMoveCommand(program)

program.commandsGroup('Card Lookup')
registerCardCommand(program)
registerScryCommand(program)
registerRandomCommand(program)

program.commandsGroup('Site')
registerBuildSiteCommand(program)
registerServeCommand(program)
registerInitSiteCommand(program)
registerAdminCommand(program)

program.commandsGroup('Cache')
registerCacheCommand(program)
registerCacheServerCommand(program)

program.commandsGroup('Utilities')
registerGitDetectChangesCommand(program)
registerHashCommand(program)
registerListAllCardsCommand(program)
registerConfigSetCommand(program)

program.commandsGroup('Legal')
registerLicenseCommand(program)
registerDepLicenseCommand(program)

program.parse()
