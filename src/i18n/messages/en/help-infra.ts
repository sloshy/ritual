/**
 * `help.*` messages for the infrastructure commands — cache, serve, build-site, admin, mcp, skills, config.
 *
 * A fragment of the help namespace, split out purely so the command surfaces can
 * be converted independently without contending for one file. Every key still
 * begins with `help.`, and a translator sees one flat catalog.
 *
 * These strings are *registered*, not called: Commander evaluates them while
 * `buildProgram()` constructs the tree, which is why the locale is resolved from
 * the tolerant argv pre-scan before registration (see `src/cli/locale.ts`).
 *
 * Flag spellings (`--refresh`, `--out-dir`), config keys (`cacheSource`,
 * `site.includeDecks`), enum values (`'scryfall'`, `'daily'`) and environment
 * variables are machine vocabulary and stay English inside the sentences that
 * mention them.
 */

import type { MessageCatalogShape } from '../../types'

export const helpInfraMessages = {
  // ── cache ─────────────────────────────────────────────────────────────
  'help.cache.description': 'Manage card cache',
  'help.cache.status':
    'Report card-cache state (size, freshness, tags, source, card bulk / language mode) without prompting or refreshing',
  'help.cache.preloadSet': 'Download and cache all cards for a given set',
  'help.cache.preloadSetArg': 'Set code to preload (e.g. khm, lea)',
  'help.cache.preloadAll':
    'Download and cache all Scryfall card data (bulk), including oracle and art tags',
  'help.cache.preloadAllSource':
    "Where to download from: 'scryfall' or 'feed' (overrides the cacheSource config key for this run)",
  'help.cache.preloadAllFeedUrl':
    'Feed URL for a feed-sourced refresh (implies --source feed; defaults to the cacheFeedUrl config key)',
  'help.cache.preloadAllForce': 'Re-download and re-ingest even when the feed is unchanged',
  'help.cache.refreshTags':
    'Re-download oracle and art tag bulks and re-attach them to cached cards (no full card re-download)',

  // ── cache server ──────────────────────────────────────────────────────
  'help.cacheServer.description': 'Start a local cache server for card and pricing data',
  'help.cacheServer.port': 'Port for the cache server',
  'help.cacheServer.host': 'Host interface for the cache server',
  'help.cacheServer.cardsRefresh':
    "Run full cards cache refresh on an interval (supported: 'daily', 'weekly', 'monthly')",
  'help.cacheServer.pricesRefresh':
    "Run prices cache refresh on an interval (supported: 'daily', 'weekly', 'monthly')",
  'help.cacheServer.cacheSource':
    "Where card refreshes download from: 'scryfall' or 'feed' (defaults to the cacheSource config key)",
  'help.cacheServer.feedUrl':
    'Cache feed URL for feed-sourced refreshes (defaults to the cacheFeedUrl config key)',
  'help.cacheServer.torrentPort':
    'Fixed TCP port for incoming torrent peers while seeding feed artifacts',
  'help.cacheServer.noSeed':
    'With a feed source, sync without seeding the artifacts back to the swarm',
  'help.cacheServer.verbose': 'Log every cache-server request',
  'help.cacheServer.denyHttp':
    'Reject all outgoing HTTP requests (for testing with pre-populated caches)',

  // ── cache feed ────────────────────────────────────────────────────────
  'help.cacheFeed.description': 'Share Scryfall bulk cache data peer-to-peer',
  'help.cacheFeed.host':
    'Host a cache feed: download the raw Scryfall bulk files, torrent them, and serve + seed them for other ritual clients',
  'help.cacheFeed.hostPort': 'Port for the feed HTTP server',
  'help.cacheFeed.hostHost': 'Host interface for the feed HTTP server',
  'help.cacheFeed.publicUrl':
    'Public base URL peers reach this host at (embedded in the feed and web-seed URLs; defaults to http://<host>:<port>)',
  'help.cacheFeed.hostRefresh':
    "Re-check Scryfall for new bulk data on an interval (supported: 'daily', 'weekly', 'monthly'; falls back to RITUAL_CACHE_FEED_REFRESH, then 'daily')",
  'help.cacheFeed.upstream': 'Bulk manifest URL to source artifacts from',
  'help.cacheFeed.dir': 'Feed data directory (defaults to <cache>/feed)',
  'help.cacheFeed.cards':
    "Card bulk(s) to publish: 'default' (English-only default_cards), 'all' (every-language all_cards), or 'both' (defaults to whichever the defaultLanguage config key demands)",
  'help.cacheFeed.hostNoSeed':
    'Serve the feed and files over HTTP only, without BitTorrent seeding',
  'help.cacheFeed.torrentPort': 'Fixed TCP port for incoming torrent peers',
  'help.cacheFeed.hostVerbose': 'Log every feed-server request',
  'help.cacheFeed.fetch':
    'Sync the card cache from a cache feed, then stay open seeding the artifacts to other peers (Ctrl+C to stop)',
  'help.cacheFeed.fetchFeedUrl':
    'Feed URL (defaults to the cacheFeedUrl config key, then the built-in default)',
  'help.cacheFeed.fetchNoP2p': 'Download over plain HTTP instead of BitTorrent',
  'help.cacheFeed.fetchNoSeed': 'Exit after ingesting instead of staying open to seed',
  'help.cacheFeed.fetchForce': 'Re-download and re-ingest even when the feed is unchanged',
  'help.cacheFeed.fetchRefresh':
    "Re-check the feed while seeding (supported: 'daily', 'weekly', 'monthly'; falls back to RITUAL_CACHE_FEED_REFRESH, then 'daily')",

  // ── config ────────────────────────────────────────────────────────────
  'help.config.description': 'Inspect and modify the ritual configuration file',
  'help.config.set': 'Set or update a value in the ritual configuration file',
  'help.config.setProperty': 'Config property to set (use dot notation for nested: parent.child)',
  'help.config.setValue': 'Value(s) to set',
  'help.config.add': 'Add value(s) to an array property instead of replacing it',
  'help.config.remove': 'Remove value(s) from an array property',
  'help.config.get': 'Print the value of a single configuration property',
  'help.config.getProperty': 'Config property to read (use dot notation for nested: parent.child)',
  'help.config.list': 'Print the full effective configuration',
  'help.config.unset': 'Remove a configuration property, reverting it to its default',
  'help.config.unsetProperty':
    'Config property to unset (use dot notation for nested: parent.child)',

  // ── serve ─────────────────────────────────────────────────────────────
  'help.serve.description': 'Serve the generated static site, optionally building it first',
  'help.serve.port': 'Port to serve on',
  'help.serve.host': 'Host address to bind to',
  'help.serve.build': 'Build the site before serving it',
  'help.serve.api':
    'Serve a live read-only data API alongside the site: list data is computed from the markdown files on request, and card search uses the card cache with the same term matching as the admin editor',

  // ── build-site ────────────────────────────────────────────────────────
  'help.buildSite.description':
    'Generate a static website for your decks, collections, and wanted lists',
  'help.buildSite.refresh':
    'Card cache refresh policy: ask (default; bulk-downloads an empty or stale cache without asking, prompts for the price and tag refreshes), auto, no-bulk, never',
  'help.buildSite.verbose': 'Show list of cards to be fetched',
  'help.buildSite.cacheImages':
    'Download and use local deck card images instead of Scryfall image URLs',
  'help.buildSite.decks':
    'Deck names or URLs to build (default: the site.includeDecks config selection)',
  'help.buildSite.collections':
    'Collection names to build (default: the site.includeCollections config selection)',
  'help.buildSite.wantedLists':
    'Wanted list names to build (default: the site.includeWantedLists config selection)',
  'help.buildSite.currencies':
    'Comma-separated currencies to include: usd, eur, tix (default: all three; first is default)',
  'help.buildSite.theme':
    'Initial theme baked into the generated HTML ({themes}, or a custom theme name loaded via --theme-file)',
  'help.buildSite.themeFile':
    'Load one or more custom theme JSON files; their names become selectable alongside the built-ins',
  'help.buildSite.locale':
    "UI locale baked into the generated site (BCP-47, e.g. de-AT): the html lang/dir and the language the site opens in (default: the uiLocale config value). Ritual's own text, not the card language",
  'help.buildSite.locales':
    'Locales to publish dictionaries for in dist/locales/, which is what the in-app language switcher offers (default: en; "all" publishes every locale this build has)',
  'help.buildSite.localeFile':
    'Load one or more locale dictionary JSON files, named for their tag (de-AT.json); their locales become selectable alongside the built-in ones',
  'help.buildSite.moxfieldUserAgent':
    'Moxfield-approved unique User-Agent string (required for Moxfield deck URLs unless MOXFIELD_USER_AGENT is set)',
  'help.buildSite.outDir':
    'Publish into this directory instead of dist/ (relative paths resolve against the Ritual directory); `serve` without --build serves it instead',
  'help.buildSite.sellMode':
    'Offer sell mode for this run even when the site.sellMode config is off: update the Card Kingdom buylist (~70 MB) and include its buy prices',

  // ── init-site ─────────────────────────────────────────────────────────
  'help.initSite.description': 'Initialize the current directory for publishing a Ritual site',
  'help.initSite.force':
    'Re-initialize and overwrite all generated files, ignoring the existing site config',
  'help.initSite.upgrade': 'Upgrade tracked workflows to the current version without prompting',
  'help.initSite.ci': "CI system for a fresh init: 'github-actions' or 'manual'",
  'help.initSite.deploy':
    "Deploy mode for a fresh init: 'publish-for-me' or 'local-build' (github-actions only)",
  'help.initSite.distDir':
    'Directory containing your locally built site (local-build deploys only)',
  'help.initSite.changeDetection':
    'Enable automatic change detection in the generated workflow (publish-for-me only)',
  'help.initSite.noChangeDetection': 'Disable automatic change detection (no prompt)',
  'help.initSite.currency': "Default price currency: 'usd', 'eur', or 'tix'",
  'help.initSite.overwriteReadme': 'Overwrite an existing README.md without prompting',
  'help.initSite.noOverwriteReadme': 'Keep an existing README.md as-is (no prompt)',
  'help.initSite.skills': 'Install Ritual agent skills into .claude/skills without prompting',
  'help.initSite.noSkills': 'Skip installing Ritual agent skills (no prompt)',

  // ── admin ─────────────────────────────────────────────────────────────
  'help.admin.description': 'Start the web admin interface',
  'help.admin.port': 'Port to serve on',
  'help.admin.host': 'Host address to bind to',
  'help.admin.theme': 'Initial theme baked into the served HTML ({themes})',
  'help.admin.mcp':
    'Also serve an MCP (Model Context Protocol) endpoint in this process (requires --mcp-token)',
  'help.admin.mcpPort': 'Port for the embedded MCP server (with --mcp)',
  'help.admin.mcpToken':
    'Bearer token required on the embedded MCP endpoint (with --mcp; or set RITUAL_MCP_TOKEN)',
  'help.admin.sellMode':
    'Offer sell mode for this run even when the site.sellMode config is off: update the Card Kingdom buylist (~70 MB) and serve its buy prices',
  'help.admin.setup': 'Create the admin account without starting the server',
  'help.admin.setupUsername': 'Username for the new admin account',
  'help.admin.setupPasswordStdin': 'Read the password from stdin (for scripting)',
  'help.admin.resetPassword': 'Reset the admin password (and optionally replace the username)',
  'help.admin.resetPasswordUsername': 'Also replace the admin username',
  'help.admin.resetPasswordStdin': 'Read the new password from stdin (for scripting)',
  'help.admin.disableTotp': 'Disable TOTP two-factor auth (clears active and pending enrollment)',

  // ── mcp ───────────────────────────────────────────────────────────────
  //
  // Only the *command's* help is localized. Everything the MCP server itself
  // says to an agent — tool names, titles, descriptions, instructions — is
  // English by contract (see the plan's §11).
  'help.mcp.description':
    'Start an MCP (Model Context Protocol) server exposing deck, collection, and wanted-list management to AI agents',
  'help.mcp.transport': 'Transport to use',
  'help.mcp.port': 'Port for the HTTP transport',
  'help.mcp.host': 'Host to bind for the HTTP transport',
  'help.mcp.token': 'Require this bearer token on the HTTP transport (or set RITUAL_MCP_TOKEN)',
  'help.mcp.allowUnauthenticated':
    'Serve the HTTP transport without a bearer token on a non-loopback host',
  'help.mcp.sellMode':
    'Answer the sell and buylist tools for this run even when the site.sellMode config is off (they use the locally cached Card Kingdom buylist)',

  // ── skills ────────────────────────────────────────────────────────────
  //
  // As with `mcp`, the skill *content* installed by these subcommands stays
  // English by contract; only the command's own help is localized.
  'help.skills.description':
    'Install Claude Code agent skills that teach AI agents how to drive Ritual from a local workspace',
  'help.skills.list': 'List the available Ritual skills',
  'help.skills.install':
    'Install Ritual skills into .claude/skills (or ~/.claude/skills with --global). Installs every skill when no names are given.',
  'help.skills.update':
    'Refresh already-installed Ritual skills to the current version. Never installs skills that are not present; use install for that.',
  'help.skills.global': 'Target ~/.claude/skills instead of the project directory',
  'help.skills.dir':
    'Project directory that should contain .claude/skills (defaults to the base dir)',
  'help.skills.force': 'Overwrite skill files even when they have local edits',

  // ── price ─────────────────────────────────────────────────────────────
  'help.price.description': 'Browse prices of every deck, collection, and wanted list',
  'help.price.listArg': 'Open (or print) a single list instead of all lists',
  'help.price.prices': 'Price currency: usd, eur, or tix (default: the configured defaultCurrency)',
  'help.price.source':
    'Price store: tcgplayer (Scryfall USD), cardmarket (Scryfall EUR), or cardkingdom (NM retail from the Card Kingdom feed)',
  'help.price.name': 'Print cards whose name contains every term',
  'help.price.set': 'Print cards from this set code',
  'help.price.collector': 'Print cards with this collector number',
  'help.price.sort': 'Sort cards by: {fields}',
  'help.price.descending': 'Reverse the sort direction',
  'help.price.summary': 'Print the price summary instead of opening the browser',

  // ── sell ──────────────────────────────────────────────────────────────
  'help.sell.description': "Check what Card Kingdom's buylist pays for cards in your lists",
  'help.sell.listArg':
    'Lists to check (any type; deck:/collection:/wanted: prefixes work). Default: every collection',
  'help.sell.sets': 'Only cards from these set codes (comma-separated)',
  'help.sell.min': 'Only offers of at least this much per copy',
  'help.sell.all': 'Also list entries CK is not buying (text output)',
  'help.sell.out': "Write the output to a file instead of stdout ('-' for stdout)",
  'help.sell.refresh':
    'Buylist + card cache refresh policy: ask (a day-old buylist redownloads without asking; the first download prompts, skipped when unanswerable), auto, no-bulk, never',

  // ── locale ────────────────────────────────────────────────────────────
  //
  // The shared `help.ts` fragment carries an older, shorter
  // `help.locale.description` that no call site ever used and that does not
  // match what `registerLocaleCommand` actually registers. This key is the one
  // the command reads; retiring the stale one belongs to whoever owns `help.ts`.
  'help.locale.summary':
    'Show the resolved interface locale, where it came from, and the card language',
  'help.locale.detect':
    'Ask the OS directly (spawns a subprocess) and offer to save what it says as uiLocale',

  // ── license / dep-license ─────────────────────────────────────────────
  'help.license.description': 'Display the Ritual project license (AGPLv3)',
  'help.license.plain': 'Output directly to stdout without pager',
  'help.depLicense.description': 'Show licenses of dependencies bundled with Ritual',
  'help.depLicense.packageArg': 'Package name to display directly',
  'help.depLicense.list': 'List every bundled dependency with its version and license',
  'help.depLicense.plain': 'Output directly to stdout without pager',
} as const satisfies MessageCatalogShape
