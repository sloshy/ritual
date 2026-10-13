/**
 * `admin.api.*` — the prose the admin HTTP API *authors*: refusals, success
 * alerts, run summaries and the warnings a response carries.
 *
 * A fragment of the `admin` namespace, split out of `admin.ts` (the admin SPA's
 * own chrome) because the two are read on different surfaces: these keys are
 * rendered to English at the handler — that is what `message` carries,
 * unchanged, for MCP, `curl` and scripts — and re-rendered in the reader's
 * locale from `messageKey` + `messageParams` by the admin SPA (`useApiAction`,
 * `useApiText`). So the CLI barrel registers this fragment (the server renders
 * the English) and so does the admin SPA (`src/i18n/register/admin.ts`).
 *
 * Request field names (`cardId`, `contentHash`, `removalAssignments`), query
 * parameter names, JSON shapes (passed as `{shape}`), route paths and literal
 * values like `"url"` or `'true'` are wire vocabulary and stay as they are
 * inside the sentences that mention them.
 */

import type { MessageCatalogShape } from '../../types'

export const adminApiMessages = {
  // ── First-run setup ───────────────────────────────────────────────────
  'admin.api.setup.tokenInvalid':
    'That setup token is not right. Use the setup link `ritual admin` printed when it started, or run `ritual admin setup`.',

  // ── List lifecycle ────────────────────────────────────────────────────
  //
  // Verb + noun concatenation does not survive case or gender, so the list
  // type selects a whole sentence rather than splicing a noun in.
  'admin.api.list.created': {
    $select: 'listType',
    deck: "Created deck '{name}'",
    collection: "Created collection '{name}'",
    wanted: "Created wanted list '{name}'",
    other: "Created list '{name}'",
  },
  'admin.api.list.renamed': {
    $select: 'listType',
    deck: "Renamed deck to '{name}'",
    collection: "Renamed collection to '{name}'",
    wanted: "Renamed wanted list to '{name}'",
    other: "Renamed list to '{name}'",
  },
  'admin.api.list.deleted': {
    $select: 'listType',
    deck: "Deleted deck '{name}'; its files are in {trash}",
    collection: "Deleted collection '{name}'; its files are in {trash}",
    wanted: "Deleted wanted list '{name}'; its files are in {trash}",
    other: "Deleted list '{name}'; its files are in {trash}",
  },

  // ── One-shot operations ───────────────────────────────────────────────
  'admin.api.move.moved': {
    $plural: 'count',
    one: 'Moved {count} card.',
    other: 'Moved {count} cards.',
  },
  'admin.api.save.saved': 'Saved {count} changes to {name}',
  'admin.api.save.artUnreconciled':
    "The list's custom art was left as it is — it could not be read: {reason}",
  'admin.api.save.lineBreak':
    'The request field "{field}" contains a line break; card names, printings, sections, and list names must be single-line text.',
  'admin.api.save.categoriesUnreconciled':
    'The card lines were saved, but the categories sidecar could not be updated: {reason}',
  'admin.api.load.categoriesUnreadable':
    'The list’s categories sidecar could not be read, so no categories are reported: {reason}',
  'admin.api.load.categoriesStaleNames':
    'Categories are recorded for cards this list no longer holds: {names}.',
  'admin.api.art.set': "Set custom art on '{name}'",
  'admin.api.art.cleared': "Cleared custom art on '{name}'",
  'admin.api.buildSite.built': 'Site built successfully',
  'admin.api.buildSite.cancelled': 'The site build was cancelled.',
  'admin.api.cache.refreshed': 'Cache refreshed successfully',
  'admin.api.history.saved': {
    $plural: 'count',
    one: 'Saved {count} change set.',
    other: 'Saved {count} change sets.',
  },
  'admin.api.move.removed': {
    $plural: 'count',
    one: 'Removed {count} card.',
    other: 'Removed {count} cards.',
  },

  // ── Archidekt session ─────────────────────────────────────────────────
  'admin.api.archidekt.loggedIn': 'Logged in as {username}',
  'admin.api.archidekt.credentialsRequired': 'username and password are required',

  // ── Deck sync run summary ─────────────────────────────────────────────
  //
  // A run summary is assembled from clauses joined with `Intl.ListFormat` and
  // terminated by the renderer, so **no clause carries final punctuation** —
  // see `src/admin/api/sync-summary.ts`.
  'admin.api.deckSync.loginRequired':
    'Not signed into Archidekt. Sign in to sync decks with Archidekt.',
  'admin.api.deckSync.noDecks': 'No Archidekt decks found to sync',
  'admin.api.deckSync.previewed': {
    $plural: 'count',
    one: 'Previewed {count} deck',
    other: 'Previewed {count} decks',
  },
  'admin.api.deckSync.pulled': {
    $plural: 'count',
    one: 'Pulled {count} deck',
    other: 'Pulled {count} decks',
  },
  'admin.api.deckSync.pushed': {
    $plural: 'count',
    one: 'Pushed {count} deck',
    other: 'Pushed {count} decks',
  },
  'admin.api.deckSync.skipped': '{count} skipped',
  'admin.api.deckSync.failed': '{count} failed',
  'admin.api.deckSync.cancelled': {
    $plural: 'count',
    one: 'cancelled with {count} deck not started',
    other: 'cancelled with {count} decks not started',
  },

  // ── Collection sync run summary ───────────────────────────────────────
  'admin.api.collectionSync.loginRequired':
    'Not signed into Archidekt. Sign in to sync your collection with Archidekt.',
  'admin.api.collectionSync.accountRequired':
    'The stored Archidekt login does not name an account. Sign in to Archidekt again to record it.',
  'admin.api.collectionSync.noLists': 'No collection lists found to sync',
  'admin.api.collectionSync.totals': {
    $select: 'action',
    previewed: 'Previewed +{added} added, -{removed} removed',
    pulled: 'Pulled +{added} added, -{removed} removed',
    pushed: 'Pushed +{added} added, -{removed} removed',
    other: 'Synced +{added} added, -{removed} removed',
  },
  'admin.api.collectionSync.totalsInto': {
    $select: 'action',
    previewed: 'Previewed +{added} added, -{removed} removed into "{into}"',
    pulled: 'Pulled +{added} added, -{removed} removed into "{into}"',
    pushed: 'Pushed +{added} added, -{removed} removed into "{into}"',
    other: 'Synced +{added} added, -{removed} removed into "{into}"',
  },
  'admin.api.collectionSync.pending': '{count} awaiting a manual CSV upload',
  'admin.api.collectionSync.filtered': '{count} filtered out',
  'admin.api.collectionSync.ambiguous': {
    $plural: 'count',
    one: '{count} ambiguous removal',
    other: '{count} ambiguous removals',
  },
  'admin.api.collectionSync.listsFailed': {
    $plural: 'count',
    one: '{count} list failed',
    other: '{count} lists failed',
  },
  'admin.api.collectionSync.errors': {
    $plural: 'count',
    one: '{count} error',
    other: '{count} errors',
  },
  'admin.api.collectionSync.cancelled': {
    $plural: 'count',
    one: 'cancelled with {count} list not started',
    other: 'cancelled with {count} lists not started',
  },

  // ── Requests the server refuses before a route runs ───────────────────
  'admin.api.server.forbidden': 'Forbidden',
  'admin.api.server.setupRequired': 'Setup required. Create an admin account first.',
  'admin.api.server.unauthorized': 'Unauthorized',
  'admin.api.server.notFound': 'Not Found',
  'admin.api.server.internalError': 'Internal server error',

  // ── Sign-in ───────────────────────────────────────────────────────────
  'admin.api.login.rateLimited': 'Too many failed attempts. Try again later.',
  'admin.api.login.credentialsRequired': 'Username and password are required',
  'admin.api.login.inputTooLong': 'Input exceeds maximum length',
  'admin.api.login.invalidCredentials': 'Invalid username or password',
  'admin.api.login.totpRequired': 'TOTP code required',
  'admin.api.login.totpMisconfigured': 'TOTP configuration error',
  'admin.api.login.totpInvalid': 'Invalid TOTP code',

  // ── First-run account ─────────────────────────────────────────────────
  'admin.api.setup.userExists': 'Admin user already exists',
  'admin.api.setup.credentialsRequired': 'username and password are required',
  'admin.api.setup.usernameTooLong': 'Username is too long',
  'admin.api.setup.passwordTooLong': 'Password is too long',
  'admin.api.setup.passwordTooShort': {
    $plural: 'count',
    one: 'Password must be at least {count} character',
    other: 'Password must be at least {count} characters',
  },
  'admin.api.setup.created': 'Admin account created successfully',

  // ── Two-factor authentication ─────────────────────────────────────────
  'admin.api.totp.alreadyEnabled': 'TOTP is already enabled. Disable it first to reconfigure.',
  'admin.api.totp.codeRequired': 'code is required',
  'admin.api.totp.noPendingSetup': 'No pending TOTP setup. Call /api/totp/setup first.',
  'admin.api.totp.codeInvalid': 'Invalid TOTP code. Check your authenticator app and try again.',
  'admin.api.totp.enabled': 'TOTP enabled successfully',
  'admin.api.totp.notEnabled': 'TOTP is not enabled',
  'admin.api.totp.disabled': 'TOTP disabled successfully',

  // ── Addressing a list ─────────────────────────────────────────────────
  'admin.api.target.typeInvalid': 'Invalid or missing list type',
  'admin.api.target.slugRequired': 'List slug is required',
  'admin.api.target.slugInvalid': 'Invalid list slug',
  'admin.api.listNotFound': "List '{list}' not found",
  'admin.api.listTypeInvalid': "Invalid list type '{type}'",
  'admin.api.list.notFound': {
    $select: 'listType',
    deck: "Deck '{slug}' not found",
    collection: "Collection '{slug}' not found",
    wanted: "Wanted list '{slug}' not found",
  },
  'admin.api.list.notFoundListRoute': {
    $select: 'listType',
    deck: "Deck '{slug}' not found. Use GET /api/lists to see the available slugs.",
    collection: "Collection '{slug}' not found. Use GET /api/lists to see the available slugs.",
    wanted: "Wanted list '{slug}' not found. Use GET /api/lists to see the available slugs.",
  },
  'admin.api.list.slugInvalid': {
    $select: 'listType',
    deck: 'Invalid deck slug',
    collection: 'Invalid collection slug',
    wanted: 'Invalid wanted list slug',
  },
  'admin.api.list.nameRequired': {
    $select: 'listType',
    deck: 'Deck name is required',
    collection: 'Collection name is required',
    wanted: 'Wanted list name is required',
  },
  'admin.api.list.newNameRequired': {
    $select: 'listType',
    deck: 'New deck name is required',
    collection: 'New collection name is required',
    wanted: 'New wanted list name is required',
  },
  'admin.api.list.confirmNameRequired': 'confirmName is required',

  // ── Loading a list ────────────────────────────────────────────────────
  'admin.api.load.limitInvalid': "Invalid limit '{value}'. Use a positive integer.",
  'admin.api.load.offsetInvalid': "Invalid offset '{value}'. Use a non-negative integer.",
  'admin.api.cardIndex.listTypeInvalid': "Invalid list type '{value}'. Use one of: {choices}.",
  'admin.api.cardIndex.slugInvalid': "Invalid list slug '{slug}'.",

  // ── Saving a list ─────────────────────────────────────────────────────
  'admin.api.save.conflict': {
    $select: 'listType',
    deck: 'Deck has been modified since you loaded it. Please reload.',
    collection: 'Collection has been modified since you loaded it. Please reload.',
    wanted: 'Wanted list has been modified since you loaded it. Please reload.',
  },
  'admin.api.save.fieldsRequired':
    'changes and contentHash are required. A filtered or paged load returns "partial": true and no contentHash — reload the list without section/nameContains/limit/offset to get one.',
  'admin.api.save.frontMatterUnreadable':
    "The deck's front matter could not be read ({reason}). Fix it before saving.",
  'admin.api.save.frontMatterNotMapping':
    "The deck's front matter could not be read (not a mapping). Fix it before saving.",
  'admin.api.save.idPastCeiling':
    'changes[{index}] claims &{id}, past the {ceiling} this save could allocate.',

  // ── The local card cache ──────────────────────────────────────────────
  'admin.api.cache.empty': {
    $select: 'need',
    prices:
      'The card cache is empty; prices are unavailable. Refresh it first (MCP: the refresh_cache tool; CLI: `ritual cache preload-all`).',
    buylist:
      'The card cache is empty; buylist matching requires it. Refresh it first (MCP: the refresh_cache tool; CLI: `ritual cache preload-all`).',
  },
  'admin.api.cardNames.coldCache':
    'The local card cache is empty, so card names cannot be validated. Refresh it first (MCP: the refresh_cache tool; CLI: `ritual cache preload-all`), or omit validateCardNames.',
  'admin.api.cardNames.unknown': "'{name}' is not a card name the local cache knows.",
  'admin.api.cardNames.unknownSuggested':
    "'{name}' is not a card name the local cache knows. Did you mean: {candidates}?",

  // ── Settings ──────────────────────────────────────────────────────────
  'admin.api.config.unknownKey': 'Unknown config key "{key}"',
  'admin.api.config.notString': '"{key}" must be a string',
  'admin.api.config.unknownAdminKey': 'Unknown admin config key "{key}"',

  // ── Custom card art ───────────────────────────────────────────────────
  'admin.api.art.unknownField': "Unknown field '{field}'. Accepted fields: cardId, art.",
  'admin.api.art.cardIdInvalid': 'cardId must be a card line’s &N id (a positive integer).',
  'admin.api.art.artRequired':
    'art is required — an object with a "file" or "url", or null to clear the card’s art.',
  'admin.api.art.staleIds':
    '{file}: custom art is set for cards that are no longer in this list: {ids}.',
  'admin.api.art.listNotFound': {
    $select: 'listType',
    deck: "No deck named '{slug}'",
    collection: "No collection named '{slug}'",
    wanted: "No wanted list named '{slug}'",
  },
  'admin.api.art.cardNotInList': {
    $select: 'listType',
    deck: "Card {cardId} is not in deck '{slug}'.",
    collection: "Card {cardId} is not in collection '{slug}'.",
    wanted: "Card {cardId} is not in wanted list '{slug}'.",
  },
  'admin.api.art.imageMissing': 'No image at {path}.',

  // ── List metadata ─────────────────────────────────────────────────────
  'admin.api.metadata.lastSyncedReadOnly':
    'lastSynced is stamped by deck sync and cannot be edited.',
  'admin.api.metadata.unknownField': "Unknown metadata field '{field}'. Accepted fields: {fields}.",
  'admin.api.metadata.tagsInvalid': 'tags must be an array of strings or null.',
  'admin.api.metadata.tagsBlank': 'tags must be an array of non-empty strings.',
  'admin.api.metadata.sourceIdInvalid': 'sourceId must be a non-empty string or null.',
  'admin.api.metadata.sourceUrlInvalid': 'sourceUrl must be an http(s) URL.',

  // ── Moving and removing cards ─────────────────────────────────────────
  'admin.api.move.movesRequired': 'moves array is required',
  'admin.api.move.invalidMove': 'Invalid move request',
  'admin.api.move.removesRequired': 'removes array is required',
  'admin.api.move.invalidRemove': 'Invalid remove request',
  'admin.api.move.toSectionDeckOnly': 'toSection is only valid when the destination is a deck.',

  // ── Comparing lists ───────────────────────────────────────────────────
  'admin.api.diff.sidesRequired': "Query parameters 'a' and 'b' are required ([type:]name).",

  // ── Prices and the sell report ────────────────────────────────────────
  'admin.api.sell.refInvalid': "Invalid list reference '{ref}' (expected type:slug)",
  'admin.api.sell.noRefs': "No list references in 'lists'",

  // ── Request fields, any route ─────────────────────────────────────────
  'admin.api.field.notBoolean': '{field} must be a boolean.',
  'admin.api.field.notString': '{field} must be a string.',

  // ── Export ────────────────────────────────────────────────────────────
  'admin.api.export.columnsNotArray': 'columns must be an array of property names.',
  'admin.api.export.filtersNotObject': 'filters must be an object.',
  'admin.api.export.conditionsNotArray': 'filters.conditions must be an array of condition values.',
  'admin.api.export.labelsNotArray': 'filters.labels must be an array of label values.',
  'admin.api.export.presetUnknown':
    "No export preset named '{name}'. Available presets: {presets}.",
  'admin.api.export.cardsInvalid': 'cards must be an array of search-term strings.',
  'admin.api.export.listsNotArray': 'lists must be an array of {shape} objects.',
  'admin.api.export.listNameMissing': 'Each list needs a name.',
  'admin.api.export.listTypeInvalid': "Invalid list type '{type}'.",

  // ── Change history ────────────────────────────────────────────────────
  'admin.api.history.setsRequired': 'sets array is required',
  'admin.api.history.setNotObject': 'Each change set must be an object',
  'admin.api.history.timestampInvalid': 'Each change set needs a valid ISO-8601 timestamp',
  'admin.api.history.linesInvalid': 'Each change set needs a lines array of strings',
  'admin.api.history.linesEmpty': 'Each change set must have at least one change line',
  'admin.api.history.lineInvalid': 'Every change line must start with "- " and be a single line',
  'admin.api.history.eventsMissing': 'Each change set needs an events array',
  'admin.api.history.eventInvalid': 'Set #{set} event #{event} {problem}',
  'admin.api.history.eventCountMismatch':
    'Each change set needs one event per change line (or none, for a legacy set)',
  'admin.api.history.trailingInvalid': 'A change set trailing field must be an array of strings',
  'admin.api.history.trailingMultiline': 'Trailing lines must each be a single line',
  'admin.api.history.trailingLooksLikeChange':
    'Trailing lines must not look like change lines or "## " headers',
  'admin.api.history.trailingOpenFence': 'Trailing lines must not leave a code fence open',

  // ── Site build ────────────────────────────────────────────────────────
  'admin.api.buildSite.busy': 'A site build is already running; wait for it to finish.',
  'admin.api.buildSite.stepStarting': 'Starting site build…',
  'admin.api.buildSite.stepBuilding': 'Building…',
  'admin.api.buildSite.stepPublishing': 'Publishing to dist/…',
  'admin.api.buildSite.failed': 'Site build failed (exit {code}).',
  'admin.api.buildSite.failedWithOutput': 'Site build failed (exit {code}). {output}',

  // ── Deck import ───────────────────────────────────────────────────────
  'admin.api.importDeck.modeRequired':
    'Invalid request: expected mode "url" (with url) or "text" (with content)',
  'admin.api.importDeck.urlRequiredForMode': 'url is required for mode "url"',
  'admin.api.importDeck.syncPrintingsRequired':
    'syncPrintings is required for a URL import and must be a boolean: true keeps the exact printings (set, collector number, finish) the source lists, false imports bare card names',
  'admin.api.importDeck.contentRequiredForMode': 'content is required for mode "text"',
  'admin.api.importDeck.syncPrintingsUrlOnly':
    'syncPrintings only applies to URL imports; pasted text states its own printings',
  'admin.api.importDeck.urlRequired': 'url is required',
  'admin.api.importDeck.contentRequired': 'content is required',
  'admin.api.importDeck.defaultName': 'Imported Deck',
  'admin.api.importDeck.noCardLines': 'No valid card lines found in the provided text.',
  'admin.api.importDeck.cancelled': 'Import cancelled',
  'admin.api.importDeck.imported': "Successfully imported '{name}'{notes}",
  // The four notes below each open with their own " — " separator: they are
  // appended, in order, to `admin.api.importDeck.imported`'s {notes}.
  'admin.api.importDeck.skippedNote': {
    $plural: 'count',
    one: ' — {count} line could not be parsed and was skipped',
    other: ' — {count} lines could not be parsed and were skipped',
  },
  'admin.api.importDeck.labelsDroppedNote': {
    $plural: 'count',
    one: ' — {count} line was imported without its labels',
    other: ' — {count} lines were imported without their labels',
  },
  'admin.api.importDeck.categoryNotesNote': {
    $plural: 'count',
    one: ' — {count} note about its categories',
    other: ' — {count} notes about its categories',
  },
  'admin.api.importDeck.misreadNote': {
    $plural: 'count',
    one: ' — {count} line may not have been understood',
    other: ' — {count} lines may not have been understood',
  },

  // ── CSV import ────────────────────────────────────────────────────────
  'admin.api.importCsv.invalidRequest':
    'Invalid request: expected listType ({types}), name, content, and columns (with optional mode [{modes}], format, hasHeader)',
  'admin.api.importCsv.nameRequired': 'name is required',
  'admin.api.importCsv.formatRequired': 'format is required when creating or overwriting a deck',
  'admin.api.importCsv.parseFailed': 'Failed to parse CSV: {reason}',
  'admin.api.importCsv.headerSkipped': 'Skipped header row: {row}',
  'admin.api.importCsv.headerSuspicious':
    'The first row does not look like a header but was skipped as one: {row} — set hasHeader to false to import it as a card.',
  'admin.api.importCsv.noDataRows': 'CSV contains no data rows',
  'admin.api.importCsv.imported': {
    $select: 'listType',
    deck: "Imported {cards} into deck '{name}'",
    collection: "Imported {cards} into collection '{name}'",
    wanted: "Imported {cards} into wanted list '{name}'",
  },
  'admin.api.importCsv.appended': {
    $select: 'listType',
    deck: "Appended {cards} to deck '{name}'",
    collection: "Appended {cards} to collection '{name}'",
    wanted: "Appended {cards} to wanted list '{name}'",
  },
  'admin.api.importCsv.partial': '{result}; {failed}',
  'admin.api.importCsv.rowsFailed': {
    $plural: 'count',
    one: '{count} row failed validation',
    other: '{count} rows failed validation',
  },

  // ── Change-bundle import ──────────────────────────────────────────────
  'admin.api.importChanges.applied': 'Applied {changes} across {lists}',
  'admin.api.importChanges.appliedWithFailures': {
    $plural: 'count',
    one: 'Applied {changes}; {count} list failed',
    other: 'Applied {changes}; {count} lists failed',
  },
  'admin.api.importChanges.requestFailed': 'Request failed (HTTP {status})',
  'admin.api.importChanges.unhandledKind': 'Unhandled list kind (this is a bug)',
  'admin.api.importChanges.targetOmitted': "bundleTargets omitted {kind} '{name}'",

  // ── Sync requests (decks and collection) ──────────────────────────────
  'admin.api.sync.invalidBody': 'Invalid request body',
  'admin.api.sync.progressItem': 'Syncing {item}',
  'admin.api.sync.directionRequired': 'direction is required ({first} or {second})',
  'admin.api.sync.queryFlagInvalid': "{field} must be 'true' or 'false'",
  'admin.api.sync.namesNotArray': {
    $select: 'names',
    deck: '{field} must be an array of deck names',
    collection: '{field} must be an array of collection list names',
  },
  'admin.api.sync.namesAllBlank': '{field} must not hold only blank names',
  'admin.api.sync.namesBlank': '{field} must not contain blank names',
  'admin.api.collectionSync.listNameInvalid': '{field} must be a collection list name',
  'admin.api.collectionSync.choiceNotObject': '{field} must be an object with list and copies',
  'admin.api.collectionSync.copiesInvalid': '{field} must be a whole number of at least 1',
  'admin.api.collectionSync.assignmentsNotArray': 'removalAssignments must be an array of {shape}',
  'admin.api.collectionSync.assignmentsNotJson':
    'removalAssignments must be a JSON-encoded array of {shape}',
  'admin.api.collectionSync.assignmentNotObject': '{field} must be an object with key and choices',
  'admin.api.collectionSync.assignmentKeyInvalid': "{field} must be the ambiguous removal's key",
  'admin.api.collectionSync.choicesInvalid': '{field} must be a non-empty array of {shape}',
  'admin.api.collectionSync.strategyConflict':
    'removalPriority and removalAssignments are two ways to settle the same removals; send one or the other.',
  'admin.api.collectionSync.csvFileUnsupported':
    'csvFile is not supported over HTTP: use the CLI’s --csv-file to write a CSV, or csv: true to upload the additions.',
} as const satisfies MessageCatalogShape
