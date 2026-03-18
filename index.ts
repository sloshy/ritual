#!/usr/bin/env bun
import { setupGlobalFetch } from './src/http'
import { version } from './src/version'
// Apply global fetch patch immediately
setupGlobalFetch()

import { Command } from 'commander'
import { registerNewDeckCommand } from './src/commands/new-deck'
import { registerImportCommand } from './src/commands/import'
import { registerPriceCommand } from './src/commands/price'
import { registerBuildSiteCommand } from './src/commands/build-site'
import { registerServeCommand } from './src/commands/serve'
import { registerAddCardCommand } from './src/commands/add-card'
import { registerCacheCommand } from './src/commands/cache'
import { registerCacheServerCommand } from './src/commands/cache-server'
import { registerLoginCommand } from './src/commands/login'

import { registerImportAccountCommand } from './src/commands/import-account'
import { registerCollectionCommand } from './src/commands/collection'
import { registerPriceCollectionCommand } from './src/commands/price-collection'
import { registerScryCommand } from './src/commands/scry'
import { registerCardCommand } from './src/commands/card'
import { registerRandomCommand } from './src/commands/random'
import { registerGetPrimerCommand } from './src/commands/get-primer'
import { registerAdminCommand } from './src/commands/admin'
import {
  resolveCacheServerAddress,
  setCacheServerAddressOverride,
  toCacheServerBaseUrl,
} from './src/cache/config'

const program = new Command()

program.name('ritual').description('Ritual, a Magic: The Gathering toolkit').version(version)
program.option(
  '--cache-server <host:port>',
  'Use a cache server for card and pricing cache (overrides local cache files)',
)
program.hook('preAction', (command) => {
  const commandWithGlobals = command as Command & {
    optsWithGlobals: () => { cacheServer?: string }
  }
  const options = commandWithGlobals.optsWithGlobals()
  const resolved = resolveCacheServerAddress(options.cacheServer, process.env.RITUAL_CACHE_SERVER)
  if (resolved) {
    toCacheServerBaseUrl(resolved)
  }
  setCacheServerAddressOverride(resolved)
})

program.commandsGroup('Account & Auth')
registerLoginCommand(program)

program.commandsGroup('Deck Management')
registerNewDeckCommand(program)
registerAddCardCommand(program)
registerImportCommand(program)
registerImportAccountCommand(program)
registerGetPrimerCommand(program)
registerPriceCommand(program)

program.commandsGroup('Collection Management')
registerCollectionCommand(program)
registerPriceCollectionCommand(program)

program.commandsGroup('Card Lookup')
registerCardCommand(program)
registerScryCommand(program)
registerRandomCommand(program)

program.commandsGroup('Site')
registerBuildSiteCommand(program)
registerServeCommand(program)
registerAdminCommand(program)

program.commandsGroup('Cache')
registerCacheCommand(program)
registerCacheServerCommand(program)

program.parse()
