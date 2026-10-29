/**
 * `domain.sync.*` — the text the Archidekt sync engines (`src/sync/`,
 * `src/deck-sync/`, `src/collection-sync/`) produce.
 *
 * A fragment of the domain namespace, split out so the sync engines' text
 * reaches the surfaces that run or replay a sync — the CLI, the admin server
 * and MCP report, the admin SPA's sync pages — without riding along in the
 * public site's bundle, which never syncs. Every key still begins with
 * `domain.`, and a translator sees one flat catalog.
 *
 * The engines render a line once and hand the same text to every surface, so
 * nothing here names a CLI-only control unless the line is only ever produced
 * for the CLI. Flag spellings (`--force`, `--into`), config keys
 * (`collectionSync.pullTarget`), front-matter keys (`sourceUrl`, `sourceId`,
 * `sourceUpdatedAt`, `lastSynced`), Archidekt finish modifiers, deck board
 * names, list names, card names and printing annotations are machine
 * vocabulary or user data and stay as they are inside the sentences that
 * mention them.
 */

import type { MessageCatalogShape } from '../../types'

export const domainSyncMessages = {
  // ── Sync engines ──────────────────────────────────────────────────────
  //
  // Emitted by `src/collection-sync/` and `src/deck-sync/`, which render their
  // log lines once and hand them to the CLI, the admin site over SSE, and the
  // MCP report alike.
  'domain.sync.skippedRemovals': {
    $plural: 'count',
    one: 'Skipped {count} removal (applying additions only).',
    other: 'Skipped {count} removals (applying additions only).',
  },
  'domain.sync.skippedAdditions': {
    $plural: 'count',
    one: 'Skipped {count} addition (applying removals only).',
    other: 'Skipped {count} additions (applying removals only).',
  },
  'domain.sync.csvUncachedAdditions': {
    $plural: 'count',
    one: '{count} addition cannot ride the CSV (the printing is not in the Scryfall cache); it is added one at a time instead.',
    other:
      '{count} additions cannot ride the CSV (the printing is not in the Scryfall cache); they are added one at a time instead.',
  },
  'domain.sync.rateLimitWait':
    'Rate limited by Archidekt — waiting {wait} before retry {retry} of {maxRetries}.',
  // What accepting a source's unreadable lines costs, shown above the list of
  // those lines before the user agrees to sync it anyway.
  'domain.sync.unreadableDeckConsequence':
    'Syncing rewrites the deck file, so these lines would be removed:',
  'domain.sync.unreadablePullConsequence':
    'A pull rewrites the list file, so these lines would be removed:',
  'domain.sync.unreadablePushConsequence':
    'A push treats the list file as the truth, so the cards on these lines would be removed from your Archidekt collection:',

  // ── Collection-sync progress ──────────────────────────────────────────
  //
  // A collection sync spends most of its wall clock in three phases that used
  // to say nothing at all — reading the list files, loading the Scryfall cache
  // to key them by, and paging in the remote collection — so each one announces
  // itself before it starts and reports what it cost when it ends.
  'domain.sync.readingLists': 'Reading collection lists...',
  'domain.sync.listsRead': 'Read {lists} holding {entries} in {elapsed}.',
  'domain.sync.indexingLocal':
    'Matching {entries} against the local card cache (loading the cache the first time, which can take a while)...',
  'domain.sync.localIndexed': 'Indexed {printings} across the local lists in {elapsed}.',
  'domain.sync.printingNotCached':
    '{card} is not in the Scryfall card cache; syncing {copies} as nonfoil. If the cache is out of date, refreshing it (`{command}`) lets its finish be read.',
  'domain.sync.reindexingLocal':
    'The card cache was just refreshed, so matching the local lists against it again (this replaces any cache warnings above)...',
  'domain.sync.fetchingCollection':
    'Fetching the Archidekt collection (paced to stay under the rate limit)...',
  'domain.sync.fetchedPage': 'Fetched page {page} of {totalPages} — {records} so far.',
  'domain.sync.collectionFetched':
    'Archidekt collection: {records} covering {printings}, fetched in {elapsed}.',
  'domain.sync.comparing': 'Comparing the collection against the local lists...',
  'domain.sync.cancelled': 'Cancelled: {items} not synced.',

  // ── Sync change details ───────────────────────────────────────────────
  //
  // One line per card a sync applies, listed under its `Changes:` summary.
  // The CLI prints them only under `--verbose`.
  'domain.sync.detailAdded': '+ {quantity} {card} to {place}',
  'domain.sync.detailRemoved': '- {quantity} {card} from {place}',
  'domain.sync.detailQuantity': '~ {card} in {place}: {from} → {to}',
  'domain.sync.detailMove': '> {quantity} {card}: {from} → {to}',
  'domain.sync.detailPrinting': '* {card} in {place}: {from} → {to}',
  'domain.sync.detailCategories': '= {card} categories: {categories}',
  'domain.sync.detailNoPrinting': 'no printing',
  'domain.sync.detailPending': '+ {quantity} {card} to the CSV file, not pushed yet',
  'domain.sync.placeArchidekt': 'Archidekt',
  // The per-item count line both syncs log above their detail lines.
  'domain.sync.changesLine': 'Changes: {summary}',
  'domain.sync.deckCounts': {
    $select: 'direction',
    pull: '+{added} added, -{removed} removed, ~{quantity} quantity changed',
    push: '+{added} to add, -{removed} to remove, ~{quantity} quantity changes',
  },
  'domain.sync.deckMovesClause': ', {moves}',
  'domain.sync.deckPrintingsClause': {
    $select: 'direction',
    pull: ', {printings} changed',
    push: ', {printings} to change',
  },
  'domain.sync.deckCategoriesClause': {
    $select: 'direction',
    pull: ', {cards} changed',
    push: ', {cards} to change',
  },
  'domain.sync.collectionCounts': '+{added} added, -{removed} removed',
  'domain.sync.collectionPendingClause': ', {copies} pending',
  'domain.sync.detailNoCategories': 'none',

  // ── Run outcomes ──────────────────────────────────────────────────────
  //
  // The `reason` a deck's or list's result carries, shown in the CLI report,
  // the admin sync pages and the MCP report. Short, lowercase fragments: each
  // surface places them after the item's name.
  'domain.sync.reasonCancelled': 'cancelled before it started',
  'domain.sync.reasonNoChanges': 'no changes',
  'domain.sync.reasonNotRun': 'not synced: the run stopped before this list',
  'domain.sync.reasonDryRun': 'dry-run: {summary}',
  'domain.sync.wouldPushCardChanges': {
    $plural: 'count',
    one: 'would push {count} card change',
    other: 'would push {count} card changes',
  },
  'domain.sync.reasonList': '{reasons}',
  'domain.sync.clauseJoin': '{first}; {second}',
  'domain.sync.moreReasons': { $plural: 'count', one: '{count} more', other: '{count} more' },

  // ── Shared run log lines ──────────────────────────────────────────────
  'domain.sync.noChanges': 'No changes.',
  'domain.sync.saved': 'Saved.',
  'domain.sync.dryRunNotSaved': '[dry-run] Not saved.',
  'domain.sync.dryRunLine': '[dry-run] {line}',
  'domain.sync.itemReason': '{item}: {reason}',
  'domain.sync.unhandledCardChange': 'Unhandled card change: {change}',
  'domain.sync.confirmUnreadableFailed': 'Could not confirm the unreadable lines: {error}',
  'domain.sync.unreadableDropped': {
    $plural: 'count',
    one: '{count} unreadable line would be dropped by a sync',
    other: '{count} unreadable lines would be dropped by a sync',
  },

  // ── Deck sync ─────────────────────────────────────────────────────────
  'domain.sync.noDecks': 'No Archidekt decks found to sync.',
  'domain.sync.printingsUnaligned':
    'Printings not synced for "{card}": the local file and Archidekt hold different printings of it. Re-run with {flag} to reconcile them.',
  'domain.sync.categoriesUnreadable': 'Could not read the categories file: {error}',
  'domain.sync.categoriesWriteFailed':
    'Synced the cards, but could not write the categories file: {error}',
  'domain.sync.categoriesRefused': {
    $plural: 'count',
    one: 'Skipped an Archidekt category Ritual cannot store ({rule}): {names}',
    other: 'Skipped {count} Archidekt categories Ritual cannot store ({rule}): {names}',
  },
  'domain.sync.noLocalCategories':
    'The local deck has no categories, so its Archidekt categories are left as they are. Pull with {flag} first to bring them down.',
  'domain.sync.moveShortfall': {
    $plural: 'count',
    one: 'Could not move {count} copy of "{card}" from {from} to {to}: the local {from} does not hold them.',
    other:
      'Could not move {count} copies of "{card}" from {from} to {to}: the local {from} does not hold them.',
  },
  'domain.sync.noChangesDetected': 'No changes detected.',
  'domain.sync.formatNotSet': 'not set',
  'domain.sync.formatChanged': 'Format: {from} → {to}',
  'domain.sync.notDeckOwner': 'you do not own Archidekt deck {deckId}',
  'domain.sync.ownershipUnknown':
    'could not tell whether you own Archidekt deck {deckId}: {reason}',
  'domain.sync.skipping': 'Skipping: {reason}',
  'domain.sync.divergenceUnchecked': '{reason} — pushing without the divergence check.',
  'domain.sync.noChangesToUpload': 'No changes to upload.',
  'domain.sync.dryRunWouldPush': {
    $plural: 'count',
    one: '[dry-run] Would push {count} card change to Archidekt.',
    other: '[dry-run] Would push {count} card changes to Archidekt.',
  },
  'domain.sync.pushedCardChanges': {
    $plural: 'count',
    one: 'Pushed {count} card change to Archidekt.',
    other: 'Pushed {count} card changes to Archidekt.',
  },
  'domain.sync.pushFailed': 'Failed to push changes: {error}',
  'domain.sync.updatedLastSynced': 'Updated lastSynced.',

  // ── Deck sync: the push divergence guard ──────────────────────────────
  'domain.sync.divergenceNoTimestamp': 'Archidekt reported no update timestamp for this deck',
  'domain.sync.divergenceRemoteUnreadable':
    'Archidekt reported an unreadable update timestamp ("{value}")',
  'domain.sync.divergenceLocalUnreadable':
    'The deck\'s sourceUpdatedAt is not a readable timestamp ("{value}")',
  'domain.sync.diverged':
    'Remote deck changed since last sync (remote: {remote}, last synced against: {synced}) — pull first, or pass {flag} to overwrite remote changes.',

  // ── Both syncs: the remove-everything guard ───────────────────────────
  'domain.sync.emptyRemoteDeck':
    'The Archidekt deck holds no cards, so pulling it would remove all {cards} from the local deck. Nothing was changed. If the deck really is empty now, pass {flag} to pull it anyway.',
  'domain.sync.emptyLocalDeck':
    'The local deck holds no cards, so pushing it would remove all {cards} from the Archidekt deck. Nothing was changed. If you mean to empty it, pass {flag} to push it anyway.',
  'domain.sync.emptyRemoteCollection':
    'The Archidekt collection holds no cards Ritual can read, so this pull would remove all {entries} from your collection lists. Nothing was changed. If the collection really is empty now, pass {flag} to pull anyway.',
  'domain.sync.emptyLocalCollection':
    'Your collection lists hold no cards, so this push would delete all {records} from the Archidekt collection. Nothing was changed. If you mean to empty it, pass {flag} to push anyway.',

  // ── Deck sync: linking a deck ─────────────────────────────────────────
  'domain.sync.deckUrlRequired': 'An Archidekt deck URL is required.',
  'domain.sync.deckUrlInvalid':
    '"{value}" is not an Archidekt deck URL. Expected something like {example}.',
  'domain.sync.linkMismatch':
    'sourceUrl names Archidekt deck {urlDeckId} but sourceId is {sourceId}. A sync addresses the deck by sourceId, so the two must name the same deck.',

  // ── Deck sync: choosing the decks ─────────────────────────────────────
  'domain.sync.skippingDeckFile': 'Skipping {file}: {reason}',
  'domain.sync.deckProblem': 'Deck "{deck}": {reason}',
  'domain.sync.deckFileUnreadable': 'could not read the deck file: {error}',
  'domain.sync.frontMatterUnreadable': 'unreadable front matter: {error}',
  'domain.sync.missingSourceId': 'has Archidekt sourceUrl but no sourceId',
  'domain.sync.notArchidekt': 'not sourced from Archidekt',

  // ── Deck sync: the push's upload plan ─────────────────────────────────
  'domain.sync.finishNotOffered':
    'Finish "{finish}" is not offered for {card} on Archidekt (valid: {valid})',
  'domain.sync.planCardMissing': {
    $select: 'action',
    remove: 'Cannot remove {card}: the Archidekt deck does not hold it',
    printing: 'Cannot update the printing of {card}: the Archidekt deck does not hold it',
    quantity: 'Cannot update the quantity of {card}: the Archidekt deck does not hold it',
    board: 'Cannot change the board of {card}: the Archidekt deck does not hold it',
  },
  'domain.sync.boardMoveShortfall': {
    $plural: 'count',
    one: 'Cannot change the board for {count} copy of {card}: the Archidekt {board} board does not hold them',
    other:
      'Cannot change the board for {count} copies of {card}: the Archidekt {board} board does not hold them',
  },

  // ── Collection sync: reading the lists ────────────────────────────────
  'domain.sync.noReadableListsToPush':
    'No readable collection lists to push. Refusing to treat that as an empty collection.',
  'domain.sync.noCollectionLists': 'No collection lists to sync from.',
  'domain.sync.listUnreadable': 'Could not read collection list "{list}": {error}',
  'domain.sync.listGone': "Collection list '{list}' is no longer on disk",
  'domain.sync.previewIncludesUnreadable':
    'This preview includes the lists above; a real run holds them back until their unreadable lines are accepted.',
  'domain.sync.stateWriteFailed': 'Could not record the sync timestamp: {error}',

  // ── Collection sync: the state file ───────────────────────────────────
  'domain.sync.stateNotObject': 'Collection sync state is not an object',
  'domain.sync.stateMissingLastSynced': "Collection sync state is missing a 'lastSynced' timestamp",
  'domain.sync.stateMissingUserId': "Collection sync state is missing a numeric 'userId'",
  'domain.sync.stateMissingUsername': "Collection sync state is missing a 'username'",
  'domain.sync.stateInvalidJson': 'the file is not valid JSON',

  // ── Collection sync: reading Archidekt's records ──────────────────────
  'domain.sync.recordIncomplete':
    'Skipping Archidekt record {recordId}: it does not name a card, set code, and collector number.',
  'domain.sync.recordSkipped': 'Skipping Archidekt record {recordId} ({card}): {reason}',
  'domain.sync.recordUnknownLanguage':
    "Archidekt record {recordId} ({card}) has an unknown language id '{languageId}'; treating it as English.",
  'domain.sync.languageUnmappable':
    'Archidekt cannot represent {languageName} [{language}]; pushing {card} as English.',

  // ── Collection sync: pull ─────────────────────────────────────────────
  'domain.sync.pullAdditionsWithheld': {
    $plural: 'count',
    one: 'Not adding {count} copy: some collection lists in scope could not be read, so cards they already hold would be duplicated into "{target}". Fix or accept those lists and run again.',
    other:
      'Not adding {count} copies: some collection lists in scope could not be read, so cards they already hold would be duplicated into "{target}". Fix or accept those lists and run again.',
  },
  'domain.sync.saveFailed': 'Failed to save: {error}',
  'domain.sync.scryfallCacheUnreadable': 'Could not read the Scryfall cache: {error}',
  'domain.sync.pullTargetAmbiguous':
    'More than one collection list is named "{name}": {matches}. Point {flag} (or {configKey}) at one of them.',
  'domain.sync.dryRunCreateTarget':
    '[dry-run] Would create collection list "{name}" for the cards being added.',
  'domain.sync.createTargetFailed': 'Could not create the collection list "{name}": {error}',
  'domain.sync.createdTarget': 'Created collection list "{name}" for the cards being added.',

  // ── Collection sync: ambiguous removals ───────────────────────────────
  'domain.sync.ambiguousListShare': '"{list}" ({copies})',
  'domain.sync.unplacedCopies': '{quantity} × {card}',
  'domain.sync.ambiguousRemoval':
    'Not removing {quantity} × {card}: ambiguous — copies live in {lists}.',
  'domain.sync.priorityNoList': 'no collection list is named "{name}"',
  'domain.sync.priorityAmbiguousList': 'more than one collection list is named "{name}": {matches}',
  'domain.sync.priorityUnusable': 'Cannot use the removal priority: {problems}.',
  'domain.sync.removingAmbiguous': {
    $select: 'via',
    priority: 'Removing {quantity} × {card} from "{list}" (removal priority).',
    resolved: 'Removing {quantity} × {card} from "{list}" (resolved).',
  },
  'domain.sync.priorityCannotPlace':
    'The removal priority ({priority}) cannot place {cards}. Nothing was written.',
  'domain.sync.ambiguityPreview':
    'A real run would refuse to place {cards} until the ambiguity is resolved.',
  'domain.sync.ambiguityUnresolved':
    'Could not place {cards}: the removals are ambiguous and were not resolved. Nothing was written.',
  'domain.sync.ambiguityResolverFailed':
    'Could not resolve the ambiguous removals: {error}. Nothing was written.',
  'domain.sync.nothingWritten': '{message} Nothing was written.',
  'domain.sync.ambiguityResolutionIncomplete':
    'Could not place {cards}: the resolution did not say which lists lose those copies. Nothing was written.',

  // ── Collection sync: push ─────────────────────────────────────────────
  'domain.sync.pushRemovalsWithheld': {
    $plural: 'count',
    one: 'Not removing {count} copy from Archidekt: some collection lists in scope could not be read, so cards they still hold would look gone. Fix or accept those lists and run again.',
    other:
      'Not removing {count} copies from Archidekt: some collection lists in scope could not be read, so cards they still hold would look gone. Fix or accept those lists and run again.',
  },
  'domain.sync.removeFromArchidektFailed': 'Failed to remove {card} from Archidekt',
  'domain.sync.addFailed': 'Failed to add {card}: {error}',
  'domain.sync.updateFailed': 'Failed to update {card}: {error}',
  'domain.sync.removeFailed': 'Failed to remove {card}: {error}',

  // ── Collection sync: the push's additions CSV ─────────────────────────
  'domain.sync.nothingPushed': '{message} Nothing was pushed.',
  'domain.sync.csvCachePrepareFailed':
    'Could not prepare the card cache for a CSV upload: {error}. Nothing was pushed.',
  'domain.sync.csvUndecided': {
    $plural: 'count',
    one: '{count} card would be added — more than {threshold}, so adding it one at a time would cost {count} printing search, and this run was not told to upload it as one CSV import instead. Nothing was pushed.',
    other:
      '{count} cards would be added — more than {threshold}, so adding them one at a time would cost {count} printing searches, and this run was not told to upload them as one CSV import instead. Nothing was pushed.',
  },
  'domain.sync.csvDeciderFailed': {
    $plural: 'count',
    one: 'Could not decide how to add {count} card: {error}. Nothing was pushed.',
    other: 'Could not decide how to add {count} cards: {error}. Nothing was pushed.',
  },
  'domain.sync.csvNoFile': 'No file was named for the additions CSV. Nothing was pushed.',
  'domain.sync.dryRunCsvExport':
    '[dry-run] Would write {size} to {path} for a manual upload at {url}.',
  'domain.sync.dryRunCsvUpload': '[dry-run] Would upload {size} as a CSV import.',
  'domain.sync.csvWriteFailed': 'Failed to write the additions CSV to {path}: {error}',
  'domain.sync.csvExported':
    'Wrote {size} to {path}; they were not pushed. Import the file at {url}.',
  'domain.sync.csvUploading': 'Uploading {size} as a CSV import...',
  'domain.sync.csvUploadFailed': 'Failed to upload {size} as a CSV import: {error}',
  'domain.sync.csvChunkUnreadable':
    "Could not read Archidekt's answer for CSV chunk {chunk}: {error}. Response: {body}",
  'domain.sync.csvRowsUnpaired': {
    $plural: 'count',
    one: '{count} refused row could not be matched to a card; the copies it carried are credited on faith — a later push reconciles anything actually missed.',
    other:
      '{count} refused rows could not be matched to a card; the copies they carried are credited on faith — a later push reconciles anything actually missed.',
  },
  'domain.sync.csvRowsRefused': {
    $plural: 'count',
    one: 'Archidekt did not import {failed} of {count} CSV row ({reasons}).',
    other: 'Archidekt did not import {failed} of {count} CSV rows ({reasons}).',
  },
  'domain.sync.csvRowNotImported': '  Not imported: {card} — {reason}.',
  'domain.sync.csvMoreFailures': {
    $plural: 'count',
    one: '  …and {count} more.',
    other: '  …and {count} more.',
  },
  'domain.sync.csvCardsNotImported': {
    $plural: 'count',
    one: '{count} card could not be imported from the CSV',
    other: '{count} cards could not be imported from the CSV',
  },
  'domain.sync.csvImported': 'Imported {size} from the CSV in {requests}.',
  'domain.sync.csvSize': '{cards} ({rows})',
  'domain.sync.csvRow': 'CSV row {row}',
  'domain.sync.csvRowEcho': 'CSV row {row} ({line})',
  'domain.sync.csvReasonNotFound': {
    $plural: 'count',
    one: '{count} not found',
    other: '{count} not found',
  },
  'domain.sync.csvReasonAmbiguous': {
    $plural: 'count',
    one: '{count} ambiguous',
    other: '{count} ambiguous',
  },
  'domain.sync.csvReasonRejected': {
    $plural: 'count',
    one: '{count} rejected',
    other: '{count} rejected',
  },
  'domain.sync.csvReasonUnexplained': {
    $plural: 'count',
    one: '{count} refused without a reason',
    other: '{count} refused without a reason',
  },
  'domain.sync.csvFailureNotFound': 'not found on Archidekt',
  'domain.sync.csvFailureAmbiguous': 'matched more than one printing',
  'domain.sync.csvFailureUnexplained': 'Archidekt gave no reason',

  // ── The Archidekt login (`src/auth/ArchidektAuth.ts`) ─────────────────
  //
  // Its failures reach `ritual login`, the admin Archidekt Login page and the
  // console of whatever process refreshed the session before a sync.
  'domain.sync.auth.loginFailed': 'Archidekt answered the login with HTTP {status}',
  'domain.sync.auth.loginFailedWithReason':
    'Archidekt answered the login with HTTP {status}: {reason}',
  'domain.sync.auth.loginReplyInvalid': 'Archidekt answered the login without a usable session',
  'domain.sync.auth.refreshFailed': 'Archidekt answered the session refresh with HTTP {status}',
  'domain.sync.auth.refreshFailedWithReason':
    'Archidekt answered the session refresh with HTTP {status}: {reason}',
  'domain.sync.auth.refreshNoAccessToken':
    'Archidekt answered the session refresh without an access token',
  'domain.sync.auth.refreshed': 'Refreshed the Archidekt session.',
  'domain.sync.auth.refreshError': 'Could not refresh the Archidekt session: {error}',

  // ── The Archidekt client (`src/clients/ArchidektClient.ts`) ───────────
  //
  // Its failures reach `ritual import` (an Archidekt URL), `import-account`,
  // both syncs (CLI, admin pages, MCP, reports) and the admin Import Deck page;
  // each request's pair is the failure alone and the same failure quoting
  // Archidekt's own reason.
  'domain.sync.archidekt.deckFailed': 'Failed to fetch Archidekt deck {deckId} (HTTP {status})',
  'domain.sync.archidekt.deckFailedWithReason':
    'Failed to fetch Archidekt deck {deckId} (HTTP {status}): {reason}',
  'domain.sync.archidekt.publicDecksFailed':
    'Failed to fetch the public decks of Archidekt user {username} (HTTP {status})',
  'domain.sync.archidekt.publicDecksFailedWithReason':
    'Failed to fetch the public decks of Archidekt user {username} (HTTP {status}): {reason}',
  'domain.sync.archidekt.ownDecksFailed': 'Failed to fetch your Archidekt decks (HTTP {status})',
  'domain.sync.archidekt.ownDecksFailedWithReason':
    'Failed to fetch your Archidekt decks (HTTP {status}): {reason}',
  'domain.sync.archidekt.collectionPageFailed':
    'Failed to fetch page {page} of the collection of Archidekt user {userId} (HTTP {status})',
  'domain.sync.archidekt.collectionPageFailedWithReason':
    'Failed to fetch page {page} of the collection of Archidekt user {userId} (HTTP {status}): {reason}',
  'domain.sync.archidekt.searchFailed':
    'The Archidekt card search for {card} failed (HTTP {status})',
  'domain.sync.archidekt.searchFailedWithReason':
    'The Archidekt card search for {card} failed (HTTP {status}): {reason}',
  'domain.sync.archidekt.deckChangeFailed':
    'Failed to send the changes to Archidekt deck {deckId} (HTTP {status})',
  'domain.sync.archidekt.deckChangeFailedWithReason':
    'Failed to send the changes to Archidekt deck {deckId} (HTTP {status}): {reason}',
  'domain.sync.archidekt.recordCreateFailed':
    'Failed to create a record in the Archidekt collection (HTTP {status})',
  'domain.sync.archidekt.recordCreateFailedWithReason':
    'Failed to create a record in the Archidekt collection (HTTP {status}): {reason}',
  'domain.sync.archidekt.recordUpdateFailed':
    'Failed to update record {recordId} of the Archidekt collection (HTTP {status})',
  'domain.sync.archidekt.recordUpdateFailedWithReason':
    'Failed to update record {recordId} of the Archidekt collection (HTTP {status}): {reason}',
  'domain.sync.archidekt.recordsDeleteFailed':
    'Failed to delete {records} from the Archidekt collection (HTTP {status})',
  'domain.sync.archidekt.recordsDeleteFailedWithReason':
    'Failed to delete {records} from the Archidekt collection (HTTP {status}): {reason}',
  'domain.sync.archidekt.csvChunkFailed':
    'Failed to upload part {chunk} of the CSV to Archidekt (HTTP {status})',
  'domain.sync.archidekt.csvChunkFailedWithReason':
    'Failed to upload part {chunk} of the CSV to Archidekt (HTTP {status}): {reason}',
  'domain.sync.archidekt.publicDecksUnreadable':
    'Failed to read the public decks of Archidekt user {username}: {reason}',
  'domain.sync.archidekt.ownDecksUnreadable': 'Failed to read your Archidekt decks: {reason}',
  'domain.sync.archidekt.deckUnreadable': 'Failed to read Archidekt deck {deckId}: {reason}',
  'domain.sync.archidekt.collectionPageUnreadable':
    'Failed to read page {page} of the collection of Archidekt user {userId}: {reason}',
  'domain.sync.archidekt.searchUnreadable':
    'Failed to read the Archidekt card search for {card}: {reason}',
  'domain.sync.archidekt.searchUnreachable':
    'The Archidekt card search for {card} could not reach Archidekt: {error}',
  'domain.sync.archidekt.replyNotObject': 'the reply was not a JSON object',
  'domain.sync.archidekt.replyFieldInvalid': 'the reply had no usable {field}',
  'domain.sync.archidekt.pageItemUnreadable': 'result {index} of the reply had no usable {field}',
  'domain.sync.archidekt.cardNotFound': 'Card not found on Archidekt: {card}',
  'domain.sync.archidekt.csvUnreadable': 'The CSV for Archidekt could not be read: {reason}',
  'domain.sync.archidekt.pageRepeated':
    'Archidekt served a next-page link it had already served ({url}); stopped after {decks}.',
  'domain.sync.archidekt.pageCapReached':
    'Stopped after {pages} of Archidekt results; the list may be incomplete ({decks} so far).',
  'domain.sync.archidekt.nextLinkUnreadable':
    'Archidekt served a next-page link that cannot be read, so it was not followed: {url}. The list may be incomplete.',
  'domain.sync.archidekt.nextLinkForeign':
    'Archidekt served a next-page link to another site ({host}), so it was not followed: {url}. The list may be incomplete.',
} as const satisfies MessageCatalogShape
