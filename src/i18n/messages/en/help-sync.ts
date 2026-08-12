/**
 * `help.*` messages for the sync and import/export commands — deck sync, collection sync, importers, exporters.
 *
 * A fragment of the help namespace, split out purely so the command surfaces can
 * be converted independently without contending for one file. Every key still
 * begins with `help.`, and a translator sees one flat catalog.
 *
 * These strings are *registered*, not called: Commander evaluates them while
 * `buildProgram()` constructs the tree, which is why the locale is resolved from
 * the tolerant argv pre-scan before registration (see `src/commands/locale.ts`).
 *
 * Flag spellings (`--only`, `--csv-file`), config keys
 * (`collectionSync.pullTarget`), enum values (`'push'`, `'additions'`),
 * environment variables and the names of the sites being synced are machine
 * vocabulary and stay English inside the sentences that mention them. Every
 * `{placeholder}` is a comma-joined list of such values, rendered by the caller.
 */

import type { MessageCatalogShape } from '../../types'

export const helpSyncMessages = {
  // ── Shared sync plumbing (src/commands/sync-helpers.ts) ───────────────
  'help.sync.direction': "Sync direction: 'push' (local → Archidekt) or 'pull' (Archidekt → local)",
  // A `$select` rather than an interpolated noun: the subject is the object of
  // "Sync", and its article, case and position are the translator's business.
  'help.sync.yes': {
    $select: 'subject',
    decks: 'Sync decks with unreadable lines without asking (those lines are lost)',
    collectionLists:
      'Sync collection lists with unreadable lines without asking (those lines are lost)',
  },
  'help.sync.only': "Apply only 'additions' or 'removals' (relative to the sync destination)",
  'help.sync.dryRun': 'Report what would sync without writing files or pushing changes',

  // ── collection-sync ───────────────────────────────────────────────────
  'help.collectionSync.description': 'Sync collection changes with Archidekt',
  'help.collectionSync.lists':
    'Collection lists to sync (defaults to every collection list); the remote side is always the whole Archidekt collection',
  'help.collectionSync.into':
    'Collection list a pull adds new cards to, created if needed (default: the collectionSync.pullTarget config key)',
  'help.collectionSync.removalPriority':
    'Collection list an ambiguous removal may take copies from, in the order given (repeatable)',
  'help.collectionSync.csv':
    "Upload a push's new cards as one CSV import instead of adding them one at a time (automatic above {threshold})",
  'help.collectionSync.csvFile':
    "Write a push's new cards to this CSV file for a manual upload instead of pushing them",
  'help.collectionSync.refresh':
    "Card cache refresh policy when a push's new cards take the CSV path: ask (prompt; without a terminal, fails the run like never), auto, no-bulk, never",

  // ── deck-sync ─────────────────────────────────────────────────────────
  'help.deckSync.description': 'Sync deck changes with Archidekt',
  'help.deckSync.pull': 'Apply Archidekt deck changes to the local deck files',
  'help.deckSync.push': 'Send local deck changes to the decks you own on Archidekt',
  'help.deckSync.decks': 'Deck names to sync (defaults to all Archidekt decks)',
  'help.deckSync.force':
    'Overwrite a remote deck that changed since its last sync (see deck-sync status)',
  'help.deckSync.syncPrintings':
    "Also sync each card's exact printing (set, collector number, and foil/etched finish)",
  'help.deckSync.link': 'Link a local deck to a deck that already exists on Archidekt',
  'help.deckSync.linkDeck': 'Deck name to link',
  'help.deckSync.linkUrl': 'Archidekt deck URL, e.g. https://archidekt.com/decks/123456',
  'help.deckSync.linkDryRun': 'Report what would be linked without writing the deck file',
  'help.deckSync.status': 'Show which decks are linked to Archidekt, and when each last synced',

  // ── login ─────────────────────────────────────────────────────────────
  'help.login.description': 'Login to a supported website',
  'help.login.archidekt': 'Login to Archidekt',
  'help.login.forceLogin': 'Force a new login even if a session exists',
  'help.login.username': 'Archidekt username or email (for scripting)',
  'help.login.passwordStdin': 'Read the password from stdin (for scripting)',
  'help.login.status': 'Show the stored Archidekt login and whether its session is still usable',
  'help.login.logout': 'Clear the stored Archidekt login',

  // ── import ────────────────────────────────────────────────────────────
  'help.import.description':
    'Import a deck from a URL (Archidekt, Moxfield, MTGGoldfish), or a deck, collection, or wanted list from a local text or CSV file',
  'help.import.source': 'URL or file path (.csv files are imported as CSV)',
  'help.import.type': 'List type for a file import: {types} (URLs always import decks)',
  'help.import.name': 'CSV only: name of the list to create or append to',
  'help.import.deckFormat': 'CSV only: deck format when creating a deck (e.g. commander, modern)',
  'help.import.columns':
    "CSV only: column mapping like 'name=1,set=2,collector-number=3' (1-based; fields: {fields}). Skips the interactive setup wizard.",
  'help.import.noHeader': 'CSV only: treat the first row as data instead of a header row',
  'help.import.append':
    'CSV only: append the cards to an existing list instead of creating a new one',
  'help.import.csv': 'Treat the source file as CSV regardless of its extension',
  'help.import.overwrite': 'Overwrite existing lists without prompting',
  'help.import.yes': 'Automatically answer yes to the overwrite confirmation on import conflicts',
  'help.import.syncPrintings':
    'Keep the exact printings (set, collector number, finish) the source lists, without asking',
  'help.import.noSyncPrintings': 'Import bare card names, dropping the printings the source lists',
  'help.import.moxfieldUserAgent':
    'Moxfield-approved unique User-Agent string (required for Moxfield imports unless MOXFIELD_USER_AGENT is set)',
  'help.import.dryRun': 'Preview actions without writing files',

  // ── import-account ────────────────────────────────────────────────────
  'help.importAccount.description': 'Import decks from an Archidekt user',
  'help.importAccount.username': 'Archidekt username (optional if logged in)',
  'help.importAccount.all': 'Import all decks without interactive selection',
  'help.importAccount.overwrite': 'Overwrite existing decks without prompting',
  'help.importAccount.yes':
    'Automatically answer yes to the overwrite confirmation on import conflicts',
  'help.importAccount.dryRun': 'Preview imports without writing deck files',

  // ── import-changes ────────────────────────────────────────────────────
  'help.importChanges.description':
    'Apply a change bundle exported from the site editor to your lists',
  'help.importChanges.file': 'Path to the exported change-bundle JSON (one or more lists)',
  'help.importChanges.yes': 'Apply without asking for confirmation',

  // ── export ────────────────────────────────────────────────────────────
  'help.export.description':
    'Export cards from decks, collections, and wanted lists as CSV, JSON, plain text, or Markdown',
  'help.export.lists':
    'Lists to export; an optional deck:/collection:/wanted: prefix pins the type',
  'help.export.deck': 'Only decks (also disambiguates list names)',
  'help.export.collection': 'Only collections (also disambiguates list names)',
  'help.export.wanted': 'Only wanted lists (also disambiguates list names)',
  'help.export.all': 'Export every list (the default when no lists or --card are given)',
  'help.export.card': 'Add cards whose name matches every term (repeatable)',
  'help.export.name': 'Only cards whose name contains every term',
  'help.export.set': 'Only cards from this set code',
  'help.export.finish': 'Only cards with this finish: {finishes}',
  'help.export.condition':
    'Only cards with one of these conditions (comma-separated): {conditions}, none (no condition marked)',
  'help.export.labels':
    'Only collection cards whose effective labels include one of these (comma-separated): {labels}, {none} (unlabeled)',
  'help.export.format': 'Export format: {formats} (default: csv)',
  'help.export.columns':
    'Comma-separated columns in output order (csv/json only). Available: {properties}',
  'help.export.dialect':
    'Value spellings for finish and condition (csv/json only): {dialects} (default: ritual)',
  'help.export.noHeader': 'Omit the CSV header row',
  'help.export.quoteAll': 'Quote every CSV cell instead of only cells that need it',
  'help.export.out': 'Write to this file instead of stdout',
  'help.export.preset':
    'Export with a saved or built-in preset (explicit flags override its values)',
  'help.export.savePreset': 'Save the resolved format/columns/CSV options as a preset',
} as const satisfies MessageCatalogShape
