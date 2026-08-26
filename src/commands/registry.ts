/**
 * The `ritual` command tree as data: every `register*Command` in the order it
 * appears in `--help`, under the section each belongs to.
 *
 * Keys only — the headings are rendered by `buildProgram` after the UI locale
 * has been resolved, never at module scope.
 */

import type { CommandGroup } from '../cli/program'
import { registerNewCommand } from './new'
import { registerRenameCommand } from './rename'
import { registerDeleteCommand } from './delete'
import { registerListsCommand } from './lists'
import { registerDiffCommand } from './diff'
import { registerImportCommand } from './import'
import { registerPriceCommand } from './price'
import { registerBuildSiteCommand } from './build-site'
import { registerServeCommand } from './serve'
import { registerAddCardCommand } from './add-card'
import { registerNoteCommand } from './note'
import { registerRemoveCardCommand } from './remove-card'
import { registerSetCardCommand } from './set-card'
import { registerCacheCommand } from './cache'
import { registerLoginCommand } from './login'
import { registerImportAccountCommand } from './import-account'
import { registerImportChangesCommand } from './import-changes'
import { registerScryCommand } from './scry'
import { registerSellCommand } from './sell'
import { registerCardCommand } from './card'
import { registerGetPrimerCommand } from './get-primer'
import { registerInitSiteCommand } from './init-site'
import { registerAdminCommand } from './admin'
import { registerLicenseCommand } from './license'
import { registerDepLicenseCommand } from './dep-license'
import { registerDetectChangesCommand } from './detect-changes'
import { registerDeckSyncCommand } from './deck-sync'
import { registerCollectionSyncCommand } from './collection-sync'
import { registerEditCommand } from './edit'
import { registerMoveCommand } from './move'
import { registerHistoryCommand } from './history'
import { registerExportCommand } from './export'
import { registerCleanupCommand } from './cleanup'
import { registerConfigCommand } from './config'
import { registerMetadataCommand } from './metadata'
import { registerSetListImageCommand } from './set-list-image'
import { registerListAllCardsCommand } from './list-all-cards'
import { registerMcpCommand } from './mcp'
import { registerSkillsCommand } from './skills'
import { registerLocaleCommand } from './locale'

export const COMMAND_GROUPS = [
  {
    titleKey: 'help.group.lists',
    commands: [
      registerListsCommand,
      registerNewCommand,
      registerRenameCommand,
      registerDeleteCommand,
      registerEditCommand,
      registerMetadataCommand,
      registerSetListImageCommand,
      registerHistoryCommand,
      registerDiffCommand,
      registerGetPrimerCommand,
    ],
  },
  {
    titleKey: 'help.group.cards',
    commands: [
      registerAddCardCommand,
      registerRemoveCardCommand,
      registerSetCardCommand,
      registerNoteCommand,
      registerMoveCommand,
    ],
  },
  {
    titleKey: 'help.group.importExport',
    commands: [
      registerImportCommand,
      registerImportAccountCommand,
      registerImportChangesCommand,
      registerExportCommand,
    ],
  },
  {
    titleKey: 'help.group.lookupPricing',
    commands: [registerCardCommand, registerScryCommand, registerPriceCommand, registerSellCommand],
  },
  {
    titleKey: 'help.group.site',
    commands: [
      registerBuildSiteCommand,
      registerServeCommand,
      registerInitSiteCommand,
      registerAdminCommand,
    ],
  },
  {
    titleKey: 'help.group.integrations',
    commands: [
      registerLoginCommand,
      registerDeckSyncCommand,
      registerCollectionSyncCommand,
      registerMcpCommand,
      registerSkillsCommand,
    ],
  },
  {
    titleKey: 'help.group.cache',
    commands: [registerCacheCommand],
  },
  {
    titleKey: 'help.group.utilities',
    commands: [
      registerCleanupCommand,
      registerDetectChangesCommand,
      registerListAllCardsCommand,
      registerConfigCommand,
      registerLocaleCommand,
    ],
  },
  {
    titleKey: 'help.group.legal',
    commands: [registerLicenseCommand, registerDepLicenseCommand],
  },
] as const satisfies readonly CommandGroup[]
