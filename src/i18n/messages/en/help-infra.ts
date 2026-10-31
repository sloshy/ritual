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
 * A help string that names another flag, a config key (`cacheSource`,
 * `site.includeDecks`), an environment variable or a file takes it as a
 * `{placeholder}` from `src/util/cli-tokens.ts`, so a translation cannot alter
 * it. Enum values (`'scryfall'`, `'daily'`) are still written inline and stay
 * English. An option's own spelling is never here: commander prints it.
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
    "Where to download from: 'scryfall' or 'feed' (overrides the {configKey} config key for this run)",
  'help.cache.preloadAllFeedUrl':
    'Feed URL for a feed-sourced refresh (implies {flag}; defaults to the {configKey} config key)',
  'help.cache.preloadAllForce': 'Re-download and re-ingest even when the feed is unchanged',
  'help.cache.refreshTags':
    'Re-download oracle and art tag bulks and re-attach them to cached cards (no full card re-download)',

  // ── cache server ──────────────────────────────────────────────────────
  'help.cacheServer.description':
    'Start a local cache server for card and pricing data (trusted networks only: its write routes are unauthenticated)',
  'help.cacheServer.port': 'Port for the cache server',
  'help.cacheServer.host': 'Host interface for the cache server',
  'help.cacheServer.cardsRefresh':
    "Run full cards cache refresh on an interval (supported: 'daily', 'weekly', 'monthly')",
  'help.cacheServer.pricesRefresh':
    "Run prices cache refresh on an interval (supported: 'daily', 'weekly', 'monthly')",
  'help.cacheServer.cacheSource':
    "Where card refreshes download from: 'scryfall' or 'feed' (defaults to the {configKey} config key)",
  'help.cacheServer.feedUrl':
    'Cache feed URL for feed-sourced refreshes (defaults to the {configKey} config key)',
  'help.cacheServer.torrentPort':
    'Fixed TCP port for incoming torrent peers while seeding feed artifacts',
  'help.cacheServer.noSeed':
    'With a feed source, sync without seeding the artifacts back to the swarm',
  'help.cacheServer.verbose': 'Log every cache-server request',
  'help.cacheServer.denyHttp':
    'Reject all outgoing HTTP requests (for testing with pre-populated caches)',

  // ── cache feed ────────────────────────────────────────────────────────
  'help.cacheFeed.description': 'Experimental: share Scryfall bulk cache data peer-to-peer',
  'help.cacheFeed.host':
    'Experimental: host a cache feed: download the raw Scryfall bulk files, torrent them, and serve + seed them for other ritual clients',
  'help.cacheFeed.hostPort': 'Port for the feed HTTP server',
  'help.cacheFeed.hostHost': 'Host interface for the feed HTTP server',
  'help.cacheFeed.publicUrl':
    'Public base URL peers reach this host at (embedded in the feed and web-seed URLs; defaults to {url})',
  'help.cacheFeed.hostRefresh':
    "Re-check Scryfall for new bulk data on an interval (supported: 'daily', 'weekly', 'monthly'; falls back to {envVar}, then 'daily')",
  'help.cacheFeed.upstream': 'Bulk manifest URL to source artifacts from',
  'help.cacheFeed.dir': 'Feed data directory (defaults to <cache>/feed)',
  'help.cacheFeed.cards':
    "Which card bulks to publish: 'default' (English-only default_cards), 'all' (every-language all_cards), or 'both' (defaults to whichever the {configKey} config key demands)",
  'help.cacheFeed.hostNoSeed':
    'Serve the feed and files over HTTP only, without BitTorrent seeding',
  'help.cacheFeed.torrentPort': 'Fixed TCP port for incoming torrent peers',
  'help.cacheFeed.hostVerbose': 'Log every feed-server request',
  'help.cacheFeed.fetch':
    'Experimental: sync the card cache from a cache feed, then stay open seeding the artifacts to other peers (Ctrl+C to stop)',
  'help.cacheFeed.fetchFeedUrl':
    'Feed URL (defaults to the {configKey} config key; required when that is unset)',
  'help.cacheFeed.fetchNoP2p': 'Download over plain HTTP instead of BitTorrent',
  'help.cacheFeed.fetchNoSeed': 'Exit after ingesting instead of staying open to seed',
  'help.cacheFeed.fetchForce': 'Re-download and re-ingest even when the feed is unchanged',
  'help.cacheFeed.fetchRefresh':
    "Re-check the feed while seeding (supported: 'daily', 'weekly', 'monthly'; falls back to {envVar}, then 'daily')",

  // ── config ────────────────────────────────────────────────────────────
  'help.config.description': 'Inspect and modify the ritual configuration file',
  'help.config.set': 'Set or update a value in the ritual configuration file',
  'help.config.setProperty': 'Config property to set (use dot notation for nested: parent.child)',
  'help.config.setValue': 'One or more values to set',
  'help.config.add': 'Add values to an array property instead of replacing it',
  'help.config.remove': 'Remove values from an array property',
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
    '(Beta) Serve a live read-only data API alongside the site: list data is computed from the markdown files on request, and card search uses the card cache with the same term matching as the admin editor',

  // ── build-site ────────────────────────────────────────────────────────
  'help.buildSite.description':
    'Generate a static website for your decks, collections, and wanted lists',
  'help.buildSite.verbose': 'Show list of cards to be fetched',
  'help.buildSite.cacheImages':
    'Download and use local deck card images instead of Scryfall image URLs',
  'help.buildSite.decks': 'Deck names or URLs to build (default: the {configKey} config selection)',
  'help.buildSite.collections':
    'Collection names to build (default: the {configKey} config selection)',
  'help.buildSite.wantedLists':
    'Wanted list names to build (default: the {configKey} config selection)',
  'help.buildSite.priceSources':
    'Comma-separated price stores to offer: tcgplayer, cardmarket, cardkingdom, cardhoarder (default: every enabled {configKey} store; this can only narrow them). Each store brings its own currency',
  'help.buildSite.theme':
    'Initial theme baked into the generated HTML: a built-in name such as {example} or {invertedExample}, or a custom theme loaded via {flag} or {filesKey} (default: the {configKey} config value, else default). An unknown name lists every theme',
  'help.buildSite.themeFile':
    'Load one or more custom theme JSON files; their names become selectable alongside the built-ins (replaces the {configKey} config value for this run)',
  'help.buildSite.locale':
    "UI locale baked into the generated site (BCP-47, e.g. de-AT): the html lang/dir and the language the site opens in (default: the {configKey} config value). Ritual's own text, not the card language",
  'help.buildSite.locales':
    'Locales to publish dictionaries for in {file}, which is what the in-app language switcher offers (default: en; "all" publishes every locale this build has)',
  'help.buildSite.localeFile':
    'Load one or more locale dictionary JSON files, named for their tag (de-AT.json); their locales become selectable alongside the built-in ones',
  'help.buildSite.moxfieldUserAgent':
    'Moxfield-approved unique User-Agent string (required for Moxfield deck URLs unless {envVar} is set)',
  'help.buildSite.outDir':
    'Publish into this directory instead of {file} (relative paths resolve against the Ritual directory); `{command}` without {flag} serves it instead',
  'help.buildSite.sellMode':
    '(Beta) Offer sell mode for this run even when the {configKey} config is off: update the Card Kingdom buylist (~70 MB) and include its buy prices',

  // ── init-site ─────────────────────────────────────────────────────────
  'help.initSite.description':
    "Set up publishing your site to GitHub Pages or another host (CI workflow and site settings). Not needed to get started: create lists with '{newCommand}' or '{importCommand}'",
  'help.initSite.force':
    'Re-initialize and overwrite all generated files, ignoring the existing site config',
  'help.initSite.ci': "CI system for a fresh init: 'github-actions' or 'manual'",
  'help.initSite.deploy':
    "Deploy mode for a fresh init: 'publish-for-me' or 'local-build' (github-actions only)",
  'help.initSite.distDir':
    'Directory containing your locally built site (local-build deploys only)',
  'help.initSite.changeDetection':
    'Enable automatic change detection in the generated workflow (publish-for-me only)',
  'help.initSite.noChangeDetection': 'Disable automatic change detection (no prompt)',
  'help.initSite.priceSource':
    "Default price store (its currency follows): 'tcgplayer', 'cardkingdom', 'cardmarket', or 'cardhoarder'",
  'help.initSite.overwriteReadme': 'Overwrite an existing {file} without prompting',
  'help.initSite.noOverwriteReadme': 'Keep an existing {file} as-is (no prompt)',
  'help.initSite.skills': 'Install Ritual agent skills into {file} without prompting',
  'help.initSite.noSkills': 'Skip installing Ritual agent skills (no prompt)',

  // ── migrate ───────────────────────────────────────────────────────────
  'help.migrate.description':
    'Bring this workspace up to date: apply pending migrations, refresh generated files, and move the CI release pin',
  'help.migrate.yes': 'Apply without asking for confirmation',
  'help.migrate.dryRun': 'Print what would change and write nothing',
  'help.migrate.check': 'Write nothing; exit 4 when updates are pending, 0 when up to date',

  // ── self-update ───────────────────────────────────────────────────────
  'help.selfUpdate.description':
    'Download a newer Ritual release, verify it, and install it in place of this binary',
  'help.selfUpdate.prerelease': 'Include prereleases (default: follow the running build)',
  'help.selfUpdate.stable': 'Only consider stable releases (default: follow the running build)',
  'help.selfUpdate.tag': 'Install this exact release tag (e.g. v1.2.0), even an older one',
  'help.selfUpdate.check': 'Write nothing; exit 4 when an update is available, 0 when up to date',
  'help.selfUpdate.yes': 'Install without asking for confirmation',

  // ── admin ─────────────────────────────────────────────────────────────
  'help.admin.description': 'Start the web admin interface',
  'help.admin.port': 'Port to serve on',
  'help.admin.host': 'Host address to bind to',
  'help.admin.theme':
    'Initial theme baked into the served HTML, such as {example} or {invertedExample}. An unknown name lists every theme',
  'help.admin.mcp':
    'Also serve an MCP (Model Context Protocol) endpoint in this process (requires {flag})',
  'help.admin.mcpPort': 'Port for the embedded MCP server (with {flag})',
  'help.admin.mcpToken':
    'Bearer token required on the embedded MCP endpoint (with {flag}; or set {envVar})',
  'help.admin.sellMode':
    '(Beta) Offer sell mode for this run even when the {configKey} config is off: update the Card Kingdom buylist (~70 MB) and serve its buy prices',
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
  // English by contract.
  'help.mcp.description':
    'Start an MCP (Model Context Protocol) server exposing deck, collection, and wanted-list management to AI agents',
  'help.mcp.transport': 'Transport to use',
  'help.mcp.port': 'Port for the HTTP transport',
  'help.mcp.host': 'Host to bind for the HTTP transport',
  'help.mcp.token': 'Require this bearer token on the HTTP transport (or set {envVar})',
  'help.mcp.allowUnauthenticated':
    'Serve the HTTP transport without a bearer token on a non-loopback host',
  'help.mcp.sellMode':
    'Answer the sell and buylist tools for this run even when the {configKey} config is off (they use the locally cached Card Kingdom buylist)',

  // ── skills ────────────────────────────────────────────────────────────
  //
  // As with `mcp`, the skill *content* installed by these subcommands stays
  // English by contract; only the command's own help is localized.
  'help.skills.description':
    'Install Claude Code agent skills that teach AI agents how to drive Ritual from a local workspace',
  'help.skills.list': 'List the available Ritual skills',
  'help.skills.install':
    'Install Ritual skills into {skillsDirFile} (or {globalSkillsDirFile} with {flag}). Installs every skill when no names are given.',
  'help.skills.update':
    'Refresh already-installed Ritual skills to the current version. Never installs skills that are not present; use install for that.',
  'help.skills.global': 'Target {file} instead of the project directory',
  'help.skills.dir': 'Project directory that should contain {file} (defaults to the base dir)',
  'help.skills.force': 'Overwrite skill files even when they have local edits',

  // ── price ─────────────────────────────────────────────────────────────
  'help.price.description': 'Browse prices of every deck, collection, and wanted list',
  'help.price.listArg': 'Open (or print) a single list instead of all lists',
  'help.price.source':
    'Price store, which sets the currency: tcgplayer (Scryfall USD), cardmarket (Scryfall EUR), cardkingdom (NM retail from the Card Kingdom feed), or cardhoarder (Scryfall MTGO tix). Default: the configured {configKey}',
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
  'help.sell.tags':
    'Only cards carrying one of these tags (comma-separated, exact); scopes matching, so CK buy limits go to these cards',
  'help.sell.minOwned':
    'Only cards you own at least this many copies of, across every collection and deck and every printing',
  'help.sell.minRatio':
    "Only offers worth at least this fraction of the card's TCGplayer market price (0.8 = 80%)",
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
    'Ask the OS directly (spawns a subprocess) and offer to save what it says as {configKey}',

  // ── license / dep-license ─────────────────────────────────────────────
  'help.license.description': 'Display the Ritual project license (AGPLv3)',
  'help.license.plain': 'Output directly to stdout without pager',
  'help.depLicense.description': 'Show licenses of dependencies bundled with Ritual',
  'help.depLicense.packageArg': 'Package name to display directly',
  'help.depLicense.list': 'List every bundled dependency with its version and license',
  'help.depLicense.plain': 'Output directly to stdout without pager',
  'help.doctor.description':
    'Check your Ritual setup and print a report to paste into a bug report',
} as const satisfies MessageCatalogShape
