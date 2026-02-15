#!/usr/bin/env bun
import { setupGlobalFetch } from './src/http'
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
import { registerLoginCommand } from './src/commands/login'

import { registerImportAccountCommand } from './src/commands/import-account'
import { registerCollectionCommand } from './src/commands/collection'
import { registerScryCommand } from './src/commands/scry'
import { registerCardCommand } from './src/commands/card'
import { registerRandomCommand } from './src/commands/random'

const program = new Command()

program.name('ritual').description('Ritual, a Magic: The Gathering toolkit').version('0.1.0')

registerNewDeckCommand(program)
registerImportCommand(program)
registerImportAccountCommand(program)
registerPriceCommand(program)
registerBuildSiteCommand(program)
registerServeCommand(program)
registerAddCardCommand(program)
registerCacheCommand(program)
registerLoginCommand(program)

registerCollectionCommand(program)
registerScryCommand(program)
registerCardCommand(program)
registerRandomCommand(program)

program.parse()
