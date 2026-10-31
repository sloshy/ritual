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
      "`cache preload-all --source`. 'scryfall' and 'feed' are literal values. {configKey} is the `cacheSource` config key. It is typed or matched exactly by the user, so never translate it.",
  },
  'help.cache.preloadAllFeedUrl': {
    description:
      '`cache preload-all --url`. cacheFeedUrl is a config key. {flag} is `--source feed`, a flag and its value; {configKey} is the `cacheFeedUrl` config key. Each is typed or matched exactly by the user, so never translate them.',
  },
  'help.cache.preloadAllForce': { description: '`cache preload-all --force`.' },
  'help.cache.refreshTags': { description: 'Summary of `cache refresh-tags`.' },

  // ── cache server ──────────────────────────────────────────────────────
  'help.cacheServer.description': {
    description:
      'Summary of `cache server`. The parenthetical warns that the server must only be reachable from a trusted network, because anyone who can reach it can change the cache.',
  },
  'help.cacheServer.port': { description: '`cache server --port`.' },
  'help.cacheServer.host': { description: '`cache server --host`.' },
  'help.cacheServer.cardsRefresh': {
    description: '`cache server --cards-refresh`. The quoted cadences are literal flag values.',
  },
  'help.cacheServer.pricesRefresh': {
    description: '`cache server --prices-refresh`. The quoted cadences are literal flag values.',
  },
  'help.cacheServer.cacheSource': {
    description:
      '`cache server --cache-source`. cacheSource is a config key. {configKey} is the `cacheSource` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.cacheServer.feedUrl': {
    description:
      '`cache server --url`. cacheFeedUrl is a config key. {configKey} is the `cacheFeedUrl` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.cacheServer.torrentPort': { description: '`cache server --torrent-port`.' },
  'help.cacheServer.noSeed': { description: '`cache server --no-seed`.' },
  'help.cacheServer.verbose': { description: '`cache server --verbose`.' },
  'help.cacheServer.denyHttp': { description: '`cache server --deny-http`.' },

  // ── cache feed ────────────────────────────────────────────────────────
  'help.cacheFeed.description': {
    description:
      'Summary of the `cache feed` command group. "Experimental" marks a feature that may change or be removed in any release.',
  },
  'help.cacheFeed.host': {
    description:
      'Summary of `cache feed host`. "Experimental" marks a feature that may change or be removed in any release.',
  },
  'help.cacheFeed.hostPort': { description: '`cache feed host --port`.' },
  'help.cacheFeed.hostHost': { description: '`cache feed host --host`.' },
  'help.cacheFeed.publicUrl': {
    description:
      '`cache feed host --public-url`. {url} is the example URL `http://<host>:<port>`. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.cacheFeed.hostRefresh': {
    description:
      '`cache feed host --refresh`. RITUAL_CACHE_FEED_REFRESH is an environment variable name. {envVar} is the `RITUAL_CACHE_FEED_REFRESH` environment variable. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.cacheFeed.upstream': { description: '`cache feed host --upstream`.' },
  'help.cacheFeed.dir': { description: '`cache feed host --dir`.' },
  'help.cacheFeed.cards': {
    description:
      "`cache feed host --cards`. 'default'/'all'/'both' are literal flag values; default_cards and all_cards are Scryfall bulk names. {configKey} is the `defaultLanguage` config key. It is typed or matched exactly by the user, so never translate it.",
  },
  'help.cacheFeed.hostNoSeed': { description: '`cache feed host --no-seed`.' },
  'help.cacheFeed.torrentPort': {
    description: '`--torrent-port`, shared by `cache feed host` and `cache feed fetch`.',
  },
  'help.cacheFeed.hostVerbose': { description: '`cache feed host --verbose`.' },
  'help.cacheFeed.fetch': {
    description:
      'Summary of `cache feed fetch`. "Experimental" marks a feature that may change or be removed in any release.',
  },
  'help.cacheFeed.fetchFeedUrl': {
    description:
      '`cache feed fetch --url`. cacheFeedUrl is a config key. {configKey} is the `cacheFeedUrl` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.cacheFeed.fetchNoP2p': { description: '`cache feed fetch --no-p2p`.' },
  'help.cacheFeed.fetchNoSeed': { description: '`cache feed fetch --no-seed`.' },
  'help.cacheFeed.fetchForce': { description: '`cache feed fetch --force`.' },
  'help.cacheFeed.fetchRefresh': {
    description:
      '`cache feed fetch --refresh`. RITUAL_CACHE_FEED_REFRESH is an environment variable name. {envVar} is the `RITUAL_CACHE_FEED_REFRESH` environment variable. It is typed or matched exactly by the user, so never translate it.',
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
  'help.serve.api': {
    description:
      '`serve --api`. "(Beta)" marks a feature that works but may still change between releases.',
  },

  // ── build-site ────────────────────────────────────────────────────────
  'help.buildSite.description': { description: 'Summary of the `build-site` command.' },
  'help.buildSite.verbose': { description: '`build-site --verbose`.' },
  'help.buildSite.cacheImages': { description: '`build-site --cache-images`.' },
  'help.buildSite.decks': {
    description:
      '`build-site --decks`. site.includeDecks is a config key. {configKey} is the `site.includeDecks` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.buildSite.collections': {
    description:
      '`build-site --collections`. site.includeCollections is a config key. {configKey} is the `site.includeCollections` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.buildSite.wantedLists': {
    description:
      '`build-site --wanted-lists`. site.includeWantedLists is a config key. {configKey} is the `site.includeWantedLists` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.buildSite.priceSources': {
    description:
      '`build-site --price-sources`. The store names are literal tokens and must not be translated. {configKey} is the `priceSources` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.buildSite.theme': {
    description:
      '`build-site --theme`. {example} and {invertedExample} are two built-in theme names (e.g. "izzet", "izzet-inverted"), typed exactly. {flag} is the `--theme-file` flag; {configKey} is the `site.theme` config key the flag overrides; {filesKey} is the `site.themeFiles` config key. Both are typed or matched exactly by the user, so never translate them.',
  },
  'help.buildSite.themeFile': {
    description:
      '`build-site --theme-file`. {configKey} is the `site.themeFiles` config key the flag replaces for one run. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.buildSite.locale': {
    description:
      '`build-site --locale` — the UI locale, deliberately distinguished from the card language. {configKey} is the `uiLocale` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.buildSite.locales': {
    description:
      '`build-site --locales`. {file} is the `dist/locales/` directory. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.buildSite.localeFile': { description: '`build-site --locale-file`.' },
  'help.buildSite.moxfieldUserAgent': {
    description:
      '`build-site --moxfield-user-agent`. MOXFIELD_USER_AGENT is an env var name. {envVar} is the `MOXFIELD_USER_AGENT` environment variable. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.buildSite.outDir': {
    description:
      '`build-site --out-dir`. {file} is the `dist/` directory; {command} is the `serve` command name; {flag} is the `--build` flag. Each is typed or matched exactly by the user, so never translate them.',
  },
  'help.buildSite.sellMode': {
    description:
      '"(Beta)" marks the sell mode of the web sites as a feature that may still change between releases. `--sell-mode`, shared by `build-site` and `serve`. site.sellMode is a config key name; Card Kingdom is a company name. {configKey} is the `site.sellMode` config key. It is typed or matched exactly by the user, so never translate it.',
  },

  // ── init-site ─────────────────────────────────────────────────────────
  'help.initSite.description': {
    description:
      'Summary of the `init-site` command, which sets up publishing (a CI workflow and the site settings) and is not a first step: a newcomer starts with {newCommand} or {importCommand}, the `new` and `import` command names. Each is typed or matched exactly by the user, so never translate them.',
  },
  'help.initSite.force': { description: '`init-site --force`.' },
  'help.initSite.ci': {
    description: "`init-site --ci`. 'github-actions'/'manual' are literal flag values.",
  },
  'help.initSite.deploy': {
    description: "`init-site --deploy`. 'publish-for-me'/'local-build' are literal flag values.",
  },
  'help.initSite.distDir': { description: '`init-site --dist-dir`.' },
  'help.initSite.changeDetection': { description: '`init-site --change-detection`.' },
  'help.initSite.noChangeDetection': { description: '`init-site --no-change-detection`.' },
  'help.initSite.priceSource': {
    description: '`init-site --price-source`. The quoted store names are literal values.',
  },
  'help.initSite.overwriteReadme': {
    description:
      '`init-site --overwrite-readme`. {file} is the `README.md` file name. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.initSite.noOverwriteReadme': {
    description:
      '`init-site --no-overwrite-readme`. {file} is the `README.md` file name. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.initSite.skills': {
    description:
      '`init-site --skills`. {file} is the `.claude/skills` directory. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.initSite.noSkills': { description: '`init-site --no-skills`.' },

  // ── migrate ───────────────────────────────────────────────────────────
  'help.migrate.description': { description: 'Summary of the `migrate` command.' },
  'help.migrate.yes': { description: '`migrate --yes`.' },
  'help.migrate.dryRun': { description: '`migrate --dry-run`.' },
  'help.migrate.check': { description: '`migrate --check`: the exit codes are literal.' },

  // ── self-update ───────────────────────────────────────────────────────
  'help.selfUpdate.description': { description: 'Summary of the `self-update` command.' },
  'help.selfUpdate.prerelease': {
    description:
      '`self-update --prerelease`: switch to the channel that includes prerelease (beta) builds.',
  },
  'help.selfUpdate.stable': {
    description: '`self-update --stable`: switch to stable releases only.',
  },
  'help.selfUpdate.tag': {
    description: '`self-update --tag <tag>`: the example tag is literal.',
  },
  'help.selfUpdate.check': { description: '`self-update --check`: the exit codes are literal.' },
  'help.selfUpdate.yes': { description: '`self-update --yes`.' },

  // ── admin ─────────────────────────────────────────────────────────────
  'help.admin.description': { description: 'Summary of the `admin` command.' },
  'help.admin.port': { description: '`admin --port`.' },
  'help.admin.host': { description: '`admin --host`.' },
  'help.admin.theme': {
    description:
      '`admin --theme`. {example} and {invertedExample} are two built-in theme names (e.g. "izzet", "izzet-inverted"), typed exactly, so never translate them.',
  },
  'help.admin.mcp': {
    description:
      '`admin --mcp`. {flag} is the `--mcp-token` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.admin.mcpPort': {
    description:
      '`admin --mcp-port`. {flag} is the `--mcp` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.admin.mcpToken': {
    description:
      '`admin --mcp-token`. RITUAL_MCP_TOKEN is an environment variable name. {flag} is the `--mcp` flag; {envVar} is the `RITUAL_MCP_TOKEN` environment variable. Each is typed or matched exactly by the user, so never translate them.',
  },
  'help.admin.sellMode': {
    description:
      '"(Beta)" marks the sell mode of the web sites as a feature that may still change between releases. `admin --sell-mode`. site.sellMode is a config key name; Card Kingdom is a company name. {configKey} is the `site.sellMode` config key. It is typed or matched exactly by the user, so never translate it.',
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
    description:
      '`mcp --token`. RITUAL_MCP_TOKEN is an environment variable name. {envVar} is the `RITUAL_MCP_TOKEN` environment variable. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.mcp.allowUnauthenticated': { description: '`mcp --allow-unauthenticated`.' },
  'help.mcp.sellMode': {
    description:
      '`mcp --sell-mode`. site.sellMode is a config key name; Card Kingdom is a company name. "sell and buylist tools" refers to the get_sell_report, get_sell_cart, get_buylist_quotes and refresh_buylist MCP tools. {configKey} is the `site.sellMode` config key. It is typed or matched exactly by the user, so never translate it.',
  },

  // ── skills ────────────────────────────────────────────────────────────
  'help.skills.description': { description: 'Summary of the `skills` command group.' },
  'help.skills.list': { description: 'Summary of `skills list`.' },
  'help.skills.install': {
    description:
      'Summary of `skills install`. {skillsDirFile} is the `.claude/skills` directory; {globalSkillsDirFile} is the `~/.claude/skills` directory; {flag} is the `--global` flag. Each is typed or matched exactly by the user, so never translate them.',
  },
  'help.skills.update': { description: 'Summary of `skills update`.' },
  'help.skills.global': {
    description:
      '`skills install|update --global`. {file} is the `~/.claude/skills` directory. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.skills.dir': {
    description:
      '`skills install|update --dir`. {file} is the `.claude/skills` directory. It is typed or matched exactly by the user, so never translate it.',
  },
  'help.skills.force': { description: '`skills install|update --force`.' },

  // ── price ─────────────────────────────────────────────────────────────
  'help.price.description': { description: 'Summary of the `price` command.' },
  'help.price.listArg': { description: 'The `[listName]` argument of `price`.' },
  'help.price.source': {
    description:
      'Help text for the --source flag choosing which store prices come from. The store tokens (tcgplayer, cardmarket, cardkingdom, cardhoarder) are literal values and must not be translated. {configKey} is the `defaultPriceSource` config key. It is typed or matched exactly by the user, so never translate it.',
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
  'help.sell.sets': { description: '`sell --sets`.' },
  'help.sell.min': { description: '`sell --min`.' },
  'help.sell.tags': {
    description:
      '`sell --tags`. Tags are free-form labels the user puts on individual cards; the value is a comma-separated list. CK is Card Kingdom; "buy limits" are how many copies of a card it will buy.',
  },
  'help.sell.minOwned': {
    description:
      '`sell --min-owned`. Counts every copy of the card by name (any printing) in all collections and decks, not only the lists being checked.',
  },
  'help.sell.minRatio': {
    description:
      '`sell --min-ratio`. The ratio is the buylist offer divided by the TCGplayer market price; 0.8 means the offer is 80% of market. TCGplayer is a store name.',
  },
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
    description:
      '`locale --detect`. {configKey} is the `uiLocale` config key. It is typed or matched exactly by the user, so never translate it.',
  },

  // ── license / dep-license ─────────────────────────────────────────────
  'help.license.description': { description: 'Summary of the `license` command.' },
  'help.license.plain': { description: '`license --plain`.' },
  'help.depLicense.description': { description: 'Summary of the `dep-license` command.' },
  'help.depLicense.packageArg': { description: 'The `[package]` argument of `dep-license`.' },
  'help.depLicense.list': { description: '`dep-license --list`.' },
  'help.depLicense.plain': { description: '`dep-license --plain`.' },
  'help.doctor.description': { description: 'Summary of the `doctor` command.' },
} as const satisfies MetaFor<typeof helpInfraMessages>
