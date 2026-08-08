/** Translator metadata for {@link helpInfraMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { helpInfraMessages } from './help-infra'

export const helpInfraMeta = {
  // ── cache ─────────────────────────────────────────────────────────────
  'help.cache.description': { description: 'Summary of the `cache` command group.' },
  'help.cache.status': { description: 'Summary of `cache status`.' },
  'help.cache.preloadSet': { description: 'Summary of `cache preload-set`.' },
  'help.cache.preloadSetArg': {
    description: 'The `<setCode>` argument of `cache preload-set`. khm/lea are set codes.',
  },
  'help.cache.preloadAll': { description: 'Summary of `cache preload-all`.' },
  'help.cache.preloadAllSource': {
    description:
      "`cache preload-all --source`. 'scryfall' and 'feed' are literal values; cacheSource is a config key.",
  },
  'help.cache.preloadAllFeedUrl': {
    description: '`cache preload-all --url`. cacheFeedUrl is a config key.',
  },
  'help.cache.preloadAllForce': { description: '`cache preload-all --force`.' },
  'help.cache.refreshTags': { description: 'Summary of `cache refresh-tags`.' },

  // ── cache server ──────────────────────────────────────────────────────
  'help.cacheServer.description': { description: 'Summary of `cache server`.' },
  'help.cacheServer.port': { description: '`cache server --port`.' },
  'help.cacheServer.host': { description: '`cache server --host`.' },
  'help.cacheServer.cardsRefresh': {
    description: '`cache server --cards-refresh`. The quoted cadences are literal flag values.',
  },
  'help.cacheServer.pricesRefresh': {
    description: '`cache server --prices-refresh`. The quoted cadences are literal flag values.',
  },
  'help.cacheServer.cacheSource': {
    description: '`cache server --cache-source`. cacheSource is a config key.',
  },
  'help.cacheServer.feedUrl': {
    description: '`cache server --url`. cacheFeedUrl is a config key.',
  },
  'help.cacheServer.torrentPort': { description: '`cache server --torrent-port`.' },
  'help.cacheServer.noSeed': { description: '`cache server --no-seed`.' },
  'help.cacheServer.verbose': { description: '`cache server --verbose`.' },
  'help.cacheServer.denyHttp': { description: '`cache server --deny-http`.' },

  // ── cache feed ────────────────────────────────────────────────────────
  'help.cacheFeed.description': { description: 'Summary of the `cache feed` command group.' },
  'help.cacheFeed.host': { description: 'Summary of `cache feed host`.' },
  'help.cacheFeed.hostPort': { description: '`cache feed host --port`.' },
  'help.cacheFeed.hostHost': { description: '`cache feed host --host`.' },
  'help.cacheFeed.publicUrl': { description: '`cache feed host --public-url`.' },
  'help.cacheFeed.hostRefresh': {
    description:
      '`cache feed host --refresh`. RITUAL_CACHE_FEED_REFRESH is an environment variable name.',
  },
  'help.cacheFeed.upstream': { description: '`cache feed host --upstream`.' },
  'help.cacheFeed.dir': { description: '`cache feed host --dir`.' },
  'help.cacheFeed.cards': {
    description:
      "`cache feed host --cards`. 'default'/'all'/'both' are literal flag values; default_cards and all_cards are Scryfall bulk names; defaultLanguage is a config key.",
  },
  'help.cacheFeed.hostNoSeed': { description: '`cache feed host --no-seed`.' },
  'help.cacheFeed.torrentPort': {
    description: '`--torrent-port`, shared by `cache feed host` and `cache feed fetch`.',
  },
  'help.cacheFeed.hostVerbose': { description: '`cache feed host --verbose`.' },
  'help.cacheFeed.fetch': { description: 'Summary of `cache feed fetch`.' },
  'help.cacheFeed.fetchFeedUrl': {
    description: '`cache feed fetch --url`. cacheFeedUrl is a config key.',
  },
  'help.cacheFeed.fetchNoP2p': { description: '`cache feed fetch --no-p2p`.' },
  'help.cacheFeed.fetchNoSeed': { description: '`cache feed fetch --no-seed`.' },
  'help.cacheFeed.fetchForce': { description: '`cache feed fetch --force`.' },
  'help.cacheFeed.fetchRefresh': {
    description:
      '`cache feed fetch --refresh`. RITUAL_CACHE_FEED_REFRESH is an environment variable name.',
  },

  // ── config ────────────────────────────────────────────────────────────
  'help.config.description': { description: 'Summary of the `config` command group.' },
  'help.config.set': { description: 'Summary of `config set`.' },
  'help.config.setProperty': { description: 'The `<property>` argument of `config set`.' },
  'help.config.setValue': { description: 'The `<value...>` argument of `config set`.' },
  'help.config.add': { description: '`config set --add`.' },
  'help.config.remove': { description: '`config set --remove`.' },
  'help.config.get': { description: 'Summary of `config get`.' },
  'help.config.getProperty': { description: 'The `<property>` argument of `config get`.' },
  'help.config.list': { description: 'Summary of `config list`.' },
  'help.config.unset': { description: 'Summary of `config unset`.' },
  'help.config.unsetProperty': { description: 'The `<property>` argument of `config unset`.' },

  // ── serve ─────────────────────────────────────────────────────────────
  'help.serve.description': { description: 'Summary of the `serve` command.' },
  'help.serve.port': { description: '`serve --port`.' },
  'help.serve.host': { description: '`serve --host`.' },
  'help.serve.build': { description: '`serve --build`.' },
  'help.serve.api': { description: '`serve --api`.' },

  // ── build-site ────────────────────────────────────────────────────────
  'help.buildSite.description': { description: 'Summary of the `build-site` command.' },
  'help.buildSite.refresh': {
    description:
      '`--refresh`, shared by `build-site` and `serve --build`. ask/auto/no-bulk/never are literal flag values.',
  },
  'help.buildSite.verbose': { description: '`build-site --verbose`.' },
  'help.buildSite.cacheImages': { description: '`build-site --cache-images`.' },
  'help.buildSite.decks': {
    description: '`build-site --decks`. site.includeDecks is a config key.',
  },
  'help.buildSite.collections': {
    description: '`build-site --collections`. site.includeCollections is a config key.',
  },
  'help.buildSite.wantedLists': {
    description: '`build-site --wanted-lists`. site.includeWantedLists is a config key.',
  },
  'help.buildSite.currencies': {
    description: '`build-site --currencies`. usd/eur/tix are literal currency codes.',
  },
  'help.buildSite.theme': {
    description: '`build-site --theme`. {themes} is the comma-separated list of built-in themes.',
  },
  'help.buildSite.themeFile': { description: '`build-site --theme-file`.' },
  'help.buildSite.locale': {
    description:
      '`build-site --locale` — the UI locale, deliberately distinguished from the card language.',
  },
  'help.buildSite.locales': { description: '`build-site --locales`.' },
  'help.buildSite.localeFile': { description: '`build-site --locale-file`.' },
  'help.buildSite.moxfieldUserAgent': {
    description: '`build-site --moxfield-user-agent`. MOXFIELD_USER_AGENT is an env var name.',
  },
  'help.buildSite.outDir': { description: '`build-site --out-dir`.' },
  'help.buildSite.sellMode': {
    description:
      '`--sell-mode`, shared by `build-site` and `serve`. site.sellMode is a config key name; Card Kingdom is a company name.',
  },

  // ── init-site ─────────────────────────────────────────────────────────
  'help.initSite.description': { description: 'Summary of the `init-site` command.' },
  'help.initSite.force': { description: '`init-site --force`.' },
  'help.initSite.upgrade': { description: '`init-site --upgrade`.' },
  'help.initSite.ci': {
    description: "`init-site --ci`. 'github-actions'/'manual' are literal flag values.",
  },
  'help.initSite.deploy': {
    description: "`init-site --deploy`. 'publish-for-me'/'local-build' are literal flag values.",
  },
  'help.initSite.distDir': { description: '`init-site --dist-dir`.' },
  'help.initSite.changeDetection': { description: '`init-site --change-detection`.' },
  'help.initSite.noChangeDetection': { description: '`init-site --no-change-detection`.' },
  'help.initSite.currency': {
    description: "`init-site --currency`. 'usd'/'eur'/'tix' are literal currency codes.",
  },
  'help.initSite.overwriteReadme': { description: '`init-site --overwrite-readme`.' },
  'help.initSite.noOverwriteReadme': { description: '`init-site --no-overwrite-readme`.' },
  'help.initSite.skills': { description: '`init-site --skills`.' },
  'help.initSite.noSkills': { description: '`init-site --no-skills`.' },

  // ── admin ─────────────────────────────────────────────────────────────
  'help.admin.description': { description: 'Summary of the `admin` command.' },
  'help.admin.port': { description: '`admin --port`.' },
  'help.admin.host': { description: '`admin --host`.' },
  'help.admin.theme': {
    description: '`admin --theme`. {themes} is the comma-separated list of built-in themes.',
  },
  'help.admin.mcp': { description: '`admin --mcp`.' },
  'help.admin.mcpPort': { description: '`admin --mcp-port`.' },
  'help.admin.mcpToken': {
    description: '`admin --mcp-token`. RITUAL_MCP_TOKEN is an environment variable name.',
  },
  'help.admin.sellMode': {
    description:
      '`admin --sell-mode`. site.sellMode is a config key name; Card Kingdom is a company name.',
  },
  'help.admin.setup': { description: 'Summary of `admin setup`.' },
  'help.admin.setupUsername': { description: '`admin setup --username`.' },
  'help.admin.setupPasswordStdin': { description: '`admin setup --password-stdin`.' },
  'help.admin.resetPassword': { description: 'Summary of `admin reset-password`.' },
  'help.admin.resetPasswordUsername': { description: '`admin reset-password --username`.' },
  'help.admin.resetPasswordStdin': { description: '`admin reset-password --password-stdin`.' },
  'help.admin.disableTotp': { description: 'Summary of `admin disable-totp`.' },

  // ── mcp ───────────────────────────────────────────────────────────────
  'help.mcp.description': { description: 'Summary of the `mcp` command.' },
  'help.mcp.transport': { description: '`mcp --transport`.' },
  'help.mcp.port': { description: '`mcp --port`.' },
  'help.mcp.host': { description: '`mcp --host`.' },
  'help.mcp.token': {
    description: '`mcp --token`. RITUAL_MCP_TOKEN is an environment variable name.',
  },
  'help.mcp.allowUnauthenticated': { description: '`mcp --allow-unauthenticated`.' },
  'help.mcp.sellMode': {
    description:
      '`mcp --sell-mode`. site.sellMode is a config key name; Card Kingdom is a company name. "sell and buylist tools" refers to the get_sell_report, get_sell_cart, get_buylist_quotes and refresh_buylist MCP tools.',
  },

  // ── skills ────────────────────────────────────────────────────────────
  'help.skills.description': { description: 'Summary of the `skills` command group.' },
  'help.skills.list': { description: 'Summary of `skills list`.' },
  'help.skills.install': { description: 'Summary of `skills install`.' },
  'help.skills.update': { description: 'Summary of `skills update`.' },
  'help.skills.global': { description: '`skills install|update --global`.' },
  'help.skills.dir': { description: '`skills install|update --dir`.' },
  'help.skills.force': { description: '`skills install|update --force`.' },

  // ── price ─────────────────────────────────────────────────────────────
  'help.price.description': { description: 'Summary of the `price` command.' },
  'help.price.listArg': { description: 'The `[listName]` argument of `price`.' },
  'help.price.deck': { description: '`price --deck`.' },
  'help.price.collection': { description: '`price --collection`.' },
  'help.price.wanted': { description: '`price --wanted`.' },
  'help.price.prices': {
    description: '`price --prices`. defaultCurrency is a config key; usd/eur/tix are codes.',
  },
  'help.price.name': { description: '`price --name`.' },
  'help.price.set': { description: '`price --set`.' },
  'help.price.collector': { description: '`price --collector`.' },
  'help.price.sort': {
    description: '`price --sort`. {fields} is the comma-separated list of sort field names.',
  },
  'help.price.descending': { description: '`price --descending`.' },
  'help.price.summary': { description: '`price --summary`.' },

  // ── sell ──────────────────────────────────────────────────────────────
  'help.sell.description': { description: 'Summary of the `sell` command.' },
  'help.sell.listArg': {
    description: 'The `[list...]` argument of `sell`. The `deck:` style prefixes are literal.',
  },
  'help.sell.deck': { description: '`sell --deck`.' },
  'help.sell.collection': { description: '`sell --collection`.' },
  'help.sell.wanted': { description: '`sell --wanted`.' },
  'help.sell.sets': { description: '`sell --sets`.' },
  'help.sell.min': { description: '`sell --min`.' },
  'help.sell.all': { description: '`sell --all`. CK is Card Kingdom.' },
  'help.sell.out': { description: "`sell --out`. '-' is the literal stdout marker." },
  'help.sell.refresh': {
    description: '`sell --refresh`. ask/auto/no-bulk/never are literal flag values.',
  },

  // ── locale ────────────────────────────────────────────────────────────
  'help.locale.summary': {
    description:
      'Summary of the `locale` command. "Card language" is the Scryfall printing language, a different setting from the interface locale.',
  },
  'help.locale.detect': {
    description: '`locale --detect`. uiLocale is a literal config key.',
  },

  // ── license / dep-license ─────────────────────────────────────────────
  'help.license.description': { description: 'Summary of the `license` command.' },
  'help.license.plain': { description: '`license --plain`.' },
  'help.depLicense.description': { description: 'Summary of the `dep-license` command.' },
  'help.depLicense.packageArg': { description: 'The `[package]` argument of `dep-license`.' },
  'help.depLicense.list': { description: '`dep-license --list`.' },
  'help.depLicense.plain': { description: '`dep-license --plain`.' },
} as const satisfies MetaFor<typeof helpInfraMessages>
