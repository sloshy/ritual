/**
 * `cli.*` messages for the infrastructure commands — cache, serve, build-site, admin, mcp, skills, config.
 *
 * A fragment of the cli namespace, split out purely so the command surfaces can
 * be converted independently without contending for one file. Every key still
 * begins with `cli.`, and a translator sees one flat catalog.
 *
 * Two things these commands print are deliberately **not** here:
 *
 * - the files `init-site` generates (README, workflow YAML, `.gitignore`) — they
 *   are repository artifacts, English by contract like `.changes.md`;
 * - everything the MCP server and the installed skills say — LLM-facing prose,
 *   English by contract.
 */

import type { MessageCatalogShape } from '../../types'

export const cliInfraMessages = {
  // ── cache status ──────────────────────────────────────────────────────
  //
  // Row labels of the `cache status` text report. The column is padded to the
  // widest label with `padEndDisplay`, so a longer translation widens the
  // column rather than breaking the alignment.
  'cli.cache.rowEmpty': 'Empty',
  'cli.cache.rowCardNames': 'Card names',
  'cli.cache.rowLastCardRefresh': 'Last card refresh',
  'cli.cache.rowPriceAgeHours': 'Price age (hours)',
  'cli.cache.rowPricesStale': 'Prices stale',
  'cli.cache.rowTagsPresent': 'Tags present',
  'cli.cache.rowSource': 'Source',
  'cli.cache.rowDefaultLanguage': 'Default language',
  'cli.cache.rowCardBulk': 'Card bulk',
  'cli.cache.rowBulkStale': 'Bulk stale',
  'cli.cache.valueNever': 'never',
  'cli.cache.valueNotApplicable': 'n/a',
  'cli.cache.valueUnrecorded': 'unrecorded',

  // ── cache preload ─────────────────────────────────────────────────────
  'cli.cache.preloadingSet': "Preloading set '{set}'...",
  'cli.cache.preloadSetFailed': "Failed to preload set '{set}': {reason}",
  'cli.cache.preloadSetNotFound':
    "No cards found for set '{set}' — check the set code (see https://scryfall.com/sets).",
  'cli.cache.preloadSetNoPrintings':
    "Set '{set}' matched {counted}, none of which are real printings (token and Art Series sets are not cached).",
  'cli.cache.preloadSetDone': "Successfully cached {count} cards for set '{set}'",
  'cli.cache.preloadAllFailed': 'Failed to preload card cache: {reason}',
  'cli.cache.preloadAllBuylistFailed':
    'The card cache was updated, but the Card Kingdom buylist was not: {reason}',
  'cli.cache.refreshTagsFailed': 'Failed to refresh tags: {reason}',

  // ── cache feed ────────────────────────────────────────────────────────
  //
  // Every line below is printed behind the feed's own log prefix, which is a
  // machine marker and is never translated.
  'cli.cacheFeed.invalidCards': "--cards must be one of: 'default', 'all', 'both'.",
  'cli.cacheFeed.initialFeedFailed': 'Initial feed generation failed: {error}',
  'cli.cacheFeed.refreshFailed': 'Refresh failed ({reason}); serving the existing feed.',
  'cli.cacheFeed.seedStartFailed': 'Failed to start seeding: {error}',
  'cli.cacheFeed.seedingTorrents': 'Seeding {count} torrents.',
  'cli.cacheFeed.seedingTorrentsOnPort': 'Seeding {count} torrents on TCP port {port}.',
  'cli.cacheFeed.serverStartFailed': 'Failed to start the feed server: {error}',
  'cli.cacheFeed.scheduledRefreshFailed': 'Scheduled feed refresh failed: {error}',
  'cli.cacheFeed.listening': 'Feed server listening on {url}',
  'cli.cacheFeed.publicUrl': 'Public URL: {url}',
  'cli.cacheFeed.seedingDisabled':
    'BitTorrent seeding disabled (--no-seed); serving over HTTP only.',
  'cli.cacheFeed.syncing': 'Syncing from {url}',
  'cli.cacheFeed.syncFailed': 'Feed sync failed: {error}',
  'cli.cacheFeed.ingested': 'Card cache updated from the feed.',
  'cli.cacheFeed.unchanged': 'Feed is unchanged; card cache is already current.',
  'cli.cacheFeed.seedingArtifacts': 'Seeding {count} artifacts. Press Ctrl+C to stop.',
  'cli.cacheFeed.seedingArtifactsOnPort':
    'Seeding {count} artifacts on TCP port {port}. Press Ctrl+C to stop.',
  'cli.cacheFeed.scheduledRecheckFailed': 'Scheduled feed re-check failed: {error}',
  'cli.cacheFeed.feedChanged': 'Feed changed; card cache updated.',
  'cli.cacheFeed.stopping': 'Stopping seeding...',

  // ── cache feed host ───────────────────────────────────────────────────
  //
  // What `cache feed host` prints while it publishes the feed and seeds it,
  // and the errors a refresh raises. Feed kinds (`default-cards`), Scryfall
  // bulk types (`default_cards`), file names, info hashes and ISO timestamps
  // are machine values.
  'cli.cacheFeed.loadedExisting': 'Loaded existing feed (generated {generatedAt}).',
  'cli.cacheFeed.artifactMissing': 'Artifact {file} is missing on disk; redownloading.',
  'cli.cacheFeed.downloadingBulk': 'Downloading {kind} (updated {updatedAt})...',
  'cli.cacheFeed.upToDate': 'Feed is up to date.',
  'cli.cacheFeed.published': {
    $plural: 'count',
    one: 'Published feed with {count} entry.',
    other: 'Published feed with {count} entries.',
  },
  'cli.cacheFeed.pruning': 'Pruning stale artifact {file}',
  'cli.cacheFeed.seedingArtifact': 'Seeding {name} ({infoHash})',
  'cli.cacheFeed.manifestEntryMissing': "Bulk manifest has no usable '{bulkType}' entry",
  'cli.cacheFeed.suspiciousFileName': "Refusing suspicious bulk file name '{file}'",
  'cli.cacheFeed.bulkDownloadFailed': 'Failed to download the {kind} bulk: {status} {statusText}',
  'cli.cacheFeed.bulkNoBody': 'Bulk download for {kind} has no body',
  'cli.cacheFeed.requestFailed': 'Feed request failed: {error}',

  // ── cache feed client ─────────────────────────────────────────────────
  //
  // What a fetching client (`cache feed sync`, a feed-backed refresh, the cache
  // server) prints behind the same `[cache-feed]` prefix, and the errors its
  // download raises. File names, info hashes, sha256 digests, URLs and feed
  // kinds (`all-cards`, `default-cards`) are machine values.
  'cli.cacheFeed.ignoringState': 'Ignoring {file}: {reason}',
  'cli.cacheFeed.ignoringUnreadable': 'Ignoring unreadable {file} (not valid JSON).',
  'cli.cacheFeed.fetchFailed': 'Failed to fetch cache feed {url} (HTTP {status})',
  'cli.cacheFeed.fetchFailedWithBody': 'Failed to fetch cache feed {url} (HTTP {status}): {body}',
  'cli.cacheFeed.missingEntry': "Cache feed has no '{kind}' entry",
  'cli.cacheFeed.missingAllCardsEntry':
    "Cache feed has no '{kind}' entry (the configured defaultLanguage needs the all_cards bulk, which this feed's host does not publish — host with `cache feed host --cards all` or refresh with --source scryfall)",
  'cli.cacheFeed.reusing': 'Reusing already-downloaded {file}.',
  'cli.cacheFeed.restoring': 'Restoring missing artifact {file}...',
  'cli.cacheFeed.stoppedSeeding': 'Stopped seeding superseded artifact {name} ({infoHash})',
  'cli.cacheFeed.hashMismatch': "Downloaded {file} does not match the feed's sha256 (got {hash})",
  'cli.cacheFeed.downloadingHttp': 'Downloading {file} over HTTP...',
  'cli.cacheFeed.downloadFailed': 'Failed to download feed artifact {url} (HTTP {status})',
  'cli.cacheFeed.downloadFailedWithBody':
    'Failed to download feed artifact {url} (HTTP {status}): {body}',
  'cli.cacheFeed.downloadNoBody': 'Download of {file} has no body',
  'cli.cacheFeed.downloadingTorrent': 'Downloading {file} over BitTorrent...',
  'cli.cacheFeed.torrentTimedOut': 'Torrent download of {file} timed out',
  'cli.cacheFeed.completed': {
    $plural: 'count',
    one: 'Completed {file} ({count} peer).',
    other: 'Completed {file} ({count} peers).',
  },
  'cli.cacheFeed.torrentFetchFailed': 'Failed to fetch torrent {url} (HTTP {status})',
  'cli.cacheFeed.torrentFetchFailedWithBody':
    'Failed to fetch torrent {url} (HTTP {status}): {body}',
  'cli.cacheFeed.torrentClientError': 'Torrent client error: {error}',
  'cli.cacheFeed.torrentNotReady': 'Torrent {infoHash} did not become ready in time',

  // Why a fetched feed document, or a client's saved `state.json`, was
  // rejected. JSON field names (`generatedAt`, `entries`, `ingested`,
  // `infoHash`, `ingestedAt`, `length`) are machine vocabulary.
  'cli.cacheFeed.feedNotObject': 'Invalid cache feed: expected an object',
  'cli.cacheFeed.feedVersionUnsupported':
    'Invalid cache feed: unsupported version {version} (expected {expected})',
  'cli.cacheFeed.feedMissingGeneratedAt': 'Invalid cache feed: missing string generatedAt',
  'cli.cacheFeed.feedMissingEntries': 'Invalid cache feed: missing entries array',
  'cli.cacheFeed.feedEntryNotObject': 'Invalid cache feed: entry {index} is not an object',
  'cli.cacheFeed.feedEntryUnknownKind':
    "Invalid cache feed: entry {index} has unknown kind '{kind}'",
  'cli.cacheFeed.feedEntryMissingField':
    'Invalid cache feed: entry {index} is missing a string {field}',
  'cli.cacheFeed.feedEntryBadLength':
    'Invalid cache feed: entry {index} is missing a positive numeric length',
  'cli.cacheFeed.stateNotObject': 'Invalid feed-client state: expected an object',
  'cli.cacheFeed.stateMissingIngested': 'Invalid feed-client state: missing ingested map',
  'cli.cacheFeed.stateUnknownKind': "Invalid feed-client state: unknown kind '{kind}'",
  'cli.cacheFeed.stateEntryInvalid':
    "Invalid feed-client state: entry for '{kind}' is missing a string infoHash/ingestedAt",

  // ── cache freshness gates ─────────────────────────────────────────────
  //
  // The prompts and progress lines the commands that need the card cache print
  // before they run (`add-card`, `edit`, `price`, `sell`, `build-site`,
  // `serve --api`, `admin` at startup). Commands, flags, config keys and
  // Scryfall bulk names (`default_cards`, `all_cards`) are machine vocabulary.
  'cli.cacheGate.emptyAdvice':
    '{lead} Run `ritual cache preload-all` first, or re-run with --refresh auto to download it.',
  'cli.cacheGate.bulkMismatch': {
    $select: 'required',
    all_cards:
      "The card cache was built from Scryfall's '{recorded}' bulk, but the configured defaultLanguage '{language}' needs the every-language 'all_cards' bulk.",
    default_cards:
      "The card cache was built from Scryfall's '{recorded}' bulk, but the configured defaultLanguage 'en' only needs the English-only 'default_cards' bulk.",
  },
  'cli.cacheGate.bulkMismatchConfirm': '{reason} Redownload the card cache now?',
  'cli.cacheGate.bulkMismatchRefreshing': '{reason} Redownloading the card cache...',
  'cli.cacheGate.staleConfirm': 'Card cache is {age} old. Would you like to update it?',
  'cli.cacheGate.emptyForAutocomplete':
    'Card cache is empty. A preloaded cache is required for card autocomplete.',
  'cli.cacheGate.downloadDatabaseConfirm': 'Would you like to download the card database now?',
  'cli.cacheGate.pricesStaleRefreshing':
    'Cached prices are more than a day old. Refreshing the card cache from Scryfall...',
  'cli.cacheGate.uploadConfirm': '{reason} Update it before uploading?',
  'cli.cacheGate.emptyWithRequirement': 'Card cache is empty. {requirement}',
  'cli.cacheGate.downloadNowConfirm': 'Would you like to download it now?',
  'cli.cacheGate.pricingRequirement': 'Pricing requires the Scryfall card database.',
  'cli.cacheGate.stalePriceCount': {
    $plural: 'count',
    one: '{stale} of {count} card has prices older than 24 hours.',
    other: '{stale} of {count} cards have prices older than 24 hours.',
  },
  'cli.cacheGate.bulkFasterHint':
    'Redownloading the Scryfall bulk card cache (includes fresh prices) would be faster than refreshing each card individually.',
  'cli.cacheGate.redownloadConfirm': 'Redownload the latest Scryfall card cache now?',
  'cli.cacheGate.continuingWithExisting': '{reason} Continuing with the existing cache.',
  'cli.cacheGate.tagsConfirm':
    'The card cache has no oracle/art tags (used by the site’s tag filters). Download them now?',
  'cli.cacheGate.tagsSkipped':
    "Skipping tag download; the site's tag filters will be empty. Run `ritual cache refresh-tags` later to add them.",
  'cli.cacheGate.tagsFetching': 'Fetching oracle/art tags from Scryfall...',
  'cli.cacheGate.tagsFailed': "Could not download tags; the site's tag filters will be empty.",
  'cli.cacheGate.tagsAdded': 'Added oracle/art tags to the card cache.',
  'cli.cacheGate.pricesAgeConfirm': 'Prices were last updated {age} ago. Update now?',

  // ── cache lock ────────────────────────────────────────────────────────
  //
  // The cache-write lock (`.ritual-cache-lock`) one Ritual process holds while
  // it writes the card cache. Printed by the CLI and in the cache server's and
  // admin server's console. The lock file's fields (`pid`, `hostname`,
  // `createdAt`, `operation`) are machine vocabulary.
  'cli.cacheLock.invalidJson': 'Invalid cache lock: not valid JSON',
  'cli.cacheLock.notObject': 'Invalid cache lock: expected an object',
  'cli.cacheLock.missingField': {
    $select: 'field',
    pid: 'Invalid cache lock: missing numeric pid',
    hostname: 'Invalid cache lock: missing string hostname',
    createdAt: 'Invalid cache lock: missing numeric createdAt',
    operation: 'Invalid cache lock: missing string operation',
  },
  'cli.cacheLock.breakingStale': 'Breaking stale cache lock ({reason}).',
  'cli.cacheLock.holderGone': 'holder pid {pid} is no longer running or exceeded the stale age',
  'cli.cacheLock.waiting':
    'Cache is locked by "{operation}" (pid {pid}). Waiting up to {timeout} for it to finish...',

  // ── cache store ───────────────────────────────────────────────────────
  //
  // The local card cache's own housekeeping, printed by the CLI and in the
  // servers' consoles.
  'cli.cacheStore.oldSchemaReset':
    'Detected old cache schema (single objects). Resetting cards cache.',
  'cli.cacheStore.invalidFormatReset': 'Detected invalid cache format. Resetting cache.',
  'cli.cacheStore.loadFailed': 'Failed to load cache, starting fresh.',
  'cli.cacheStore.saveFailed': 'Failed to save cache:',
  'cli.cacheStore.blocklisted': "Card '{name}' added to blocklist (expires {expires}).",
  'cli.cacheStore.unblocklisted': "Card '{name}' removed from blocklist (expired).",
  'cli.cacheStore.bulkWeekOld': 'Card cache bulk download is more than a week old. Refreshing...',
  'cli.cacheStore.bulkNever':
    'Card cache has never been bulk-downloaded. Downloading from Scryfall...',
  'cli.cacheStore.manyMissing':
    'Over {threshold} cards not found in cache. Triggering bulk cache refresh...',
  'cli.cacheStore.feedUnchanged': 'Cache feed is unchanged; card cache is current.',
  'cli.cacheStore.feedFallback': 'Feed refresh failed ({reason}); falling back to Scryfall.',
  'cli.cacheStore.provenanceNotObject': 'Invalid card-bulk provenance: expected an object',
  'cli.cacheStore.provenanceUnknownBulk':
    "Invalid card-bulk provenance: unknown bulkType '{bulkType}'",
  'cli.cacheStore.provenanceMissingRecordedAt':
    'Invalid card-bulk provenance: missing string recordedAt',

  // ── Scryfall client ───────────────────────────────────────────────────
  //
  // The Scryfall client's console lines: card lookups, the bulk refresh's
  // log, the tag bake and the cache feed's ingest. Printed by the CLI and in
  // the cache server's, cache feed host's and admin server's consoles. What a
  // server route answers with lives in `domain.cache.*` instead. Scryfall bulk
  // names (`oracle_tags`, `art_tags`) and JSON field names are literal.
  'cli.scryfall.fetchingSymbology': 'Fetching symbology from Scryfall...',
  'cli.scryfall.symbolDownloadFailed': 'Failed to download symbol {symbol}',
  'cli.scryfall.evictFailed': "Failed to evict excluded printings for '{name}':",
  'cli.scryfall.fetchingCard': 'Fetching: {name}',
  'cli.scryfall.arenaOnly': "Card '{name}' is arena-only, skipping.",
  'cli.scryfall.cardFetchFailed': "Failed to fetch card '{name}': {status} {statusText}",
  'cli.scryfall.cardFetchError': "Error fetching card '{name}':",
  'cli.scryfall.cachePrintingsFailed': "Failed to cache printings for '{name}':",
  'cli.scryfall.searching': 'Searching for: {query}',
  'cli.scryfall.imageDownloadFailed': 'Failed to download image from {url}:',
  'cli.scryfall.fetchingTagMetadata': 'Fetching tag bulk metadata from Scryfall...',
  'cli.scryfall.noTagBulkUris': 'Could not find oracle_tags / art_tags bulk data URIs',
  'cli.scryfall.downloadingTags': 'Downloading oracle and art tags...',
  'cli.scryfall.tagBulkFetchFailed': 'Failed to fetch tag bulk {url}: {status} {statusText}',
  'cli.scryfall.tagBulkNoBody': 'Tag bulk response for {url} has no body',
  'cli.scryfall.tagDownloadFailed': 'Failed to download tags: {reason}',
  'cli.scryfall.indexedTags': 'Indexed tags for {oracleIds} and {illustrations}.',
  'cli.scryfall.oracleIdCount': {
    $plural: 'count',
    one: '{count} oracle id',
    other: '{count} oracle ids',
  },
  'cli.scryfall.illustrationCount': {
    $plural: 'count',
    one: '{count} illustration',
    other: '{count} illustrations',
  },
  'cli.scryfall.reattachingTags': {
    $plural: 'count',
    one: 'Re-attaching tags to {count} cached card...',
    other: 'Re-attaching tags to {count} cached cards...',
  },
  'cli.scryfall.tagsRefreshed': 'Done! Tags refreshed.',
  'cli.scryfall.bulkUrl': 'Bulk URL: {url}',
  'cli.scryfall.skippedMalformed': {
    $plural: 'count',
    one: 'Skipped {count} malformed bulk card entry.',
    other: 'Skipped {count} malformed bulk card entries.',
  },
  'cli.scryfall.filteredOut': {
    $plural: 'count',
    one: 'Filtered out {count} printing ({breakdown}).',
    other: 'Filtered out {count} printings ({breakdown}).',
  },
  'cli.scryfall.excludedArenaOnly': {
    $plural: 'count',
    one: '{count} arena-only',
    other: '{count} arena-only',
  },
  'cli.scryfall.excludedTokens': {
    $plural: 'count',
    one: '{count} token',
    other: '{count} tokens',
  },
  'cli.scryfall.excludedArtSeries': {
    $plural: 'count',
    one: '{count} art-series',
    other: '{count} art-series',
  },
  'cli.scryfall.processedCards': {
    $plural: 'count',
    one: 'Processed {count} card.',
    other: 'Processed {count} cards.',
  },
  'cli.scryfall.buildingTagIndex': 'Building tag index from downloaded tag bulks...',
  'cli.scryfall.tagBuildFailed': 'Failed to build tags from downloaded bulks: {reason}',
  'cli.scryfall.feedIngestDone': 'Done! Card cache populated from downloaded artifacts.',
  'cli.scryfall.tagBulkNotArray': 'Invalid tag bulk: expected a JSON array',
  'cli.scryfall.tagBulkEntryNotObject': 'Invalid tag bulk: entry {index} is not an object',
  'cli.scryfall.tagBulkMissingField': {
    $select: 'field',
    object: 'Invalid tag bulk: entry {index} is missing a string object',
    id: 'Invalid tag bulk: entry {index} is missing a string id',
    label: 'Invalid tag bulk: entry {index} is missing a string label',
    slug: 'Invalid tag bulk: entry {index} is missing a string slug',
  },
  'cli.scryfall.tagBulkBadType': "Invalid tag bulk: entry {index} has unexpected type '{type}'",
  'cli.scryfall.tagIndexNotObject': 'Invalid tag index: expected an object',
  'cli.scryfall.tagIndexMissingField': {
    $select: 'field',
    updatedAt: 'Invalid tag index: missing numeric updatedAt',
    oracle: 'Invalid tag index: missing oracle map',
    illustration: 'Invalid tag index: missing illustration map',
  },

  // ── --cache-server ────────────────────────────────────────────────────
  'cli.cacheServer.addressEmpty':
    'Cache server must be a non-empty hostname and port (example: localhost:4000).',
  'cli.cacheServer.addressInvalid':
    'Cache server must include hostname and port (example: localhost:4000 or http://localhost:4000).',

  // ── cache server / cache feed flags ───────────────────────────────────
  'cli.cache.refreshIntervalInvalid':
    "Refresh interval must be one of: 'daily', 'weekly', 'monthly'.",
  'cli.cache.feedUrlEmpty': '"--url" requires a value',
  'cli.cache.feedUrlNeedsFeedSource': "--url only applies when the cache source is 'feed'.",

  // ── cache server (operator log) ───────────────────────────────────────
  //
  // Every line below is printed behind the server's own `[cache-server]`
  // prefix, which is a machine marker and is never translated. A line ending in
  // a colon has the error object printed after it.
  'cli.cacheServer.cacheUpdate': 'cache update: {fields}',
  'cli.cacheServer.requestFailed': 'Cache server request failed:',
  'cli.cacheServer.feedSyncFailed': 'Feed sync failed; falling back to Scryfall:',
  'cli.cacheServer.feedUnchanged': 'Cache feed is unchanged; cards are current.',
  'cli.cacheServer.seedFailed': 'Seeding feed artifacts failed (cards already ingested):',
  'cli.cacheServer.scryfallRefreshFailed': 'Refreshing cards from Scryfall failed:',
  'cli.cacheServer.startupRefresh': {
    $select: 'reason',
    empty: 'Running startup cards refresh (empty, source: {source})...',
    stale: 'Running startup cards refresh (stale, source: {source})...',
    seed: 'Running startup cards refresh (seed, source: {source})...',
  },
  'cli.cacheServer.cardsRefreshEnabled': {
    $select: 'cadence',
    daily: 'Scheduled cards cache refresh enabled: daily',
    weekly: 'Scheduled cards cache refresh enabled: weekly',
    monthly: 'Scheduled cards cache refresh enabled: monthly',
  },
  'cli.cacheServer.cardsRefreshComplete': 'Scheduled cards cache refresh complete.',
  'cli.cacheServer.cardsRefreshFailed': 'Scheduled cards cache refresh failed:',
  'cli.cacheServer.pricesRefreshEnabled': {
    $select: 'cadence',
    daily: 'Scheduled prices cache refresh enabled: daily',
    weekly: 'Scheduled prices cache refresh enabled: weekly',
    monthly: 'Scheduled prices cache refresh enabled: monthly',
  },
  'cli.cacheServer.priceBucketFailed': 'Scheduled price refresh bucket failed:',
  'cli.cacheServer.priceRefreshFailed': "Scheduled price refresh failed for '{key}':",
  'cli.cacheServer.startFailed': 'Failed to start the cache server:',
  'cli.cacheServer.httpDenied': 'HTTP requests denied (--deny-http).',
  'cli.cacheServer.feedDisabled': 'Feed mode disabled by --deny-http.',
  'cli.cacheServer.verbose': 'Verbose request logging enabled.',
  'cli.cacheServer.seeding': 'Seeding feed artifacts.',
  'cli.cacheServer.seedingOnPort': 'Seeding feed artifacts on TCP port {port}.',
  'cli.cacheServer.listening': 'Cache server listening on {url}',

  // ── --base-dir ────────────────────────────────────────────────────────
  'cli.baseDir.missing': 'base directory does not exist: {path}',
  'cli.baseDir.notDirectory': 'base directory is not a directory: {path}',
  'cli.baseDir.unreadable': 'base directory is not readable: {path} — {reason}',

  // ── config ────────────────────────────────────────────────────────────
  //
  // The property name and the rendered value are machine vocabulary; only the
  // frame around them is translated. `(unset)` and `(default)` are markers a
  // reader scans for, so each lives in its own whole line rather than being
  // concatenated onto a shared one.
  'cli.config.set': 'Set {property} = {value}',
  'cli.config.notSet': '"{property}" is not set.',
  'cli.config.entry': '{property} = {value}',
  'cli.config.entryDefault': '{property} = {value} (default)',
  'cli.config.entryUnset': '{property} = (unset)',
  'cli.config.reset': 'Reset {property} to default ({value})',
  'cli.config.unset': 'Unset {property}',
  'cli.config.unknownProperty':
    'Unknown property: "{property}". Available properties: {properties}',
  'cli.config.noValues': 'At least one value must be provided.',
  'cli.config.fieldType': {
    $select: 'type',
    string: 'string',
    boolean: 'boolean',
    number: 'number',
  },
  'cli.config.addRemoveScalar':
    '--add and --remove can only be used with array properties. "{property}" is a {typeName}.',
  'cli.config.tooManyValues': {
    $plural: 'count',
    one: '"{property}" is a {typeName} and only accepts one value, but {count} was provided.',
    other: '"{property}" is a {typeName} and only accepts one value, but {count} were provided.',
  },
  'cli.config.expectsBoolean':
    '"{property}" expects a boolean. Use "true" or "false", got "{value}".',
  'cli.config.expectsNumberEmpty': '"{property}" expects a number, got an empty string.',
  'cli.config.expectsNumber': '"{property}" expects a number, got "{value}".',
  'cli.config.expectsInteger': '"{property}" expects an integer, got "{value}".',
  'cli.config.expectsNonNegativeInteger':
    '"{property}" expects a non-negative integer, got "{value}".',
  'cli.config.siteManaged': {
    $select: 'verb',
    set: 'The "site" property is managed by "ritual init-site" and cannot be set with "config set", except for the public-site selection lists: {properties}.',
    unset:
      'The "site" property is managed by "ritual init-site" and cannot be unset with "config unset", except for the public-site selection lists: {properties}.',
  },
  'cli.config.managedOwned': {
    $select: 'verb',
    set: 'The "managed" property is owned by Ritual and cannot be set with "config set"; "ritual init-site" and "ritual migrate" keep it up to date.',
    unset:
      'The "managed" property is owned by Ritual and cannot be unset with "config unset"; "ritual init-site" and "ritual migrate" keep it up to date.',
  },

  // ── serve ─────────────────────────────────────────────────────────────
  'cli.serve.building': 'Building site...',
  'cli.serve.buildFailed': 'Build failed: {reason}',
  'cli.serve.noBuiltSite':
    'No built site found in {dir}. Build it first with `ritual build-site{outDirFlag}`, or re-run this command with --build.',
  'cli.serve.cacheImagesNote':
    'Note: live data always uses Scryfall image URLs; --cache-images only affects static assets.',
  'cli.serve.emptyCardCache':
    'Card cache is empty — card search will return no results until the cache is preloaded.',
  'cli.serve.servingWithApi': 'Serving site + live API from {dir} at {url}...',
  'cli.serve.serving': 'Serving site from {dir} at {url}...',
  'cli.serve.cacheDownloadFailed':
    'Card cache download failed; serving from the existing cache. {reason}',
  'cli.serve.startFailed': 'Failed to start the server on {host}:{port}: {error}',

  // ── admin ─────────────────────────────────────────────────────────────
  'cli.admin.mcpTokenRequired':
    '--mcp requires a bearer token: pass --mcp-token <secret> or set RITUAL_MCP_TOKEN.',
  'cli.admin.mcpPortConflict': '--mcp-port must differ from the admin --port.',
  'cli.admin.preparing': 'Preparing admin interface...',
  'cli.admin.ready': 'Admin interface ready.',
  'cli.admin.serverRunning': 'Ritual Admin running at {url}',
  'cli.admin.serverError': 'Unhandled server error:',
  'cli.admin.setupRequired':
    'No admin account yet. Create it at:\n  {url}\n(or run `ritual admin setup` in this workspace)',
  'cli.admin.teardownFailedMcp': 'MCP HTTP server teardown failed:',
  'cli.admin.teardownFailedAdmin': 'Admin server teardown failed:',
  'cli.admin.jsBuildFailed': 'Admin SPA JS build failed',
  'cli.admin.cssBuildFailed': 'Admin SPA CSS build failed',
  'cli.admin.cssBuildNoOutput': 'Admin SPA CSS build produced no .css output',
  'cli.admin.promptPassword': 'Password',
  'cli.admin.passwordCancelled': 'Password entry cancelled.',
  'cli.admin.usernameTooLong': 'Username is too long',
  'cli.admin.passwordTooLong': 'Password is too long',
  'cli.admin.passwordTooShort': 'Password must be at least {min} characters',
  'cli.admin.noUser': "No admin user exists. Run 'ritual admin setup' to create one.",
  'cli.admin.usernameRequired': '--username is required.',
  'cli.admin.userExists': 'Admin user already exists',
  'cli.admin.userCreated': "Admin user '{username}' created.",
  'cli.admin.passwordReset': "Password reset for admin user '{username}'.",
  'cli.admin.totpNotEnabled': 'TOTP is not enabled',
  'cli.admin.totpDisabled': 'TOTP disabled.',

  // ── build-site: flag and file parsing ─────────────────────────────────
  'cli.theme.unknown': "Unknown theme '{value}'. Choose one of: {choices}.",
  'cli.buildSite.themeFileUnreadable': "Failed to read --theme-file '{path}': {reason}",
  'cli.buildSite.themeFileNotJson': "--theme-file '{path}' is not valid JSON: {reason}",
  'cli.buildSite.themeFileInvalid': "--theme-file '{path}': {reason}",
  'cli.buildSite.spaBuildFailed': 'Site SPA {ext} build failed',
  'cli.buildSite.spaBuildNoOutput': 'Site SPA build produced no {ext} output',
  'cli.buildSite.outDirBlank': '--out-dir requires a directory path.',
  'cli.buildSite.outDirIsBase':
    "--out-dir may not be the Ritual directory itself ({base}) — it is the site's output directory: a build replaces it wholesale, and serving it would publish your lists.",
  'cli.buildSite.outDirContainsBase':
    "--out-dir may not contain the Ritual directory ({dir} contains {base}) — it is the site's output directory: a build replaces it wholesale, and serving it would publish your lists.",
  'cli.buildSite.previousBuildNotRemoved': 'Could not remove the previous site build at {path}.',
  'cli.buildSite.localeFileNotJson': 'not valid JSON: {reason}',
  'cli.buildSite.localeFileNotObject':
    'a locale file must be a JSON object of message keys to message values',
  'cli.buildSite.localeFileBadValue': 'key "{key}": {reason}',
  'cli.buildSite.localeFileBadTag':
    "--locale-file '{path}': {reason}. The file name is the locale tag, e.g. de-AT.json.",
  'cli.buildSite.localeFileUnreadable': "Failed to read --locale-file '{path}': {reason}",
  'cli.buildSite.localeFileInvalid': "--locale-file '{path}': {reason}",
  'cli.buildSite.localeInvalid': "--locale '{value}': {reason}",
  'cli.buildSite.localesInvalid': "--locales '{value}': {reason}",
  'cli.buildSite.localesUnknown':
    "--locales names '{tag}', which this build has no dictionary for. Load one with --locale-file <path>, or bake it in with RITUAL_BUNDLED_LOCALES.",
  'cli.buildSite.bakedLocaleUndictionaried':
    '⚠️  No dictionary for the baked locale \'{tag}\'; the site will render English text under <html lang="{tag}">. Load one with --locale-file <path>.',
  'cli.buildSite.storesNotEnabled':
    '--price-sources {stores} names no store priceSources enables (priceSources: {sources}). Enable it first, e.g. `ritual config set priceSources --add cardhoarder`.',
  'cli.buildSite.storesNoneEnabled':
    '--price-sources {stores} names no store priceSources enables (priceSources enables none). Enable one first, e.g. `ritual config set priceSources --add cardhoarder`.',
  'cli.buildSite.selectionFlagEmpty': '{flag} requires at least one name.',

  // ── build-site: list kinds ────────────────────────────────────────────
  //
  // The three list categories, as the build's own sentences name them —
  // lower-case and singular, unlike `domain.listTypeSingular.*`, which titles
  // a tab. Each sentence that mentions a kind is a `$select` rather than a
  // frame with a `{kind}` noun spliced in: the noun is gendered in most target
  // languages, so the words around it have to move with it.
  'cli.buildSite.loadFailed': {
    $select: 'kind',
    deck: "Failed to load deck '{name}': {reason}",
    collection: "Failed to load collection '{name}': {reason}",
    wanted: "Failed to load wanted list '{name}': {reason}",
  },
  'cli.buildSite.skippedEntry': {
    $select: 'kind',
    deck: "  - deck '{name}': {reason}",
    collection: "  - collection '{name}': {reason}",
    wanted: "  - wanted list '{name}': {reason}",
  },
  'cli.buildSite.sourceMissing': {
    $select: 'kind',
    deck: 'no deck named that in {dir}',
    collection: 'no collection named that in {dir}',
    wanted: 'no wanted list named that in {dir}',
  },
  'cli.buildSite.sourceAmbiguous': 'matches {counted} ({matches}) — name one exactly',
  'cli.buildSite.includeUnmatched': {
    $select: 'kind',
    deck: "⚠️  site.{configKey} lists '{name}', which matches no deck in {dir} — it may have been renamed or removed.",
    collection:
      "⚠️  site.{configKey} lists '{name}', which matches no collection in {dir} — it may have been renamed or removed.",
    wanted:
      "⚠️  site.{configKey} lists '{name}', which matches no wanted list in {dir} — it may have been renamed or removed.",
  },
  'cli.buildSite.foundSources': 'Found {counted}: {names}',

  // ── build-site: progress and results ──────────────────────────────────
  'cli.buildSite.skippedHeader': '⚠️  {counted} could not be built:',
  'cli.buildSite.publishedWithout': 'The site was published without them.',
  'cli.buildSite.leftUnchanged': 'The published site was left unchanged.',
  'cli.buildSite.nothingToBuild':
    'Nothing to build: no decks, collections, or wanted lists were found. Create one with `ritual new deck "My Deck"` (or run `ritual edit`), then build again.',
  'cli.buildSite.starting': 'Building static site...',
  'cli.buildSite.cachingImages': 'Caching deck card images locally and using dist/images paths.',
  'cli.buildSite.usingImageUrls':
    'Using Scryfall image URLs from card data and skipping deck image downloads.',
  'cli.buildSite.fetchingSymbols': 'Fetching and downloading mana symbols...',
  'cli.buildSite.noSymbology':
    '⚠️  No cached symbology and --refresh never: mana symbols will be missing from the site. Re-run with --refresh auto to download them.',
  'cli.buildSite.symbolDownloadFailed': 'Failed to download symbol {symbol}:',
  'cli.buildSite.refreshingSymbology': 'Found new symbols in text. Refreshing symbology...',
  'cli.buildSite.loadingDecks': 'Loading decks...',
  'cli.buildSite.loadingCollections': 'Loading collections...',
  'cli.buildSite.loadingWantedLists': 'Loading wanted lists...',
  'cli.buildSite.loadedDeck': '  - Loaded {name}',
  'cli.buildSite.loadedList': '  - Loaded {name} ({counted}, ${price})',
  'cli.buildSite.sourceWarning': '  ⚠️  {name}: {warning}',
  'cli.buildSite.noValidEntries': '  {name}: no valid entries, skipping',
  'cli.buildSite.uniqueCards': 'Found {count} unique cards.',
  'cli.buildSite.cacheDownloadFailed':
    'Card cache download failed; building with the existing cache. {reason}',
  'cli.buildSite.fetchListHeader': 'Fetch List ({count}):',
  'cli.buildSite.fetchListEntry': ' - {name}',
  'cli.buildSite.allCardsCached': 'All cards are cached.',
  'cli.buildSite.fetchingData': 'Fetching data...',
  'cli.buildSite.noPricing': "⚠️  '{name}' has no {currency} pricing.",
  'cli.buildSite.noCardsToPrice':
    'No cards to price: every selected list is empty, so there is nothing to build.',
  'cli.buildSite.noPriceData': 'No price data found in the card cache.',
  'cli.buildSite.buylistReady': 'Card Kingdom buylist ready ({counted}).',
  'cli.buildSite.buylistUnavailable':
    '⚠️  Sell mode is on but the Card Kingdom buylist is unavailable, so the site is built without buy prices. {reason}',
  'cli.buildSite.artCopied': 'Copied {counted} of custom art.',
  'cli.buildSite.artMissing': '  ⚠️  Custom art file not found in {dir}: {path}',
  'cli.buildSite.artSidecarFailed': '  ⚠️  Custom art could not be read: {reason}',
  'cli.buildSite.artCopyFailed': '  ⚠️  Custom art file {path} could not be copied: {reason}',
  'cli.buildSite.artSourceUnreadable': '  ⚠️  Custom art file {path} could not be read: {reason}',
  'cli.buildSite.generatingData': 'Generating data files...',
  'cli.buildSite.writingApp': 'Writing Web App...',
  'cli.buildSite.writingLocales': 'Writing {counted} of UI text (locale: {locale})...',
  'cli.buildSite.writingCss': 'Writing CSS (initial theme: {theme})...',
  'cli.buildSite.writingCssCustom': 'Writing CSS (initial theme: {theme}, +{count} custom)...',
  'cli.buildSite.done': 'Site generated in {dir}',

  // ── init-site ─────────────────────────────────────────────────────────
  'cli.initSite.cancelled': 'Cancelled.',
  'cli.initSite.distDirRequired': 'Expected a directory path for --dist-dir.',
  'cli.initSite.promptOverwrite': '{path} already exists. Overwrite?',
  'cli.initSite.promptSkills':
    'Install Ritual agent skills into .claude/skills so coding agents can work with this repository?',
  'cli.initSite.promptPriceSource': 'Default price store?',
  'cli.initSite.priceSourceCurrency': 'Prices in {currency}',
  'cli.initSite.priceSourceCurrent': '{store} (current)',
  'cli.initSite.promptCi': 'Which CI system are you using?',
  'cli.initSite.ciGithubActions': 'GitHub Actions',
  'cli.initSite.ciGithubActionsHint':
    'Generate a GitHub Actions workflow that builds and deploys automatically',
  'cli.initSite.ciManual': 'Manual / None',
  'cli.initSite.ciManualHint': 'No CI integration — build and deploy manually',
  'cli.initSite.promptDeploy': 'How would you like to deploy your site?',
  'cli.initSite.deployPublish': 'Publish for me',
  'cli.initSite.deployPublishHint':
    'Generate a GitHub Action that builds your site and deploys it automatically',
  'cli.initSite.deployLocal': 'Deploy my local build',
  'cli.initSite.deployLocalHint':
    'Generate a GitHub Action that deploys a directory you build locally with build-site',
  'cli.initSite.promptDistDir': 'Which directory contains your built site?',
  'cli.initSite.promptChangeDetection':
    'Enable automatic change detection? (commits changelogs when list files change)',
  'cli.initSite.readmeExists':
    'README.md already exists and prompts are unavailable; pass --overwrite-readme or --no-overwrite-readme.',
  'cli.initSite.fileExists':
    '{path} already exists and prompts are unavailable; pass --force to overwrite generated files.',
  'cli.initSite.alreadyInitializedFlags':
    'This repository is already initialized; --ci, --deploy, --dist-dir, --change-detection, --price-source, and --overwrite-readme only apply to a fresh init. Use --force to re-initialize with new settings.',
  'cli.initSite.manualOnlyFlags':
    '--deploy, --dist-dir, and --change-detection only apply with --ci github-actions.',
  'cli.initSite.changeDetectionScope':
    '--change-detection/--no-change-detection only applies with --deploy publish-for-me.',
  'cli.initSite.distDirScope': '--dist-dir only applies with --deploy local-build.',
  'cli.initSite.alreadyCurrent': 'Already initialized and up to date; nothing to do.',
  'cli.initSite.configWriteFailed': 'Error: Failed to write ritual.config.json: {reason}',
  'cli.initSite.created': '✓ Created {path}',
  'cli.initSite.skipped': '⊘ Skipped {path}',
  'cli.initSite.gitignoreCreated': '✓ Created .gitignore',
  'cli.initSite.gitignoreUpdated': '✓ Updated .gitignore',
  'cli.initSite.gitignoreUnchanged': '⊘ .gitignore already up to date',
  'cli.initSite.gitignoreStillIgnores':
    "⚠️  .gitignore still ignores '{dir}/' via {patterns} — this deploy mode commits the built site, so remove or narrow those patterns.",
  'cli.initSite.nextSteps': 'Your site is ready! Next steps:',
  'cli.initSite.stepAddDecks': '  1. Add decks to the decks/ directory (ritual new deck "My Deck")',
  'cli.initSite.stepPreview': '  2. Preview locally with {command}',
  'cli.initSite.stepBuild': '  3. Run {command} to build your site',
  'cli.initSite.stepDeployManual': '  4. Deploy the {dir}/ directory to your hosting provider',
  'cli.initSite.stepEnablePages':
    '  3. Enable GitHub Pages in your repo: Settings → Pages → Source: GitHub Actions',
  'cli.initSite.stepBuildAndCommit': '  4. Build with {command} and commit {dir}/',
  'cli.initSite.stepPushLocal': '  5. Push to main to trigger a deploy',
  'cli.initSite.stepPush': '  4. Push to main to trigger a deploy',
  'cli.initSite.pinVersionTip':
    'Tip: The workflow builds with the Ritual release pinned in ritual.config.json (managed.version). Run `ritual migrate` with a newer release and commit to move it, or set a RITUAL_VERSION repository variable to override it.',

  // ── migrate ───────────────────────────────────────────────────────────
  'cli.migrate.noConfig': 'No ritual.config.json in this directory; nothing to migrate.',
  'cli.migrate.upToDate': 'This workspace is already up to date; nothing to do.',
  'cli.migrate.pending':
    'This workspace has pending updates. Run `ritual migrate` to review and apply them.',
  'cli.migrate.planHeading': 'Pending workspace updates:',
  'cli.migrate.migrationHeading': 'Migration {id}: {description}',
  'cli.migrate.migration.dropSiteVersion':
    'Remove site.version from ritual.config.json (the managed block replaces it)',
  'cli.migrate.migration.dropSitePrerelease':
    'Remove site.prerelease from ritual.config.json (the deploy workflow now downloads the release pinned in managed.version)',
  'cli.migrate.opConfigSet': '  set {path} = {value} in ritual.config.json',
  'cli.migrate.opConfigDelete': '  remove {path} from ritual.config.json',
  'cli.migrate.opWrite': '  write {path}',
  'cli.migrate.opDelete': '  delete {path}',
  'cli.migrate.opRename': '  move {from} → {to}',
  'cli.migrate.refreshHeading': 'Refresh generated files:',
  'cli.migrate.refreshGitignore': '  add {entries} to .gitignore',
  'cli.migrate.refreshSkill': '  overwrite agent skill {name}',
  'cli.migrate.refreshRemoveSkill': '  remove agent skill {name} (no longer shipped)',
  'cli.migrate.refreshRecordOnly':
    '  record that the generated files are current (nothing to rewrite)',
  'cli.migrate.pinBump': 'Pin CI to Ritual {version} (was {previous})',
  'cli.migrate.pinBumpNew': 'Pin CI to Ritual {version} (no release pinned yet)',
  'cli.migrate.dryRunDone': 'Dry run: nothing was written.',
  'cli.migrate.confirm': 'Apply these updates?',
  'cli.migrate.cancelled': 'Cancelled; nothing was written.',
  'cli.migrate.applied': '✓ Applied migration {id}: {description}',
  'cli.migrate.backedUp': '✓ Saved a copy of the files it changed in {path}',
  'cli.migrate.wrote': '✓ Wrote {path}',
  'cli.migrate.skillUpdated': '✓ Updated agent skill {name}',
  'cli.migrate.skillRemoved': '✕ Removed agent skill {name}',
  'cli.migrate.pinned': '✓ Pinned CI to Ritual {version}',
  'cli.migrate.done': '✓ Workspace is up to date.',
  'cli.migrate.devBuild':
    'Warning: {version} is a development build, so managed.version was left unchanged. CI keeps building with the pinned release {pinned}, which does not know the migrations just applied. Run `ritual migrate` with a Ritual release build and commit to move the pin.',
  'cli.migrate.devBuildNoPin':
    'Warning: {version} is a development build, so it did not pin a release in managed.version. With no pin, CI builds with the newest Ritual release (the latest stable one, or the newest prerelease when there is none), which may not know the migrations just applied. Run `ritual migrate` with a Ritual release build and commit to pin one.',
  'cli.migrate.ahead':
    'This workspace was last updated by a newer Ritual ({version}). Run `ritual self-update --tag {version}` and try again.',
  'cli.migrate.aheadNoVersion':
    'This workspace was migrated by a newer Ritual (migration {applied}; this build knows up to {latest}). Run `ritual self-update` to install a newer Ritual and try again.',
  'cli.migrate.changedSincePlan':
    'ritual.config.json changed while migrate was running; nothing was written. Run `ritual migrate` again.',
  'cli.migrate.invalid':
    'ritual.config.json would still be invalid after migrating ({error}); nothing was written. Fix the file and run `ritual migrate` again.',
  'cli.migrate.offer': 'Run `ritual migrate` now?',
  'cli.migrate.offerDeclined':
    'Skipped. Run `ritual migrate` when you are ready; Ritual asks again tomorrow.',
  'cli.migrate.notice.pending':
    'This workspace has pending updates. Run `ritual migrate --dry-run` to see them, then `ritual migrate` to apply them.',
  'cli.migrate.notice.pendingConfig':
    'This workspace has pending updates, and ritual.config.json loads with warnings until they are applied. Run `ritual migrate --dry-run` to see them, then `ritual migrate` to apply them.',
  'cli.migrate.notice.ahead':
    'Warning: this workspace was last updated by Ritual {version}, which is newer than this build ({current}). Run `ritual self-update --tag {version}` to work on it safely.',
  'cli.migrate.notice.aheadNoVersion':
    'Warning: this workspace was migrated by a newer Ritual (migration {applied}; this build knows up to {latest}). Run `ritual self-update` to install a newer Ritual and work on it safely.',

  // ── self-update ───────────────────────────────────────────────────────
  'cli.selfUpdate.upToDate':
    'Ritual {current} is up to date (the newest release on this channel is {latest}).',
  'cli.selfUpdate.alreadyInstalled': 'Ritual {version} is already installed.',
  'cli.selfUpdate.available': 'Ritual {latest} is available (installed: {current}).',
  'cli.selfUpdate.downgradeAvailable':
    'Ritual {latest} is older than the installed {current}; installing it would downgrade {current} → {latest}.',
  'cli.selfUpdate.confirm': 'Update Ritual {current} → {target}?',
  'cli.selfUpdate.confirmDowngrade': 'Downgrade Ritual {current} → {target}?',
  'cli.selfUpdate.cancelled': 'Cancelled; Ritual was not changed.',
  'cli.selfUpdate.downloading': 'Downloading Ritual {tag}…',
  'cli.selfUpdate.updated': '✓ Updated Ritual {current} → {target} ({path})',
  'cli.selfUpdate.checkingWorkspace':
    'Checking this workspace with Ritual {version} (nothing is applied):',
  'cli.selfUpdate.workspaceCheckFailed':
    'Warning: could not run the new Ritual to check this workspace ({error}). Run `ritual migrate --dry-run` to see its pending updates.',
  'cli.selfUpdate.refuse.notRelease':
    'self-update only replaces a Ritual release binary, and {version} is a development or local build. Install a release with the installer, or update your checkout and rebuild.',
  'cli.selfUpdate.refuse.docker':
    'This Ritual runs from its Docker image, which self-update cannot change. Pull the newer image instead (docker pull ghcr.io/sloshy/ritual).',
  'cli.selfUpdate.refuse.notWritable':
    'Cannot replace Ritual: {dir} is not writable. Re-run with permission to write there, or reinstall Ritual with the installer.',
  'cli.selfUpdate.error.invalidTag':
    "'{tag}' is not a release version (expected a tag like v1.2.0 or 1.2.0-beta4).",
  'cli.selfUpdate.error.unsupportedPlatform':
    'Ritual publishes no release binary for {platform}/{arch}.',
  'cli.selfUpdate.error.network': 'Could not reach GitHub ({url}): {error}',
  'cli.selfUpdate.error.http': 'GitHub answered {status} for {url}.',
  'cli.selfUpdate.error.rateLimited':
    'GitHub answered {status} for {url}; its API rate limit may be used up. Try again later, or set GITHUB_TOKEN.',
  'cli.selfUpdate.error.redirectRefused':
    'GitHub redirected {url} to {location}, another site; Ritual does not send GITHUB_TOKEN there. Unset GITHUB_TOKEN and try again.',
  'cli.selfUpdate.error.badResponse': 'GitHub sent an unexpected response for {url}: {error}',
  'cli.selfUpdate.error.noStableRelease':
    'No stable Ritual release has been published yet. Run `ritual self-update --prerelease` for the newest prerelease.',
  'cli.selfUpdate.error.noRelease': 'No Ritual release has been published yet.',
  'cli.selfUpdate.error.tagNotFound': 'No Ritual release is tagged {tag}.',
  'cli.selfUpdate.error.missingAsset':
    'Release {tag} has no {asset} binary for this platform; nothing was installed.',
  'cli.selfUpdate.error.missingChecksum':
    'Release {tag} has no checksum file for {asset}; refusing to install an unverified binary.',
  'cli.selfUpdate.error.badChecksumFile':
    'The checksum file for {asset} is malformed ({error}); nothing was installed.',
  'cli.selfUpdate.error.sizeMismatch':
    'The downloaded {asset} is {actual} bytes, but the release lists {expected}; nothing was installed.',
  'cli.selfUpdate.error.checksumMismatch':
    'Checksum mismatch for {asset} (expected {expected}, got {actual}); nothing was installed.',
  'cli.selfUpdate.error.smokeTest':
    'The downloaded binary did not report version {expected} ({detail}); nothing was installed.',
  'cli.selfUpdate.error.swapStranded':
    'Could not finish replacing {target} ({error}). The previous Ritual is at {old} and the new one at {kept}; rename either to {target} to recover.',
  'cli.selfUpdate.previewExit': 'it exited with code {exitCode}',
  'cli.selfUpdate.error.installFailed':
    'Could not install the new binary at {path}: {error}. The current Ritual was left in place.',

  // ── why GitHub's release data, or a checksum file, was refused ─────────
  'cli.selfUpdate.release.notObject': 'the release is not an object',
  'cli.selfUpdate.release.listNotList': 'the release list is not a list',
  'cli.selfUpdate.release.inList': 'release {index}: {reason}',
  'cli.selfUpdate.release.fieldMissing': '{field} is missing',
  'cli.selfUpdate.release.fieldNotText': '{field} is not a non-empty string',
  'cli.selfUpdate.release.fieldNotBoolean': '{field} is not a boolean',
  'cli.selfUpdate.release.fieldNotList': '{field} is not a list',
  'cli.selfUpdate.release.fieldNotObject': '{field} is not an object',
  'cli.selfUpdate.release.fieldNotHttpsUrl': '{field} is not an https URL',
  'cli.selfUpdate.release.fieldNotByteCount': '{field} is not a byte count',
  'cli.selfUpdate.release.fieldNotVersion': "{field} '{value}' is not a release version",
  'cli.selfUpdate.checksum.malformed': 'expected a SHA-256 digest followed by a file name',
  'cli.selfUpdate.checksum.otherFile': 'the digest is for {file}, not {asset}',

  // ── why an install step failed ────────────────────────────────────────
  'cli.selfUpdate.install.diskFull': 'the disk accepted no more bytes',
  'cli.selfUpdate.smoke.timedOut': 'timed out',
  'cli.selfUpdate.smoke.exited': 'exit {exitCode}: {output}',
  'cli.selfUpdate.smoke.exitedSilently': 'exit {exitCode}, with no output',
  'cli.selfUpdate.smoke.noOutput': 'it printed nothing',

  // ── update-available notice ───────────────────────────────────────────
  'cli.updateNotice.available':
    'Ritual {latest} is available (you have {current}). Run `ritual self-update` to update.',

  // ── the per-user state file ───────────────────────────────────────────
  'cli.userState.fileNotObject': 'the state file must contain a JSON object',
  'cli.userState.sectionNotObject': '{section} must be an object',

  // ── skills ────────────────────────────────────────────────────────────
  'cli.skills.resultWritten': '✓ {name} → {path}',
  'cli.skills.resultUpToDate': '• {name} already up to date',
  'cli.skills.resultSkipped': '• {name} has local edits (skipped)',
  'cli.skills.resultAbsent': '• {name} not installed (skipped)',
  'cli.skills.forceHintRerun': 're-run with --force to overwrite them with the current version',
  'cli.skills.forceHintInit': 'use --force to overwrite them',

  // ── mcp ───────────────────────────────────────────────────────────────
  //
  // The command's own diagnostics. Everything the *server* says to an agent
  // stays English by contract.
  'cli.mcp.refusingUnauthenticated':
    "Refusing to serve MCP without authentication on non-loopback host '{host}'. Pass --token <secret> (or set RITUAL_MCP_TOKEN), or pass --allow-unauthenticated to override.",
  'cli.mcp.unauthenticatedWarning':
    "Warning: serving MCP without authentication on '{host}' (--allow-unauthenticated).",
  'cli.mcp.unauthenticatedLoopback':
    "No token set; serving unauthenticated MCP on loopback host '{host}'.",
  'cli.mcp.httpTeardownFailed': 'MCP HTTP teardown failed:',
  'cli.mcp.stdioIgnoredFlags':
    'Warning: {flags} only apply to --transport http and are ignored under stdio.',

  // ── dep-license ───────────────────────────────────────────────────────
  'cli.depLicense.noText': '[No license text found. SPDX identifier: {license}]',
  'cli.depLicense.primaryHeader': 'Primary:',
  'cli.depLicense.transitiveHeader': 'Transitive:',
  'cli.depLicense.listWithPackage': 'Cannot combine a package name with --list.',
  'cli.depLicense.packageNotFound':
    "Package '{name}' not found. Run 'ritual dep-license --list' for a list.",
  'cli.depLicense.needsPackage': 'Provide a package name argument or use --list ({reason}).',
  'cli.depLicense.promptSelect': 'Select a dependency to view its license',
  'cli.depLicense.primarySeparator': '── Primary Dependencies ──',
  'cli.depLicense.transitiveSeparator': '── Transitive Dependencies ──',

  // ── price: report output ──────────────────────────────────────────────
  'cli.price.disclaimer':
    '⚠️  Prices are from Scryfall and reflect NM (Near Mint) market values. Card condition can significantly decrease actual value.',
  'cli.price.pricingList': {
    $select: 'type',
    deck: 'Pricing deck "{name}"{suffix}',
    collection: 'Pricing collection "{name}"{suffix}',
    wanted: 'Pricing wanted list "{name}"{suffix}',
  },
  'cli.price.emptyCache': 'The card cache is empty; prices are unavailable.',
  'cli.price.calculating': 'Calculating prices...',
  'cli.price.listFooter': '  {count} cards · {totals}',
  'cli.price.searchFooter': '{count} matching entries · {totals}',

  // ── price: the interactive browser ────────────────────────────────────
  'cli.price.totalsTotal': 'Total {price}',
  'cli.price.totalsLowest': 'Lowest {price}',
  'cli.price.totalsUnpriced': '{count} unpriced',
  'cli.price.headerUpdated': '💰 Prices last updated: {updated} · Store: {store} ({currency})',
  'cli.price.updatedUnknown': 'unknown',
  'cli.price.updatedAt': '{timestamp} ({age} ago)',
  'cli.price.headerTypeTotals': '{icon} {title} ({count}) — {totals}',
  'cli.price.headerGrandTotals': '💵 All lists ({count}) — {totals}',
  'cli.price.listRow': '{icon} {name} — {totals} · {count} cards',
  'cli.price.menuSearch': '🔎 Search all cards',
  'cli.price.menuRefresh': '🔄 Refresh prices',
  'cli.price.menuStore': '🏪 Change store',
  'cli.price.menuExit': '🚪 Exit',
  'cli.price.menuBack': '← Back',
  'cli.price.controlSort': '↕️ Sort: {field} ({direction})',
  'cli.price.directionAscending': 'ascending',
  'cli.price.directionDescending': 'descending',
  'cli.price.controlSetFilter': '🔤 Set code filter: {value}',
  'cli.price.controlCollectorFilter': '#️⃣ Collector number filter: {value}',
  'cli.price.controlTypeFilter': '🗂️ List type filter: {value}',
  'cli.price.filterAll': 'all',
  'cli.price.detailList': '  List: {icon} {name} ({section})',
  'cli.price.detailRepresentative':
    '  Printing shown is representative — the entry does not pin one.',
  'cli.price.detailPrice': '  Price: {price}{lineTotal}',
  'cli.price.detailLineTotal': ' · {total} for {count}',
  'cli.price.detailUnpriced': '  Unpriced: {reason}',
  'cli.price.detailLowest': '  Lowest: {price}{printing}',
  'cli.price.detailTypeLine': '  {typeLine} · Mana value {cmc}{rank}',
  'cli.price.detailEdhrec': ' · EDHREC #{rank}',
  'cli.price.unpricedNoPrintings': 'card not found in the local card database',
  'cli.price.unpricedPrintingNotFound': 'printing not found in the card database',
  'cli.price.unpricedCurrencyUnavailable': 'not available in this currency’s game',
  'cli.price.unpricedFinishUnpriced': 'this finish has no price in this currency',
  'cli.price.unpricedNoPriceData': 'no price data for this printing',
  'cli.price.unpricedProxy': 'this copy is a proxy, so it carries no price',
  'cli.price.unpricedCustomArt': 'this copy has custom art, so it carries no price',
  'cli.price.markerProxy': 'PROXY',
  'cli.price.markerCustomArt': 'CUSTOM',
  'cli.price.promptMainMenu': 'Select a list to browse',
  'cli.price.promptSortBy': 'Sort by',
  'cli.price.sortFieldCurrent': '{field} (current)',
  'cli.price.sortToggleDirection': 'Toggle direction (currently {direction})',
  'cli.price.promptTypeFilter': 'Show cards from',
  'cli.price.typeFilterAll': 'All list types',
  'cli.price.typeFilterAllCurrent': 'All list types (current)',
  'cli.price.typeFilterRowCurrent': '{icon} {title} (current)',
  'cli.price.promptBrowser': 'Type to filter by name, set, or collector number',
  'cli.price.promptStore': 'Price store',
  'cli.price.storeRowCurrent': '{store} (current)',
  'cli.price.allPrintings': '📜 All printings & prices ({count})',
  'cli.price.promptSetFilter': 'Set code (empty for all)',
  'cli.price.promptCollectorFilter': 'Collector number (empty for all)',
  'cli.price.refreshing': 'Refreshing prices from Scryfall...',
  'cli.price.allCardsHeading': '🔎 All cards',
  'cli.price.browserHeading': '{heading} — {totals}',

  // ── sell ──────────────────────────────────────────────────────────────
  'cli.sell.disclaimer':
    '⚠️  Buy prices are Card Kingdom cash quotes for Near Mint copies: played conditions are graded down, quantities are capped at their listed limits, and quotes change daily. Store credit typically pays more.',
  'cli.sell.quantityCapped': '×{sellable} of {quantity}',
  'cli.sell.quantity': '×{quantity}',
  'cli.sell.lineValue': ' = {value}',
  'cli.sell.buyingLine':
    '{price} {quantity}{value}  {name}{annotation} · {product} · max {max}{market}',
  'cli.sell.tagsTail': ' · tags: {tags}',
  'cli.sell.marketTail': ' · {percent} of TCGplayer {market}',
  'cli.sell.noMatch': 'no match ({reason})',
  'cli.sell.notBuying': 'not buying ({product})',
  'cli.sell.unsoldLine': '{name}{annotation} ×{quantity} — {label}',
  'cli.sell.listTitle': '[{type}] {name} — CK buys {sellable} of {total} cards · {value}{tail}',
  'cli.sell.listTitleSkipped': ' ({count} not bought)',
  'cli.sell.header': 'Card Kingdom buylist{generated} · retrieved {age} ago',
  'cli.sell.headerGenerated': ' · generated {date}',
  'cli.sell.totals': 'Total: {value} for {sellable} of {total} cards across {counted}',
  'cli.sell.unsoldSummary':
    '  ({notBuying} not buying, {noMatch} unmatched — rerun with --all to list them)',
  'cli.sell.cacheRequirement': 'Buylist matching requires the Scryfall card database.',
  'cli.sell.emptyCache': 'The card cache is empty; buylist matching requires it.',
  'cli.sell.wroteFile': 'Wrote {file}',

  // ── Card Kingdom buylist (console lines) ──────────────────────────────
  'cli.cardKingdom.cacheInvalid.notObject': 'Invalid Card Kingdom cache: expected an object',
  'cli.cardKingdom.cacheInvalid.noRetrievedAt':
    'Invalid Card Kingdom cache: missing numeric retrievedAt',
  'cli.cardKingdom.cacheInvalid.noFeed': 'Invalid Card Kingdom cache: missing feed object',
  'cli.cardKingdom.cacheInvalid.noCreatedAt': 'Invalid Card Kingdom cache: missing feed.createdAt',
  'cli.cardKingdom.cacheInvalid.noBaseUrl': 'Invalid Card Kingdom cache: missing feed.baseUrl',
  'cli.cardKingdom.cacheInvalid.noProductList':
    'Invalid Card Kingdom cache: missing products array',
  'cli.cardKingdom.cacheInvalid.noProducts': 'Invalid Card Kingdom cache: no readable products',
  'cli.cardKingdom.cacheDropped': {
    $plural: 'count',
    one: 'Dropped {count} malformed product from the Card Kingdom cache',
    other: 'Dropped {count} malformed products from the Card Kingdom cache',
  },
  'cli.cardKingdom.cacheNotJson': 'Ignoring unreadable Card Kingdom cache (not valid JSON)',
  'cli.cardKingdom.cacheIgnored': 'Ignoring unreadable Card Kingdom cache: {reason}',
  'cli.cardKingdom.downloadPrompt': '{lead} Download it now (~{size} MB)?',
  'cli.cardKingdom.downloading': 'Downloading the Card Kingdom buylist (~{size} MB)...',
  'cli.cardKingdom.updated': {
    $plural: 'count',
    one: 'Card Kingdom buylist updated ({count} product).',
    other: 'Card Kingdom buylist updated ({count} products).',
  },
  'cli.cardKingdom.updating': 'The Card Kingdom buylist was retrieved {age} ago. Updating it...',
  'cli.cardKingdom.usingStale': 'Using the buylist retrieved {age} ago instead: {reason}',
  'cli.cardKingdom.sellModeProblem': 'Sell mode: {problem}',

  // ── locale ────────────────────────────────────────────────────────────
  //
  // `--locale` and `RITUAL_LOCALE` name themselves and are never translated;
  // the other three tiers are described in words.
  'cli.locale.sourceConfig': 'uiLocale in ritual.config.json',
  'cli.locale.sourceDetected': 'detected from the environment',
  'cli.locale.sourceDefault': 'built-in default',
  'cli.locale.uiLocale': 'UI locale: {locale} ({source})',
  'cli.locale.available': 'Available UI locales: {locales}',
  'cli.locale.detected': 'Detected OS locale: {locale}',
  'cli.locale.detectedNone': 'none',
  'cli.locale.cardLanguage': 'Card language (defaultLanguage): {language}',
  'cli.locale.ignoring': 'Ignoring {source} "{value}": {error}',
  'cli.locale.envIgnored': '{variable}: ignoring invalid value — {error}',
  'cli.locale.footer':
    'The UI locale is the language Ritual speaks; the card language selects which printing of a card is used. They are independent settings.',

  // ── locale --detect ───────────────────────────────────────────────────
  //
  // {origin} is an environment variable name or a literal command line, and
  // {value} is whatever the OS said — neither is ever translated.
  'cli.locale.probeHeader': 'Detection probes:',
  'cli.locale.probeEnvironment': 'Environment',
  'cli.locale.probeWindows': 'Windows UI culture',
  'cli.locale.probeMacos': 'macOS system locale',
  'cli.locale.probeFound': '  {label} ({origin}): {value} → {locale}',
  'cli.locale.probeUnusable': '  {label} ({origin}): {value} — names no usable language',
  'cli.locale.probeNothing': '  {label} ({origin}): nothing set',
  'cli.locale.probeSkipped': '  {label}: not applicable on this platform',
  'cli.locale.detectNothing': 'No probe found a usable language; nothing to change.',
  'cli.locale.detectAgrees': 'Detection agrees with the interface locale ({locale}).',
  'cli.locale.detectDiffers': 'Detected {locale}, but the interface is using {current} ({source}).',
  'cli.locale.detectNoDictionary':
    'This build ships no dictionary for {locale}: messages would stay English, while dates, numbers, and currency would follow it.',
  'cli.locale.detectPrompt': 'Set uiLocale to {locale} in ritual.config.json?',
  'cli.locale.detectSaved': 'Set uiLocale to {locale} in ritual.config.json.',
  'cli.locale.detectDeclined': 'Left uiLocale unchanged.',
  'cli.locale.detectNoPrompt': 'Not offering to save it ({reason}). To apply it, run: {command}',
  'cli.prompt.subject.uiLocale': 'whether to save the detected UI locale',
} as const satisfies MessageCatalogShape
