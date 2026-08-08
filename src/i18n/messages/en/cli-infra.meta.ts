/** Translator metadata for {@link cliInfraMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { cliInfraMessages } from './cli-infra'

export const cliInfraMeta = {
  'cli.listScope.oneTypeFlag': {
    description:
      'Usage error when more than one of the --deck/--collection/--wanted scope flags is given.',
  },

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

  // ── cache preload ─────────────────────────────────────────────────────
  'cli.cache.preloadingSet': {
    description: 'Progress line of `cache preload-set`. {set} is an upper-case set code.',
  },
  'cli.cache.preloadSetFailed': {
    description: '`cache preload-set` failed. {reason} is an underlying error message.',
  },
  'cli.cache.preloadSetNotFound': {
    description: 'The set code matched nothing on Scryfall — almost always a typo.',
  },
  'cli.cache.preloadSetNoPrintings': {
    description:
      'The set exists but holds nothing cacheable. {counted} is a pre-rendered "N items" fragment.',
  },
  'cli.cache.preloadSetDone': { description: '`cache preload-set` succeeded.' },
  'cli.cache.preloadAllFailed': { description: '`cache preload-all` failed.' },
  'cli.cache.refreshTagsFailed': { description: '`cache refresh-tags` failed.' },

  // ── cache feed ────────────────────────────────────────────────────────
  'cli.cacheFeed.invalidCards': {
    description: 'Usage error for `cache feed host --cards`. The quoted words are literal values.',
  },
  'cli.cacheFeed.initialFeedFailed': {
    description:
      'The first feed generation failed and there is no existing feed to fall back on. The error object is printed after this line.',
  },
  'cli.cacheFeed.refreshFailed': {
    description: 'A feed refresh failed but a previously generated feed is still being served.',
  },
  'cli.cacheFeed.seedStartFailed': {
    description: 'The BitTorrent seeder would not start. The error is printed after this line.',
  },
  'cli.cacheFeed.seedingTorrents': {
    description: 'How many torrents the feed host is seeding, when the TCP port is unknown.',
  },
  'cli.cacheFeed.seedingTorrentsOnPort': {
    description: 'How many torrents the feed host is seeding, and on which TCP port.',
  },
  'cli.cacheFeed.serverStartFailed': {
    description: 'The feed HTTP server would not bind — usually the port is already in use.',
  },
  'cli.cacheFeed.scheduledRefreshFailed': {
    description: 'A scheduled (background) feed refresh failed on a running host.',
  },
  'cli.cacheFeed.listening': { description: 'The feed host is up. {url} is its feed URL.' },
  'cli.cacheFeed.publicUrl': {
    description: 'The base URL peers will reach this feed host at.',
  },
  'cli.cacheFeed.seedingDisabled': {
    description: 'The feed host was started with --no-seed.',
  },
  'cli.cacheFeed.syncing': { description: '`cache feed fetch` is contacting the feed.' },
  'cli.cacheFeed.syncFailed': {
    description: '`cache feed fetch` could not sync. The error is printed after this line.',
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
    description: 'A scheduled feed re-check failed while seeding.',
  },
  'cli.cacheFeed.feedChanged': {
    description: 'A scheduled re-check found new data and ingested it.',
  },
  'cli.cacheFeed.stopping': { description: 'Ctrl+C was pressed; the seeder is shutting down.' },

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

  // ── serve ─────────────────────────────────────────────────────────────
  'cli.serve.building': { description: '`serve --build` is building the site first.' },
  'cli.serve.buildFailed': { description: 'The build under `serve --build` threw.' },
  'cli.serve.noBuiltSite': {
    description:
      'Nothing to serve. {outDirFlag} is either empty or a ready-to-paste " --out-dir <path>" fragment.',
  },
  'cli.serve.cacheImagesNote': {
    description: '--cache-images has no effect on the live data served by `serve --api`.',
  },
  'cli.serve.emptyCardCache': {
    description:
      '`serve --api` started with an empty card cache, so card search will find nothing.',
  },
  'cli.serve.servingWithApi': { description: 'Startup line for `serve --api`.' },
  'cli.serve.serving': { description: 'Startup line for plain `serve`.' },

  // ── admin ─────────────────────────────────────────────────────────────
  'cli.admin.mcpTokenRequired': { description: '`admin --mcp` was given without a bearer token.' },
  'cli.admin.mcpPortConflict': {
    description: 'The embedded MCP endpoint was pointed at the admin server’s own port.',
  },
  'cli.admin.preparing': { description: '`admin` is bundling assets before listening.' },
  'cli.admin.ready': { description: 'The admin assets are written; the server is about to start.' },
  'cli.admin.teardownFailed': {
    description:
      'One of the listeners refused to close on shutdown. {label} names it; the reason follows on the same line.',
  },
  'cli.admin.promptPassword': { description: 'Password prompt of the admin account subcommands.' },
  'cli.admin.passwordCancelled': { description: 'The password prompt was cancelled.' },
  'cli.admin.usernameTooLong': { description: 'The given admin username exceeds the limit.' },
  'cli.admin.passwordTooLong': { description: 'The given admin password exceeds the limit.' },
  'cli.admin.passwordTooShort': {
    description: 'The given admin password is below the minimum length. {min} is that minimum.',
  },
  'cli.admin.noUser': {
    description: 'An account subcommand needs an existing admin user and there is none.',
  },
  'cli.admin.usernameRequired': { description: '`admin setup` was run without --username.' },
  'cli.admin.userExists': { description: '`admin setup` was run but an account already exists.' },
  'cli.admin.userCreated': { description: '`admin setup` succeeded.' },
  'cli.admin.passwordReset': { description: '`admin reset-password` succeeded.' },
  'cli.admin.totpNotEnabled': {
    description: '`admin disable-totp` was run with no TOTP secret to clear.',
  },
  'cli.admin.totpDisabled': { description: '`admin disable-totp` succeeded.' },

  // ── build-site: flag and file parsing ─────────────────────────────────
  'cli.buildSite.themeFileUnreadable': { description: 'A --theme-file path could not be read.' },
  'cli.buildSite.themeFileNotJson': { description: 'A --theme-file is not valid JSON.' },
  'cli.buildSite.themeFileInvalid': {
    description: 'A --theme-file parsed but is not a valid theme. {reason} explains why.',
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
      'A locale file entry is not a renderable message. {reason} is the shape parser\'s own English explanation (e.g. "value must be a string, a $plural table, or a $select table") and is not itself translated.',
  },
  'cli.buildSite.localeFileBadTag': {
    description: 'A --locale-file is named for something that is not a BCP-47 tag.',
  },
  'cli.buildSite.localeFileUnreadable': { description: 'A --locale-file path could not be read.' },
  'cli.buildSite.localeFileInvalid': {
    description: 'A --locale-file failed validation. {reason} is one of the fragments above.',
  },
  'cli.buildSite.localeInvalid': { description: 'The --locale value is not a valid BCP-47 tag.' },
  'cli.buildSite.localesInvalid': { description: 'A --locales value is not a valid BCP-47 tag.' },
  'cli.buildSite.localesUnknown': {
    description:
      'A --locales tag names a locale this build has no dictionary for. RITUAL_BUNDLED_LOCALES is an env var name.',
  },
  'cli.buildSite.bakedLocaleUndictionaried': {
    description:
      'Warning: the baked-in locale has no dictionary, so the site renders English under a non-English html lang.',
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
      'Warning: the site selection config names a list that no longer exists. {configKey} is a literal config key.',
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
    description: 'There are no lists at all. The backticked commands are literal.',
  },
  'cli.buildSite.starting': { description: 'First line of a build.' },
  'cli.buildSite.cachingImages': { description: 'Progress line under --cache-images.' },
  'cli.buildSite.usingImageUrls': { description: 'Progress line without --cache-images.' },
  'cli.buildSite.fetchingSymbols': { description: 'Progress line: mana symbol download phase.' },
  'cli.buildSite.noSymbology': {
    description: 'Warning: --refresh never left the symbology uncached, so symbols will be absent.',
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
      'One collection or wanted list was loaded. {counted} is a pre-rendered "N cards" fragment; the $ and {price} are a USD total.',
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

  // ── init-site ─────────────────────────────────────────────────────────
  'cli.initSite.cancelled': { description: 'A prompt was cancelled, so nothing was written.' },
  'cli.initSite.fieldCiSystem': {
    description:
      'The noun naming the --ci value inside an "Invalid <field> …" error. A short noun phrase.',
  },
  'cli.initSite.fieldDeployMode': {
    description: 'The noun naming the --deploy value inside an "Invalid <field> …" error.',
  },
  'cli.initSite.fieldCurrency': {
    description: 'The noun naming the --currency value inside an "Invalid <field> …" error.',
  },
  'cli.initSite.distDirRequired': { description: '--dist-dir was given an empty value.' },
  'cli.initSite.missingFlag': {
    description:
      'A value is needed, prompts are unavailable, and a flag could supply it. {what} is one of the cli.initSite.subject* noun phrases.',
  },
  'cli.initSite.subjectCiSystem': {
    description:
      'Subject of cli.initSite.missingFlag: the CI system. A noun phrase, not a question.',
  },
  'cli.initSite.subjectDeployMode': {
    description: 'Subject of cli.initSite.missingFlag: the deploy mode.',
  },
  'cli.initSite.subjectDistDir': {
    description: 'Subject of cli.initSite.missingFlag: the built-site directory.',
  },
  'cli.initSite.subjectChangeDetection': {
    description: 'Subject of cli.initSite.missingFlag: the change-detection decision.',
  },
  'cli.initSite.subjectCurrency': {
    description: 'Subject of cli.initSite.missingFlag: the default price currency.',
  },
  'cli.initSite.promptOverwrite': {
    description: 'Confirm prompt before overwriting a generated file. {path} is repo-relative.',
  },
  'cli.initSite.promptSkills': {
    description: 'Confirm prompt: install the Ritual agent skills into this repository?',
  },
  'cli.initSite.promptCurrency': { description: 'Select prompt: the default price currency.' },
  'cli.initSite.currencyUsd': {
    description: 'Hint under the USD choice. TCGplayer is the price source.',
  },
  'cli.initSite.currencyEur': {
    description: 'Hint under the EUR choice. Cardmarket is the price source.',
  },
  'cli.initSite.currencyTix': {
    description: 'Hint under the TIX choice. MTGO tickets are Magic Online’s currency.',
  },
  'cli.initSite.currencyCurrent': {
    description: 'Marks the currently configured currency in the picker. {currency} is a code.',
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
  'cli.initSite.deployLocalHint': { description: 'Choice hint under the local-build row.' },
  'cli.initSite.promptDistDir': { description: 'Text prompt: the built-site directory.' },
  'cli.initSite.promptChangeDetection': {
    description: 'Confirm prompt: add the changelog-committing step to the workflow?',
  },
  'cli.initSite.promptUpgrade': {
    description: 'Confirm prompt after a Ritual upgrade. {from}/{to} are version numbers.',
  },
  'cli.initSite.readmeExists': {
    description: 'README.md exists, prompts are unavailable, and no explicit decision was given.',
  },
  'cli.initSite.fileExists': {
    description: 'A generated file exists and prompts are unavailable.',
  },
  'cli.initSite.alreadyInitializedFlags': {
    description: 'Fresh-init flags were given in an already-initialized repository.',
  },
  'cli.initSite.manualOnlyFlags': {
    description: 'GitHub-Actions-only flags were combined with --ci manual.',
  },
  'cli.initSite.changeDetectionScope': {
    description: '--change-detection was combined with a deploy mode that has no such step.',
  },
  'cli.initSite.distDirScope': {
    description: '--dist-dir was combined with a deploy mode that does not build locally.',
  },
  'cli.initSite.upgradeRequired': {
    description: 'An upgrade needs confirmation and prompts are unavailable.',
  },
  'cli.initSite.alreadyCurrent': {
    description:
      'Re-running init-site on an already-current repository. This is a success, not an error.',
  },
  'cli.initSite.downgrade': {
    description: 'The running build is older than the one that initialized the repository.',
  },
  'cli.initSite.downgradeAdvice': {
    description: 'How to recover from a downgrade. "site" is a literal config key.',
  },
  'cli.initSite.upgrading': { description: 'Regenerating managed files for a newer Ritual.' },
  'cli.initSite.configUpdated': {
    description: 'The site section of ritual.config.json was stamped with the new version.',
  },
  'cli.initSite.configWriteFailed': { description: 'ritual.config.json could not be written.' },
  'cli.initSite.migrationUpdated': { description: 'A managed file was regenerated.' },
  'cli.initSite.migrationRemoved': {
    description: 'A managed file this version no longer uses was deleted.',
  },
  'cli.initSite.created': { description: 'A generated file was written.' },
  'cli.initSite.skipped': { description: 'A generated file was left as the user had it.' },
  'cli.initSite.gitignoreCreated': { description: '.gitignore did not exist and was written.' },
  'cli.initSite.gitignoreUpdated': { description: '.gitignore gained the missing Ritual entries.' },
  'cli.initSite.gitignoreUnchanged': { description: '.gitignore already had every entry.' },
  'cli.initSite.gitignoreStillIgnores': {
    description:
      'Warning: an existing .gitignore pattern still hides the built site this deploy mode must commit. {patterns} is a comma-separated list of the offending lines.',
  },
  'cli.initSite.nextSteps': { description: 'Header of the closing checklist.' },
  'cli.initSite.stepAddDecks': {
    description: 'Checklist step 1. The parenthesized command is literal. Keep the numbering.',
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
    description: 'Closing tip. RITUAL_VERSION is a GitHub Actions variable name.',
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
      'How to overwrite locally edited skills, phrased for the `skills` subcommands. Spliced into cli.skills.skipped as {forceHint}.',
  },
  'cli.skills.forceHintInit': {
    description: 'The same hint phrased for a fresh `init-site`, whose flag is --force.',
  },
  'cli.skills.forceHintUpdate': {
    description:
      'The same hint phrased for an `init-site` upgrade, which defers to `skills update`.',
  },

  // ── mcp ───────────────────────────────────────────────────────────────
  'cli.mcp.refusingUnauthenticated': {
    description: 'The HTTP transport was pointed at a public interface with no bearer token.',
  },
  'cli.mcp.unauthenticatedWarning': {
    description: 'The above refusal was overridden with --allow-unauthenticated.',
  },
  'cli.mcp.unauthenticatedLoopback': {
    description: 'Serving without a token, which is tolerable because the host is loopback-only.',
  },
  'cli.mcp.httpTeardownFailed': {
    description: 'The MCP HTTP listener refused to close. The error follows on the same line.',
  },
  'cli.mcp.stdioIgnoredFlags': {
    description: 'HTTP-only flags were passed under --transport stdio. {flags} is a flag list.',
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
    description: '`dep-license` was given both a package name and --list.',
  },
  'cli.depLicense.packageNotFound': { description: 'No bundled dependency has that name.' },
  'cli.depLicense.needsPackage': {
    description: 'The dependency picker needs a terminal. {reason} explains which half is missing.',
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
  'cli.price.fieldSort': {
    description: 'The noun naming the --sort value inside an "Invalid <field> …" error.',
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
    description: 'The cheapest-printing total, shown only when it differs from the total.',
  },
  'cli.price.totalsUnpriced': { description: 'How many entries have no price at all.' },
  'cli.price.headerUpdated': {
    description: 'Top line of the browser: price age and active currency.',
  },
  'cli.price.updatedUnknown': { description: 'The price cache carries no refresh timestamp.' },
  'cli.price.updatedAt': {
    description: 'An absolute timestamp plus its relative age, e.g. "… (2 hours ago)".',
  },
  'cli.price.headerTypeTotals': {
    description: 'One per-type totals row. {icon} is an emoji; {title} is a plural list-type name.',
  },
  'cli.price.headerGrandTotals': { description: 'The across-all-types totals row.' },
  'cli.price.listRow': { description: 'One list’s row in the browser’s main menu.' },
  'cli.price.menuSearch': { description: 'Main menu action: search every list’s cards.' },
  'cli.price.menuRefresh': { description: 'Main menu action: redownload prices.' },
  'cli.price.menuCurrency': { description: 'Main menu action: switch currency.' },
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
  'cli.price.promptCurrency': { description: 'Select prompt of the currency picker.' },
  'cli.price.currencyRowCurrent': {
    description: 'Marks the active currency in the picker. {currency} is an upper-case code.',
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
      'One entry the buylist is buying. {annotation} is a printing annotation such as " (NEO:234) [foil]" and is never translated.',
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
  'cli.sell.header': { description: 'Provenance line of the report: which feed, and how old.' },
  'cli.sell.headerGenerated': {
    description: 'Appended to the provenance line when the feed states its generation date.',
  },
  'cli.sell.totals': {
    description: 'Grand total. {counted} is a pre-rendered "N lists" fragment.',
  },
  'cli.sell.unsoldSummary': {
    description: 'Counts the entries hidden without --all. Keep the indentation.',
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
      'Names the tier that won: the config file. uiLocale and ritual.config.json are literal.',
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
      'The card language, printed beside the UI locale precisely so the two are not confused. defaultLanguage is a config key.',
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
      'The yes/no question offering to persist the detected locale. uiLocale and ritual.config.json are literal.',
  },
  'cli.locale.detectSaved': { description: 'The detected locale was written to the config file.' },
  'cli.locale.detectDeclined': { description: 'The offer was declined; nothing was written.' },
  'cli.locale.detectNoPrompt': {
    description:
      'Prompting was impossible, so the equivalent command is printed instead. {reason} is the shared "prompts are disabled" / "stdin is not a terminal" phrase; {command} is a literal command line.',
  },
  'cli.prompt.subject.uiLocale': {
    description:
      'Noun phrase naming what the `locale --detect` confirmation wanted, spliced into "Input required: {subject} ({reason})".',
  },
} as const satisfies MetaFor<typeof cliInfraMessages>
