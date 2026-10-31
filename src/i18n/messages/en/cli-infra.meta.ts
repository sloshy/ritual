/** Translator metadata for {@link cliInfraMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { cliInfraMessages } from './cli-infra'

/** Shared context for why GitHub's release data was refused. */
const RELEASE_REASON =
  '`ritual self-update` reads the list of published Ritual releases from GitHub as JSON. This phrase says why that data was refused; it starts lowercase with no closing period, and is shown as {error} inside cli.selfUpdate.error.badResponse ("GitHub sent an unexpected response for …: …").'

/** Shared context for the release field a reason names. */
const RELEASE_FIELD =
  '{field} is the JSON field exactly as GitHub names it (e.g. "tag_name", "draft", "assets[0].browser_download_url", where [0] is a 0-based position); never translate it.'

/** Shared context for why a release's checksum file was refused. */
const CHECKSUM_REASON =
  'Each Ritual release archive comes with a .sha256 checksum file that proves the download is intact. This phrase says why that file could not be read; it starts lowercase with no closing period, and is shown as {error} inside cli.selfUpdate.error.badChecksumFile.'

const ARCHIVE_REASON =
  'Ritual releases publish each binary compressed, in a .tar.gz or .zip archive that must hold just the one binary. This phrase says why that archive could not be unpacked; it starts lowercase with no closing period, and is shown as {error} inside cli.selfUpdate.error.badArchive. "it" is the archive.'

/** Shared context for why the new binary's version check failed. */
const SMOKE_REASON =
  'Before installing it, `ritual self-update` runs the downloaded binary with --version as a test. This phrase says why the test got no version back; it starts lowercase with no closing period, and is shown in parentheses as {detail} inside cli.selfUpdate.error.smokeTest.'

/** Shared context for the Scryfall client's console lines. */
const SCRYFALL_LOG =
  'A console line of the Scryfall client (Scryfall is the card database Ritual reads card data from), printed by the CLI and in the console of a Ritual server (the admin server, the cache server, the cache feed host).'

/** Shared context for the bulk card-cache refresh's console lines. */
const BULK_LOG = `${SCRYFALL_LOG} Part of a card-cache refresh: downloading Scryfall's bulk card data into the local card cache.`

/** Shared context for the tag bake's console lines. */
const TAG_LOG = `${SCRYFALL_LOG} Part of downloading Scryfall's card tags — "oracle tags" (tags on a card's rules text) and "art tags" (tags on its artwork) — and attaching them to each cached card. A "tag bulk" is the file Scryfall publishes them in.`

/** Shared context for the tag files' parse errors. */
const TAG_PARSE = `${TAG_LOG} Why a tag file could not be read; shown inside "Failed to download tags: …" or "Failed to build tags from downloaded bulks: …". {index} is the 0-based position of the bad entry.`

/** The HTTP status pair a failed request reports. */
const STATUS_PAIR =
  '{status} is the HTTP status code (e.g. 404) and {statusText} its standard English reason phrase (possibly empty), as the server sent them.'

/** Shared context for the cache server's console lines. */
const CACHE_SERVER_LOG =
  'A console line of `ritual cache server` — a long-running process that serves a shared card and price cache to other Ritual processes — read by whoever operates it.'

/** Context for the Card Kingdom buylist's console lines. */
const CK_LOG_CONTEXT =
  'About the Card Kingdom buylist: Card Kingdom (a card store; a company name, never translated) publishes a ~70 MB pricelist feed of what it pays for cards, which Ritual downloads into its local cache for `ritual sell` and sell mode. A console line of the CLI, or of a Ritual server (admin, serve) in its terminal.'

/** Context for a rejected Card Kingdom cache file. */
const CK_CACHE_CONTEXT = `${CK_LOG_CONTEXT} Why the cached buylist file (cache/cardkingdom.json) was rejected as unreadable; it fills {reason} in "Ignoring unreadable Card Kingdom cache: {reason}".`

export const cliInfraMeta = {
  // ── cache status ──────────────────────────────────────────────────────
  'cli.cache.rowEmpty': {
    description: '`cache status` row label: whether the card cache holds nothing.',
  },
  'cli.cache.rowCardNames': {
    description: '`cache status` row label: how many card names are cached.',
  },
  'cli.cache.rowLastCardRefresh': {
    description: '`cache status` row label: when the card bulk was last downloaded.',
  },
  'cli.cache.rowPriceAgeHours': {
    description: '`cache status` row label: age of the cached prices, in hours.',
  },
  'cli.cache.rowPricesStale': {
    description: '`cache status` row label: whether the cached prices are past their max age.',
  },
  'cli.cache.rowTagsPresent': {
    description: '`cache status` row label: whether oracle/art tags are attached to cached cards.',
  },
  'cli.cache.rowSource': {
    description: '`cache status` row label: where refreshes download from.',
  },
  'cli.cache.rowLocation': {
    description: '`cache status` row label: the folder on disk where the card cache is stored.',
  },
  'cli.cache.locationEnv': {
    description:
      '`cache status` Location value when an environment variable chose the folder. {path} is the absolute folder path; {envVar} is the variable name (RITUAL_CACHE_DIR). Never translate either.',
  },
  'cli.cache.locationConfig': {
    description:
      '`cache status` Location value when the workspace settings file chose the folder. {path} is the absolute folder path; {configKey} is the setting name (cacheDir) and {file} the settings file name (ritual.config.json). Never translate them.',
  },
  'cli.cache.locationDefault': {
    description:
      '`cache status` Location value when nothing overrides the folder: the per-user cache folder that every workspace (project folder) on this computer uses. {path} is the absolute folder path; never translate it.',
  },
  'cli.cache.rowDefaultLanguage': {
    description:
      '`cache status` row label: the configured card language (NOT the interface locale).',
  },
  'cli.cache.rowCardBulk': {
    description: '`cache status` row label: which Scryfall bulk file built the cache.',
  },
  'cli.cache.rowBulkStale': {
    description:
      '`cache status` row label: whether the cache was built from a different bulk than the config now demands.',
  },
  'cli.cache.valueNever': {
    description: '`cache status` value: the cache has never been refreshed.',
  },
  'cli.cache.valueNotApplicable': {
    description: '`cache status` value: the price age cannot be determined. Keep it very short.',
  },
  'cli.cache.valueUnrecorded': {
    description: '`cache status` value: the cache predates bulk-type provenance.',
  },
  'cli.cache.valueYes': {
    description:
      '`cache status` value of a yes/no row (Empty, Prices stale, Tags present, Bulk stale): yes.',
  },
  'cli.cache.valueNo': {
    description: '`cache status` value of a yes/no row: no.',
  },
  'cli.cache.sourceLocal': {
    description: '`cache status` Source value: the card cache is the files in this workspace.',
  },
  'cli.cache.sourceCacheServer': {
    description:
      '`cache status` Source value: the card cache is read from a shared cache server (`ritual cache server`) rather than local files.',
  },
  'cli.cache.rowLabel': {
    description:
      'A `cache status` row label followed by its punctuation, before the padded value, e.g. "Prices stale:". {label} is one of the cli.cache.row* labels. Use the punctuation your language puts before a value (French writes a space before the colon).',
  },

  // ── cache preload ─────────────────────────────────────────────────────
  'cli.cache.preloadingSet': {
    description: 'Progress line of `cache preload-set`. {set} is an upper-case set code.',
  },
  'cli.cache.preloadSetFailed': {
    description: '`cache preload-set` failed. {reason} is an underlying error message.',
  },
  'cli.cache.preloadSetNotFound': {
    description:
      'The set code matched nothing on Scryfall — almost always a typo. {url} is the example URL `https://scryfall.com/sets`. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.cache.preloadSetNoPrintings': {
    description:
      'The set exists but holds nothing cacheable. {counted} is a pre-rendered "N items" fragment.',
  },
  'cli.cache.preloadSetDone': { description: '`cache preload-set` succeeded.' },
  'cli.cache.preloadAllFailed': { description: '`cache preload-all` failed.' },
  'cli.cache.preloadAllBuylistFailed': {
    description:
      'Warning, not a failure: `cache preload-all` refreshed the card cache but could not update the Card Kingdom buylist sell mode quotes from. Card Kingdom is a company name. {reason} is an underlying error or advice sentence.',
  },
  'cli.cache.refreshTagsFailed': { description: '`cache refresh-tags` failed.' },

  // ── cache feed ────────────────────────────────────────────────────────
  'cli.cacheFeed.invalidCards': {
    description:
      'Usage error for `cache feed host --cards`. The quoted words are literal values. {flag} is the `--cards` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.cacheFeed.initialFeedFailed': {
    description:
      'The first feed generation failed and there is no existing feed to fall back on, so `cache feed host` exits. {error} is the failure, already worded (one of the feed-host errors, or a download error).',
  },
  'cli.cacheFeed.refreshFailed': {
    description:
      'A feed refresh failed but a previously generated feed is still being served. {reason} is the failure, already worded (one of the feed-host errors, or a download error).',
  },
  'cli.cacheFeed.seedStartFailed': {
    description:
      "The BitTorrent seeder would not start (in `cache feed host` or `cache feed fetch`). {error} is the failure, already worded — possibly the BitTorrent client's own English text.",
  },
  'cli.cacheFeed.seedingTorrents': {
    description: 'How many torrents the feed host is seeding, when the TCP port is unknown.',
  },
  'cli.cacheFeed.seedingTorrentsOnPort': {
    description: 'How many torrents the feed host is seeding, and on which TCP port.',
  },
  'cli.cacheFeed.serverStartFailed': {
    description:
      "The feed HTTP server would not bind — usually the port is already in use. {error} is the system's own reason, usually English.",
  },
  'cli.cacheFeed.scheduledRefreshFailed': {
    description:
      'A scheduled (background) feed refresh failed on a running host, which keeps serving its current feed. {error} is the failure, already worded.',
  },
  'cli.cacheFeed.listening': { description: 'The feed host is up. {url} is its feed URL.' },
  'cli.cacheFeed.publicUrl': {
    description: 'The base URL peers will reach this feed host at.',
  },
  'cli.cacheFeed.seedingDisabled': {
    description:
      'The feed host was started with --no-seed. {flag} is the `--no-seed` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.cacheFeed.syncing': { description: '`cache feed fetch` is contacting the feed.' },
  'cli.cacheFeed.syncFailed': {
    description: '`cache feed fetch` could not sync. {error} is the failure, already worded.',
  },
  'cli.cacheFeed.ingested': { description: 'The feed carried new data and it was ingested.' },
  'cli.cacheFeed.unchanged': { description: 'The feed matched what is already cached.' },
  'cli.cacheFeed.seedingArtifacts': {
    description: '`cache feed fetch` is now seeding, TCP port unknown.',
  },
  'cli.cacheFeed.seedingArtifactsOnPort': {
    description: '`cache feed fetch` is now seeding on a known TCP port.',
  },
  'cli.cacheFeed.scheduledRecheckFailed': {
    description:
      'A scheduled feed re-check failed while `cache feed fetch` was seeding; it keeps seeding. {error} is the failure, already worded.',
  },
  'cli.cacheFeed.feedChanged': {
    description: 'A scheduled re-check found new data and ingested it.',
  },
  'cli.cacheFeed.stopping': { description: 'Ctrl+C was pressed; the seeder is shutting down.' },

  // ── cache feed host ───────────────────────────────────────────────────
  'cli.cacheFeed.loadedExisting': {
    description:
      'At start-up the feed host found the feed it published before and serves it straight away. {generatedAt} is when that feed was generated, an ISO 8601 timestamp (e.g. "2026-07-05T10:00:00.000Z"), printed as it is.',
  },
  'cli.cacheFeed.artifactMissing': {
    description:
      "A file the published feed lists has disappeared from the host's disk, so the host downloads it from Scryfall again. {file} is its file name.",
  },
  'cli.cacheFeed.downloadingBulk': {
    description:
      'The feed host is downloading one of Scryfall\'s bulk files to publish. {kind} is the feed artifact kind, a literal such as "default-cards" or "oracle-tags"; {updatedAt} is when Scryfall last updated the file, an ISO 8601 timestamp printed as it is.',
  },
  'cli.cacheFeed.upToDate': {
    description:
      'A feed refresh found nothing new on Scryfall, so the published feed was left as it is.',
  },
  'cli.cacheFeed.published': {
    description:
      'The feed host published a new feed document. {count} is how many files (entries) it lists.',
  },
  'cli.cacheFeed.pruning': {
    description:
      'After publishing a new feed, the host deletes a file the new feed no longer lists (an older generation of a bulk file). {file} is its file name.',
  },
  'cli.cacheFeed.seedingArtifact': {
    description:
      'The feed host verified one file on disk and now shares it with BitTorrent peers. {name} is its file name; {infoHash} is its BitTorrent info hash.',
  },
  'cli.cacheFeed.manifestEntryMissing': {
    description:
      'Scryfall\'s list of bulk files (its "bulk manifest") lacks a file the feed host publishes, or lists it without a download address or update time. {bulkType} is Scryfall\'s name for the bulk file, a literal such as "default_cards".',
  },
  'cli.cacheFeed.suspiciousFileName': {
    description:
      'A safety refusal: the download address Scryfall listed for a bulk file ends in a file name that could write outside the feed directory, so the host will not save it. {file} is that name.',
  },
  'cli.cacheFeed.bulkDownloadFailed': {
    description:
      'The feed host could not download one of Scryfall\'s bulk files. {kind} is the feed artifact kind, a literal such as "default-cards"; {status} and {statusText} are the HTTP status code and its standard English reason phrase (e.g. "503 Service Unavailable").',
  },
  'cli.cacheFeed.requestFailed': {
    description:
      "The feed host hit an unexpected error answering one HTTP request (it answers that request with an error and keeps running). {error} is the failure, already worded — possibly the system's own English text.",
  },
  'cli.cacheFeed.bulkNoBody': {
    description:
      'Scryfall answered a bulk file download with an empty response. {kind} is the feed artifact kind, a literal such as "default-cards".',
  },

  // ── cache feed client ─────────────────────────────────────────────────
  'cli.cacheFeed.ignoringState': {
    description:
      'A saved file was malformed and is ignored: a feed client\'s state file (the next sync downloads everything again), or the feed document a feed host published before (it generates a new one). {file} is the file name; {reason} is the already-worded reason, one of the "Invalid feed-client state" or "Invalid cache feed" messages.',
  },
  'cli.cacheFeed.ignoringUnreadable': {
    description:
      "A saved file is not valid JSON and is ignored: a feed client's state file, or the feed document a feed host published before. {file} is the file name.",
  },
  'cli.cacheFeed.fetchFailed': {
    description:
      'The feed document could not be downloaded and the server said nothing more. {url} is its address; {status} is the HTTP status code (a number such as 503). "HTTP" stays literal.',
  },
  'cli.cacheFeed.fetchFailedWithBody': {
    description:
      "The feed document could not be downloaded. {url} is its address; {status} is the HTTP status code (a number such as 503). \"HTTP\" stays literal. {body} is what the server answered, already worded: a Ritual feed host's reason in the reader's language (e.g. that the feed has not been generated yet), or another server's reply quoted as it was sent.",
  },
  'cli.cacheFeed.missingEntry': {
    description:
      'The feed document does not list an artifact this client needs. {kind} is the artifact kind, a literal such as "oracle-tags".',
  },
  'cli.cacheFeed.missingAllCardsEntry': {
    description:
      'The feed lacks the every-language card artifact the configured card language needs. {kind} is the literal "all-cards". `all_cards` is a Scryfall bulk name and is not translated. {configKey} is the `defaultLanguage` config key; {hostCommand} is the `cache feed host --cards all` command line (without the `ritual` prefix); {sourceFlag} is `--source scryfall`, a flag and its value. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.cacheFeed.reusing': {
    description:
      'A feed artifact is already on disk with the right checksum, so it is not downloaded again. {file} is its file name.',
  },
  'cli.cacheFeed.restoring': {
    description:
      'A feed artifact the cache already ingested is missing from disk and is being downloaded again. {file} is its file name.',
  },
  'cli.cacheFeed.stoppedSeeding': {
    description:
      'A long-running client or feed host stopped sharing an artifact the feed no longer lists. {name} is its file name; {infoHash} is its BitTorrent info hash.',
  },
  'cli.cacheFeed.hashMismatch': {
    description:
      'A downloaded artifact failed its checksum check and was deleted. {file} is its file name; {hash} is the checksum it actually had. "sha256" is the checksum algorithm and is not translated.',
  },
  'cli.cacheFeed.downloadingHttp': {
    description: 'A feed artifact is being downloaded over plain HTTP. {file} is its file name.',
  },
  'cli.cacheFeed.downloadFailed': {
    description:
      'A feed artifact (one of the bulk files a feed lists) could not be downloaded over HTTP and the server said nothing more. {url} is its address; {status} is the HTTP status code (a number such as 404). "HTTP" stays literal.',
  },
  'cli.cacheFeed.downloadFailedWithBody': {
    description:
      "A feed artifact (one of the bulk files a feed lists) could not be downloaded over HTTP. {url} is its address; {status} is the HTTP status code (a number such as 404). \"HTTP\" stays literal. {body} is what the server answered, already worded: a Ritual feed host's reason in the reader's language (e.g. that the feed has not been generated yet), or another server's reply quoted as it was sent.",
  },
  'cli.cacheFeed.downloadNoBody': {
    description:
      'The server answered a feed artifact download with an empty response. {file} is its file name.',
  },
  'cli.cacheFeed.downloadingTorrent': {
    description: 'A feed artifact is being downloaded over BitTorrent. {file} is its file name.',
  },
  'cli.cacheFeed.torrentTimedOut': {
    description:
      'A BitTorrent download of a feed artifact gave up after waiting too long. {file} is its file name.',
  },
  'cli.cacheFeed.completed': {
    description:
      'A BitTorrent download of a feed artifact finished. {file} is its file name; {count} is how many peers it was downloaded from (may be zero).',
  },
  'cli.cacheFeed.torrentFetchFailed': {
    description:
      'The .torrent file for a feed artifact could not be downloaded and the server said nothing more. {url} is its address; {status} is the HTTP status code (a number such as 404). "HTTP" stays literal.',
  },
  'cli.cacheFeed.torrentFetchFailedWithBody': {
    description:
      "The .torrent file for a feed artifact could not be downloaded. {url} is its address; {status} is the HTTP status code (a number such as 404). \"HTTP\" stays literal. {body} is what the server answered, already worded: a Ritual feed host's reason in the reader's language (e.g. that the feed has not been generated yet), or another server's reply quoted as it was sent.",
  },
  'cli.cacheFeed.torrentClientError': {
    description:
      "The BitTorrent client (a feed client's or a feed host's) reported an error. {error} is the client's own text, usually English.",
  },
  'cli.cacheFeed.torrentNotReady': {
    description:
      'An artifact already on disk could not be verified for sharing in time. {infoHash} is its BitTorrent info hash.',
  },
  'cli.cacheFeed.feedNotObject': {
    description: 'A fetched or saved feed document is not a JSON object.',
  },
  'cli.cacheFeed.feedVersionUnsupported': {
    description:
      'A feed document has a format version this Ritual cannot read. {version} is the version it has; {expected} is the one Ritual reads.',
  },
  'cli.cacheFeed.feedMissingGeneratedAt': {
    description: 'A feed document lacks its "generatedAt" text field (a literal field name).',
  },
  'cli.cacheFeed.feedMissingEntries': {
    description: 'A feed document lacks its "entries" list (a literal field name).',
  },
  'cli.cacheFeed.feedEntryNotObject': {
    description:
      'One entry of a feed document is not a JSON object. {index} is its 0-based position.',
  },
  'cli.cacheFeed.feedEntryUnknownKind': {
    description:
      'One entry of a feed document names an artifact kind Ritual does not know. {index} is its 0-based position; {kind} is the value it has.',
  },
  'cli.cacheFeed.feedEntryMissingField': {
    description:
      'One entry of a feed document lacks a required text field. {index} is its 0-based position; {field} is the literal field name (e.g. "fileName").',
  },
  'cli.cacheFeed.feedEntryBadLength': {
    description:
      'One entry of a feed document lacks a positive file size in its "length" field (a literal field name). {index} is its 0-based position.',
  },
  'cli.cacheFeed.stateNotObject': {
    description: "A feed client's saved state file is not a JSON object.",
  },
  'cli.cacheFeed.stateMissingIngested': {
    description:
      'A feed client\'s saved state file lacks its "ingested" record of downloaded artifacts (a literal field name).',
  },
  'cli.cacheFeed.stateUnknownKind': {
    description:
      "A feed client's saved state file records an artifact kind Ritual does not know. {kind} is the value it has.",
  },
  'cli.cacheFeed.stateEntryInvalid': {
    description:
      'A feed client\'s saved state file has a malformed record for one artifact kind. {kind} is the kind; "infoHash" and "ingestedAt" are literal field names.',
  },

  // ── cache freshness gates ─────────────────────────────────────────────
  'cli.cacheGate.emptyAdvice': {
    description:
      'Appended to a command\'s own "the card cache is empty" sentence ({lead}) to say how to fill it. {command} is the `ritual cache preload-all` command line; {flag} is `--refresh auto`, a flag and its value. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.cacheGate.bulkMismatch': {
    description:
      'The card cache was downloaded for a different card language setting than the configured one. {recorded} is the Scryfall bulk it was built from ("default_cards" or "all_cards", literal); {language} is the configured card language code (e.g. "ja"). The form is chosen by {required}, the bulk the configuration needs ("all_cards" or "default_cards"), which is not itself printed; {language} appears only in the all_cards form. Followed by a question or a progress note. {configKey} is the `defaultLanguage` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.cacheGate.bulkMismatchConfirm': {
    description:
      'Yes/no prompt. {reason} is the "The card cache was built from…" sentence; this asks whether to download the cache again now.',
  },
  'cli.cacheGate.bulkMismatchRefreshing': {
    description:
      'Progress line. {reason} is the "The card cache was built from…" sentence; this says the cache is being downloaded again.',
  },
  'cli.cacheGate.staleConfirm': {
    description:
      'Yes/no prompt: the card cache is more than a week old. {age} is a whole number of days, already worded with its unit (e.g. "9 days").',
  },
  'cli.cacheGate.empty': {
    description:
      'Before offering the first card-cache download (`add-card`, the admin server at startup): the card cache holds nothing, and Ritual reads card names, printings and prices from it.',
  },
  'cli.cacheGate.locationShared': {
    description:
      'Printed before the offer to download the card database into an empty cache: where the download will be stored. {path} is the absolute folder path; never translate it. This is the per-user default folder, which every workspace (project folder) on the computer uses, so one download serves them all.',
  },
  'cli.cacheGate.location': {
    description:
      'Printed before the offer to download the card database into an empty cache: where the download will be stored. {path} is the absolute folder path, chosen by a setting (an environment variable or the workspace settings file); never translate it.',
  },
  'cli.cacheGate.downloadSize': {
    description:
      'Printed after where the card data will be stored, before the offer to download it: roughly how big the download is. The form is chosen by {bulk}, the Scryfall bulk the card language setting needs ("default_cards" for English, "all_cards" for every language), which is not itself printed. The sizes are approximate; keep the "about" wording and the MB unit.',
  },
  'cli.cacheGate.downloadDatabaseConfirm': {
    description: 'Yes/no prompt following the previous message: download the card cache now?',
  },
  'cli.cacheGate.pricesStaleRefreshing': {
    description:
      'Progress line: card prices in the cache are over a day old, so the whole cache is being downloaded again from Scryfall (a card database).',
  },
  'cli.cacheGate.uploadConfirm': {
    description:
      'Yes/no prompt before a collection-sync CSV upload. {reason} is the "Archidekt CSV uploads are configured…" sentence; "it" is the card cache.',
  },
  'cli.cacheGate.emptyWithRequirement': {
    description:
      'The card cache holds nothing. {requirement} is one sentence from the command saying why it needs the cache (e.g. "Pricing requires the Scryfall card database.").',
  },
  'cli.cacheGate.downloadNowConfirm': {
    description: 'Yes/no prompt following the previous message: download the card cache now?',
  },
  'cli.cacheGate.pricingRequirement': {
    description:
      'Why `ritual price` needs the card cache — the sentence placed in "Card cache is empty. {requirement}".',
  },
  'cli.cacheGate.stalePriceCount': {
    description:
      'Before building a site or warming the live server: {stale} of the {count} cards about to be priced have prices more than 24 hours old. {count} is the total number of cards.',
  },
  'cli.cacheGate.bulkFasterHint': {
    description:
      'Follows the previous message: downloading the whole cache again is faster than refreshing card by card.',
  },
  'cli.cacheGate.redownloadConfirm': {
    description: 'Yes/no prompt following the previous two messages.',
  },
  'cli.cacheGate.continuingWithExisting': {
    description:
      'Printed after an offered cache download failed. {reason} is the "Card cache download failed: …" sentence; the run carries on with the older cache.',
  },
  'cli.cacheGate.tagsConfirm': {
    description:
      'Yes/no prompt before building or serving a site. "Oracle/art tags" are Scryfall\'s community card tags, which power the site\'s tag filters.',
  },
  'cli.cacheGate.tagsSkipped': {
    description:
      'The tag download was declined. {command} is the `ritual cache refresh-tags` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.cacheGate.tagsFetching': { description: 'Progress line: the tag download has started.' },
  'cli.cacheGate.tagsFailed': {
    description: 'The tag download failed; the site will be built without tag filters.',
  },
  'cli.cacheGate.tagsAdded': {
    description: 'The tag download finished and was saved into the card cache.',
  },
  'cli.cacheGate.pricesAgeConfirm': {
    description:
      'Yes/no prompt before `ritual price`: the cached prices are over a day old. {age} is a rendered duration such as "2 days, 3 hours".',
  },

  // ── cache lock ────────────────────────────────────────────────────────
  'cli.cacheLock.invalidJson': {
    description:
      'Why an existing cache lock file was considered abandoned: it is not valid JSON. Shown inside "Breaking stale cache lock (…)."',
  },
  'cli.cacheLock.notObject': {
    description:
      'Why an existing cache lock file was considered abandoned: it is not a JSON object. Shown inside "Breaking stale cache lock (…)."',
  },
  'cli.cacheLock.missingField': {
    description:
      'Why an existing cache lock file was considered abandoned: it lacks one field. One branch per field; the field names (pid, hostname, createdAt, operation) are literal, and "numeric"/"string" name the type it should have. Shown inside "Breaking stale cache lock (…)."',
  },
  'cli.cacheLock.breakingStale': {
    description:
      'A warning: a lock left behind by another Ritual process is being removed. {reason} is why it counts as abandoned — another message, lowercase or an "Invalid cache lock" sentence.',
  },
  'cli.cacheLock.holderGone': {
    description:
      'Lowercase clause inside "Breaking stale cache lock (…)." {pid} is the process id that held the lock; "pid" is the technical abbreviation for process id.',
  },
  'cli.cacheLock.waiting': {
    description:
      'Another Ritual process holds the cache lock, so this one waits. {operation} is what the other process is doing, recorded in English by it; {pid} is its process id; {timeout} is a rendered duration such as "5 minutes".',
  },

  // ── cache store ───────────────────────────────────────────────────────
  'cli.cacheStore.oldSchemaReset': {
    description:
      'The cache file is in an outdated layout, so its cards section is discarded and rebuilt.',
  },
  'cli.cacheStore.invalidFormatReset': {
    description: 'The cache file is malformed, so it is discarded and rebuilt.',
  },
  'cli.cacheStore.loadFailed': {
    description:
      'The cache file could not be read; an empty cache is used instead. The error is printed after this line.',
  },
  'cli.cacheStore.unwritable': {
    description:
      "Refusal of a write to the card cache: the cache file is there but unreadable or not valid JSON, and writing would replace everything in it (it may be shared by all the user's workspaces) with an empty cache plus one entry. {path} is the absolute file path; {reason} is the system's or parser's own error text, untranslated. {command} is `ritual cache preload-all`, which rebuilds the whole cache; never translate it.",
  },
  'cli.cacheStore.unsafeDirIgnored': {
    description:
      'Warning from a server (the admin, MCP or cache server): the RITUAL_CACHE_DIR environment variable or the cacheDir setting names a folder the card cache must not use (such as the home folder or the workspace), so it is ignored and the next choice applies. {reason} is the refusal itself, already worded (one of the domain.config.cacheDir* messages).',
  },
  'cli.cacheStore.writeContended': {
    description:
      'Error: a save to the card cache was abandoned because, every time Ritual tried, another Ritual process (possibly in another workspace sharing the cache) had rewritten the file first. {path} is the absolute file path.',
  },
  'cli.cacheStore.saveFailed': {
    description: 'The cache file could not be written. The error is printed after this line.',
  },
  'cli.cacheStore.blocklisted': {
    description:
      'A card name Scryfall does not know is skipped for a week. {name} is the card name; {expires} is a timestamp in ISO 8601 form (machine format).',
  },
  'cli.cacheStore.unblocklisted': {
    description:
      "A skipped card name's week is up, so it will be looked up again. {name} is the card name.",
  },
  'cli.cacheStore.bulkWeekOld': {
    description:
      "Progress line: the cache's last full download is over a week old, so it is downloaded again.",
  },
  'cli.cacheStore.bulkNever': {
    description:
      'Progress line: the cache was never fully downloaded, so it is downloaded now from Scryfall (a card database).',
  },
  'cli.cacheStore.bulkWeekOldConfirm': {
    description:
      "Yes/no prompt (default yes) before building a site: the cache's last full download is over a week old; download it again now?",
  },
  'cli.cacheStore.bulkNeverConfirm': {
    description:
      'Yes/no prompt (default yes) before building a site: the card cache was never fully downloaded from Scryfall (a card database); download it now?',
  },
  'cli.cacheStore.manyMissingConfirm': {
    description:
      'Yes/no prompt (default yes) before building a site: more than {threshold} of the cards needed are missing from the cache; download the whole cache again now? {threshold} is a number.',
  },
  'cli.cacheStore.bulkSkipped': {
    description:
      'The cache download was declined, or could not be asked because prompts are unavailable. The build carries on, fetching missing cards individually. {flag} is `--refresh auto`, a flag and its value; it is typed or matched exactly by the user, so never translate it.',
  },
  'cli.cacheStore.manyMissing': {
    description:
      'Progress line: more than {threshold} of the cards needed are missing from the cache, so the whole cache is downloaded instead of fetching them one by one. {threshold} is a number.',
  },
  'cli.cacheStore.feedUnchanged': {
    description: 'A cache refresh from the peer-to-peer cache feed found nothing new.',
  },
  'cli.cacheStore.feedUrlMissing': {
    description:
      'Warning before a card-cache refresh: the settings say to refresh from the peer-to-peer cache feed, but give no address for it, so the refresh downloads straight from Scryfall. "feed" is the literal setting value. {sourceKey} is the `cacheSource` setting and {urlKey} the `cacheFeedUrl` setting; never translate them.',
  },
  'cli.cacheStore.feedFallback': {
    description:
      'A cache refresh from the peer-to-peer cache feed failed, so the cache is downloaded straight from Scryfall instead. {reason} is the error, already worded.',
  },
  'cli.cacheStore.provenanceNotObject': {
    description:
      'The small file recording which Scryfall bulk built the card cache is not a JSON object (it is then treated as missing).',
  },
  'cli.cacheStore.provenanceUnknownBulk': {
    description:
      'That file names a bulk Ritual does not know. {bulkType} is the value it has; "bulkType" is a literal field name.',
  },
  'cli.cacheStore.provenanceMissingRecordedAt': {
    description: 'That file lacks its "recordedAt" timestamp (a literal field name).',
  },

  // ── Scryfall client ───────────────────────────────────────────────────
  'cli.scryfall.fetchingSymbology': {
    description: `${SCRYFALL_LOG} Downloading Scryfall's "symbology": the list of mana and other symbols printed on cards, used when building the site.`,
  },
  'cli.scryfall.symbolDownloadFailed': {
    description: `${SCRYFALL_LOG} One symbol image could not be downloaded. {symbol} is the symbol as printed in card text, e.g. "{W}" or "{2/U}".`,
  },
  'cli.scryfall.evictFailed': {
    description: `${SCRYFALL_LOG} A warning, followed by the error on the same line: cached printings that are no longer wanted (tokens, art cards) could not be removed from a card's cache entry. {name} is the card's name.`,
  },
  'cli.scryfall.fetchingCard': {
    description: `${SCRYFALL_LOG} Looking a card up on Scryfall because the local cache does not have it. {name} is the card's name.`,
  },
  'cli.scryfall.arenaOnly': {
    description: `${SCRYFALL_LOG} A warning: the card exists only in MTG Arena, the digital game, so it is not cached. {name} is the card's name; "arena-only" means "only on MTG Arena".`,
  },
  'cli.scryfall.cardFetchFailed': {
    description: `${SCRYFALL_LOG} A warning: Scryfall refused the lookup of one card. {name} is the card's name. ${STATUS_PAIR}`,
  },
  'cli.scryfall.cardFetchError': {
    description: `${SCRYFALL_LOG} An error, followed by the error itself on the same line: looking one card up failed (e.g. the network was down). {name} is the card's name.`,
  },
  'cli.scryfall.cachePrintingsFailed': {
    description: `${SCRYFALL_LOG} A warning, followed by the error on the same line: a card's printings (its editions) were fetched but could not be saved to the cache. {name} is the card's name.`,
  },
  'cli.scryfall.searching': {
    description: `${SCRYFALL_LOG} Running a Scryfall card search. {query} is the search as typed, in Scryfall's own search syntax.`,
  },
  'cli.scryfall.imageDownloadFailed': {
    description: `${SCRYFALL_LOG} An error, followed by the error itself on the same line: a card image could not be downloaded. {url} is the image's address.`,
  },
  'cli.scryfall.fetchingTagMetadata': {
    description: `${TAG_LOG} The first step: asking Scryfall which bulk files exist and where to download them.`,
  },
  'cli.scryfall.noTagBulkUris': {
    description: `${TAG_LOG} Scryfall's list of bulk files did not include the two tag files. "oracle_tags" and "art_tags" are their literal Scryfall names; "URIs" are download addresses. Shown inside "Failed to download tags: …".`,
  },
  'cli.scryfall.downloadingTags': {
    description: `${TAG_LOG} Downloading the two tag files.`,
  },
  'cli.scryfall.tagBulkFetchFailed': {
    description: `${TAG_LOG} Scryfall refused the download of one tag file. {url} is the file's address. ${STATUS_PAIR} Shown inside "Failed to download tags: …".`,
  },
  'cli.scryfall.tagBulkNoBody': {
    description: `${TAG_LOG} Scryfall answered the download of one tag file with an empty response. {url} is the file's address. Shown inside "Failed to download tags: …".`,
  },
  'cli.scryfall.tagDownloadFailed': {
    description: `${TAG_LOG} A warning: the tags could not be downloaded, so cards are cached without them. {reason} is why, already worded.`,
  },
  'cli.scryfall.indexedTags': {
    description: `${TAG_LOG} How many cards and artworks got tags. {oracleIds} is a count with its noun, e.g. "3 oracle ids" (an "oracle id" identifies a card across its printings); {illustrations} is a count with its noun, e.g. "2 illustrations" (artworks).`,
  },
  'cli.scryfall.oracleIdCount': {
    description: `${TAG_LOG} Fills {oracleIds} in "Indexed tags for {oracleIds} and {illustrations}." An "oracle id" is Scryfall's identifier for a card across all its printings; "id" may be translated as the language's usual abbreviation for an identifier.`,
  },
  'cli.scryfall.illustrationCount': {
    description: `${TAG_LOG} Fills {illustrations} in "Indexed tags for {oracleIds} and {illustrations}." An illustration is one card artwork.`,
  },
  'cli.scryfall.reattachingTags': {
    description: `${TAG_LOG} Attaching freshly downloaded tags to every card already in the cache. {count} is how many cards.`,
  },
  'cli.scryfall.tagsRefreshed': {
    description: `${TAG_LOG} The last line: every cached card has its tags again.`,
  },
  'cli.scryfall.bulkUrl': {
    description: `${BULK_LOG} The address of the bulk card file about to be downloaded. {url} is that address, literal.`,
  },
  'cli.scryfall.skippedMalformed': {
    description: `${BULK_LOG} A warning: some entries of the downloaded card file were not valid cards and were left out. {count} is how many.`,
  },
  'cli.scryfall.filteredOut': {
    description: `${BULK_LOG} How many downloaded printings (card editions) were deliberately left out of the cache. {count} is the total; {breakdown} is a list of counts per reason, already joined for the language, e.g. "3 arena-only, 2 tokens".`,
  },
  'cli.scryfall.excludedArenaOnly': {
    description: `${BULK_LOG} One item of the {breakdown} list in "Filtered out … printings ({breakdown})": printings that exist only in MTG Arena, the digital game. {count} is how many.`,
  },
  'cli.scryfall.excludedTokens': {
    description: `${BULK_LOG} One item of the {breakdown} list in "Filtered out … printings ({breakdown})": tokens (game pieces that are not real cards). {count} is how many.`,
  },
  'cli.scryfall.excludedArtSeries': {
    description: `${BULK_LOG} One item of the {breakdown} list in "Filtered out … printings ({breakdown})": "art series" cards (collectible art cards, not playable cards). {count} is how many.`,
  },
  'cli.scryfall.processedCards': {
    description: `${BULK_LOG} How many cards the download produced. {count} is that number.`,
  },
  'cli.scryfall.buildingTagIndex': {
    description: `${BULK_LOG} The bulk files came from a cache feed (a server that republishes Scryfall's files) and are already on disk; the tag files among them are being read. A "tag bulk" is the file Scryfall publishes card tags in.`,
  },
  'cli.scryfall.tagBuildFailed': {
    description: `${BULK_LOG} A warning: the tag files that came from the cache feed could not be read, so cards are cached without tags. {reason} is why, already worded.`,
  },
  'cli.scryfall.feedIngestDone': {
    description: `${BULK_LOG} The last line of a refresh from a cache feed: the card cache now holds the cards from the downloaded files ("artifacts").`,
  },
  'cli.scryfall.tagBulkNotArray': {
    description: `${TAG_PARSE} The file is not a list at all. "JSON array" is a technical term for a list in JSON format.`,
  },
  'cli.scryfall.tagBulkEntryNotObject': {
    description: `${TAG_PARSE} One entry is not a JSON object (a record of named fields).`,
  },
  'cli.scryfall.tagBulkMissingField': {
    description: `${TAG_PARSE} One entry lacks a required text field. One branch per field; the field names (object, id, label, slug) are literal.`,
  },
  'cli.scryfall.tagBulkBadType': {
    description: `${TAG_PARSE} One entry's "type" field is neither "oracle" nor "illustration". {type} is the value it has, literal.`,
  },
  'cli.scryfall.tagIndexNotObject': {
    description: `${TAG_LOG} Why Ritual's own saved tag index (tags.json in the cache folder) could not be read: it is not a JSON object (a record of named fields).`,
  },
  'cli.scryfall.tagIndexMissingField': {
    description: `${TAG_LOG} Why Ritual's own saved tag index (tags.json in the cache folder) could not be read: it lacks a field. One branch per field; the field names (updatedAt, oracle, illustration) are literal, and "map" means a lookup table.`,
  },

  // ── --cache-server ────────────────────────────────────────────────────
  'cli.cacheServer.addressEmpty': {
    description:
      'Usage error: the --cache-server flag or RITUAL_CACHE_SERVER environment variable is blank. {example} is the example value `localhost:4000`. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.cacheServer.addressInvalid': {
    description:
      'Usage error: the --cache-server flag or RITUAL_CACHE_SERVER environment variable is not a host name with a port. {example} is the example value `localhost:4000`; {exampleUrl} is the example URL `http://localhost:4000`. Each is typed or matched exactly by the user, so never translate them.',
  },

  // ── cache server / cache feed flags ───────────────────────────────────
  'cli.cache.refreshIntervalInvalid': {
    description:
      "Usage error: a refresh-interval flag (`cache server --cards-refresh`/`--prices-refresh`, `cache feed host`/`fetch --refresh`) or its environment variable named an unknown interval. 'daily', 'weekly' and 'monthly' are the literal values the flag accepts.",
  },
  'cli.cache.feedUrlRequired': {
    description:
      "Usage error: the peer-to-peer cache feed (an experimental way to download Ritual's card data) was asked for, but no address for it is set. {flag} is the `--url` flag, {configKey} the `cacheFeedUrl` setting, and {command} the `ritual cache feed host` command that runs a feed. Each is typed exactly by the user, so never translate them.",
  },
  'cli.cache.feedUrlNeedsFeedSource': {
    description:
      "Usage error: --url (a cache feed's address) was combined with a cache source other than the feed, so it would be ignored. 'feed' (the cache-source value) is literal. {flag} is the `--url` flag. It is typed or matched exactly by the user, so never translate it.",
  },

  // ── cache server (operator log) ───────────────────────────────────────
  'cli.cacheServer.cacheUpdate': {
    description: `${CACHE_SERVER_LOG} The server changed its cache. {fields} is a machine-readable list of key=value tokens (section=prices action=set key='Sol Ring'), never translated. Kept lowercase.`,
  },
  'cli.cacheServer.requestFailed': {
    description: `${CACHE_SERVER_LOG} Handling one HTTP request failed unexpectedly; the client gets an error reply.`,
  },
  'cli.cacheServer.feedSyncFailed': {
    description: `${CACHE_SERVER_LOG} Refreshing the card cache from the cache feed (a BitTorrent/HTTP distribution of Scryfall's card data) failed, so the server downloads from Scryfall (the card database) directly instead.`,
  },
  'cli.cacheServer.feedUrlMissing': {
    description: `${CACHE_SERVER_LOG} At startup: the settings say card refreshes come from the peer-to-peer cache feed, but no address for it is set, so the server refreshes from Scryfall instead. "feed" is the literal setting value. {urlKey} is the \`cacheFeedUrl\` setting and {flag} the \`--url\` flag; never translate them.`,
  },
  'cli.cacheServer.feedUnchanged': {
    description: `${CACHE_SERVER_LOG} The cache feed has not published anything new since the last refresh, so the cached cards are already up to date.`,
  },
  'cli.cacheServer.seedFailed': {
    description: `${CACHE_SERVER_LOG} The card cache was refreshed from the feed, but sharing ("seeding", as in BitTorrent) the feed's downloaded files with other peers failed. A warning only.`,
  },
  'cli.cacheServer.scryfallRefreshFailed': {
    description: `${CACHE_SERVER_LOG} Downloading the card data from Scryfall (the card database) failed; the server keeps running on its existing cache.`,
  },
  'cli.cacheServer.startupRefresh': {
    description: `${CACHE_SERVER_LOG} On start-up the server refreshes its card cache, and says why: one branch per reason — the cache is empty, it is older than the refresh interval (stale), or the server seeds the feed and needs its current files (seed). {source} is the configured cache source, \`scryfall\` or \`feed\`, literal.`,
  },
  'cli.cacheServer.cardsRefreshEnabled': {
    description: `${CACHE_SERVER_LOG} The card cache will be refreshed on a schedule. One branch per interval (daily, weekly, monthly — the --cards-refresh value).`,
  },
  'cli.cacheServer.cardsRefreshComplete': {
    description: `${CACHE_SERVER_LOG} A scheduled card-cache refresh finished.`,
  },
  'cli.cacheServer.cardsRefreshFailed': {
    description: `${CACHE_SERVER_LOG} A scheduled card-cache refresh failed; the next one still runs.`,
  },
  'cli.cacheServer.pricesRefreshEnabled': {
    description: `${CACHE_SERVER_LOG} Cached prices will be refreshed on a schedule. One branch per interval (daily, weekly, monthly — the --prices-refresh value).`,
  },
  'cli.cacheServer.priceBucketFailed': {
    description: `${CACHE_SERVER_LOG} A scheduled refresh of a group of cached prices failed; the group is rescheduled.`,
  },
  'cli.cacheServer.priceRefreshFailed': {
    description: `${CACHE_SERVER_LOG} A scheduled refresh of one cached price failed; it is rescheduled. {key} is its cache key — a card name, possibly with a currency after a colon (e.g. "Sol Ring:usd") — literal.`,
  },
  'cli.cacheServer.startFailed': {
    description: `${CACHE_SERVER_LOG} The server could not start listening — usually the port is already in use.`,
  },
  'cli.cacheServer.httpDenied': {
    description: `${CACHE_SERVER_LOG} The server was started with --deny-http (a test mode): it will not download anything. {flag} is the \`--deny-http\` flag. It is typed or matched exactly by the user, so never translate it.`,
  },
  'cli.cacheServer.feedDisabled': {
    description: `${CACHE_SERVER_LOG} The cache source is the feed, but --deny-http forbids downloading it, so the feed is not used. {flag} is the \`--deny-http\` flag. It is typed or matched exactly by the user, so never translate it.`,
  },
  'cli.cacheServer.verbose': {
    description: `${CACHE_SERVER_LOG} The server was started with --verbose and will log every request it serves.`,
  },
  'cli.cacheServer.seeding': {
    description: `${CACHE_SERVER_LOG} The server is sharing ("seeding", as in BitTorrent) the cache feed's files with other peers.`,
  },
  'cli.cacheServer.seedingOnPort': {
    description: `${CACHE_SERVER_LOG} The same as the previous line, naming the TCP port peers connect to. {port} is a number.`,
  },
  'cli.cacheServer.listening': {
    description: `${CACHE_SERVER_LOG} The server is up. {url} is the address clients point --cache-server at.`,
  },

  // ── --base-dir ────────────────────────────────────────────────────────
  'cli.baseDir.missing': {
    description:
      'Usage error: the --base-dir flag or the RITUAL_BASE_DIR environment variable names a directory (the workspace folder Ritual reads and writes) that does not exist; Ritual never creates it. {path} is the absolute path it resolved to. Starts lowercase, no closing period.',
  },
  'cli.baseDir.notDirectory': {
    description:
      'Usage error: the --base-dir flag or the RITUAL_BASE_DIR environment variable names a file, not a directory (the workspace folder Ritual reads and writes). {path} is the absolute path it resolved to. Starts lowercase, no closing period.',
  },
  'cli.baseDir.unreadable': {
    description:
      "Usage error: the directory named by the --base-dir flag or the RITUAL_BASE_DIR environment variable could not be checked (for example, no permission). {path} is the absolute path it resolved to; {reason} is the operating system's own message (usually English). Starts lowercase, no closing period.",
  },

  // ── config ────────────────────────────────────────────────────────────
  'cli.config.set': {
    description: '`config set` succeeded. {property} and {value} are machine values.',
  },
  'cli.config.notSet': { description: '`config get` on a property that has no value.' },
  'cli.config.entry': { description: '`config list` row for an explicitly set property.' },
  'cli.config.entryDefault': {
    description: '`config list` row for a property still at its built-in default.',
  },
  'cli.config.entryUnset': { description: '`config list` row for a property with no value.' },
  'cli.config.reset': {
    description: '`config unset` on a property that has a built-in default to fall back to.',
  },
  'cli.config.unset': { description: '`config unset` on a property with no default.' },
  'cli.config.unknownProperty': {
    description:
      'Usage error from `ritual config set`/`get`/`unset`: no setting has that name. Ritual keeps its settings in a JSON file named ritual.config.json; `ritual config set`/`get`/`unset` edit and read it by property name. {property} is the property name the user typed (a config key such as "cacheSource" or a dotted path such as "admin.gitEnabled"); never translate it. Keep the straight quotes around it. {properties} is the list of every valid property name, already joined in the reader\'s language; never translate the names.',
  },
  'cli.config.noValues': {
    description:
      'Usage error from `ritual config set`: the property was given no value. Ritual keeps its settings in a JSON file named ritual.config.json; `ritual config set`/`get`/`unset` edit and read it by property name.',
  },
  'cli.config.fieldType': {
    description:
      'The kind of value a setting holds, as a noun shown after "is a" in the two `config set` usage errors (cli.config.addRemoveScalar, cli.config.tooManyValues): text (string), true/false (boolean) or a number. One branch per kind; the branch names are code.',
  },
  'cli.config.addRemoveScalar': {
    description:
      'Usage error from `ritual config set`: --add and --remove add to or remove from a list-valued setting, and this setting holds a single value. Ritual keeps its settings in a JSON file named ritual.config.json; `ritual config set`/`get`/`unset` edit and read it by property name. {property} is the property name the user typed (a config key such as "cacheSource" or a dotted path such as "admin.gitEnabled"); Keep the straight quotes around it. {typeName} is the kind of value it holds (cli.config.fieldType: string, boolean or number). {addFlag} is the `--add` flag; {removeFlag} is the `--remove` flag. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.config.tooManyValues': {
    description:
      'Usage error from `ritual config set`: several values were given for a setting that holds one. Ritual keeps its settings in a JSON file named ritual.config.json; `ritual config set`/`get`/`unset` edit and read it by property name. {property} is the property name the user typed (a config key such as "cacheSource" or a dotted path such as "admin.gitEnabled"); never translate it. Keep the straight quotes around it. {typeName} is the kind of value it holds (cli.config.fieldType: string, boolean or number); {count} is how many values were given (always 2 or more).',
  },
  'cli.config.expectsBoolean': {
    description:
      'Usage error from `ritual config set`: a true/false setting was given another value. Ritual keeps its settings in a JSON file named ritual.config.json; `ritual config set`/`get`/`unset` edit and read it by property name. {property} is the property name the user typed (a config key such as "cacheSource" or a dotted path such as "admin.gitEnabled"); never translate it. Keep the straight quotes around it. {value} is the value as typed. "true" and "false" are the literal words to type; keep them in English.',
  },
  'cli.config.expectsNumberEmpty': {
    description:
      'Usage error from `ritual config set`: a numeric setting was given an empty value. Ritual keeps its settings in a JSON file named ritual.config.json; `ritual config set`/`get`/`unset` edit and read it by property name. {property} is the property name the user typed (a config key such as "cacheSource" or a dotted path such as "admin.gitEnabled"); never translate it. Keep the straight quotes around it.',
  },
  'cli.config.expectsNumber': {
    description:
      'Usage error from `ritual config set`: a numeric setting was given something that is not a number. Ritual keeps its settings in a JSON file named ritual.config.json; `ritual config set`/`get`/`unset` edit and read it by property name. {property} is the property name the user typed (a config key such as "cacheSource" or a dotted path such as "admin.gitEnabled"); never translate it. Keep the straight quotes around it. {value} is the value as typed.',
  },
  'cli.config.expectsInteger': {
    description:
      'Usage error from `ritual config set`: a numeric setting was given a number with a fractional part; it takes whole numbers only. Ritual keeps its settings in a JSON file named ritual.config.json; `ritual config set`/`get`/`unset` edit and read it by property name. {property} is the property name the user typed (a config key such as "cacheSource" or a dotted path such as "admin.gitEnabled"); never translate it. Keep the straight quotes around it. {value} is the value as typed.',
  },
  'cli.config.expectsNonNegativeInteger': {
    description:
      'Usage error from `ritual config set`: a numeric setting was given a negative number; it takes zero or more. Ritual keeps its settings in a JSON file named ritual.config.json; `ritual config set`/`get`/`unset` edit and read it by property name. {property} is the property name the user typed (a config key such as "cacheSource" or a dotted path such as "admin.gitEnabled"); never translate it. Keep the straight quotes around it. {value} is the value as typed.',
  },
  'cli.config.siteManaged': {
    description:
      'Usage error from `ritual config set`/`unset`: the deployment part of the "site" settings block is written by the `ritual init-site` command, so it cannot be changed this way; only the public-site selection lists can. One branch per command (set, unset): the participle and the quoted command in a branch are the same word, and only the participle is translated. {properties} is the list of property names that may be changed, already joined in the reader\'s language. {configKey} is the `site` config key; {initSiteCommand} is the `ritual init-site` command line; {configCommand} is the `config set` or `config unset` command name, matching the branch. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.config.managedOwned': {
    description:
      'Usage error from `ritual config set`/`unset`: the "managed" settings block is Ritual\'s own bookkeeping, kept current by the `ritual init-site` and `ritual migrate` commands. One branch per command (set, unset): the participle and the quoted command in a branch are the same word, and only the participle is translated. {configKey} is the `managed` config key; {configCommand} is the `config set` or `config unset` command name, matching the branch; {initSiteCommand} is the `ritual init-site` command line; {migrateCommand} is the `ritual migrate` command line. Each is typed or matched exactly by the user, so never translate them.',
  },

  // ── serve ─────────────────────────────────────────────────────────────
  'cli.serve.building': { description: '`serve --build` is building the site first.' },
  'cli.serve.noBuiltSite': {
    description:
      'Nothing to serve. {command} is the `ritual build-site` command line, with `--out-dir <path>` appended when one was given; {flag} is the `--build` flag. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.serve.cacheImagesNote': {
    description:
      '--cache-images has no effect on the live data served by `serve --api`. {flag} is the `--cache-images` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.serve.emptyCardCache': {
    description:
      '`serve --api` started with an empty card cache, so card search will find nothing.',
  },
  'cli.serve.servingWithApi': { description: 'Startup line for `serve --api`.' },
  'cli.serve.serving': { description: 'Startup line for plain `serve`.' },
  'cli.serve.cacheDownloadFailed': {
    description:
      "serve --api's warm could not bulk-download the card cache; the server starts on what the cache already holds. {reason} is the error.",
  },
  'cli.serve.startFailed': {
    description:
      'The server could not bind its port — nearly always because another process already holds it. {host} and {port} are the requested bind address; {error} is the operating system’s own message.',
  },

  // ── admin ─────────────────────────────────────────────────────────────
  'cli.admin.mcpTokenRequired': {
    description:
      '`admin --mcp` was given without a bearer token. {mcpFlag} is the `--mcp` flag; {mcpTokenFlag} is `--mcp-token <secret>`, a flag and its value; {envVar} is the `RITUAL_MCP_TOKEN` environment variable. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.admin.mcpPortConflict': {
    description:
      'The embedded MCP endpoint was pointed at the admin server’s own port. {mcpPortFlag} is the `--mcp-port` flag; {portFlag} is the `--port` flag. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.admin.preparing': { description: '`admin` is bundling assets before listening.' },
  'cli.admin.ready': { description: 'The admin assets are written; the server is about to start.' },
  'cli.admin.serverRunning': {
    description:
      'Printed to the operator’s console once the admin server is listening. {url} is the address to open, e.g. http://localhost:3001.',
  },
  'cli.serve.serverError': {
    description:
      'Printed to the operator’s console by `ritual serve` when a request failed with an error nothing handled; the error itself follows on the same line.',
  },
  'cli.serve.pageNotFound': {
    description:
      'The whole plain-text page `ritual serve` answers (HTTP 404) when a browser asks for a path with no file and no site to fall back to. The standard HTTP reason phrase; translate it as your language’s usual wording for "Not Found".',
  },
  'cli.serve.pageInternalError': {
    description:
      'The whole plain-text page `ritual serve` answers (HTTP 500) when serving a file failed unexpectedly; the details go to the operator’s console. The standard HTTP reason phrase.',
  },
  'cli.serve.enumerateFailed': {
    description:
      'Printed to the operator’s console by `ritual serve` when it could not list the deck, collection or wanted-list files the site shows (e.g. a permissions error); the server carries on with none of that kind. {reason} is the operating system’s own message.',
  },
  'cli.admin.serverError': {
    description:
      'Printed to the operator’s console when a request failed with an error nothing handled; the error itself follows on the same line.',
  },
  'cli.admin.setupRequired': {
    description:
      'Printed at startup while no admin account exists. {url} is the setup link carrying the one-time setup token; the account can only be created through it (or the {command} command). {command} is the `ritual admin setup` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.admin.teardownFailedMcp': {
    description:
      'On shutdown, the embedded MCP HTTP listener refused to close (its port may stay bound). The reason follows on the same line.',
  },
  'cli.admin.teardownFailedAdmin': {
    description:
      'On shutdown, the admin web server refused to close (its port may stay bound). The reason follows on the same line.',
  },
  'cli.admin.jsBuildFailed': {
    description:
      'Startup failure: bundling the admin web app\'s JavaScript failed. The bundler\'s own diagnostics are printed above it. "SPA" is the single-page web app; JS and CSS are file kinds.',
  },
  'cli.admin.cssBuildFailed': {
    description:
      "Startup failure: bundling the admin web app's stylesheet failed. The bundler's own diagnostics are printed above it.",
  },
  'cli.admin.cssBuildNoOutput': {
    description:
      'Startup failure: the admin stylesheet bundle finished but wrote no .css file (".css" is a file extension, kept verbatim).',
  },
  'cli.admin.promptPassword': { description: 'Password prompt of the admin account subcommands.' },
  'cli.admin.passwordCancelled': { description: 'The password prompt was cancelled.' },
  'cli.admin.usernameTooLong': { description: 'The given admin username exceeds the limit.' },
  'cli.admin.passwordTooLong': { description: 'The given admin password exceeds the limit.' },
  'cli.admin.passwordTooShort': {
    description: 'The given admin password is below the minimum length. {min} is that minimum.',
  },
  'cli.admin.noUser': {
    description:
      'An account subcommand needs an existing admin user and there is none. {command} is the `ritual admin setup` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.admin.usernameRequired': {
    description:
      '`admin setup` was run without --username. {flag} is the `--username` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.admin.userExists': { description: '`admin setup` was run but an account already exists.' },
  'cli.admin.userCreated': { description: '`admin setup` succeeded.' },
  'cli.admin.passwordReset': { description: '`admin reset-password` succeeded.' },
  'cli.admin.totpNotEnabled': {
    description: '`admin disable-totp` was run with no TOTP secret to clear.',
  },
  'cli.admin.totpDisabled': { description: '`admin disable-totp` succeeded.' },

  // ── build-site: flag and file parsing ─────────────────────────────────
  'cli.theme.unknown': {
    description:
      'Usage error of `build-site --theme` / `admin --theme`: the named colour theme does not exist. {value} is what the user typed; {choices} is the list of built-in theme names (slugs such as "izzet", never translated), already joined in the reader\'s language.',
  },
  'cli.buildSite.configThemeUnknown': {
    description:
      "A site build stops because the `site.theme` setting names a color theme that does not exist: not a built-in theme, and no custom theme file listed in `site.themeFiles` declares it. {configKey} is `site.theme` and {filesKey} is `site.themeFiles`, config keys typed by the user — never translate them. {value} is the theme name as stored. {choices} is the list of valid theme names (code words, never translated), already joined in the reader's language.",
  },
  'cli.buildSite.themeFileUnreadable': {
    description:
      'A custom theme file could not be read. {source} is where the path came from: the `--theme-file` flag or the `site.themeFiles` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.buildSite.themeFileNotJson': {
    description:
      'A custom theme file is not valid JSON. {source} is where the path came from: the `--theme-file` flag or the `site.themeFiles` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.buildSite.themeFileInvalid': {
    description:
      'A custom theme file parsed but is not a valid theme. {reason} explains why. {source} is where the path came from: the `--theme-file` flag or the `site.themeFiles` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.buildSite.spaBuildFailed': {
    description:
      'Build failure: bundling the public site\'s web app failed. The bundler\'s own diagnostics are printed above it. "SPA" is the single-page web app; {ext} is the file extension being built (".js" or ".css"), kept verbatim.',
  },
  'cli.buildSite.spaBuildNoOutput': {
    description:
      'Build failure: the public site\'s web-app bundle finished but wrote no file of the expected kind. {ext} is a file extension (".js" or ".css"), kept verbatim.',
  },
  'cli.buildSite.outDirBlank': {
    description:
      'Usage error of `build-site` / `serve`: --out-dir was given an empty value. {flag} is the `--out-dir` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.buildSite.outDirIsBase': {
    description:
      "Usage error: --out-dir points at the Ritual directory that holds the user's lists. A build deletes and replaces its output directory, and `serve` publishes it, so this would destroy or publish the lists. {base} is that directory's path. {flag} is the `--out-dir` flag. It is typed or matched exactly by the user, so never translate it.",
  },
  'cli.buildSite.outDirContainsBase': {
    description:
      'Usage error: --out-dir points at a directory that contains the Ritual directory (a parent of it), with the same danger as cli.buildSite.outDirIsBase. {dir} is the given output directory, {base} the Ritual directory, both paths. {flag} is the `--out-dir` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.buildSite.previousBuildNotRemoved': {
    description:
      'Console warning after a new site build was published: the previous build, moved aside, could not be deleted and is left on disk. {path} is where it was left.',
  },
  'cli.buildSite.localeFileNotJson': {
    description:
      'A locale file is not valid JSON. Spliced into cli.buildSite.localeFileInvalid, so it is a fragment, not a sentence.',
  },
  'cli.buildSite.localeFileNotObject': {
    description: 'A locale file parsed but is an array or a scalar. A fragment, like the above.',
  },
  'cli.buildSite.localeFileBadValue': {
    description:
      'A locale file entry is not a renderable message. {key} is the entry’s message key; {reason} is the shape parser’s explanation, already translated (e.g. "value must be a string, a $plural table, or a $select table").',
  },
  'cli.buildSite.localeFileBadTag': {
    description:
      'A --locale-file is named for something that is not a BCP-47 tag. {path} is the file as given; {reason} is the tag parser’s explanation, already translated (e.g. "invalid locale tag: de_DE"). {flag} is the `--locale-file` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.buildSite.localeFileUnreadable': {
    description:
      'A --locale-file path could not be read. {flag} is the `--locale-file` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.buildSite.localeFileInvalid': {
    description:
      'A --locale-file failed validation. {reason} is one of the fragments above. {flag} is the `--locale-file` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.buildSite.localeInvalid': {
    description:
      'The --locale value is not a valid BCP-47 tag. {flag} is the `--locale` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.buildSite.localesInvalid': {
    description:
      'A --locales value is not a valid BCP-47 tag. {flag} is the `--locales` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.buildSite.localesUnknown': {
    description:
      'A --locales tag names a locale this build has no dictionary for. RITUAL_BUNDLED_LOCALES is an env var name. {localesFlag} is the `--locales` flag; {localeFileFlag} is `--locale-file <path>`, a flag and its value; {envVar} is the `RITUAL_BUNDLED_LOCALES` environment variable. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.buildSite.bakedLocaleUndictionaried': {
    description:
      'Warning: the baked-in locale has no dictionary, so the site renders English under a non-English html lang. {flag} is `--locale-file <path>`, a flag and its value. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.buildSite.storesNotEnabled': {
    description:
      "Usage error: no store given to `build-site --price-sources` is enabled in priceSources. {stores} is the list of store tokens asked for, {sources} the enabled ones, both already joined in the reader's language. {flag} is the `--price-sources` flag; {configKey} is the `priceSources` config key; {command} is the `ritual config set priceSources --add cardhoarder` command line. Each is typed or matched exactly by the user, so never translate them.",
  },
  'cli.buildSite.storesNoneEnabled': {
    description:
      'The same usage error when priceSources enables no store at all (the config sets it to an empty list, meaning "show no prices"). {stores} is the list of store tokens asked for, already joined in the reader\'s language. {flag} is the `--price-sources` flag; {configKey} is the `priceSources` config key; {command} is the `ritual config set priceSources --add cardhoarder` command line. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.buildSite.selectionFlagEmpty': {
    description: 'A --decks/--collections/--wanted-lists flag was given with no names.',
  },

  // ── build-site: list kinds ────────────────────────────────────────────
  'cli.buildSite.loadFailed': {
    description: 'A list source could not be loaded. One branch per kind of list.',
  },
  'cli.buildSite.skippedEntry': {
    description: 'One row of the end-of-build "could not be built" summary. Keep the indentation.',
  },
  'cli.buildSite.sourceMissing': {
    description:
      'Reason a named source was skipped: there is no such file. Spliced into cli.buildSite.loadFailed as {reason}.',
  },
  'cli.buildSite.sourceAmbiguous': {
    description:
      'Reason a named source was skipped: the name matched several files. {counted} is a pre-rendered "N decks" fragment.',
  },
  'cli.buildSite.includeUnmatched': {
    description:
      "Warning: the site selection config names a list that no longer exists. {configKey} is the include list's config key path, e.g. `site.includeDecks`. It is typed or matched exactly by the user, so never translate it.",
  },
  'cli.buildSite.foundSources': {
    description:
      'Discovery result. {counted} is a pre-rendered "N decks" fragment; {names} is a comma-separated list.',
  },

  // ── build-site: progress and results ──────────────────────────────────
  'cli.buildSite.skippedHeader': {
    description:
      'Header of the end-of-build skipped summary. {counted} is a pre-rendered "N sources" fragment.',
  },
  'cli.buildSite.publishedWithout': {
    description: 'The build shipped despite the skipped sources.',
  },
  'cli.buildSite.leftUnchanged': {
    description: 'The build failed, so the previously published site is untouched.',
  },
  'cli.buildSite.nothingToBuild': {
    description:
      'There are no lists at all. {newDeckCommand} is the `ritual new deck` command line; {editCommand} is the `ritual edit` command line. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.buildSite.starting': { description: 'First line of a build.' },
  'cli.buildSite.cachingImages': { description: 'Progress line under --cache-images.' },
  'cli.buildSite.usingImageUrls': { description: 'Progress line without --cache-images.' },
  'cli.buildSite.fetchingSymbols': { description: 'Progress line: mana symbol download phase.' },
  'cli.buildSite.noSymbology': {
    description:
      'Warning: --refresh never left the symbology uncached, so symbols will be absent. {refreshNeverFlag} is `--refresh never`, a flag and its value; {refreshAutoFlag} is `--refresh auto`, a flag and its value. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.buildSite.symbolDownloadFailed': {
    description: 'One mana symbol failed to download. The error is printed after this line.',
  },
  'cli.buildSite.refreshingSymbology': {
    description: 'Card text mentioned a symbol the cached symbology does not have.',
  },
  'cli.buildSite.loadingDecks': { description: 'Progress line: deck loading phase.' },
  'cli.buildSite.loadingCollections': { description: 'Progress line: collection loading phase.' },
  'cli.buildSite.loadingWantedLists': { description: 'Progress line: wanted-list loading phase.' },
  'cli.buildSite.loadedDeck': { description: 'One deck was loaded. Keep the indentation.' },
  'cli.buildSite.loadedList': {
    description:
      'One collection or wanted list was loaded. Keep the indentation. {counted} is a pre-rendered "N cards" fragment; {price} is its total at the site\'s default store, already formatted with its currency.',
  },
  'cli.buildSite.sourceWarning': {
    description: 'A parser warning from one list file. Keep the indentation.',
  },
  'cli.buildSite.noValidEntries': {
    description: 'A list file parsed but holds no usable cards. Keep the indentation.',
  },
  'cli.buildSite.uniqueCards': {
    description: 'How many distinct card names the whole build needs.',
  },
  'cli.buildSite.cacheDownloadFailed': {
    description: 'The bulk download failed; the build continues on whatever is already cached.',
  },
  'cli.buildSite.fetchListHeader': {
    description: 'Header of the --verbose list of cards that must be fetched.',
  },
  'cli.buildSite.fetchListEntry': {
    description: 'One row of the --verbose fetch list. Keep the leading space.',
  },
  'cli.buildSite.allCardsCached': { description: '--verbose: nothing needs fetching.' },
  'cli.buildSite.fetchingData': { description: 'Progress line: per-card fetch phase.' },
  'cli.buildSite.noPricing': {
    description: 'A card has no price in one currency. {currency} is an upper-case code.',
  },
  'cli.buildSite.noCardsToPrice': { description: 'Every selected list is empty.' },
  'cli.buildSite.noPriceData': {
    description:
      'The cache holds cards but no prices. Passed to the shared "run cache preload-all" advice, which appends its own sentence.',
  },
  'cli.buildSite.buylistReady': {
    description:
      'Progress line under sell mode: the buyer feed whose prices get baked into the site is loaded. Card Kingdom is a company name; {counted} is a pre-rendered "N items" fragment counting buylist products.',
  },
  'cli.buildSite.buylistUnavailable': {
    description:
      'Warning: sell mode is on but no buylist could be loaded, so the built site carries no buy prices. Card Kingdom is a company name; {reason} is an advice sentence explaining how to get one.',
  },
  'cli.buildSite.artCopied': {
    description:
      'Progress line: local custom-art images were copied into the built site. {counted} is a pre-rendered "N files" fragment.',
  },
  'cli.buildSite.artMissing': {
    description:
      "Warning: a local image is referenced but is not in the art directory, so whatever referenced it falls back — a card to its normal art, a list's cover to the built-in one. {path} is the path as written in the sidecar or in the list's 'image' front matter; {dir} is the art directory. Keep the indentation.",
  },
  'cli.buildSite.artSidecarFailed': {
    description:
      "Warning: a list's custom-art sidecar could not be read or parsed. {reason} is the parser's own report, which names the file. Keep the indentation.",
  },
  'cli.buildSite.artCopyFailed': {
    description:
      'Warning: a custom-art image exists but copying it into the built site failed. {path} is the art-directory-relative path; {reason} is the system error. Keep the indentation.',
  },
  'cli.buildSite.artSourceUnreadable': {
    description:
      'Warning: a custom-art image could not be inspected at all (a permission denial, a broken symlink), so the card keeps its normal art. {path} is the art-directory-relative path; {reason} is the system error. Keep the indentation.',
  },
  'cli.buildSite.generatingData': { description: 'Progress line: JSON data file phase.' },
  'cli.buildSite.writingApp': { description: 'Progress line: SPA bundle phase.' },
  'cli.buildSite.writingLocales': {
    description:
      'Progress line: dictionary phase. {counted} is a pre-rendered "N files" fragment; {locale} is a BCP-47 tag.',
  },
  'cli.buildSite.writingCss': { description: 'Progress line: stylesheet phase.' },
  'cli.buildSite.writingCssCustom': {
    description: 'Progress line: stylesheet phase when --theme-file added custom themes.',
  },
  'cli.buildSite.done': { description: 'The build succeeded and published into {dir}.' },
  'cli.buildSite.failed': {
    description:
      'The site build (`build-site`, or `serve --build`) stopped on an unexpected failure, such as a network error while fetching card data. {reason} is the underlying error, usually system text in English.',
  },

  // ── init-site ─────────────────────────────────────────────────────────
  'cli.initSite.cancelled': { description: 'A prompt was cancelled, so nothing was written.' },
  'cli.initSite.distDirRequired': {
    description:
      '--dist-dir was given an empty value. {flag} is the `--dist-dir` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.initSite.promptOverwrite': {
    description: 'Confirm prompt before overwriting a generated file. {path} is repo-relative.',
  },
  'cli.initSite.promptSkills': {
    description:
      'Confirm prompt: install the Ritual agent skills into this repository? {file} is the `.claude/skills` directory. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.initSite.promptPriceSource': {
    description:
      'Select prompt: which price store (TCGplayer, Card Kingdom, Cardmarket, Cardhoarder) prices are read from by default.',
  },
  'cli.initSite.priceSourceCurrency': {
    description:
      'Hint under each store choice naming the currency it prices in. {currency} is a code such as USD, EUR or TIX.',
  },
  'cli.initSite.priceSourceCurrent': {
    description: 'Marks the store currently in effect in the picker. {store} is a store name.',
  },
  'cli.initSite.promptCi': { description: 'Select prompt: which CI system to generate for.' },
  'cli.initSite.ciGithubActions': { description: 'Choice title: GitHub Actions. A product name.' },
  'cli.initSite.ciGithubActionsHint': { description: 'Choice hint under the GitHub Actions row.' },
  'cli.initSite.ciManual': { description: 'Choice title: no CI integration.' },
  'cli.initSite.ciManualHint': { description: 'Choice hint under the manual row.' },
  'cli.initSite.promptDeploy': { description: 'Select prompt: which deploy mode to generate.' },
  'cli.initSite.deployPublish': { description: 'Choice title: Ritual builds and deploys for you.' },
  'cli.initSite.deployPublishHint': { description: 'Choice hint under the publish-for-me row.' },
  'cli.initSite.deployLocal': { description: 'Choice title: you build, the action deploys.' },
  'cli.initSite.deployLocalHint': {
    description:
      'Choice hint under the local-build row. {command} is the `build-site` command name. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.initSite.promptDistDir': { description: 'Text prompt: the built-site directory.' },
  'cli.initSite.promptChangeDetection': {
    description: 'Confirm prompt: add the changelog-committing step to the workflow?',
  },
  'cli.initSite.readmeExists': {
    description:
      'README.md exists, prompts are unavailable, and no explicit decision was given. {file} is the `README.md` file name; {overwriteReadmeFlag} is the `--overwrite-readme` flag; {noOverwriteReadmeFlag} is the `--no-overwrite-readme` flag. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.initSite.fileExists': {
    description:
      'A generated file exists and prompts are unavailable. {flag} is the `--force` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.initSite.alreadyInitializedFlags': {
    description:
      'Fresh-init flags were given in an already-initialized repository. {ciFlag} is the `--ci` flag; {deployFlag} is the `--deploy` flag; {distDirFlag} is the `--dist-dir` flag; {changeDetectionFlag} is the `--change-detection` flag; {priceSourceFlag} is the `--price-source` flag; {overwriteReadmeFlag} is the `--overwrite-readme` flag; {forceFlag} is the `--force` flag. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.initSite.manualOnlyFlags': {
    description:
      'GitHub-Actions-only flags were combined with --ci manual. {deployFlag} is the `--deploy` flag; {distDirFlag} is the `--dist-dir` flag; {changeDetectionFlag} is the `--change-detection` flag; {ciGithubActionsFlag} is `--ci github-actions`, a flag and its value. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.initSite.changeDetectionScope': {
    description:
      '--change-detection was combined with a deploy mode that has no such step. {changeDetectionFlag} is the `--change-detection` flag; {noChangeDetectionFlag} is the `--no-change-detection` flag; {deployPublishForMeFlag} is `--deploy publish-for-me`, a flag and its value. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.initSite.distDirScope': {
    description:
      '--dist-dir was combined with a deploy mode that does not build locally. {distDirFlag} is the `--dist-dir` flag; {deployLocalBuildFlag} is `--deploy local-build`, a flag and its value. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.initSite.alreadyCurrent': {
    description:
      'Re-running init-site on an initialized repository with no pending `ritual migrate` work. This is a success, not an error.',
  },
  'cli.initSite.configWriteFailed': {
    description:
      'ritual.config.json could not be written. {file} is the `ritual.config.json` file name. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.initSite.created': { description: 'A generated file was written.' },
  'cli.initSite.skipped': { description: 'A generated file was left as the user had it.' },
  'cli.initSite.gitignoreCreated': {
    description:
      '.gitignore did not exist and was written. {file} is the `.gitignore` file name. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.initSite.gitignoreUpdated': {
    description:
      '.gitignore gained the missing Ritual entries. {file} is the `.gitignore` file name. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.initSite.gitignoreUnchanged': {
    description:
      '.gitignore already had every entry. {file} is the `.gitignore` file name. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.initSite.gitignoreStillIgnores': {
    description:
      'Warning: an existing .gitignore pattern still hides the built site this deploy mode must commit. {patterns} lists the offending lines, verbatim, joined the way your language lists independent items (no conjunction). {file} is the `.gitignore` file name. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.initSite.nextSteps': { description: 'Header of the closing checklist.' },
  'cli.initSite.stepAddDecks': {
    description:
      'Checklist step 1. Keep the numbering. {file} is the `decks/` directory; {command} is the `ritual new deck` command line. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.initSite.stepPreview': {
    description: 'Checklist step 2. {command} is a ready-to-paste shell command.',
  },
  'cli.initSite.stepBuild': { description: 'Checklist step 3 for a manual (no CI) setup.' },
  'cli.initSite.stepDeployManual': { description: 'Checklist step 4 for a manual setup.' },
  'cli.initSite.stepEnablePages': {
    description: 'Checklist step 3 for GitHub Actions. The arrow path names GitHub UI menus.',
  },
  'cli.initSite.stepBuildAndCommit': {
    description: 'Checklist step 4 for a local-build deploy.',
  },
  'cli.initSite.stepPushLocal': { description: 'Checklist step 5 for a local-build deploy.' },
  'cli.initSite.stepPush': { description: 'Checklist step 4 for a publish-for-me deploy.' },
  'cli.initSite.pinVersionTip': {
    description:
      'Closing tip after a publish-for-me init. {envVar} names a GitHub Actions repository variable. {file} is the `ritual.config.json` file name; {configKey} is the `managed.version` config key; {command} is the `ritual migrate` command line; {envVar} is the `RITUAL_VERSION` environment variable. Each is typed or matched exactly by the user, so never translate them.',
  },

  // ── migrate ───────────────────────────────────────────────────────────
  'cli.migrate.noConfig': {
    description:
      '`ritual migrate` ran where there is no config file. A success. {file} is the `ritual.config.json` file name. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.migrate.upToDate': {
    description: '`ritual migrate`: no migrations or file refreshes are pending. A success.',
  },
  'cli.migrate.pending': {
    description:
      'Shown by `migrate --check` and by re-running `init-site` when the workspace needs migrating. {command} is the `ritual migrate` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.migrate.planHeading': {
    description: 'Heading above the list of changes `ritual migrate` is about to make.',
  },
  'cli.migrate.migrationHeading': {
    description:
      'One numbered migration in the plan. {id} is its number; {description} is the description of that migration, already rendered.',
  },
  'cli.migrate.opConfigSet': {
    description:
      'Plan line (indented): a config key will be set. {path} is a dotted key path, {value} its JSON value. {file} is the `ritual.config.json` file name. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.migrate.opConfigDelete': {
    description:
      'Plan line (indented): a config key will be removed. {path} is a dotted key path. {file} is the `ritual.config.json` file name. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.migrate.opWrite': {
    description: 'Plan line (indented): a workspace file will be written. {path} is relative.',
  },
  'cli.migrate.opDelete': {
    description: 'Plan line (indented): a workspace file will be deleted. {path} is relative.',
  },
  'cli.migrate.opRename': {
    description: 'Plan line (indented): a workspace file will be moved from {from} to {to}.',
  },
  'cli.migrate.refreshHeading': {
    description:
      'Heading above the generated files (deploy workflow, .gitignore entries, agent skills) a refresh rewrites.',
  },
  'cli.migrate.refreshGitignore': {
    description:
      'Plan line (indented): {entries} is a comma-separated list of .gitignore patterns to append. {file} is the `.gitignore` file name. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.migrate.refreshSkill': {
    description: 'Plan line (indented): an installed agent skill {name} is rewritten.',
  },
  'cli.migrate.refreshRecordOnly': {
    description:
      'Plan line (indented): the generated files already match; only their hash is recorded in ritual.config.json.',
  },
  'cli.migrate.refreshRemoveSkill': {
    description:
      'Plan line (indented): an installed agent skill {name} that Ritual no longer ships is deleted.',
  },
  'cli.migrate.pinBump': {
    description:
      'Plan line: the CI pin (the Ritual release the deploy workflow downloads) moves from release {previous} to the running release {version}.',
  },
  'cli.migrate.pinBumpNew': {
    description:
      'Plan line: the workspace has no CI pin yet; it will be pinned to the running release {version}.',
  },
  'cli.migrate.dryRunDone': {
    description: 'Closing line of `migrate --dry-run`, after the plan.',
  },
  'cli.migrate.confirm': { description: 'Yes/no prompt before `ritual migrate` applies its plan.' },
  'cli.migrate.cancelled': { description: 'The user declined the `ritual migrate` prompt.' },
  'cli.migrate.applied': {
    description:
      'A numbered migration was applied. {id} is its number; {description} is the description of that migration, already rendered.',
  },
  'cli.migrate.backedUp': {
    description:
      'Printed after migrations ran. {path} is the workspace-relative backup folder (e.g. ".backups/2026-10-05T14-03-22Z-migration-1") holding copies of ritual.config.json and every file the migrations rewrote, removed or moved, taken before they ran.',
  },
  'cli.migrate.wrote': { description: 'A generated file was rewritten. {path} is relative.' },
  'cli.migrate.skillUpdated': { description: 'An installed agent skill {name} was rewritten.' },
  'cli.migrate.skillRemoved': {
    description: 'An installed agent skill {name} that Ritual no longer ships was deleted.',
  },
  'cli.migrate.pinned': {
    description: 'The CI pin was moved to release {version} (the running Ritual).',
  },
  'cli.migrate.done': { description: 'Closing line after `ritual migrate` applied everything.' },
  'cli.migrate.devBuild': {
    description:
      'Warning after a development build applied migrations. {version} is the running version; {pinned} is the release CI keeps downloading. {configKey} is the `managed.version` config key; {command} is the `ritual migrate` command line. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.migrate.devBuildNoPin': {
    description:
      'The same warning when the workspace has no pinned release, so CI falls back to the newest release (latest stable, else newest prerelease). {version} is the running version. {configKey} is the `managed.version` config key; {command} is the `ritual migrate` command line. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.migrate.ahead': {
    description:
      'Refusal: a newer Ritual release last updated the workspace. {version} is that release (appears twice; the second completes the backticked command). {command} is the `ritual self-update --tag` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.migrate.aheadNoVersion': {
    description:
      'The same refusal when no release was recorded. {applied}/{latest} are migration numbers. {command} is the `ritual self-update` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.migrate.changedSincePlan': {
    description:
      'Refusal: the config file changed between planning and applying. {file} is the `ritual.config.json` file name; {commandName} is the `migrate` command name; {command} is the `ritual migrate` command line. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.migrate.invalid': {
    description:
      "Refusal: the migrated config still fails validation. {error} is the validation message, a phrase of its own already in the reader's language. {file} is the `ritual.config.json` file name; {command} is the `ritual migrate` command line. Each is typed or matched exactly by the user, so never translate them.",
  },
  'cli.migrate.offer': {
    description:
      'Yes/no question asked before an ordinary command runs, after the list of pending workspace updates. Yes applies the updates and then the command continues. {command} is the `ritual migrate` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.migrate.offerDeclined': {
    description:
      'Printed after the user answers no to cli.migrate.offer; the command then continues. Ritual asks at most once a day per workspace. {command} is the `ritual migrate` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.migrate.notice.pending': {
    description:
      'One stderr line printed before an ordinary command when the workspace has updates `ritual migrate` would apply and Ritual cannot (or already did today) ask. The command still runs. {migrateDryRunCommand} is the `ritual migrate --dry-run` command line; {migrateCommand} is the `ritual migrate` command line. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.migrate.notice.pendingConfig': {
    description:
      'Variant of cli.migrate.notice.pending when the config file will also print validation warnings that applying the updates fixes. {file} is the `ritual.config.json` file name; {migrateDryRunCommand} is the `ritual migrate --dry-run` command line; {migrateCommand} is the `ritual migrate` command line. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.migrate.notice.ahead': {
    description:
      'One stderr warning before a command when a newer Ritual release last updated the workspace; the command still runs. {version} is that release (appears twice), {current} is the running build; the second {version} completes the backticked command. {command} is the `ritual self-update --tag` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.migrate.notice.aheadNoVersion': {
    description:
      'The same warning when no release was recorded. {applied}/{latest} are migration numbers. {command} is the `ritual self-update` command line. It is typed or matched exactly by the user, so never translate it.',
  },

  // ── self-update ───────────────────────────────────────────────────────
  'cli.selfUpdate.upToDate': {
    description:
      '`self-update` found nothing newer. {current} is the running version; {latest} is the newest release on the channel it checked (stable, or prereleases included).',
  },
  'cli.selfUpdate.alreadyInstalled': {
    description:
      '`self-update --version` named the release that is already running. {version} is it.',
  },
  'cli.selfUpdate.available': {
    description:
      '`self-update --check` found a release to install. {latest} is that release; {current} is the running version.',
  },
  'cli.selfUpdate.downgradeAvailable': {
    description:
      '`self-update --check --tag` named a release older than the running one. {latest} is that release; {current} the running version; → reads "to".',
  },
  'cli.selfUpdate.confirm': {
    description:
      'Yes/no question before `self-update` replaces the running binary with a newer release. {current} → {target} are version numbers.',
  },
  'cli.selfUpdate.confirmDowngrade': {
    description:
      'The same question when `--version` named an older release than the running one. {current} → {target} are version numbers.',
  },
  'cli.selfUpdate.cancelled': {
    description: 'The user answered no to the update question; nothing was changed.',
  },
  'cli.selfUpdate.downloading': {
    description:
      'Progress line while the release binary downloads. {tag} is the release tag (e.g. v1.2.0).',
  },
  'cli.selfUpdate.updated': {
    description:
      'The new binary replaced the old one. {current} → {target} are version numbers; {path} is the replaced file.',
  },
  'cli.selfUpdate.checkingWorkspace': {
    description:
      'Heading printed after an update inside a workspace, before the new release previews (but does not apply) the workspace updates it wants. {version} is the new release.',
  },
  'cli.selfUpdate.workspaceCheckFailed': {
    description:
      'Warning when the new binary could not be started to preview workspace updates; the update itself succeeded. {error} is the English system error. {command} is the `ritual migrate --dry-run` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.selfUpdate.refuse.notRelease': {
    description:
      'Refusal: the running Ritual is not a downloaded release binary (a source checkout or local build), so there is nothing self-update can safely replace. {version} is its version string. {command} is the `self-update` command name. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.selfUpdate.refuse.docker': {
    description:
      'Refusal inside the Docker image: the image must be updated, not the binary. {command} is the `self-update` command name; {dockerCommand} is the `docker pull ghcr.io/sloshy/ritual` command line. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.selfUpdate.refuse.notWritable': {
    description:
      'Refusal: the directory holding the Ritual binary cannot be written, so the binary cannot be replaced. {dir} is that directory.',
  },
  'cli.selfUpdate.error.invalidTag': {
    description:
      'The `--tag` value is not a release version. {tag} is what the user typed; the example tags are literal.',
  },
  'cli.selfUpdate.error.unsupportedPlatform': {
    description:
      'No release binary exists for this operating system/CPU. {platform}/{arch} are Node.js platform and architecture names (e.g. linux/x64).',
  },
  'cli.selfUpdate.error.network': {
    description:
      'The GitHub request failed before an answer arrived. {url} is the address; {error} the English system error.',
  },
  'cli.selfUpdate.error.http': {
    description:
      'GitHub answered with an HTTP error. {status} is the HTTP status number; {url} the address.',
  },
  'cli.selfUpdate.error.rateLimited': {
    description:
      'GitHub refused the request (HTTP {status}), most likely its API rate limit for anonymous callers. {url} is the address. {envVar} is the `GITHUB_TOKEN` environment variable. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.selfUpdate.error.redirectRefused': {
    description:
      'Refusal: an authenticated GitHub API request was redirected to a different site, which would have received the token. {url} and {location} are addresses. {envVar} is the `GITHUB_TOKEN` environment variable (it appears twice). It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.selfUpdate.error.badResponse': {
    description:
      "GitHub answered, but not with the release data Ritual expects. {url} is the address; {error} says what was wrong — one of the cli.selfUpdate.release.* phrases, already in the reader's language, or the JSON parser's own (English) error.",
  },
  'cli.selfUpdate.error.noStableRelease': {
    description:
      'Only prereleases exist so far, so the stable channel has nothing to install. {command} is the `ritual self-update --prerelease` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.selfUpdate.error.noRelease': {
    description: 'The prerelease channel found no release at all.',
  },
  'cli.selfUpdate.error.tagNotFound': {
    description:
      '`self-update --version` named a tag with no release. {tag} is the tag (e.g. v1.2.0).',
  },
  'cli.selfUpdate.error.missingAsset': {
    description:
      'The release has no compressed archive (.tar.gz or .zip) for this platform, so nothing is installed. {tag} is the release tag; {asset} the expected archive file name. The second sentence explains that old prereleases (before version 0.1.0-rc4) only published uncompressed binaries, which the updater no longer accepts; keep the version literal.',
  },
  'cli.selfUpdate.error.missingChecksum': {
    description:
      'The release has no .sha256 checksum file for the archive, so it cannot be verified and is not installed. {tag} is the release tag; {asset} the archive file name.',
  },
  'cli.selfUpdate.error.badChecksumFile': {
    description:
      "The .sha256 checksum file could not be read. {asset} is the archive file name; {error} says why — one of the cli.selfUpdate.checksum.* phrases, already in the reader's language.",
  },
  'cli.selfUpdate.error.sizeMismatch': {
    description:
      'The download is not the size GitHub listed (a truncated or altered download). {asset} is the file name; {actual}/{expected} are byte counts.',
  },
  'cli.selfUpdate.error.checksumMismatch': {
    description:
      'The download does not match its published SHA-256 checksum. {asset} is the file name; {expected}/{actual} are hex digests.',
  },
  'cli.selfUpdate.error.badArchive': {
    description:
      "The downloaded archive (already checked against its .sha256 file) could not be unpacked, so nothing was installed. {asset} is the archive's file name; {error} says why — one of the cli.selfUpdate.archive.* phrases, already in the reader's language.",
  },
  'cli.selfUpdate.error.smokeTest': {
    description:
      "The downloaded binary was run with --version as a test and did not answer with the expected version. {expected} is that version; {detail} is the version it printed instead (untranslated), or why it printed none — one of the cli.selfUpdate.smoke.* phrases, already in the reader's language.",
  },
  'cli.selfUpdate.error.swapStranded': {
    description:
      'Windows only, rare: the old binary was moved aside but neither the new one nor the old one could be moved back into place. {target} is the binary path; {old} and {kept} are where the previous and the new binary now are; {error} is the English system error.',
  },
  'cli.selfUpdate.previewExit': {
    description:
      'Spliced into cli.selfUpdate.workspaceCheckFailed as {error} when the new binary ran but exited unsuccessfully. {exitCode} is the process exit code.',
  },
  'cli.selfUpdate.error.installFailed': {
    description:
      "Writing or moving the new binary into place failed; the old binary still works. {path} is the binary file; {error} the system error (usually English), or cli.selfUpdate.install.diskFull already in the reader's language.",
  },

  'cli.selfUpdate.release.notObject': {
    description: `${RELEASE_REASON} The whole release GitHub sent is not a JSON object.`,
  },
  'cli.selfUpdate.release.listNotList': {
    description: `${RELEASE_REASON} The list of recent releases GitHub sent is not a JSON array.`,
  },
  'cli.selfUpdate.release.inList': {
    description: `${RELEASE_REASON} Names which entry of the release list was refused: {index} is its 0-based position, and {reason} why — another of these phrases, already in the reader's language. "release" here is that entry; keep the colon layout.`,
  },
  'cli.selfUpdate.release.fieldMissing': {
    description: `${RELEASE_REASON} ${RELEASE_FIELD} The field is absent.`,
  },
  'cli.selfUpdate.release.fieldNotText': {
    description: `${RELEASE_REASON} ${RELEASE_FIELD} The field is present but is not text, or is empty text.`,
  },
  'cli.selfUpdate.release.fieldNotBoolean': {
    description: `${RELEASE_REASON} ${RELEASE_FIELD} The field must be JSON true or false.`,
  },
  'cli.selfUpdate.release.fieldNotList': {
    description: `${RELEASE_REASON} ${RELEASE_FIELD} The field must be a JSON array.`,
  },
  'cli.selfUpdate.release.fieldNotObject': {
    description: `${RELEASE_REASON} ${RELEASE_FIELD} The field must be a JSON object.`,
  },
  'cli.selfUpdate.release.fieldNotHttpsUrl': {
    description: `${RELEASE_REASON} ${RELEASE_FIELD} The field must be a web address starting with https:// (where the file is downloaded from). "https" is literal.`,
  },
  'cli.selfUpdate.release.fieldNotByteCount': {
    description: `${RELEASE_REASON} ${RELEASE_FIELD} The field must be a file size in bytes: a whole number, zero or greater.`,
  },
  'cli.selfUpdate.release.fieldNotVersion': {
    description: `${RELEASE_REASON} ${RELEASE_FIELD} The release's tag is not a version Ritual can install (such as v1.2.0). {value} is the tag as GitHub sent it; keep the straight quotes around it.`,
  },
  'cli.selfUpdate.checksum.malformed': {
    description: `${CHECKSUM_REASON} The file does not start with a SHA-256 digest (64 hexadecimal digits), optionally followed by the name of the file it is for. "SHA-256" is literal.`,
  },
  'cli.selfUpdate.checksum.otherFile': {
    description: `${CHECKSUM_REASON} The digest names a different file than the archive being installed. {file} is the name the checksum file gives; {asset} the archive's file name. Never translate either.`,
  },
  'cli.selfUpdate.archive.damaged': {
    description: `${ARCHIVE_REASON} Its contents are corrupt: a header, checksum or the compressed data does not read back correctly.`,
  },
  'cli.selfUpdate.archive.tooLarge': {
    description: `${ARCHIVE_REASON} It would unpack to more than a safety limit, so it was not unpacked. {size} is that limit, already formatted (e.g. 512 MB).`,
  },
  'cli.selfUpdate.archive.unexpectedEntry': {
    description: `${ARCHIVE_REASON} It holds a file other than the binary (an entry not named exactly like it, such as ../ritual), which is refused, so nothing it names is ever written. {entry} is that entry's path as the archive gives it; {member} the binary's file name (ritual or ritual.exe). Never translate either.`,
  },
  'cli.selfUpdate.archive.extraEntry': {
    description: `${ARCHIVE_REASON} It holds a second entry after the binary (another file, or the binary again), which is refused. {entry} is that second entry's path as the archive gives it; never translate it.`,
  },
  'cli.selfUpdate.archive.notAFile': {
    description: `${ARCHIVE_REASON} The entry with the binary's name is a directory, link or other special entry, not an ordinary file. {member} is the binary's file name (ritual or ritual.exe); never translate it.`,
  },
  'cli.selfUpdate.archive.missingMember': {
    description: `${ARCHIVE_REASON} It is empty: the binary is not in it. {member} is the binary's file name (ritual or ritual.exe); never translate it.`,
  },
  'cli.selfUpdate.archive.unsupportedZip': {
    description: `${ARCHIVE_REASON} The zip archive uses a feature Ritual does not read. "zip" and "zip64" are literal format names.`,
  },
  'cli.selfUpdate.install.diskFull': {
    description:
      'Why the new binary could not be written: the disk stopped taking data (it is likely full). Starts lowercase with no closing period: shown as {error} inside cli.selfUpdate.error.installFailed.',
  },
  'cli.selfUpdate.smoke.timedOut': {
    description: `${SMOKE_REASON} It did not answer before the time limit.`,
  },
  'cli.selfUpdate.smoke.exited': {
    description: `${SMOKE_REASON} It failed: {exitCode} is the process exit code (a number) and {output} the start of what it printed, on one line (untranslated). Keep the colon layout.`,
  },
  'cli.selfUpdate.smoke.exitedSilently': {
    description: `${SMOKE_REASON} It failed without printing anything: {exitCode} is the process exit code (a number).`,
  },
  'cli.selfUpdate.smoke.noOutput': {
    description: `${SMOKE_REASON} It ran successfully but printed nothing at all.`,
  },

  // ── update-available notice ───────────────────────────────────────────
  'cli.sidecarNotice.introduction': {
    description:
      "Printed once per workspace, the first time a command creates a `.sha256` sidecar file next to a list: what the files are for (telling Ritual's own writes apart from hand edits, so a hand edit gets logged in the list's change history) and that they belong in version control. {file} is the `.sha256` file extension, never translated.",
  },
  'cli.updateNotice.available': {
    description:
      "One stderr line printed after a command's own output, at most once a day per release, when a newer Ritual release exists. {latest} is that release's version, {current} the running one. {command} is the `ritual self-update` command line. It is typed or matched exactly by the user, so never translate it.",
  },

  // ── the per-user state file ───────────────────────────────────────────
  'cli.userState.fileNotObject': {
    description:
      'Why the per-user state file (state.json: what Ritual remembers between runs, like when it last checked for updates) was set aside: it is valid JSON but not an object ({ … }). Ritual then starts from an empty state. Starts lowercase with no closing period: it reads as a reason.',
  },
  'cli.userState.sectionNotObject': {
    description:
      'Why one section of the per-user state file (state.json) was set aside: it is not a JSON object ({ … }). {section} is the section’s key in the file ("migratePrompts" or "updateCheck") and is never translated. Starts lowercase with no closing period: it reads as a reason.',
  },

  // ── skills ────────────────────────────────────────────────────────────
  'cli.skills.resultWritten': { description: 'One skill file was installed or refreshed.' },
  'cli.skills.resultUpToDate': {
    description: 'One skill file already matched the current version.',
  },
  'cli.skills.resultSkipped': {
    description: 'One skill file was left alone because it has local edits.',
  },
  'cli.skills.resultAbsent': {
    description: 'One skill is not installed, so `skills update` had nothing to refresh.',
  },
  'cli.skills.forceHintRerun': {
    description:
      'How to overwrite locally edited skills, phrased for the `skills` subcommands. Spliced into cli.skills.skipped as {forceHint}. {flag} is the `--force` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.skills.forceHintInit': {
    description:
      'The same hint phrased for a fresh `init-site`, whose flag is --force. {flag} is the `--force` flag. It is typed or matched exactly by the user, so never translate it.',
  },

  // ── mcp ───────────────────────────────────────────────────────────────
  'cli.mcp.refusingUnauthenticated': {
    description:
      'The HTTP transport was pointed at a public interface with no bearer token. {tokenFlag} is `--token <secret>`, a flag and its value; {envVar} is the `RITUAL_MCP_TOKEN` environment variable; {allowUnauthenticatedFlag} is the `--allow-unauthenticated` flag. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.mcp.unauthenticatedWarning': {
    description:
      'The above refusal was overridden with --allow-unauthenticated. {flag} is the `--allow-unauthenticated` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.mcp.unauthenticatedLoopback': {
    description: 'Serving without a token, which is tolerable because the host is loopback-only.',
  },
  'cli.mcp.httpTeardownFailed': {
    description: 'The MCP HTTP listener refused to close. The error follows on the same line.',
  },
  'cli.mcp.httpListening': {
    description:
      'Printed to the operator’s console once `ritual mcp --transport http` is accepting connections. {url} is the endpoint address an MCP client connects to.',
  },
  'cli.mcp.httpError': {
    description:
      'Printed to the operator’s console when the MCP protocol layer reports an error on the HTTP transport; the error itself follows on the same line.',
  },
  'cli.mcp.httpRequestFailed': {
    description:
      'Printed to the operator’s console when one MCP HTTP request failed with an unexpected error (the client is told only that the server failed); the error itself follows on the same line.',
  },
  'cli.mcp.stdioError': {
    description:
      'Printed to the console’s error stream when the MCP protocol layer reports an error on the stdio transport (standard input/output, the pipe a local AI client talks over); the error itself follows on the same line.',
  },
  'cli.mcp.stdioTeardownFailed': {
    description:
      'Printed to the console’s error stream when the MCP stdio transport could not close cleanly on shutdown; the error itself follows on the same line.',
  },
  'cli.mcp.listChangedFailed': {
    description:
      'Printed to the console’s error stream when the MCP server could not tell its client that the set of lists changed (the write itself succeeded). "resources/list_changed" is the protocol’s notification name — keep it exactly. The error itself follows on the same line.',
  },
  'cli.mcp.endpointNotFound': {
    description:
      'Error message (HTTP 404) the MCP HTTP server answers a request to any path but its one endpoint. {path} is that endpoint’s path (e.g. "/mcp"), literal.',
  },
  'cli.mcp.removal.prompt': {
    description:
      'A question an AI client shows its user during a collection sync: some copies of a card were removed on Archidekt (a collection-tracking website), and they live in several local collection lists, so the user must say which lists give them up. {quantity} is how many copies left, {card} the card’s name and printing, {lists} the lists holding it, already joined (e.g. “"binder" (1) and "box" (2)”). The form shows one number field per list beneath this text.',
  },
  'cli.mcp.removal.field': {
    description:
      'The help text under one number field of the collection-sync question above: how many copies to take out of the list {list}, which currently holds {copies} copies.',
  },
  'cli.mcp.task.status.working': {
    description:
      'Status line of a long operation an AI client started on Ritual (building the site, syncing with Archidekt, refreshing the card cache) and now tracks as a background task. The client shows it to its user in a task list. Shown while the work runs and before it has reported a step. Keep it short.',
  },
  'cli.mcp.task.status.awaitingInput': {
    description:
      'Task status line (see cli.mcp.task.status.working): the collection sync stopped to ask the user which collection lists give up removed cards, and waits for the answer in the client’s form.',
  },
  'cli.mcp.task.status.cancelling': {
    description:
      'Task status line (see cli.mcp.task.status.working): the user cancelled the task, and the work is finishing its current step before it stops.',
  },
  'cli.mcp.task.status.cancelled': {
    description:
      'Task status line (see cli.mcp.task.status.working): the task was cancelled. Work finished before the cancel (e.g. decks already synced) is kept.',
  },
  'cli.mcp.task.status.completed': {
    description:
      'Task status line (see cli.mcp.task.status.working): the task finished successfully.',
  },
  'cli.mcp.task.status.toolError': {
    description:
      'Task status line (see cli.mcp.task.status.working): the task ran to its end but the operation reported an error, which the AI agent reads from the task’s result.',
  },
  'cli.mcp.task.status.failed': {
    description:
      'Task status line (see cli.mcp.task.status.working): the task broke off with an unexpected error. {reason} is the error’s own text, which is always English (it is written for the AI agent); keep it as it is.',
  },
  'cli.mcp.task.buildSite.published': {
    description:
      'Task status line (see cli.mcp.task.status.working) of a static-site build: the new site is in place; the task is about to report it finished.',
  },
  'cli.mcp.tasks.unavailable': {
    description:
      'Printed once to the operator’s console when the Ritual MCP server starts and finds its MCP library cannot run long operations as background tasks (a protocol feature called the Tasks extension); the server then runs them the ordinary way, waiting for each to finish. "MCP" and "SDK" are technical names; leave them.',
  },
  'cli.mcp.task.buildSite.starting': {
    description:
      'Task status line (see cli.mcp.task.status.working) of a static-site build: preparing to build.',
  },
  'cli.mcp.task.buildSite.building': {
    description:
      'Task status line (see cli.mcp.task.status.working) of a static-site build: the site is being generated.',
  },
  'cli.mcp.task.buildSite.publishing': {
    description:
      'Task status line (see cli.mcp.task.status.working) of a static-site build: the finished site is being swapped into place.',
  },
  'cli.mcp.task.refreshCache.progress': {
    description:
      'Task status line (see cli.mcp.task.status.working) of a card-data cache refresh (a large download). {percent} is a whole number from 0 to 100.',
  },
  'cli.mcp.task.syncDecks.progress': {
    description:
      'Task status line (see cli.mcp.task.status.working) of a deck sync with Archidekt (a deck-building website): working on deck number {current} out of {total}.',
  },
  'cli.mcp.task.syncCollection.progress': {
    description:
      'Task status line (see cli.mcp.task.status.working) of a collection sync with Archidekt (a collection-tracking website): working on local collection list number {current} out of {total}.',
  },
  'cli.mcp.stdioIgnoredFlags': {
    description:
      'HTTP-only flags were passed under --transport stdio. {flags} is a flag list. {flag} is `--transport http`, a flag and its value. It is typed or matched exactly by the user, so never translate it.',
  },

  // ── dep-license ───────────────────────────────────────────────────────
  'cli.depLicense.noText': {
    description:
      'Stands in for a dependency that ships no license file. SPDX is the license-identifier standard.',
  },
  'cli.depLicense.primaryHeader': {
    description: 'Section header of `dep-license --list`: direct dependencies.',
  },
  'cli.depLicense.transitiveHeader': {
    description: 'Section header of `dep-license --list`: indirect dependencies.',
  },
  'cli.depLicense.listWithPackage': {
    description:
      '`dep-license` was given both a package name and --list. {flag} is the `--list` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.depLicense.packageNotFound': {
    description:
      'No bundled dependency has that name. {command} is the `ritual dep-license --list` command line. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.depLicense.needsPackage': {
    description:
      'The dependency picker needs a terminal. {reason} explains which half is missing. {flag} is the `--list` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.depLicense.promptSelect': { description: 'Autocomplete prompt of the dependency picker.' },
  'cli.depLicense.primarySeparator': {
    description: 'Disabled divider row above the direct dependencies in the picker.',
  },
  'cli.depLicense.transitiveSeparator': {
    description: 'Disabled divider row above the indirect dependencies in the picker.',
  },

  // ── price: report output ──────────────────────────────────────────────
  'cli.price.disclaimer': {
    description: 'Footer of every price report. NM is the Near Mint card condition.',
  },
  'cli.price.pricingList': {
    description:
      'Announces which single list is being priced. {suffix} is an ellipsis for the non-interactive run and empty otherwise.',
  },
  'cli.price.emptyCache': {
    description:
      'Prices need the card cache and it is empty. Passed to the shared "run cache preload-all" advice, which appends its own sentence.',
  },
  'cli.price.calculating': { description: 'Progress line while the report is built.' },
  'cli.price.listFooter': {
    description: 'Footer of a single list’s printed detail. Keep the indentation.',
  },
  'cli.price.searchFooter': { description: 'Footer of a card-filter search result.' },

  // ── price: the interactive browser ────────────────────────────────────
  'cli.price.totalsTotal': {
    description: 'The total value segment. {price} is already formatted.',
  },
  'cli.price.totalsLowest': {
    description:
      'The cheapest-printing total, shown only when it differs from the total: what the cards would cost if every one were bought at its cheapest printing.',
  },
  'cli.price.legendLineTotals': {
    description:
      "Legend line under a printed price listing: each row's price covers all its copies, and the row's trailing 'lowest' (cli.price.rowLowest) is those copies at the cheapest printing. Quote 'lowest' the way cli.price.rowLowest renders it.",
  },
  'cli.price.legendUnpinned': {
    description:
      'Legend line under a printed price listing, explaining the * after a printing: the list line pins no printing, so the printing shown is a representative one. Keep the leading *, which is the marker itself.',
  },
  'cli.price.legendEstimate': {
    description:
      'Legend line under a price listing whose total is prefixed ~ (domain.price.estimated). Keep the leading ~, which is the marker itself.',
  },
  'cli.price.legendLowestTotal': {
    description:
      "Legend line under a price listing with a 'Lowest possible' total (cli.price.totalsLowest). Quote 'Lowest possible' the way cli.price.totalsLowest renders it.",
  },
  'cli.price.rowLowest': {
    description:
      'Trailing note on one card\'s row in the price browser and price report: what its copies would cost at the cheapest printing, when that differs from the price shown. {price} is the formatted amount. Follows a " · " separator, so it stays lowercase in English.',
  },
  'cli.price.totalsUnpriced': { description: 'How many entries have no price at all.' },
  'cli.price.headerUpdated': {
    description:
      'Top line of the browser: price age, the store prices come from ({store}, a store name such as TCGplayer or Card Kingdom), and its currency ({currency}, an upper-case code).',
  },
  'cli.price.updatedUnknown': { description: 'The price cache carries no refresh timestamp.' },
  'cli.price.updatedAt': {
    description: 'An absolute timestamp plus its relative age, e.g. "… (2 hours ago)".',
  },
  'cli.price.headerTypeTotals': {
    description: 'One per-type totals row. {icon} is an emoji; {title} is a plural list-type name.',
  },
  'cli.price.headerGrandTotals': { description: 'The across-all-types totals row.' },
  'cli.price.listRow': {
    description:
      'One list’s row in the browser’s main menu. {icon} is an emoji, {name} the list name, {totals} the already-formatted price totals, {count} how many cards the list holds.',
  },
  'cli.price.menuSearch': { description: 'Main menu action: search every list’s cards.' },
  'cli.price.menuRefresh': { description: 'Main menu action: redownload prices.' },
  'cli.price.menuStore': {
    description:
      'Main menu action: switch the store prices come from (which also sets the currency).',
  },
  'cli.price.menuExit': { description: 'Main menu action: leave the browser.' },
  'cli.price.menuBack': { description: 'Return to the previous screen.' },
  'cli.price.controlSort': { description: 'The sort control row of a card browser screen.' },
  'cli.price.directionAscending': { description: 'Sort direction: smallest first.' },
  'cli.price.directionDescending': { description: 'Sort direction: largest first.' },
  'cli.price.controlSetFilter': {
    description: 'The set-code filter row. {value} is an upper-case set code or "all".',
  },
  'cli.price.controlCollectorFilter': { description: 'The collector-number filter row.' },
  'cli.price.controlTypeFilter': { description: 'The list-type filter row.' },
  'cli.price.filterAll': { description: 'Value shown on a filter row when nothing is filtered.' },
  'cli.price.detailList': {
    description: 'Card detail: which list and section the entry lives in. Keep the indentation.',
  },
  'cli.price.detailRepresentative': {
    description: 'Card detail: the entry pins no printing, so the one shown is only illustrative.',
  },
  'cli.price.detailPrice': {
    description: 'Card detail: unit price, optionally followed by cli.price.detailLineTotal.',
  },
  'cli.price.detailLineTotal': {
    description: 'The line total appended when an entry holds more than one copy.',
  },
  'cli.price.detailUnpriced': {
    description:
      'Card detail: why this entry has no price. {reason} is one of cli.price.unpriced*.',
  },
  'cli.price.detailLowest': { description: 'Card detail: the cheapest printing and its price.' },
  'cli.price.detailTypeLine': {
    description: 'Card detail: the card’s type line and mana value. {typeLine} is card data.',
  },
  'cli.price.detailEdhrec': {
    description: 'The EDHREC popularity rank, appended to the type line. EDHREC is a site name.',
  },
  'cli.price.unpricedNoPrintings': {
    description: 'Unpriced reason: the card is not cached at all.',
  },
  'cli.price.unpricedPrintingNotFound': {
    description: 'Unpriced reason: the pinned printing is not cached.',
  },
  'cli.price.unpricedCurrencyUnavailable': {
    description: 'Unpriced reason: paper cards have no MTGO price and vice versa.',
  },
  'cli.price.unpricedFinishUnpriced': {
    description: 'Unpriced reason: the foil/etched finish has no quote in this currency.',
  },
  'cli.price.unpricedNoPriceData': {
    description: 'Unpriced reason: the printing is cached but carries no price.',
  },
  'cli.price.unpricedProxy': {
    description:
      'Unpriced reason: the card carries the proxy label, so it is not a real card and has no price.',
  },
  'cli.price.unpricedCustomArt': {
    description:
      'Unpriced reason: the card has been given custom art, so it is no longer the printing a price could be quoted for.',
  },
  'cli.price.markerProxy': {
    description:
      'Shown in the price column instead of an amount, for a card labeled as a proxy. Short and uppercase, like a stamp; it replaces a price such as "$4.99".',
  },
  'cli.price.markerCustomArt': {
    description:
      'Shown in the price column instead of an amount, for a card given custom art. Short and uppercase, like a stamp; it replaces a price such as "$4.99".',
  },
  'cli.price.promptMainMenu': { description: 'Autocomplete prompt of the browser’s main menu.' },
  'cli.price.promptSortBy': { description: 'Select prompt of the sort picker.' },
  'cli.price.sortFieldCurrent': { description: 'Marks the active field in the sort picker.' },
  'cli.price.sortToggleDirection': {
    description: 'Sort picker row that flips the direction rather than choosing a field.',
  },
  'cli.price.promptTypeFilter': { description: 'Select prompt of the list-type filter.' },
  'cli.price.typeFilterAll': { description: 'List-type filter choice: do not filter.' },
  'cli.price.typeFilterAllCurrent': { description: 'The same choice when it is the active one.' },
  'cli.price.typeFilterRowCurrent': {
    description: 'One list-type row of the filter when it is the active one.',
  },
  'cli.price.promptBrowser': { description: 'Autocomplete prompt of a card browser screen.' },
  'cli.price.promptStore': { description: 'Select prompt of the price-store picker.' },
  'cli.price.storeRowCurrent': {
    description: 'Marks the active store in the picker. {store} is a store name.',
  },
  'cli.price.allPrintings': {
    description: 'Card detail action: list every printing with its price.',
  },
  'cli.price.promptSetFilter': { description: 'Text prompt of the set-code filter.' },
  'cli.price.promptCollectorFilter': { description: 'Text prompt of the collector-number filter.' },
  'cli.price.refreshing': { description: 'Progress line while prices are redownloaded.' },
  'cli.price.allCardsHeading': { description: 'Heading of the search-every-list screen.' },
  'cli.price.browserHeading': {
    description: 'Heading line of a card browser screen: what is shown, and its totals.',
  },

  // ── sell ──────────────────────────────────────────────────────────────
  'cli.sell.disclaimer': {
    description: 'Footer of every sell report. CK is Card Kingdom; Near Mint is a card condition.',
  },
  'cli.sell.quantityCapped': {
    description: 'Quantity segment when the buylist caps how many copies it will take.',
  },
  'cli.sell.quantity': { description: 'Quantity segment when every copy is sellable.' },
  'cli.sell.lineValue': {
    description: 'The line total, appended only when more than one copy is sellable.',
  },
  'cli.sell.buyingLine': {
    description:
      'One entry the buylist is buying. {annotation} is a printing annotation such as " (NEO:234) [foil]" and is never translated. {market} is the optional cli.sell.marketTail segment, or empty.',
  },
  'cli.sell.tagsTail': {
    description:
      "Optional segment after a card in a sell report line, listing the user's own card tags. {tags} is the tags joined by commas, exactly as the user wrote them (never translated). Starts with a separator and a space.",
  },
  'cli.sell.marketTail': {
    description:
      'Optional tail of a buying line comparing the buylist offer with the market: {percent} is the offer as a percentage of the card\'s TCGplayer market price (already formatted, e.g. "62%"), {market} that market price (e.g. "$4.10"). Starts with a separator and a space. TCGplayer is a store name.',
  },
  'cli.sell.noMatch': { description: 'Status of an entry the buylist has no product for.' },
  'cli.sell.notBuying': { description: 'Status of a matched entry the buylist is not buying.' },
  'cli.sell.unsoldLine': {
    description: 'One entry that will not sell. {label} is cli.sell.noMatch or cli.sell.notBuying.',
  },
  'cli.sell.listTitle': {
    description: 'Header of one list’s block. {type} is a machine list-type token in brackets.',
  },
  'cli.sell.listTitleSkipped': {
    description: 'Appended to the list header when some entries will not sell.',
  },
  'cli.cardKingdom.cacheInvalid.notObject': {
    description: `${CK_CACHE_CONTEXT} The file is not a JSON object at all.`,
  },
  'cli.cardKingdom.cacheInvalid.noRetrievedAt': {
    description: `${CK_CACHE_CONTEXT} It lacks "retrievedAt" (when Ritual downloaded the feed), a field name kept literal.`,
  },
  'cli.cardKingdom.cacheInvalid.noFeed': {
    description: `${CK_CACHE_CONTEXT} It lacks its "feed" object (the downloaded feed itself), a field name kept literal.`,
  },
  'cli.cardKingdom.cacheInvalid.noCreatedAt': {
    description: `${CK_CACHE_CONTEXT} The feed lacks "feed.createdAt" (Card Kingdom's generation stamp), a field path kept literal.`,
  },
  'cli.cardKingdom.cacheInvalid.noBaseUrl': {
    description: `${CK_CACHE_CONTEXT} The feed lacks "feed.baseUrl" (the address product links are relative to), a field path kept literal.`,
  },
  'cli.cardKingdom.cacheInvalid.noProductList': {
    description: `${CK_CACHE_CONTEXT} The feed lacks its "products" array (the product list), a field name kept literal.`,
  },
  'cli.cardKingdom.cacheInvalid.noProducts': {
    description: `${CK_CACHE_CONTEXT} Not a single product row in it could be read.`,
  },
  'cli.cardKingdom.cacheDropped': {
    description: `${CK_LOG_CONTEXT} Some product rows of the cached buylist file were malformed and were left out; the rest is used. {count} is how many.`,
  },
  'cli.cardKingdom.cacheNotJson': {
    description: `${CK_LOG_CONTEXT} The cached buylist file is not valid JSON, so Ritual treats the buylist as not downloaded.`,
  },
  'cli.cardKingdom.cacheIgnored': {
    description: `${CK_LOG_CONTEXT} The cached buylist file was rejected, so Ritual treats the buylist as not downloaded. {reason} is why: one of the "Invalid Card Kingdom cache: …" sentences.`,
  },
  'cli.cardKingdom.downloadPrompt': {
    description: `${CK_LOG_CONTEXT} A yes/no question asked before the first download. {lead} is the sentence saying no buylist has been downloaded yet. {size} is the estimated download size in megabytes as a plain number (e.g. "70"), followed by the MB unit.`,
  },
  'cli.cardKingdom.downloading': {
    description: `${CK_LOG_CONTEXT} Progress line: the download is starting. {size} is the estimated download size in megabytes as a plain number (e.g. "70"), followed by the MB unit.`,
  },
  'cli.cardKingdom.updated': {
    description: `${CK_LOG_CONTEXT} Progress line: the download finished and was saved. {count} is how many products the feed lists.`,
  },
  'cli.cardKingdom.updating': {
    description: `${CK_LOG_CONTEXT} Progress line: the cached buylist is a day old or more, so it is being redownloaded. {age} is a rendered duration such as "2 days, 3 hours".`,
  },
  'cli.cardKingdom.usingStale': {
    description: `${CK_LOG_CONTEXT} Warning: redownloading the buylist failed, so the older cached copy is used. {reason} is the failure, a sentence without a closing period (e.g. "Card Kingdom feed download failed: HTTP 503"). {age} is a rendered duration such as "2 days, 3 hours".`,
  },
  'cli.cardKingdom.sellModeProblem': {
    description: `${CK_LOG_CONTEXT} Printed when \`ritual admin\` or \`ritual serve\` starts and could not bring the buylist up to date. "Sell mode" is Ritual's feature showing Card Kingdom's buy prices. {problem} is the failure, a full sentence.`,
  },
  'cli.sell.header': { description: 'Provenance line of the report: which feed, and how old.' },
  'cli.sell.headerGenerated': {
    description: 'Appended to the provenance line when the feed states its generation date.',
  },
  'cli.sell.totals': {
    description: 'Grand total. {counted} is a pre-rendered "N lists" fragment.',
  },
  'cli.sell.unsoldSummary': {
    description:
      'Counts the entries hidden without --all. Keep the indentation. {flag} is the `--all` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.sell.cacheRequirement': {
    description: 'Why the cache refresh prompt is being shown before a sell report.',
  },
  'cli.sell.emptyCache': {
    description:
      'The cache is empty. Passed to the shared "run cache preload-all" advice, which appends its own sentence.',
  },
  'cli.sell.wroteFile': { description: 'Confirms the report was written to --out.' },

  // ── locale ────────────────────────────────────────────────────────────
  'cli.locale.sourceConfig': {
    description:
      'Names the tier that won: the config file. {configKey} is the `uiLocale` config key; {file} is the `ritual.config.json` file name. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.locale.sourceDetected': {
    description: 'Names the tier that won: OS environment detection.',
  },
  'cli.locale.sourceDefault': {
    description: 'Names the tier that won: nothing named a locale, so English was used.',
  },
  'cli.locale.uiLocale': {
    description:
      'First line of `ritual locale`. {locale} is a BCP-47 tag; {source} names the tier.',
  },
  'cli.locale.available': { description: 'Which locales this build can render.' },
  'cli.locale.detected': { description: 'What the OS environment named, whether or not it won.' },
  'cli.locale.detectedNone': { description: 'The environment named no usable language.' },
  'cli.locale.cardLanguage': {
    description:
      'The card language, printed beside the UI locale precisely so the two are not confused. defaultLanguage is a config key. {configKey} is the `defaultLanguage` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.locale.ignoring': { description: 'A locale value was present but unusable.' },
  'cli.locale.envIgnored': {
    description: 'RITUAL_LOCALE held an invalid tag; the next tier was used instead.',
  },
  'cli.locale.footer': {
    description: 'Closing explanation of the UI-locale / card-language distinction.',
  },

  // ── locale --detect ───────────────────────────────────────────────────
  'cli.locale.probeHeader': {
    description: 'Heading above the per-source findings of `locale --detect`.',
  },
  'cli.locale.probeEnvironment': {
    description:
      'Label for the POSIX environment-variable source (LC_ALL, LC_MESSAGES, LANGUAGE, LANG).',
  },
  'cli.locale.probeWindows': {
    description: 'Label for the Windows source. "UI culture" is the Windows term for it.',
  },
  'cli.locale.probeMacos': {
    description: 'Label for the macOS source (the AppleLocale system default).',
  },
  'cli.locale.probeFound': {
    description:
      'A source named a usable language. {origin} is a variable name or command line, {value} the raw value, {locale} the BCP-47 tag it normalized to. Keep the leading indentation.',
  },
  'cli.locale.probeUnusable': {
    description:
      'A source had a value that names no language (C.UTF-8, an unrecognized culture). Keep the leading indentation.',
  },
  'cli.locale.probeNothing': {
    description: 'A source was consulted and had nothing to say. Keep the leading indentation.',
  },
  'cli.locale.probeSkipped': {
    description:
      'A source belongs to another operating system and was not consulted — so it names no command. Keep the leading indentation.',
  },
  'cli.locale.detectNothing': {
    description: 'No source named a language, so there is nothing to offer.',
  },
  'cli.locale.detectAgrees': {
    description: 'Detection matched the locale already in force, so there is nothing to offer.',
  },
  'cli.locale.detectDiffers': {
    description:
      'Detection disagrees with the active locale. {source} names the tier that won, as in the first report line.',
  },
  'cli.locale.detectNoDictionary': {
    description:
      'Warns that the detected locale has no dictionary in this build before it is offered.',
  },
  'cli.locale.detectPrompt': {
    description:
      'The yes/no question offering to persist the detected locale. {configKey} is the `uiLocale` config key; {file} is the `ritual.config.json` file name. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.locale.detectSaved': {
    description:
      'The detected locale was written to the config file. {configKey} is the `uiLocale` config key; {file} is the `ritual.config.json` file name. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.locale.detectDeclined': {
    description:
      'The offer was declined; nothing was written. {configKey} is the `uiLocale` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.locale.detectNoPrompt': {
    description:
      'Prompting was impossible, so the equivalent command is printed instead. {reason} is the shared "prompts are disabled" / "stdin is not a terminal" phrase; {command} is a literal command line.',
  },
  'cli.prompt.subject.uiLocale': {
    description:
      'Noun phrase naming what the `locale --detect` confirmation wanted, spliced into "Input required: {subject} ({reason})".',
  },

  'cli.doctor.status.ok': {
    description:
      'Status word in the first column of a `ritual doctor` report line: this check found nothing wrong. Keep it short — the column is as wide as the longest of the three status words.',
    maxLen: 8,
  },
  'cli.doctor.status.warn': {
    description:
      'Status word of a `ritual doctor` check that found something worth attention that does not stop Ritual working (for example pending workspace updates). Keep it short.',
    maxLen: 8,
  },
  'cli.doctor.status.fail': {
    description:
      'Status word of a `ritual doctor` check that found a real problem (for example an invalid setting); the command then exits with an error. Keep it short.',
    maxLen: 8,
  },
  'cli.doctor.hint': {
    description:
      'Indented line under a `ritual doctor` check that found a problem: {hint} is a full sentence saying how to fix it (domain.doctor.*Hint).',
  },
  'cli.doctor.detail': {
    description:
      'Indented list item under a `ritual doctor` check: {detail} is one further fact, such as one invalid setting and why it is refused.',
  },
  'cli.doctor.paste': {
    description:
      'Last line of the `ritual doctor` report, inviting the user to paste the whole report into a bug report. {url} is the issue tracker address; never translate it.',
  },
} as const satisfies MetaFor<typeof cliInfraMessages>
