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
 *   English by contract (plan §11).
 */

import type { MessageCatalogShape } from '../../types'

export const cliInfraMessages = {
  // ── Shared list scoping ───────────────────────────────────────────────
  'cli.listScope.oneTypeFlag': 'Use only one of --deck, --collection, or --wanted.',

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
  'cli.cacheFeed.initialFeedFailed': 'Initial feed generation failed:',
  'cli.cacheFeed.refreshFailed': 'Refresh failed ({reason}); serving the existing feed.',
  'cli.cacheFeed.seedStartFailed': 'Failed to start seeding:',
  'cli.cacheFeed.seedingTorrents': 'Seeding {count} torrents.',
  'cli.cacheFeed.seedingTorrentsOnPort': 'Seeding {count} torrents on TCP port {port}.',
  'cli.cacheFeed.serverStartFailed': 'Failed to start the feed server:',
  'cli.cacheFeed.scheduledRefreshFailed': 'Scheduled feed refresh failed:',
  'cli.cacheFeed.listening': 'Feed server listening on {url}',
  'cli.cacheFeed.publicUrl': 'Public URL: {url}',
  'cli.cacheFeed.seedingDisabled':
    'BitTorrent seeding disabled (--no-seed); serving over HTTP only.',
  'cli.cacheFeed.syncing': 'Syncing from {url}',
  'cli.cacheFeed.syncFailed': 'Feed sync failed:',
  'cli.cacheFeed.ingested': 'Card cache updated from the feed.',
  'cli.cacheFeed.unchanged': 'Feed is unchanged; card cache is already current.',
  'cli.cacheFeed.seedingArtifacts': 'Seeding {count} artifacts. Press Ctrl+C to stop.',
  'cli.cacheFeed.seedingArtifactsOnPort':
    'Seeding {count} artifacts on TCP port {port}. Press Ctrl+C to stop.',
  'cli.cacheFeed.scheduledRecheckFailed': 'Scheduled feed re-check failed:',
  'cli.cacheFeed.feedChanged': 'Feed changed; card cache updated.',
  'cli.cacheFeed.stopping': 'Stopping seeding...',

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

  // ── admin ─────────────────────────────────────────────────────────────
  'cli.admin.mcpTokenRequired':
    '--mcp requires a bearer token: pass --mcp-token <secret> or set RITUAL_MCP_TOKEN.',
  'cli.admin.mcpPortConflict': '--mcp-port must differ from the admin --port.',
  'cli.admin.preparing': 'Preparing admin interface...',
  'cli.admin.ready': 'Admin interface ready.',
  'cli.admin.teardownFailed': '{label} teardown failed:',
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
  'cli.buildSite.themeFileUnreadable': "Failed to read --theme-file '{path}': {reason}",
  'cli.buildSite.themeFileNotJson': "--theme-file '{path}' is not valid JSON: {reason}",
  'cli.buildSite.themeFileInvalid': "--theme-file '{path}': {reason}",
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
  'cli.initSite.fieldCiSystem': 'CI system',
  'cli.initSite.fieldDeployMode': 'deploy mode',
  'cli.initSite.fieldCurrency': 'currency',
  'cli.initSite.distDirRequired': 'Expected a directory path for --dist-dir.',
  'cli.initSite.missingFlag': '{what} is required and prompts are unavailable; pass {flag}.',
  'cli.initSite.subjectCiSystem': 'A CI system',
  'cli.initSite.subjectDeployMode': 'A deploy mode',
  'cli.initSite.subjectDistDir': 'The built-site directory',
  'cli.initSite.subjectChangeDetection': 'Automatic change detection',
  'cli.initSite.subjectCurrency': 'A default price currency',
  'cli.initSite.promptOverwrite': '{path} already exists. Overwrite?',
  'cli.initSite.promptSkills':
    'Install Ritual agent skills into .claude/skills so coding agents can work with this repository?',
  'cli.initSite.promptCurrency': 'Default price currency?',
  'cli.initSite.currencyUsd': 'US Dollars (TCGplayer)',
  'cli.initSite.currencyEur': 'Euros (Cardmarket)',
  'cli.initSite.currencyTix': 'MTGO tickets',
  'cli.initSite.currencyCurrent': '{currency} (current)',
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
  'cli.initSite.promptUpgrade':
    'Ritual has been upgraded ({from} → {to}). Regenerate tracked managed files?',
  'cli.initSite.readmeExists':
    'README.md already exists and prompts are unavailable; pass --overwrite-readme or --no-overwrite-readme.',
  'cli.initSite.fileExists':
    '{path} already exists and prompts are unavailable; pass --force to overwrite generated files.',
  'cli.initSite.alreadyInitializedFlags':
    'This repository is already initialized; --ci, --deploy, --dist-dir, --change-detection, --currency, and --overwrite-readme only apply to a fresh init. Use --force to re-initialize with new settings.',
  'cli.initSite.manualOnlyFlags':
    '--deploy, --dist-dir, and --change-detection only apply with --ci github-actions.',
  'cli.initSite.changeDetectionScope':
    '--change-detection/--no-change-detection only applies with --deploy publish-for-me.',
  'cli.initSite.distDirScope': '--dist-dir only applies with --deploy local-build.',
  'cli.initSite.upgradeRequired':
    'Ritual has been upgraded ({from} → {to}) and prompts are unavailable; pass --upgrade to regenerate tracked managed files.',
  'cli.initSite.alreadyCurrent':
    'Already initialized with the current version ({version}); nothing to do.',
  'cli.initSite.downgrade':
    'Warning: The current Ritual build ({current}) is older than the version last used to initialize this repository ({initialized}).',
  'cli.initSite.downgradeAdvice':
    'Use --force to re-initialize with current settings, or remove the "site" key from ritual.config.json if you want to use this older version.',
  'cli.initSite.upgrading': 'Upgrading from {from} to {to}...',
  'cli.initSite.configUpdated': '✓ ritual.config.json site section updated to {version}',
  'cli.initSite.configWriteFailed': 'Error: Failed to write ritual.config.json: {reason}',
  'cli.initSite.migrationUpdated': '↻ Updated {path}',
  'cli.initSite.migrationRemoved': '✕ Removed {path}',
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
    'Tip: Pin a specific Ritual version by setting a RITUAL_VERSION repository variable.',

  // ── skills ────────────────────────────────────────────────────────────
  'cli.skills.resultWritten': '✓ {name} → {path}',
  'cli.skills.resultUpToDate': '• {name} already up to date',
  'cli.skills.resultSkipped': '• {name} has local edits (skipped)',
  'cli.skills.resultAbsent': '• {name} not installed (skipped)',
  'cli.skills.forceHintRerun': 're-run with --force to overwrite them with the current version',
  'cli.skills.forceHintInit': 'use --force to overwrite them',
  'cli.skills.forceHintUpdate': 'run `ritual skills update --force` to overwrite them',

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
  'cli.price.fieldSort': 'sort field',
  'cli.price.fieldSource': 'price source',
  'cli.price.sourceCurrencyConflict':
    '--source {source} prices in {currency}; drop the conflicting --prices flag or change it to match.',
  'cli.price.currencyCardKingdom': 'USD (Card Kingdom retail)',
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
  'cli.price.headerUpdated': '💰 Prices last updated: {updated} · Currency: {currency}',
  'cli.price.updatedUnknown': 'unknown',
  'cli.price.updatedAt': '{timestamp} ({age} ago)',
  'cli.price.headerTypeTotals': '{icon} {title} ({count}) — {totals}',
  'cli.price.headerGrandTotals': '💵 All lists ({count}) — {totals}',
  'cli.price.listRow': '{icon} {name} — {totals} · {count} cards',
  'cli.price.menuSearch': '🔎 Search all cards',
  'cli.price.menuRefresh': '🔄 Refresh prices',
  'cli.price.menuCurrency': '💱 Change currency',
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
  'cli.price.promptCurrency': 'Price currency',
  'cli.price.currencyRowCurrent': '{currency} (current)',
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
  'cli.sell.buyingLine': '{price} {quantity}{value}  {name}{annotation} · {product} · max {max}',
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
