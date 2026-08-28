/**
 * `cli.*` messages for the sync and import/export commands — deck sync, collection sync, importers, exporters.
 *
 * A fragment of the cli namespace, split out purely so the command surfaces can
 * be converted independently without contending for one file. Every key still
 * begins with `cli.`, and a translator sees one flat catalog.
 *
 * Nothing here crosses into an interchange format. CSV and export *headers*,
 * the Archidekt/Moxfield dialect spellings, `EXPORT_PROPERTY_LABELS`,
 * `CSV_FIELD_LABELS`, list-type slugs, set codes, and `--output json` payload
 * keys are English by contract (plan §4.9) and are spliced in as parameters
 * rather than translated.
 */

import type { MessageCatalogShape } from '../../types'

export const cliSyncMessages = {
  // ── `login` ───────────────────────────────────────────────────────────
  'cli.login.loggedInAs': 'Logged in as {username}',
  'cli.login.sessionExpiredFor': 'Session for {username} expired.',
  'cli.login.needsCredentialFlags':
    'Non-interactive login requires both --username and --password-stdin.',
  'cli.login.emptyPassword': 'The password read from stdin is empty.',
  'cli.login.usernamePrompt': 'Username or Email',
  'cli.login.passwordPrompt': 'Password',
  'cli.login.success': 'Login successful! Logged in as {username}',
  'cli.login.successUnnamed': 'Login successful!',
  'cli.login.failed': 'Login failed: {reason}',
  'cli.login.cancelled': 'Cancelled.',
  'cli.prompt.subject.loginCredentials':
    'Archidekt login credentials — pass --username and --password-stdin instead',
  'cli.login.notLoggedIn': 'Not logged in.',
  'cli.login.accountUnnamed': 'Logged in to Archidekt (the stored login does not name an account)',
  'cli.login.accountNamed': 'Logged in to Archidekt as {username}',
  'cli.login.statusExpired': '{account} (session expired — run "ritual login archidekt")',
  'cli.login.statusRefreshable':
    '{account} (access token expired; it refreshes on the next request)',
  'cli.login.statusValidUntil': '{account} (session valid until {expiration})',
  'cli.login.loggedOut': 'Logged out of Archidekt (was {username}). Stored token cleared.',
  'cli.login.nothingToClear': 'No stored Archidekt login to clear.',

  // ── `import` — conflicts and saves ────────────────────────────────────
  'cli.import.cancelled': 'Cancelled.',
  'cli.import.conflict':
    "Import conflict for '{target}'. Re-run with --overwrite or --yes to replace it.",
  'cli.import.conflictCsv':
    "Import conflict for '{target}'. Re-run with --append to add to it, or --overwrite/--yes to replace it.",
  'cli.import.conflictAction': 'Action: [O]verwrite, [R]ename, [C]ancel? ',
  'cli.import.overwritingFile': 'Overwriting {file}...',
  'cli.import.deckExistsId': 'Deck already exists (ID Match): {file}',
  'cli.import.fileExistsName': 'File already exists (Name Conflict): {file}',
  'cli.import.promptNewFileName': 'Enter new filename (without .md): ',
  'cli.import.promptNewListName': 'Enter new {label} name: ',
  'cli.import.cancelledSave': 'Import cancelled.',
  'cli.import.dryRunOverwriteDeck': '[dry-run] Would overwrite deck: {path}',
  'cli.import.dryRunSaveDeck': '[dry-run] Would save deck to: {path}',
  'cli.import.dryRunSavePrimer': '[dry-run] Would save primer to: {path}',
  'cli.import.savedDeck': 'Successfully imported deck to: {path}',
  'cli.import.savedPrimer': 'Successfully saved primer to: {path}',
  'cli.import.dryRunOverwriteList': '[dry-run] Would overwrite {label}: {path}',
  'cli.import.dryRunSaveList': '[dry-run] Would save {label} to: {path}',
  'cli.import.savedList': 'Successfully imported {label} to: {path}',
  'cli.import.collectionNeedsPrinting':
    'Cannot import as a collection: {count} card line(s) have no printing (set and collector number required): {names}{more}',
  'cli.import.andMore': ', and {count} more',

  // ── `import` — source and flag validation ─────────────────────────────
  'cli.import.defaultedToDeck':
    'No --type given; importing as a deck (pass --type to import a collection or wanted list).',
  'cli.import.promptSyncPrintings':
    'Import the exact printings (set, collector number, and finish) the source lists?',
  'cli.import.defaultedToPrintings':
    'Keeping the exact printings the source lists (pass --no-sync-printings to import bare card names).',
  'cli.import.flagNotForUrl': '{flag} does not apply to URL imports.',
  'cli.import.flagNeedsCsv':
    '{flag} requires a CSV source (a .csv file, or --csv to force CSV parsing).',
  'cli.import.moxfieldAgentSourceOnly': {
    $select: 'kind',
    csv: '--moxfield-user-agent only applies to URL imports; it does not apply to CSV imports.',
    text: '--moxfield-user-agent only applies to URL imports; it does not apply to text-file imports.',
  },
  'cli.import.syncPrintingsUrlOnly': {
    $select: 'kind',
    csv: '--sync-printings/--no-sync-printings only apply to URL imports; a CSV import states its own printings through the column mapping.',
    text: '--sync-printings/--no-sync-printings only apply to URL imports; a text-file import states its own printings on its card lines.',
  },
  'cli.import.invalidListType': "Invalid list type '{value}'. Use: {choices}",
  'cli.import.urlDeckOnly':
    'URL imports only support decks; importing a {label} from a URL is not supported.',
  'cli.import.fileNotFound': 'File not found: {path}',
  'cli.import.readingFile': 'Reading cards from file: {path}...',
  'cli.import.failed': 'Failed to import: {reason}',

  // ── `import` — parse diagnostics ──────────────────────────────────────
  'cli.import.linesNotImported': '{count} line(s) could not be imported:',
  'cli.import.advisory': 'Warning: {message}',
  'cli.import.rowsFailed': '{count} row(s) failed to import:',
  'cli.import.failureLine': 'Line {line}: {raw}',

  // ── `import` — CSV flow ───────────────────────────────────────────────
  'cli.import.overwriteAppendExclusive': '--overwrite and --append are mutually exclusive',
  'cli.import.csvUnreadable': 'Could not read CSV file: {path}',
  'cli.import.csvParseFailed': 'Failed to parse CSV: {reason}',
  'cli.import.csvNoRows': 'CSV file contains no rows',
  'cli.import.csvHeaderNoData': 'CSV file contains a header row but no data rows',
  'cli.import.csvNoDataRows': 'CSV file contains no data rows',
  'cli.import.noRowsImported': 'No rows could be imported.',
  'cli.import.nameEmpty': 'List name cannot be empty',
  'cli.import.nameEmptyValidation': 'Name cannot be empty',
  'cli.import.missingScriptedFlags':
    'Missing required flags for a scripted import (prompts are unavailable): {flags}',
  'cli.import.deckFormatDeckOnly': '--deck-format only applies to deck imports',
  'cli.import.deckFormatNotAppend':
    '--deck-format only applies when creating a deck, not when appending',
  'cli.import.promptListName': 'Name of the {label} to create or append to:',
  'cli.import.promptExisting': "'{file}' already exists. What should happen?",
  'cli.import.choiceAppend': 'Append the cards to it',
  'cli.import.choiceOverwrite': 'Overwrite it with the import',
  'cli.import.promptDeckFormat': 'Deck format:',
  'cli.import.promptHasHeader': 'Does the first row contain column headers?',
  'cli.import.skippingHeader': 'Skipping header row: {row}',
  'cli.import.headerLooksLikeData':
    'Warning: the first row does not look like a header but was skipped as one: {row} — pass --no-header to import it as a card.',
  'cli.import.repeatHint': 'To repeat this import without the setup wizard, run:',
  'cli.import.columnNotPresent': '(not in this file)',
  'cli.import.column': 'Column {number}',
  'cli.import.columnWithHeader': 'Column {number}: "{header}"',
  'cli.import.columnSample': ' — e.g. "{sample}"',
  'cli.import.promptWhichColumn': 'Which column holds: {field}?',
  'cli.import.promptWhichColumnOptional': 'Which column holds: {field}? (optional)',
  'cli.import.dryRunOverwriteCsv':
    "[dry-run] Would overwrite {listType} '{name}' with {count} card(s): {path}",
  'cli.import.dryRunApplyCsv': {
    $select: 'mode',
    append: "[dry-run] Would append {count} card(s) to {listType} '{name}': {path}",
    create: "[dry-run] Would import {count} card(s) into {listType} '{name}': {path}",
    overwrite: "[dry-run] Would import {count} card(s) into {listType} '{name}': {path}",
  },
  'cli.import.appliedCsv': {
    $select: 'mode',
    append: "Appended {count} card(s) to {listType} '{name}': {path}",
    create: "Imported {count} card(s) into {listType} '{name}': {path}",
    overwrite: "Imported {count} card(s) into {listType} '{name}': {path}",
  },

  // ── `import-account` ──────────────────────────────────────────────────
  'cli.importAccount.noDecksSelf': 'No decks found for the logged-in account.',
  'cli.importAccount.noDecksPublic':
    "No public decks found for '{username}' — check the spelling; Archidekt does not distinguish an unknown user from an account with no public decks. Private decks require `ritual login archidekt`.",
  'cli.importAccount.selectionNeedsPrompt':
    'Deck selection requires a prompt. Pass --all to import every deck ({reason}).',
  'cli.importAccount.needUsernameOrLogin': 'You must specify a username or login first.',
  'cli.importAccount.fetchingOwn': 'Fetching decks for logged in user: {username}...',
  'cli.importAccount.fetchingAuthenticated': 'Fetching authenticated decks for: {username}...',
  'cli.importAccount.fetchingPublic': 'Fetching public decks for: {username}...',
  'cli.importAccount.sessionExpiredFallback': 'Session expired, falling back to public fetch.',
  'cli.importAccount.sessionExpiredNoPrompt':
    'Session expired or invalid. Use `ritual login archidekt` before retrying.',
  'cli.importAccount.sessionExpiredRelogin': 'Session expired or invalid. Please login again.',
  'cli.importAccount.noToken': 'Could not retrieve valid token.',
  'cli.importAccount.foundDecks': 'Found {count} decks.',
  'cli.importAccount.selectPrompt': 'Select decks to import',
  'cli.importAccount.deckFormatHint': 'Format: {format}',
  'cli.importAccount.multiselectHint': '- Space to toggle. Return to submit',
  'cli.importAccount.noneSelected': 'No decks selected.',
  'cli.importAccount.importingDecks': 'Importing {count} decks...',
  'cli.importAccount.processingDeck': 'Processing: {name} ({id})...',
  'cli.importAccount.skippedAtPrompt': 'Import cancelled at the conflict prompt',
  'cli.importAccount.deckDone': {
    $select: 'state',
    planned: 'Planned {name}',
    saved: 'Saved {name}',
  },
  'cli.importAccount.deckFailed': 'Failed to import {name}: {reason}',
  'cli.importAccount.dryRunComplete': 'Dry run complete.',
  'cli.importAccount.done': 'Done!',

  // ── `import-changes` ──────────────────────────────────────────────────
  'cli.importChanges.unreadable': "Cannot read '{file}': {reason}",
  'cli.importChanges.invalidBundle': 'Invalid change bundle: {reason}',
  'cli.importChanges.empty': 'The file contains no changes to apply.',
  'cli.importChanges.confirmationRequired':
    'Confirmation required: pass --yes to apply changes non-interactively.',
  'cli.importChanges.confirmApply': 'Apply {changes} to {lists}?',
  'cli.importChanges.listHeading': "{name} ({type} '{slug}')",
  'cli.importChanges.previewHeading': '{heading} — {changes}',
  'cli.importChanges.movesHeading': '🔀 Moves between lists — {moves}',
  'cli.importChanges.moveLine': '{change} (from {from})',
  'cli.importChanges.replacementLine': '{change} in {list}, replacing the copy taken',
  'cli.importChanges.listFailed': '{heading}: {reason}',
  'cli.importChanges.listApplied': '{heading}: applied {changes}',
  'cli.importChanges.listSkipped': '{heading}: {changes} skipped ({reasons})',
  'cli.importChanges.skippedChange': 'Skipped ({reason}): {change}',

  // ── `detect-changes` — git detection ──────────────────────────────────
  'cli.detectChanges.missingFile':
    'skipped {path}: changed in the range but missing from the working tree',
  'cli.detectChanges.wouldRename': 'Would rename: {from} → {to}',
  'cli.detectChanges.renamed': 'Renamed: {from} → {to}',
  'cli.detectChanges.wouldDelete': 'Would delete: {path}',
  'cli.detectChanges.deleted': 'Deleted: {path}',
  'cli.detectChanges.upToDate': '{label}: up to date with Ritual — skipping',
  'cli.detectChanges.noCardChanges': '{label}: no card changes detected',
  'cli.detectChanges.changeCount': '{label}: {count} change(s)',
  'cli.detectChanges.gitProbeFailed': 'Failed to check for a git repository',
  'cli.detectChanges.notGitRepo':
    'Not a git repository: {path}\n  Detection reads git history. Use "ritual detect-changes --hash-only" to stamp .sha256 sidecars without git.',
  'cli.detectChanges.resolveRefFailed': 'Failed to resolve {commit}',
  'cli.detectChanges.unknownRef':
    'Unknown git ref: {commit}\n  Pass a commit, tag, or branch that exists in {path}.',
  'cli.detectChanges.detectFailed': 'Failed to detect changes',
  'cli.detectChanges.applyFailed': 'Failed to apply detected changes: {reason}',
  'cli.detectChanges.comparing': 'Comparing against {commit}...',
  'cli.detectChanges.dryRunNotice': '(dry run — no files will be modified)',
  'cli.detectChanges.noChanges': 'No deck, collection, or wanted list changes detected.',
  'cli.detectChanges.dryRunComplete': 'Dry run complete. No files were modified.',
  'cli.detectChanges.changelogsUpdated': 'Changelogs updated.',
  'cli.detectChanges.noChangelogUpdates': 'No changelog updates needed.',
  'cli.detectChanges.failed': 'detect-changes failed: {reason}',

  // ── `detect-changes` — sidecar modes ──────────────────────────────────
  'cli.detectChanges.noListFiles': 'No list files found.',
  'cli.detectChanges.stampWarning': {
    $select: 'mode',
    dryRun:
      'would stamp {count} with unrecorded edits — these edits will not receive changelog entries:',
    applied:
      'stamped {count} with unrecorded edits — these edits will not receive changelog entries:',
  },
  'cli.detectChanges.stamped': {
    $select: 'mode',
    dryRun: 'Would stamp {count}.',
    applied: 'Stamped {count}.',
  },
  'cli.detectChanges.verifySummary':
    '{files}: {clean} clean, {diverged} diverged, {missing} without a sidecar.',
  'cli.detectChanges.verifyAdvice':
    'Run "ritual detect-changes <commit>" to record these edits in changelogs, or "ritual detect-changes --hash-only" to stamp them as already recorded.',

  // ── `detect-changes` — mode selection ─────────────────────────────────
  'cli.detectChanges.modesExclusive': '--hash-only and --verify cannot be combined.',
  'cli.detectChanges.verifyNoDryRun': '--verify never writes, so --dry-run does not apply.',
  'cli.detectChanges.missingCommit':
    'Missing required argument <commit>. Pass a commit to diff against, or use --hash-only / --verify to work without git.',
  'cli.detectChanges.commitNotUsed': 'The <commit> argument is not used with {flag}.',

  // ── Shared sync surface ───────────────────────────────────────────────
  'cli.sync.syncing': 'Syncing "{name}" ({direction})...',
  'cli.sync.notSignedIn': 'Not signed into Archidekt. Run "ritual login archidekt" first.',
  'cli.sync.accountUnnamed':
    'The stored Archidekt login does not name an account. Re-run "ritual login archidekt" to record it.',
  'cli.sync.costRemoveLines': 'removing the lines above',
  'cli.sync.costRemoveFromArchidekt': 'removing those cards from your Archidekt collection',

  // ── `deck-sync` ───────────────────────────────────────────────────────
  'cli.deckSync.syncedDecks': {
    $select: 'mode',
    dryRun: '[dry-run] Would sync {decks} ({changed} with changes)',
    applied: 'Synced {decks} ({changed} with changes)',
  },
  'cli.deckSync.skipped': '{count} skipped',
  'cli.deckSync.failed': '{count} failed',
  'cli.deckSync.decksFailed': '{failed} of {total} decks failed',
  'cli.deckSync.linked': {
    $select: 'mode',
    dryRun: '[dry-run] Would link "{name}" to {url} (deck {id}).',
    applied: 'Linked "{name}" to {url} (deck {id}).',
  },
  'cli.deckSync.previouslyLinked': 'It was linked to {target}.',
  'cli.deckSync.deckRef': 'deck {id}',
  'cli.deckSync.noLinkedDecks':
    'No Archidekt-linked decks. Link one with "ritual deck-sync link <deck> <url>".',
  'cli.deckSync.linkedHeading': '{decks} linked to Archidekt:',
  'cli.deckSync.lastSynced': 'last synced: {when}',
  'cli.deckSync.never': 'never',
  'cli.deckSync.collectionSynced': 'Collection: last synced {when} (Archidekt user {username}).',
  'cli.deckSync.collectionUnreadable': 'Collection: sync state unreadable ({reason}).',
  'cli.deckSync.collectionNever': 'Collection: never synced.',

  // ── `collection-sync` ─────────────────────────────────────────────────
  'cli.collectionSync.intoRequiresName': '--into requires a collection list name.',
  'cli.collectionSync.removalPriorityRequiresName':
    '--removal-priority requires a collection list name.',
  'cli.collectionSync.csvFileRequiresPath': '--csv-file requires a file path.',
  'cli.collectionSync.csvFlagsExclusive':
    '--csv and --csv-file cannot be combined: --csv uploads the new cards, --csv-file writes them to a file instead of pushing them.',
  'cli.collectionSync.ignoringInto': 'Ignoring --into: it only applies to a pull.',
  'cli.collectionSync.ignoringRemovalPriority':
    'Ignoring --removal-priority: it only applies to a pull.',
  'cli.collectionSync.ignoringCsv': 'Ignoring --csv: it only applies to a push.',
  'cli.collectionSync.ignoringCsvFile': 'Ignoring --csv-file: it only applies to a push.',
  'cli.collectionSync.tally': '+{added} added, -{removed} removed{waiting}',
  'cli.collectionSync.awaitingUpload': ', {count} awaiting upload',
  'cli.collectionSync.intoClause': ' (additions into "{list}")',
  'cli.collectionSync.notSynced': 'Not synced: {change}{where}.',
  'cli.collectionSync.wouldSync': '[dry-run] Would sync: {change}{where}.',
  'cli.collectionSync.synced': 'Synced: {change}{where}.',
  'cli.collectionSync.csvExported': {
    $plural: 'count',
    one: '{cards} was not pushed: upload {path} at {url} to add it.',
    other: '{cards} were not pushed: upload {path} at {url} to add them.',
  },
  'cli.collectionSync.csvPlanned':
    '[dry-run] {cards} would await a manual upload of {path} at {url}.',
  'cli.collectionSync.listsFailed': '{failed} of {total} collection lists failed',

  // ── `export` (flag mode) ──────────────────────────────────────────────
  'cli.export.formatFlagConflict':
    '{flags} cannot be combined with --format {format}: {format} exports have a fixed line format. Columns, CSV options, and the value dialect apply to csv/json output only.',
  'cli.export.unknownPreset': "No export preset named '{name}'. Available presets: {available}.",
  'cli.export.savedPreset': "Saved export preset '{name}'",
  'cli.export.exportedToFile': 'Exported {cards} to {target}',
  'cli.export.exportedToStdout': 'Exported {cards}',
  'cli.export.wizardNeedsTerminal':
    'The export wizard needs an interactive terminal, and prompts are unavailable. Specify what to export instead — e.g. --all for every list, list names, --card picks, or filters.',

  // ── `export` wizard — header and menu ─────────────────────────────────
  'cli.exportWizard.menuTitle': 'Export',
  'cli.exportWizard.nothingSelected': 'nothing selected',
  'cli.exportWizard.sourcesLine': 'Sources: {sources} — {cards} to export',
  'cli.exportWizard.filtersLine': 'Filters: {filters}',
  'cli.exportWizard.formatLine': 'Format: {format}',
  'cli.exportWizard.columnsSegment': ' · Columns: {columns}',
  'cli.exportWizard.dialectValues': '{dialect} values',
  'cli.exportWizard.csvLine': 'CSV: header {header} · {quoting}',
  'cli.exportWizard.menuAddLists': 'Add lists ({count} selected)',
  'cli.exportWizard.menuAddCards': 'Add individual cards ({count} picked)',
  'cli.exportWizard.menuFilters': 'Filters: {filters}',
  'cli.exportWizard.menuLoadPreset': 'Load preset ({count} available)',
  'cli.exportWizard.menuFormat': 'Format: {format}',
  'cli.exportWizard.menuColumns': 'Columns ({count})',
  'cli.exportWizard.menuCsvOptions': 'CSV options: header {header} · {quoting}',
  'cli.exportWizard.menuSavePreset': 'Save current settings as a preset',
  'cli.exportWizard.menuReview': 'Review {cards}',
  'cli.exportWizard.menuExport': 'Export {cards}',
  'cli.exportWizard.menuExit': 'Exit',
  'cli.exportWizard.confirmExit': 'Exit without exporting?',

  // ── `export` wizard — shared vocabulary ───────────────────────────────
  'cli.exportWizard.done': '✔ Done',
  'cli.exportWizard.back': '← Back',
  'cli.exportWizard.on': 'on',
  'cli.exportWizard.off': 'off',
  'cli.exportWizard.quoteAllCells': 'quote all cells',
  'cli.exportWizard.minimalQuoting': 'minimal quoting',
  'cli.exportWizard.quoteAll': 'quote all',
  'cli.exportWizard.alwaysQuote': 'always quote',
  'cli.exportWizard.minimal': 'minimal',
  'cli.exportWizard.any': 'Any',
  'cli.exportWizard.anyValue': 'any',
  'cli.exportWizard.anyClearFilter': 'Any (clear the filter)',
  'cli.exportWizard.currentSuffix': ' (current)',

  // ── `export` wizard — sources ─────────────────────────────────────────
  'cli.exportWizard.allListsSelected': 'Every list is already selected.',
  'cli.exportWizard.allCardsPicked': 'Every card is already picked.',
  'cli.exportWizard.promptAddList': 'Add a list ({count} selected)',
  'cli.exportWizard.promptAddCard': 'Add a card ({count} picked) — type to search all lists',

  // ── `export` wizard — filters ─────────────────────────────────────────
  'cli.exportWizard.filtersNone': 'none',
  'cli.exportWizard.filterName': 'name "{value}"',
  'cli.exportWizard.filterSet': 'set {value}',
  'cli.exportWizard.filterLabels': 'labels {value}',
  'cli.exportWizard.promptFilters': 'Filters (applied to the whole export)',
  'cli.exportWizard.filterRowName': 'Name contains: {value}',
  'cli.exportWizard.filterRowSet': 'Set code: {value}',
  'cli.exportWizard.filterRowFinish': 'Finish: {value}',
  'cli.exportWizard.filterRowCondition': 'Condition: {value}',
  'cli.exportWizard.filterRowLabels': 'Labels: {value}',
  'cli.exportWizard.promptNameTerms': 'Name terms (empty for any)',
  'cli.exportWizard.promptSetCode': 'Set code (empty for any)',
  'cli.exportWizard.promptFinish': 'Show cards with finish',
  'cli.exportWizard.promptCondition': 'Show cards with condition (toggle any combination)',
  'cli.exportWizard.noConditionMarked': 'No condition marked',
  'cli.exportWizard.promptLabels':
    'Show deck and collection cards with labels (toggle any combination)',
  'cli.exportWizard.noLabels': 'No labels at all',

  // ── `export` wizard — output shape ────────────────────────────────────
  'cli.exportWizard.promptFormat': 'Export format',
  'cli.exportWizard.promptCsvOptions': 'CSV options',
  'cli.exportWizard.csvHeaderRow': 'Header row: {value}',
  'cli.exportWizard.csvQuoting': 'Quoting: {value}',
  'cli.exportWizard.pickColumns': 'Pick columns in output order',
  'cli.exportWizard.keepCurrent': 'Keep current ({columns})',
  'cli.exportWizard.resetDefault': '↺ Reset to default',
  'cli.exportWizard.orderSoFar': 'Order so far: {columns}',

  // ── `export` wizard — presets, review, write ──────────────────────────
  'cli.exportWizard.promptLoadPreset': 'Load preset',
  'cli.exportWizard.presetNoHeader': 'no header',
  'cli.exportWizard.loadedPreset': "Loaded preset '{name}'",
  'cli.exportWizard.promptPresetName': 'Preset name',
  'cli.exportWizard.enterName': 'Enter a name',
  'cli.exportWizard.presetExists': "Preset '{name}' exists. Overwrite?",
  'cli.exportWizard.savedPreset': "Saved preset '{name}'",
  'cli.exportWizard.reviewEmpty': 'Nothing selected yet — add lists or individual cards first.',
  'cli.exportWizard.exportEmpty': 'Nothing to export yet — add lists or individual cards first.',
  'cli.exportWizard.promptOutputFile': 'Output file',
} as const satisfies MessageCatalogShape
