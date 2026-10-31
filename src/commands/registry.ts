/**
 * The `ritual` command tree as data: every `register*Command` in the order it
 * appears in `--help`, under the section each belongs to, and each section's
 * help tier (`HelpTier` in `src/cli/program.ts`): `ritual --help` describes the `core` commands,
 * names the `more` ones, and leaves the `advanced` ones to `ritual help --all`.
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
import { registerMigrateCommand } from './migrate'
import { registerSelfUpdateCommand } from './self-update'
import { registerConfigCommand } from './config'
import { registerMetadataCommand } from './metadata'
import { registerCategoriesCommand } from './categories'
import { registerSetListImageCommand } from './set-list-image'
import { registerListAllCardsCommand } from './list-all-cards'
import { registerMcpCommand } from './mcp'
import { registerSkillsCommand } from './skills'
import { registerLocaleCommand } from './locale'

export const COMMAND_GROUPS = [
  // ── core: what `ritual --help` shows a newcomer ──────────────────────
  {
    titleKey: 'help.group.start',
    tier: 'core',
    commands: [
      registerNewCommand,
      registerImportCommand,
      registerAddCardCommand,
      registerEditCommand,
      registerAdminCommand,
    ],
  },
  {
    titleKey: 'help.group.browse',
    tier: 'core',
    commands: [
      registerListsCommand,
      registerCardCommand,
      registerScryCommand,
      registerPriceCommand,
    ],
  },
  {
    titleKey: 'help.group.publish',
    tier: 'core',
    commands: [registerBuildSiteCommand, registerServeCommand],
  },
  // ── more: named in `ritual --help`, described by `ritual help --all` ──
  {
    titleKey: 'help.group.lists',
    tier: 'more',
    commands: [
      registerRenameCommand,
      registerDeleteCommand,
      registerMetadataCommand,
      registerCategoriesCommand,
      registerSetListImageCommand,
      registerHistoryCommand,
      registerDiffCommand,
      registerGetPrimerCommand,
    ],
  },
  {
    titleKey: 'help.group.cards',
    tier: 'more',
    commands: [
      registerRemoveCardCommand,
      registerSetCardCommand,
      registerNoteCommand,
      registerMoveCommand,
    ],
  },
  {
    titleKey: 'help.group.importExport',
    tier: 'more',
    commands: [registerImportAccountCommand, registerImportChangesCommand, registerExportCommand],
  },
  {
    titleKey: 'help.group.lookupPricing',
    tier: 'more',
    commands: [registerSellCommand],
  },
  {
    titleKey: 'help.group.site',
    tier: 'more',
    commands: [registerInitSiteCommand],
  },
  {
    titleKey: 'help.group.integrations',
    tier: 'more',
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
    tier: 'more',
    commands: [registerCacheCommand],
  },
  {
    titleKey: 'help.group.utilities',
    tier: 'more',
    commands: [
      registerCleanupCommand,
      registerSelfUpdateCommand,
      registerConfigCommand,
      registerLocaleCommand,
      registerLicenseCommand,
    ],
  },
  // ── advanced: plumbing for CI and maintenance, only in `help --all` ──
  {
    titleKey: 'help.group.advanced',
    tier: 'advanced',
    commands: [
      registerMigrateCommand,
      registerDetectChangesCommand,
      registerListAllCardsCommand,
      registerDepLicenseCommand,
    ],
  },
] as const satisfies readonly CommandGroup[]
