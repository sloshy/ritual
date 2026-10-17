/** Translator metadata for {@link domainSyncMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainSyncMessages } from './domain-sync'

const REASON_CONTEXT =
  "The reason a sync's per-deck or per-list result carries, shown after the item's name in the CLI output and on the admin sync pages, and readable in the report a script or agent gets. Follow the English's case and punctuation: the short fragments are lowercase with no final period, the full sentences are capitalized."

const LIST_CONTEXT =
  "is rendered as a list joined with the locale's own list pattern, so do not add separators of your own."

const LOG_CONTEXT =
  "One line of a sync run's log — printed by the CLI and streamed to the admin sync pages."

const DRY_RUN_CONTEXT =
  'The "[dry-run]" tag prefixes every line a preview run prints instead of acting, and is not translated.'

const NOTHING_WRITTEN_CONTEXT =
  'Ends with "Nothing was written." because the pull refuses before touching any file.'

const NOTHING_PUSHED_CONTEXT =
  'Ends with "Nothing was pushed." because the push refuses before sending anything to Archidekt.'

const CARD_CONTEXT =
  '{card} is a card name, optionally followed by its printing in card-line grammar like "(C21:240) [foil]" — never translated.'

const CSV_SIZE_CONTEXT =
  '{size} is a pre-rendered count of cards and CSV rows like "30 cards (28 rows)".'

const ARCHIDEKT_FAILURE_CONTEXT =
  'Why a request to Archidekt (a deck-building website; a name, never translated) failed. Shown on its own (the CLI error line, the admin Import Deck page), or after the colon of another sentence, as in "Failed to add Sol Ring: …" during a sync; so it has no closing period.'

const ARCHIDEKT_REASON_CONTEXT =
  '{reason} is Archidekt\'s own explanation (such as "This field may not be null."), or the start of its raw reply, quoted as Archidekt sent it, usually in English; never translate it. Several are already joined in the reader\'s language.'

const ARCHIDEKT_UNREADABLE_CONTEXT =
  "{reason} is why the reply could not be read: one of the domain.sync.archidekt.reply* or pageItemUnreadable phrases, already in the reader's language."

const ARCHIDEKT_WARNING_CONTEXT =
  'A warning while reading a list of decks from Archidekt (a deck-building website; a name, never translated), which serves it a page at a time, each page linking to the next ("next-page link"). Logged by deck-sync push and import-account and shown on the admin Sync Decks page; also the reason a report gives for a deck list being incomplete. A full sentence, capitalized with a closing period. {url} is the link as Archidekt sent it, never translated.'

const AUTH_FAILURE_CONTEXT =
  'Why logging in to Archidekt (a deck-building website; a name, never translated) failed. Shown on its own on the admin Archidekt Login page, and after "Login failed: " in the CLI; so it has no closing period.'

const AUTH_REFRESH_CONTEXT =
  'A stored Archidekt login is a "session": a short-lived access token, renewed ("refreshed") automatically before a sync with a longer-lived refresh token.'

const AUTH_STATUS_CONTEXT =
  '{status} is the HTTP status code (a number such as 400); "HTTP" stays literal.'

const AUTH_REASON_CONTEXT =
  '{reason} is Archidekt\'s own explanation (such as "Unable to log in with provided credentials."), quoted as Archidekt sent it, usually in English; never translate it. Several are already joined in the reader\'s language.'

const AUTH_LOG_CONTEXT =
  'A console line of the process that used a stored Archidekt login — the CLI, or a Ritual server (admin, mcp) — about renewing that login before a sync.'

const CSV_REASON_CONTEXT =
  'One clause of the parenthetical list explaining why Archidekt dropped rows of an uploaded CSV, e.g. "2 not found, 1 ambiguous". {count} is a number of CSV rows; the clauses are joined with the locale\'s list separator.'

export const domainSyncMeta = {
  'domain.sync.skippedRemovals': {
    description:
      'Reported when a sync was restricted to additions, so this many removals were left alone. "additions" and "removals" name the two halves of a sync and appear in the UI controls too.',
  },
  'domain.sync.skippedAdditions': {
    description: 'The mirror of the previous key: a sync restricted to removals skipped additions.',
  },
  'domain.sync.csvUncachedAdditions': {
    description:
      'Some cards cannot be uploaded in the bulk CSV because Ritual has no cached printing for them, so they are pushed individually instead. Note the pronoun agreement between the singular and plural forms.',
  },
  'domain.sync.rateLimitWait': {
    description:
      'Warns that Archidekt answered 429 and the sync is pausing before retrying the same request. {wait} is a pre-rendered duration like "2 seconds" or "2.5 seconds", {retry} is the 1-based attempt about to be made, {maxRetries} the total budget.',
  },
  'domain.sync.unreadableDeckConsequence': {
    description:
      'Shown in the CLI prompt and the admin confirmation panel before a deck sync proceeds with lines the parser could not read; the list of those lines follows the colon. A deck sync rewrites the file in either direction, so the sentence does not mention one.',
  },
  'domain.sync.unreadablePullConsequence': {
    description:
      'The collection-sync counterpart for a pull (Archidekt → local): pulling rewrites the collection list file, dropping the unreadable lines. The list of lines follows the colon.',
  },
  'domain.sync.unreadablePushConsequence': {
    description:
      "The collection-sync counterpart for a push (local → Archidekt): the file is taken as the truth, so cards on unreadable lines are deleted from the user's Archidekt collection. The list of lines follows the colon.",
  },
  'domain.sync.readingLists': {
    description:
      'The first progress line of a collection sync, printed before the list files are read.',
  },
  'domain.sync.listsRead': {
    description:
      'Reports the end of that phase. {lists} is a pre-rendered count of collection lists, {entries} a pre-rendered count of card entries, {elapsed} a pre-rendered duration like "4.2 seconds" — none of the three is a bare number.',
  },
  'domain.sync.indexingLocal': {
    description:
      'Announces the phase that looks every local card up in the on-disk Scryfall card cache; the parenthetical explains why the first run of it pauses for several seconds. {entries} is a pre-rendered count of card entries.',
  },
  'domain.sync.localIndexed': {
    description:
      'Reports the end of that phase. {printings} is a pre-rendered count of printings (a card in one specific set), {elapsed} a pre-rendered duration.',
  },
  'domain.sync.printingNotCached': {
    description:
      'Warning during a collection sync: a card line names no finish, and the printing is missing from the local Scryfall card cache, so its finish (nonfoil/foil/etched) could not be looked up and nonfoil is assumed. {card} is the card name followed by its printing, e.g. "Sol Ring (C21:240)"; {copies} is a pre-rendered count like "2 copies". The backticked text is a CLI command and must stay untranslated.',
  },
  'domain.sync.reindexingLocal': {
    description:
      'Announces a second pass of the local-cache lookup phase, run when a push had to download a fresh Scryfall card cache partway through (before uploading a CSV): the first pass used the old cache, so its results are recomputed. Followed by the same completion line as the first pass.',
  },
  'domain.sync.fetchingCollection': {
    description:
      'Announces the phase that downloads the whole Archidekt collection; the parenthetical explains why it is slow — Ritual deliberately spaces the requests out.',
  },
  'domain.sync.fetchedPage': {
    description:
      'One line per downloaded page of the remote collection, so a long fetch visibly advances. {page} and {totalPages} are bare numbers; {records} is a pre-rendered count of collection records fetched so far.',
  },
  'domain.sync.collectionFetched': {
    description:
      'Summarizes the downloaded collection. {records} is a pre-rendered count of collection records, {printings} a pre-rendered count of the distinct printings among them (fewer, since several records can share a printing), {elapsed} a pre-rendered duration.',
  },
  'domain.sync.comparing': {
    description:
      'Announces the phase that diffs the downloaded collection against the local lists, after both sides have been read.',
  },
  'domain.sync.cancelled': {
    description:
      'Run-level log line ending a sync the caller cancelled part way. {items} is a pre-rendered count of the decks or collection lists the run never started.',
  },
  'domain.sync.detailAdded': {
    description:
      'One per-card detail line a sync lists under its change summary (CLI: only with --verbose; admin sync pages: always). The leading symbol marks the kind of change and keeps the lines scannable in a column; keep it first. Copies of a card added. {quantity} is the number of copies. {card} is the card name, with an optional printing annotation like "(C21:263) [foil]" (card-line grammar, never translated). {place} is where the copies are, interpolated untranslated: a deck board name (Commander, Main, Sideboard, Maybeboard), a collection list name, or domain.sync.placeArchidekt.',
  },
  'domain.sync.detailRemoved': {
    description:
      'One per-card detail line a sync lists under its change summary (CLI: only with --verbose; admin sync pages: always). The leading symbol marks the kind of change and keeps the lines scannable in a column; keep it first. Copies of a card removed. {quantity} is the number of copies. {card} is the card name, with an optional printing annotation like "(C21:263) [foil]" (card-line grammar, never translated). {place} is where the copies are, interpolated untranslated: a deck board name (Commander, Main, Sideboard, Maybeboard), a collection list name, or domain.sync.placeArchidekt.',
  },
  'domain.sync.detailQuantity': {
    description:
      'One per-card detail line a sync lists under its change summary (CLI: only with --verbose; admin sync pages: always). The leading symbol marks the kind of change and keeps the lines scannable in a column; keep it first. A card whose quantity changes. {card} is the card name, with an optional printing annotation like "(C21:263) [foil]" (card-line grammar, never translated). {place} is where the copies are, interpolated untranslated: a deck board name (Commander, Main, Sideboard, Maybeboard), a collection list name, or domain.sync.placeArchidekt. {from} and {to} are the old and new copy counts.',
  },
  'domain.sync.detailMove': {
    description:
      'One per-card detail line a sync lists under its change summary (CLI: only with --verbose; admin sync pages: always). The leading symbol marks the kind of change and keeps the lines scannable in a column; keep it first. Copies of a card moving between deck boards. {quantity} is the number of copies moving. {card} is the card name, with an optional printing annotation like "(C21:263) [foil]" (card-line grammar, never translated). {from} and {to} are deck board names (Commander, Main, Sideboard, Maybeboard), interpolated untranslated.',
  },
  'domain.sync.detailPrinting': {
    description:
      'One per-card detail line a sync lists under its change summary (CLI: only with --verbose; admin sync pages: always). The leading symbol marks the kind of change and keeps the lines scannable in a column; keep it first. A card whose copies change printing. {card} is the card name. {place} is where the copies are, interpolated untranslated: a deck board name (Commander, Main, Sideboard, Maybeboard), a collection list name, or domain.sync.placeArchidekt. {from} and {to} are the old and new printings in card-line grammar like "(LEA:270) [foil]" (a finish-only change reads "[nonfoil] → [foil]"), or domain.sync.detailNoPrinting.',
  },
  'domain.sync.detailCategories': {
    description:
      'One per-card detail line a sync lists under its change summary (CLI: only with --verbose; admin sync pages: always). The leading symbol marks the kind of change and keeps the lines scannable in a column; keep it first. A card whose categories the sync sets. {card} is the card name, {categories} a comma-separated list of user-defined category names (primary first) or domain.sync.detailNoCategories.',
  },
  'domain.sync.detailPending': {
    description:
      'One per-card detail line a collection-sync push lists under the run (CLI: only with --verbose): copies the CLI’s --csv-file wrote to a file the user imports by hand, so they are not on Archidekt yet. Only the CLI writes such a file. The leading symbol marks the kind of change; keep it first. {quantity} is the number of copies, {card} the card name with an optional printing annotation like "(C21:263) [foil]" (card-line grammar, never translated).',
  },
  'domain.sync.changesLine': {
    description:
      'The per-deck or per-list count line both syncs log (CLI and admin sync pages), above the per-card detail lines. {summary} is a pre-rendered domain.sync.deckCounts or domain.sync.collectionCounts with its clauses.',
  },
  'domain.sync.deckCounts': {
    description:
      "Part of the per-item count line a sync logs (CLI and the admin sync pages) above its per-card detail lines. A deck sync's card-change counts, branched on the persisted direction slug (pull = what the pull changed locally, push = what the push will change on Archidekt). {added}, {removed} and {quantity} are entry counts; the +, - and ~ signs mirror the detail lines' markers. Optional clauses (domain.sync.deckMovesClause, deckPrintingsClause, deckCategoriesClause) are appended after it.",
  },
  'domain.sync.deckMovesClause': {
    description:
      'Part of the per-item count line a sync logs (CLI and the admin sync pages) above its per-card detail lines. Appended to domain.sync.deckCounts when a deck sync moves cards between boards. {moves} is a pre-rendered domain.count.boardMoves. Keep the leading separator.',
  },
  'domain.sync.deckPrintingsClause': {
    description:
      'Part of the per-item count line a sync logs (CLI and the admin sync pages) above its per-card detail lines. Appended to domain.sync.deckCounts when a deck sync changes printings, branched on the direction slug. {printings} is a pre-rendered domain.count.printings. Keep the leading separator.',
  },
  'domain.sync.deckCategoriesClause': {
    description:
      'Part of the per-item count line a sync logs (CLI and the admin sync pages) above its per-card detail lines. Appended to domain.sync.deckCounts when a deck sync syncs categories, branched on the direction slug. {cards} is a pre-rendered domain.count.cardCategories. Keep the leading separator.',
  },
  'domain.sync.collectionCounts': {
    description:
      "Part of the per-item count line a sync logs (CLI and the admin sync pages) above its per-card detail lines. A collection sync's copies added and removed for one list (or on Archidekt for it, on a push). The + and - signs mirror the detail lines' markers.",
  },
  'domain.sync.collectionPendingClause': {
    description:
      'Part of the per-item count line a sync logs (CLI and the admin sync pages) above its per-card detail lines. Appended to domain.sync.collectionCounts when a CLI push wrote copies to its --csv-file instead of pushing them. {copies} is a pre-rendered domain.count.copies. Keep the leading separator.',
  },
  'domain.sync.placeArchidekt': {
    description:
      "The {place} of a collection-sync push's detail lines (domain.sync.detailAdded / detailRemoved): the user's Archidekt collection, which the copies are added to or removed from. Archidekt is a product name.",
  },
  'domain.sync.detailNoPrinting': {
    description:
      'Stands in for one side of a printing change in domain.sync.detailPrinting when that side states no specific printing (a bare card line).',
  },
  'domain.sync.detailNoCategories': {
    description:
      "Stands in for the category list in domain.sync.detailCategories when the sync clears all of a card's categories.",
  },

  'domain.sync.reasonCancelled': {
    description: `${REASON_CONTEXT} The run was cancelled before it reached this deck or list, so nothing was done to it.`,
  },
  'domain.sync.reasonNotRun': {
    description: `${REASON_CONTEXT} A collection list the sync never reached because the whole run stopped first — for example on ambiguous removals nobody decided, or on additions it would not push. The run's own error says why; this only says the list was left alone. Its outcome code is "not-run".`,
  },
  'domain.sync.reasonNoChanges': {
    description: `${REASON_CONTEXT} The deck or list already matched, so nothing was changed.`,
  },
  'domain.sync.wouldPushCardChanges': {
    description: `The {summary} of domain.sync.reasonDryRun for a deck push preview. {count} is the number of card changes a real run would send. Starts lowercase: it follows "dry-run:".`,
  },
  'domain.sync.reasonList': {
    description: `${REASON_CONTEXT} Several reasons for one deck or list at once. {reasons} is the reasons joined pairwise through domain.sync.clauseJoin; there is nothing else to translate.`,
  },
  'domain.sync.moreReasons': {
    description:
      'The last clause of a list of reasons, standing for the ones left out so the list stays short: "First.; Second.; Third.; 4 more". Used both for the reasons of one sync item and for the reasons Archidekt gave for one failure. {count} is how many more reasons there were.',
  },
  'domain.sync.clauseJoin': {
    description:
      'Joins two independent clauses — reasons, or problems with the removal priority — that sit in one sentence. {first} and {second} are already-translated clauses; longer lists are joined pairwise, so keep it symmetric.',
  },
  'domain.sync.reasonDryRun': {
    description: `${REASON_CONTEXT} A preview run's reason. "dry-run" is the CLI's literal --dry-run flag name and is not translated. {summary} is a pre-rendered change count like "+2 added, -1 removed".`,
  },
  'domain.sync.noChanges': {
    description: `${LOG_CONTEXT} Logged under a collection list the sync found nothing to change in.`,
  },
  'domain.sync.saved': {
    description: `${LOG_CONTEXT} Logged under a deck or collection list once a pull has written its changes to the file.`,
  },
  'domain.sync.dryRunNotSaved': {
    description: `${LOG_CONTEXT} Logged under a deck or collection list on a preview run, where the changes listed above it were not written. ${DRY_RUN_CONTEXT}`,
  },
  'domain.sync.dryRunLine': {
    description: `${LOG_CONTEXT} Marks a line that describes what a preview run would have done. {line} is an already-translated sentence. ${DRY_RUN_CONTEXT}`,
  },
  'domain.sync.itemReason': {
    description: `${LOG_CONTEXT} Warning naming a file and why it was not synced. {item} is the file name, {reason} an already-translated reason like domain.sync.unreadableDropped.`,
  },
  'domain.sync.unhandledCardChange': {
    description:
      'Internal error raised when a sync meets a kind of card change this version does not know how to describe — a sign of a version mismatch, not a user mistake. {change} is the change as raw JSON.',
  },
  'domain.sync.confirmUnreadableFailed': {
    description: `${LOG_CONTEXT} The prompt asking whether to sync files with unreadable lines anyway failed, so those files are not synced. {error} is the underlying error message.`,
  },
  'domain.sync.unreadableDropped': {
    description: `${REASON_CONTEXT} Why a deck or list was not synced: its file has lines the parser cannot read, and syncing would delete them. {count} is the number of such lines.`,
  },
  'domain.sync.noDecks': {
    description: `${LOG_CONTEXT} No local deck is linked to an Archidekt deck, so a deck sync has nothing to do.`,
  },
  'domain.sync.printingsUnaligned': {
    description: `${LOG_CONTEXT} Warning: the local deck and the Archidekt deck hold the card at different printings (set or finish), which this run left alone. {card} is the card name. "--sync-printings" is a literal CLI flag.`,
  },
  'domain.sync.categoriesUnreadable': {
    description:
      "Why a deck failed to sync: its card-categories file (a sidecar file next to the deck) could not be read. {error} is the parser's message.",
  },
  'domain.sync.categoriesWriteFailed': {
    description:
      'Why a deck pull is reported as failed even though its cards were written: the card-categories sidecar file could not be saved. {error} is the underlying error message.',
  },
  'domain.sync.categoriesRefused': {
    description: `${LOG_CONTEXT} Warning: some category names on the Archidekt deck break Ritual's naming rule, so they were not pulled. {count} is how many — in some languages the "one" form also covers other numbers (21, 31…), so keep {count} in every form rather than writing the word for one. {rule} is the naming rule itself (domain.card.category.shapeRule), rendered separately; {names} is the quoted names, which ${LIST_CONTEXT}`,
  },
  'domain.sync.noLocalCategories': {
    description: `${LOG_CONTEXT} Warning during a deck push with category syncing on: the local deck has no categories at all, so the push leaves Archidekt's alone rather than wiping them. "--sync-categories" is a literal CLI flag.`,
  },
  'domain.sync.moveShortfall': {
    description: `${LOG_CONTEXT} Warning during a deck pull: Archidekt moved copies of a card between deck boards, but the local file does not hold enough of them on the source board. {count} is the number of copies, {card} the card name, {from} and {to} deck board names (Commander, Main, Sideboard, Maybeboard), interpolated untranslated.`,
  },
  'domain.sync.noChangesDetected': {
    description: `${LOG_CONTEXT} Logged under a deck a pull found already up to date.`,
  },
  'domain.sync.formatNotSet': {
    description:
      'Stands in for {from} in domain.sync.formatChanged when the local deck had no format before the pull set one.',
  },
  'domain.sync.formatChanged': {
    description: `${LOG_CONTEXT} A deck pull changed the deck's game format. {from} and {to} are format names like "Commander", or domain.sync.formatNotSet.`,
  },
  'domain.sync.notDeckOwner': {
    description: `${REASON_CONTEXT} A deck push skipped a deck because the signed-in Archidekt account does not own the remote deck. {deckId} is the numeric Archidekt deck id.`,
  },
  'domain.sync.ownershipUnknown': {
    description: `${REASON_CONTEXT} A deck push skipped a deck because the list of decks the signed-in Archidekt account owns came back incomplete, so Ritual cannot tell whether this deck is one of them. {deckId} is the numeric Archidekt deck id. {reason} is why the list is incomplete, one of the domain.sync.archidekt.pageRepeated / pageCapReached / nextLink* sentences, already in the reader's language.`,
  },
  'domain.sync.skipping': {
    description: `${LOG_CONTEXT} Warning logged under a deck the push skips. {reason} is a pre-rendered reason like domain.sync.notDeckOwner.`,
  },
  'domain.sync.divergenceUnchecked': {
    description: `${LOG_CONTEXT} Warning: the push could not check whether the Archidekt deck changed since the last sync (which normally protects remote edits), and goes ahead anyway. {reason} is a pre-rendered explanation like domain.sync.divergenceNoTimestamp.`,
  },
  'domain.sync.noChangesToUpload': {
    description: `${LOG_CONTEXT} Logged under a deck a push found already matching Archidekt.`,
  },
  'domain.sync.dryRunWouldPush': {
    description: `${LOG_CONTEXT} A deck push preview: {count} is the number of card changes a real run would send to the Archidekt deck. ${DRY_RUN_CONTEXT}`,
  },
  'domain.sync.pushedCardChanges': {
    description: `${LOG_CONTEXT} A deck push sent its card changes to the Archidekt deck. {count} is the number of card changes sent.`,
  },
  'domain.sync.pushFailed': {
    description:
      'Why a deck push failed: Archidekt rejected or did not answer the request carrying the card changes. {error} is the underlying error message.',
  },
  'domain.sync.updatedLastSynced': {
    description: `${LOG_CONTEXT} Logged after a deck push records the sync time in the deck file. "lastSynced" is the literal front-matter key and is not translated.`,
  },
  'domain.sync.divergenceNoTimestamp': {
    description:
      "Why a deck push could not check for remote edits: Archidekt's answer had no last-updated time. Shown inside domain.sync.divergenceUnchecked.",
  },
  'domain.sync.divergenceRemoteUnreadable': {
    description:
      "Why a deck push could not check for remote edits: Archidekt's last-updated time is not a date. {value} is the raw value Archidekt sent. Shown inside domain.sync.divergenceUnchecked.",
  },
  'domain.sync.divergenceLocalUnreadable': {
    description:
      'Why a deck push could not check for remote edits: the remote timestamp the deck file recorded at its last sync is not a date (the file was edited by hand). "sourceUpdatedAt" is the literal front-matter key. {value} is the raw value. Shown inside domain.sync.divergenceUnchecked.',
  },
  'domain.sync.diverged': {
    description:
      'Why a deck push refused a deck: someone changed the Archidekt deck after the last sync, and pushing would overwrite those edits. {remote} and {synced} are raw ISO timestamps. "--force" is a literal CLI flag.',
  },
  'domain.sync.deckUrlRequired': {
    description: 'Error from `deck-sync link` and the admin/MCP equivalents when no URL was given.',
  },
  'domain.sync.deckUrlInvalid': {
    description:
      'Error when the URL given to link a deck is not an Archidekt deck URL. {value} is what the user typed. The example URL is literal and is not translated.',
  },
  'domain.sync.linkMismatch': {
    description:
      'Error when a deck\'s front matter names one Archidekt deck in its URL and another in its id. {urlDeckId} and {sourceId} are the two deck ids. "sourceUrl" and "sourceId" are literal front-matter keys and are not translated.',
  },
  'domain.sync.skippingDeckFile': {
    description: `${LOG_CONTEXT} A deck file found while syncing every linked deck is skipped. {file} is the file name, {reason} an already-translated reason like domain.sync.missingSourceId.`,
  },
  'domain.sync.deckProblem': {
    description: `${LOG_CONTEXT} A deck the user named cannot be synced. {deck} is the deck name, {reason} an already-translated reason like domain.sync.notArchidekt.`,
  },
  'domain.sync.deckFileUnreadable': {
    description: `${REASON_CONTEXT} The deck file could not be read. {error} is the underlying error message. Also follows the deck in domain.sync.deckProblem, so it starts lowercase.`,
  },
  'domain.sync.frontMatterUnreadable': {
    description: `${REASON_CONTEXT} The deck file's front matter (the YAML header) could not be parsed. {error} is the parser's message. Also follows the deck in domain.sync.deckProblem and domain.sync.skippingDeckFile.`,
  },
  'domain.sync.missingSourceId': {
    description: `${REASON_CONTEXT} The deck names an Archidekt URL but not the deck id a sync needs. "sourceUrl" and "sourceId" are literal front-matter keys and are not translated. Also follows the deck in domain.sync.deckProblem and domain.sync.skippingDeckFile.`,
  },
  'domain.sync.notArchidekt': {
    description: `${REASON_CONTEXT} The deck the user named is not linked to an Archidekt deck. Also follows the deck in domain.sync.deckProblem.`,
  },
  'domain.sync.finishNotOffered': {
    description:
      'A deck push could not send a card: Archidekt does not offer the printing in the finish the local line states. {finish} is the local finish token (nonfoil, foil, etched), {card} the card and its printing, {valid} the finishes Archidekt does offer, in its own English spelling. None of the three is translated; {valid} ' +
      "is rendered as a list joined with the locale's own list pattern.",
  },
  'domain.sync.planCardMissing': {
    description:
      'A deck push could not act on a card: the parsed Archidekt deck lists it, but the raw data needed to change it is missing. {action} selects what the push was trying to do — remove the card, update its printing, update its quantity, or change its board (Main, Sideboard…). {card} is the card name with its printing.',
  },
  'domain.sync.boardMoveShortfall': {
    description:
      'A deck push could not move copies of a card between deck boards: the Archidekt deck does not hold enough of them on the source board. {count} is the number of copies, {card} the card with its printing, {board} a deck board name (Commander, Main, Sideboard, Maybeboard), interpolated untranslated.',
  },
  'domain.sync.noReadableListsToPush': {
    description: `${LOG_CONTEXT} Error: a collection push found no collection list it could read, and refuses to run because an empty local side would delete the whole Archidekt collection.`,
  },
  'domain.sync.noCollectionLists': {
    description: `${LOG_CONTEXT} A collection pull found no local collection lists; it still runs, and adds the remote cards to its target list.`,
  },
  'domain.sync.listUnreadable': {
    description: `${LOG_CONTEXT} Error, also the list's result reason: a collection list file could not be read. {list} is the list name, {error} the underlying error message.`,
  },
  'domain.sync.listGone': {
    description:
      'Error when a collection list the sync was about to read or write has disappeared from disk since the run started. {list} is the list name.',
  },
  'domain.sync.previewIncludesUnreadable': {
    description: `${LOG_CONTEXT} A preview run lists collection lists with unreadable lines above this line, and includes them; a real run would ask before syncing them.`,
  },
  'domain.sync.stateWriteFailed': {
    description: `${LOG_CONTEXT} Warning: the collection sync finished but could not save the time it ran. {error} is the underlying error message.`,
  },
  'domain.sync.stateNotObject': {
    description:
      'Why the collection-sync state file (which records the last collection sync) is unusable: its JSON is not an object. Shown only by `deck-sync status`, inside the parentheses of its "sync state unreadable" line.',
  },
  'domain.sync.stateMissingLastSynced': {
    description:
      'Why the collection-sync state file is unusable: it has no last-sync time. "lastSynced" is the literal JSON key and is not translated. Shown only by `deck-sync status`, inside the parentheses of its "sync state unreadable" line.',
  },
  'domain.sync.stateMissingUserId': {
    description:
      'Why the collection-sync state file is unusable: it has no numeric Archidekt user id. "userId" is the literal JSON key and is not translated. Shown only by `deck-sync status`, inside the parentheses of its "sync state unreadable" line.',
  },
  'domain.sync.stateMissingUsername': {
    description:
      'Why the collection-sync state file is unusable: it has no Archidekt username. "username" is the literal JSON key and is not translated. Shown only by `deck-sync status`, inside the parentheses of its "sync state unreadable" line.',
  },
  'domain.sync.stateInvalidJson': {
    description:
      'Why the collection-sync state file is unusable: it is not valid JSON. Shown only by `deck-sync status`, inside the parentheses of its "sync state unreadable" line, so it starts lowercase.',
  },
  'domain.sync.recordIncomplete': {
    description: `${LOG_CONTEXT} Warning: one record of the Archidekt collection lacks the card name, set code or collector number, so it is ignored. {recordId} is Archidekt's numeric record id.`,
  },
  'domain.sync.recordSkipped': {
    description: `${LOG_CONTEXT} Warning: one record of the Archidekt collection has a finish or condition Ritual cannot read, so it is ignored. {recordId} is Archidekt's numeric record id, {card} the card name, {reason} a pre-rendered explanation.`,
  },
  'domain.sync.recordUnknownLanguage': {
    description: `${LOG_CONTEXT} Warning: one record of the Archidekt collection has a language Ritual does not know, so it is read as English. {recordId} is Archidekt's numeric record id, {card} the card name, {languageId} Archidekt's raw language id.`,
  },
  'domain.sync.languageUnmappable': {
    description: `${LOG_CONTEXT} Warning during a collection push: Archidekt has no code for the card's language, so the record is created as English. {languageName} is the language's display name, {language} its short code (e.g. "ph"), {card} the card name with its set and collector number.`,
  },
  'domain.sync.pullAdditionsWithheld': {
    description: `${LOG_CONTEXT} Error during a collection pull: some collection lists could not be read, so the pull cannot tell which remote cards are already held locally and adds none. {count} is the number of copies withheld, {target} the list name they would have gone into.`,
  },
  'domain.sync.saveFailed': {
    description: `${LOG_CONTEXT} Error, also the list's result reason: a collection pull could not write a list file. {error} is the underlying error message.`,
  },
  'domain.sync.scryfallCacheUnreadable': {
    description: `${LOG_CONTEXT} Warning during a collection pull: the local Scryfall card cache could not be read, so pulled cards are written under Archidekt's spelling of their names. {error} is the underlying error message.`,
  },
  'domain.sync.pullTargetAmbiguous': {
    description: `Error: the list a collection pull adds cards to is named by more than one collection list. {name} is the name asked for; {matches} the matching list names, which ${LIST_CONTEXT} "--into" and "collectionSync.pullTarget" are a literal CLI flag and config key.`,
  },
  'domain.sync.dryRunCreateTarget': {
    description: `${LOG_CONTEXT} A pull preview: the list it adds cards to does not exist yet and a real run would create it. {name} is the list name. ${DRY_RUN_CONTEXT}`,
  },
  'domain.sync.createTargetFailed': {
    description:
      'Error: a collection pull could not create the list it adds cards to. {name} is the list name, {error} the underlying error message.',
  },
  'domain.sync.createdTarget': {
    description: `${LOG_CONTEXT} A collection pull created the list it adds cards to. {name} is the list name.`,
  },
  'domain.sync.ambiguousListShare': {
    description:
      'One entry of the list of collection lists holding copies of a card a pull wants to remove: {list} is the list name, {copies} how many copies it holds. Joined with the locale\'s "and" list separator into {lists} of domain.sync.ambiguousRemoval.',
  },
  'domain.sync.unplacedCopies': {
    description:
      'One entry of the list of copies an ambiguous removal could not place: {quantity} is the number of copies, {card} the card with its printing (never translated). The entries are joined with the locale\'s "and" list pattern.',
  },
  'domain.sync.ambiguousRemoval': {
    description: `${LOG_CONTEXT} Also shown on the admin Sync Collection page. Archidekt has fewer copies of a card than the local lists, but the copies are spread over several lists and nothing says which one lost them, so the pull does not guess. {quantity} is the number of copies to remove, {card} the card with its printing, {lists} the lists holding copies (domain.sync.ambiguousListShare entries joined with "and").`,
  },
  'domain.sync.priorityNoList': {
    description:
      'One problem with the removal priority (an ordered list of collection lists that decides which list loses ambiguous copies): no list has this name. {name} is the name the user gave. Lowercase: joined through domain.sync.clauseJoin into {problems} of domain.sync.priorityUnusable.',
  },
  'domain.sync.priorityAmbiguousList': {
    description: `One problem with the removal priority: several lists answer to this name. {name} is the name the user gave; {matches} the matching list names, which ${LIST_CONTEXT} Lowercase: joined through domain.sync.clauseJoin into {problems} of domain.sync.priorityUnusable.`,
  },
  'domain.sync.priorityUnusable': {
    description:
      'Error: the removal priority (an ordered list of collection lists that decides which list loses ambiguous copies) names lists that do not resolve. {problems} is one or more of domain.sync.priorityNoList / priorityAmbiguousList, joined through domain.sync.clauseJoin.',
  },
  'domain.sync.removingAmbiguous': {
    description: `${LOG_CONTEXT} A pull is placing an ambiguous removal: these copies leave this list. {quantity} is the number of copies, {card} the card with its printing, {list} the list name. {via} selects how the list was chosen: by the removal priority (an ordered list of lists the user configured), or by the user's answer to the ambiguity prompt.`,
  },
  'domain.sync.priorityCannotPlace': {
    description: `Error: the removal priority does not cover every ambiguous removal. {priority} is the list names of the priority, {cards} the copies left unplaced (domain.sync.unplacedCopies entries); both ${LIST_CONTEXT} ${NOTHING_WRITTEN_CONTEXT}`,
  },
  'domain.sync.ambiguityPreview': {
    description: `${LOG_CONTEXT} A pull preview, wrapped in domain.sync.dryRunLine: these removals are ambiguous and a real run would stop for a decision. {cards} is the copies (domain.sync.unplacedCopies entries), which ${LIST_CONTEXT}`,
  },
  'domain.sync.ambiguityUnresolved': {
    description: `Error: a pull met ambiguous removals and nobody could be asked which lists lose the copies. {cards} is the copies (domain.sync.unplacedCopies entries), which ${LIST_CONTEXT} ${NOTHING_WRITTEN_CONTEXT}`,
  },
  'domain.sync.ambiguityResolverFailed': {
    description: `Error: asking which lists lose ambiguous copies failed. {error} is the underlying error message. ${NOTHING_WRITTEN_CONTEXT}`,
  },
  'domain.sync.nothingWritten': {
    description: `Error: the user declined or cancelled the question about ambiguous removals. {message} is a complete, already-translated sentence saying which. ${NOTHING_WRITTEN_CONTEXT}`,
  },
  'domain.sync.ambiguityResolutionIncomplete': {
    description: `Error: the answer to the ambiguous-removal question did not account for every copy. {cards} is the copies left unplaced (domain.sync.unplacedCopies entries), which ${LIST_CONTEXT} ${NOTHING_WRITTEN_CONTEXT}`,
  },
  'domain.sync.pushRemovalsWithheld': {
    description: `${LOG_CONTEXT} Error during a collection push: some collection lists could not be read, so cards they hold would look deleted; the push removes nothing from Archidekt. {count} is the number of copies withheld.`,
  },
  'domain.sync.removeFromArchidektFailed': {
    description: `${REASON_CONTEXT} A collection push could not delete a card no local list holds any more from the Archidekt collection. ${CARD_CONTEXT}`,
  },
  'domain.sync.addFailed': {
    description: `${LOG_CONTEXT} Error, also the result reason of every list holding the card: a collection push could not create the Archidekt record. ${CARD_CONTEXT} {error} is the underlying error message.`,
  },
  'domain.sync.updateFailed': {
    description: `${LOG_CONTEXT} Error, also the result reason of every list holding the card: a collection push could not change the Archidekt record's quantity. ${CARD_CONTEXT} {error} is the underlying error message.`,
  },
  'domain.sync.removeFailed': {
    description: `${LOG_CONTEXT} Error, also the result reason of every list holding the card: a collection push could not delete the Archidekt records. ${CARD_CONTEXT} {error} is the underlying error message.`,
  },
  'domain.sync.nothingPushed': {
    description: `Error: the user declined or cancelled the question about uploading a push's additions as a CSV, or the card cache could not be readied for it. {message} is a complete, already-translated sentence saying why. ${NOTHING_PUSHED_CONTEXT}`,
  },
  'domain.sync.csvCachePrepareFailed': {
    description: `Error: a collection push needs the local Scryfall card cache to build its CSV upload, and preparing it failed. {error} is the underlying error message. ${NOTHING_PUSHED_CONTEXT}`,
  },
  'domain.sync.csvUndecided': {
    description: `Error from the admin and MCP surfaces: a collection push would add so many cards that adding them one by one is slow (one search request per card), and the request did not say to upload them as a CSV file instead. {count} is the number of cards (always above {threshold}, so the singular never shows in English), {threshold} the limit. ${NOTHING_PUSHED_CONTEXT}`,
  },
  'domain.sync.csvDeciderFailed': {
    description: `Error: asking whether to upload a push's many additions as a CSV failed. {count} is the number of cards (always large), {error} the underlying error message. ${NOTHING_PUSHED_CONTEXT}`,
  },
  'domain.sync.csvNoFile': {
    description: `Error: the user chose to write a push's additions to a CSV file but gave an empty file name. ${NOTHING_PUSHED_CONTEXT}`,
  },
  'domain.sync.dryRunCsvExport': {
    description: `${LOG_CONTEXT} A push preview: a real run would write the additions to a CSV file for the user to import by hand. ${CSV_SIZE_CONTEXT} {path} is the file path, {url} the Archidekt import page. ${DRY_RUN_CONTEXT}`,
  },
  'domain.sync.dryRunCsvUpload': {
    description: `${LOG_CONTEXT} A push preview: a real run would upload the additions to Archidekt as one CSV import. ${CSV_SIZE_CONTEXT} ${DRY_RUN_CONTEXT}`,
  },
  'domain.sync.csvWriteFailed': {
    description: `${LOG_CONTEXT} Error: the push could not write its additions CSV file. {path} is the file path, {error} the underlying error message.`,
  },
  'domain.sync.csvExported': {
    description: `${LOG_CONTEXT} A push wrote its additions to a CSV file instead of sending them; the user imports it by hand at the Archidekt page. ${CSV_SIZE_CONTEXT} {path} is the file path, {url} the Archidekt import page.`,
  },
  'domain.sync.csvUploading': {
    description: `${LOG_CONTEXT} Progress: the push is uploading its additions to Archidekt as a CSV import. ${CSV_SIZE_CONTEXT}`,
  },
  'domain.sync.csvUploadFailed': {
    description: `${LOG_CONTEXT} Error: the CSV upload failed as a whole. ${CSV_SIZE_CONTEXT} {error} is the underlying error message.`,
  },
  'domain.sync.csvChunkUnreadable': {
    description: `${LOG_CONTEXT} Warning: the CSV is uploaded in chunks, and Archidekt's answer for one of them could not be parsed, so its rows are assumed imported. {chunk} is the chunk number, {error} the parser's message, {body} Archidekt's raw response.`,
  },
  'domain.sync.csvRowsUnpaired': {
    description: `${LOG_CONTEXT} Warning: Archidekt refused some CSV rows that Ritual cannot tie back to a card, so the copies on them are counted as imported. {count} is the number of such rows.`,
  },
  'domain.sync.csvRowsRefused': {
    description: `${LOG_CONTEXT} Warning: Archidekt did not import some rows of the uploaded CSV. {failed} is how many rows it dropped, {count} how many the CSV had (the plural follows {count}), {reasons} the breakdown of why — domain.sync.csvReason* clauses like "2 not found, 1 ambiguous", which ${LIST_CONTEXT}`,
  },
  'domain.sync.csvRowNotImported': {
    description: `${LOG_CONTEXT} One CSV row Archidekt did not import, listed under domain.sync.csvRowsRefused; keep the two leading spaces, which indent it under that line. {card} is the card with its printing, or domain.sync.csvRow / csvRowEcho; {reason} is domain.sync.csvFailure* or Archidekt's own English message.`,
  },
  'domain.sync.csvMoreFailures': {
    description: `${LOG_CONTEXT} Ends the per-row list under domain.sync.csvRowsRefused once it reaches its length limit; keep the two leading spaces, which indent it under that line. {count} is how many further rows were not listed.`,
  },
  'domain.sync.csvCardsNotImported': {
    description: `${REASON_CONTEXT} Archidekt did not import some of the list's cards from the uploaded CSV. {count} is the number of cards.`,
  },
  'domain.sync.csvImported': {
    description: `${LOG_CONTEXT} The CSV upload finished. ${CSV_SIZE_CONTEXT} {requests} is a pre-rendered count of upload requests like "3 requests".`,
  },
  'domain.sync.csvSize': {
    description:
      'What an uploaded CSV covers, e.g. "30 cards (28 rows)". {cards} is a pre-rendered count of cards (copies) and {rows} a pre-rendered count of CSV rows (one per printing); two counts, so two plural messages.',
  },
  'domain.sync.csvRow': {
    description:
      'Names an uploaded CSV row that Archidekt reported but Ritual cannot tie to a card, in place of a card name. {row} is the 1-based row number.',
  },
  'domain.sync.csvRowEcho': {
    description:
      "domain.sync.csvRow with the row's text as Archidekt echoed it back. {row} is the 1-based row number, {line} the raw CSV line (not translated).",
  },
  'domain.sync.csvReasonNotFound': {
    description: `${CSV_REASON_CONTEXT} Rows whose card Archidekt could not find.`,
  },
  'domain.sync.csvReasonAmbiguous': {
    description: `${CSV_REASON_CONTEXT} Rows that matched more than one printing, so Archidekt imported none.`,
  },
  'domain.sync.csvReasonRejected': {
    description: `${CSV_REASON_CONTEXT} Rows Archidekt refused with an error message.`,
  },
  'domain.sync.csvReasonUnexplained': {
    description: `${CSV_REASON_CONTEXT} Rows Archidekt refused without saying why.`,
  },
  'domain.sync.csvFailureNotFound': {
    description:
      'Why one CSV row was not imported: Archidekt could not find the card. Follows the card name and a dash in domain.sync.csvRowNotImported, and appears on the admin Sync Collection page.',
  },
  'domain.sync.csvFailureAmbiguous': {
    description:
      'Why one CSV row was not imported: the row matched more than one printing (set and collector number), so Archidekt imported none. Follows the card name and a dash.',
  },
  'domain.sync.csvFailureUnexplained': {
    description:
      'Why one CSV row was not imported, when Archidekt refused it without any message. Follows the card name and a dash.',
  },
  'domain.sync.auth.loginFailed': {
    description: `${AUTH_FAILURE_CONTEXT} The login request (username and password) failed, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT}`,
  },
  'domain.sync.auth.loginFailedWithReason': {
    description: `${AUTH_FAILURE_CONTEXT} The login request (username and password) failed. ${AUTH_STATUS_CONTEXT} ${AUTH_REASON_CONTEXT}`,
  },
  'domain.sync.auth.loginReplyInvalid': {
    description: `${AUTH_FAILURE_CONTEXT} Archidekt accepted the login, but its reply did not hold the session it should (the tokens that keep the user signed in).`,
  },
  'domain.sync.auth.refreshFailed': {
    description: `${AUTH_FAILURE_CONTEXT} ${AUTH_REFRESH_CONTEXT} The refresh request failed, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT}`,
  },
  'domain.sync.auth.refreshFailedWithReason': {
    description: `${AUTH_FAILURE_CONTEXT} ${AUTH_REFRESH_CONTEXT} The refresh request failed. ${AUTH_STATUS_CONTEXT} ${AUTH_REASON_CONTEXT}`,
  },
  'domain.sync.auth.refreshNoAccessToken': {
    description: `${AUTH_FAILURE_CONTEXT} ${AUTH_REFRESH_CONTEXT} Archidekt answered the refresh, but its reply lacked the new access token (the credential the next requests need).`,
  },
  'domain.sync.auth.refreshed': {
    description: `${AUTH_LOG_CONTEXT} ${AUTH_REFRESH_CONTEXT} The refresh worked.`,
  },
  'domain.sync.auth.refreshError': {
    description: `${AUTH_LOG_CONTEXT} ${AUTH_REFRESH_CONTEXT} The refresh failed, so the user has to log in again. {error} is why — one of the other domain.sync.auth.* phrases already in the reader's language, or a network error (usually English).`,
  },
  'domain.sync.archidekt.deckFailed': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Reading one deck failed, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT} {deckId} is the deck's Archidekt number.`,
  },
  'domain.sync.archidekt.deckFailedWithReason': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Reading one deck failed. ${AUTH_STATUS_CONTEXT} {deckId} is the deck's Archidekt number. ${ARCHIDEKT_REASON_CONTEXT}`,
  },
  'domain.sync.archidekt.publicDecksFailed': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Reading the list of decks an Archidekt user has made public failed, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT} {username} is that Archidekt account name, never translated.`,
  },
  'domain.sync.archidekt.publicDecksFailedWithReason': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Reading the list of decks an Archidekt user has made public failed. ${AUTH_STATUS_CONTEXT} {username} is that Archidekt account name, never translated. ${ARCHIDEKT_REASON_CONTEXT}`,
  },
  'domain.sync.archidekt.ownDecksFailed': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Reading the list of the logged-in user's own decks failed, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT}`,
  },
  'domain.sync.archidekt.ownDecksFailedWithReason': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Reading the list of the logged-in user's own decks failed. ${AUTH_STATUS_CONTEXT} ${ARCHIDEKT_REASON_CONTEXT}`,
  },
  'domain.sync.archidekt.collectionPageFailed': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Reading one page of a user's card collection on Archidekt (served a page at a time) failed, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT} {page} is the page number and {userId} the Archidekt account number.`,
  },
  'domain.sync.archidekt.collectionPageFailedWithReason': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Reading one page of a user's card collection on Archidekt (served a page at a time) failed. ${AUTH_STATUS_CONTEXT} {page} is the page number and {userId} the Archidekt account number. ${ARCHIDEKT_REASON_CONTEXT}`,
  },
  'domain.sync.archidekt.searchFailed': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Archidekt's card search, run to find the printing to send, failed, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT} {card} is a card name, optionally followed by its printing like "(FDN:106)" — never translated.`,
  },
  'domain.sync.archidekt.searchFailedWithReason': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Archidekt's card search, run to find the printing to send, failed. ${AUTH_STATUS_CONTEXT} {card} is a card name, optionally followed by its printing like "(FDN:106)" — never translated. ${ARCHIDEKT_REASON_CONTEXT}`,
  },
  'domain.sync.archidekt.deckChangeFailed': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Sending card changes to a deck on Archidekt failed; none of that batch was applied, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT} {deckId} is the deck's Archidekt number.`,
  },
  'domain.sync.archidekt.deckChangeFailedWithReason': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Sending card changes to a deck on Archidekt failed; none of that batch was applied. ${AUTH_STATUS_CONTEXT} {deckId} is the deck's Archidekt number. ${ARCHIDEKT_REASON_CONTEXT}`,
  },
  'domain.sync.archidekt.recordCreateFailed': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Adding a new entry (a "record": one card printing, condition and finish, with a quantity) to the user's Archidekt collection failed, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT}`,
  },
  'domain.sync.archidekt.recordCreateFailedWithReason': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Adding a new entry (a "record": one card printing, condition and finish, with a quantity) to the user's Archidekt collection failed. ${AUTH_STATUS_CONTEXT} ${ARCHIDEKT_REASON_CONTEXT}`,
  },
  'domain.sync.archidekt.recordUpdateFailed': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Changing an existing entry (a "record") of the user's Archidekt collection failed, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT} {recordId} is Archidekt's number for that record.`,
  },
  'domain.sync.archidekt.recordUpdateFailedWithReason': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Changing an existing entry (a "record") of the user's Archidekt collection failed. ${AUTH_STATUS_CONTEXT} {recordId} is Archidekt's number for that record. ${ARCHIDEKT_REASON_CONTEXT}`,
  },
  'domain.sync.archidekt.recordsDeleteFailed': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Deleting entries ("records") from the user's Archidekt collection failed, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT} {records} is a count like "25 collection records", already in the reader's language.`,
  },
  'domain.sync.archidekt.recordsDeleteFailedWithReason': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Deleting entries ("records") from the user's Archidekt collection failed. ${AUTH_STATUS_CONTEXT} {records} is a count like "25 collection records", already in the reader's language. ${ARCHIDEKT_REASON_CONTEXT}`,
  },
  'domain.sync.archidekt.csvChunkFailed': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Uploading a CSV file of cards to the collection importer of Archidekt failed; the file goes up in parts, and this part failed, and Archidekt said nothing more. ${AUTH_STATUS_CONTEXT} {chunk} is the number of the part, counting from 1.`,
  },
  'domain.sync.archidekt.csvChunkFailedWithReason': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Uploading a CSV file of cards to the collection importer of Archidekt failed; the file goes up in parts, and this part failed. ${AUTH_STATUS_CONTEXT} {chunk} is the number of the part, counting from 1. ${ARCHIDEKT_REASON_CONTEXT}`,
  },
  'domain.sync.archidekt.publicDecksUnreadable': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Archidekt answered the request for the public decks of a user, but its reply could not be read. {username} is that Archidekt account name, never translated. ${ARCHIDEKT_UNREADABLE_CONTEXT}`,
  },
  'domain.sync.archidekt.ownDecksUnreadable': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Archidekt answered the request for the logged-in user's own decks, but its reply could not be read. ${ARCHIDEKT_UNREADABLE_CONTEXT}`,
  },
  'domain.sync.archidekt.deckUnreadable': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Archidekt answered the request for one deck, but its reply could not be read. {deckId} is the deck's Archidekt number. ${ARCHIDEKT_UNREADABLE_CONTEXT}`,
  },
  'domain.sync.archidekt.collectionPageUnreadable': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Archidekt answered the request for one page of a user's card collection, but its reply could not be read. {page} is the page number and {userId} the Archidekt account number. ${ARCHIDEKT_UNREADABLE_CONTEXT}`,
  },
  'domain.sync.archidekt.searchUnreadable': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} Archidekt answered its card search, run to find the printing to send, but its reply could not be read. {card} is a card name, optionally followed by its printing like "(FDN:106) [foil]" — never translated. ${ARCHIDEKT_UNREADABLE_CONTEXT}`,
  },
  'domain.sync.archidekt.searchUnreachable': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} The card search, run to find the printing to send, got no answer from Archidekt at all (the network failed). {card} is a card name, optionally followed by its printing like "(FDN:106) [foil]" — never translated. {error} is the network error, usually in English.`,
  },
  'domain.sync.archidekt.replyNotObject': {
    description:
      'Why a reply Archidekt sent could not be read: it was not a JSON object (structured data) at all. Follows a colon, so lowercase with no closing period. "JSON" stays literal.',
  },
  'domain.sync.archidekt.replyFieldInvalid': {
    description:
      'Why a reply Archidekt sent could not be read: a part Ritual needs was missing or of the wrong kind. {field} is the code name of that part, like `results` or `owner.username` or `cards[3].card.id`, never translated. Follows a colon, so lowercase with no closing period.',
  },
  'domain.sync.archidekt.pageItemUnreadable': {
    description:
      "Why a list Archidekt sent (of decks, of search results, of collection records) could not be read: one of its items lacked a part Ritual needs. {index} is the item's position, counting from 1, and {field} the code name of the missing part, like `id` or `oracleCard.name`, never translated. Follows a colon, so lowercase with no closing period.",
  },

  'domain.sync.archidekt.cardNotFound': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} The card search of Archidekt found no match for a card being sent to it, so that card cannot be synced. ${CARD_CONTEXT}`,
  },
  'domain.sync.archidekt.csvUnreadable': {
    description: `${ARCHIDEKT_FAILURE_CONTEXT} The CSV file of cards Ritual built for the collection importer of Archidekt could not be split into rows, so nothing was sent. {reason} is why, a CSV-reading phrase already in the reader's language.`,
  },
  'domain.sync.archidekt.pageRepeated': {
    description: `${ARCHIDEKT_WARNING_CONTEXT} A page linked to a page already read, which would loop forever, so reading stopped there. {decks} is a count like "50 decks", already in the reader's language.`,
  },
  'domain.sync.archidekt.pageCapReached': {
    description: `${ARCHIDEKT_WARNING_CONTEXT} Reading stopped at a fixed limit of pages, far more than any real account has. {pages} is a count like "100 pages" and {decks} one like "5,000 decks", both already in the reader's language.`,
  },
  'domain.sync.archidekt.nextLinkUnreadable': {
    description: `${ARCHIDEKT_WARNING_CONTEXT} The link was not a web address at all, so reading stopped and the list may be missing decks.`,
  },
  'domain.sync.archidekt.nextLinkForeign': {
    description: `${ARCHIDEKT_WARNING_CONTEXT} The link pointed away from Archidekt, so it was not followed (for safety) and the list may be missing decks. {host} is the host name of the other site, never translated.`,
  },
} as const satisfies MetaFor<typeof domainSyncMessages>
