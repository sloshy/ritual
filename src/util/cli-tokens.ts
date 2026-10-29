/**
 * The machine tokens Ritual's messages name — flags, commands, environment
 * variables, config keys, file names and example values — spelled once, here.
 *
 * A message that tells the user to type something exactly (`pass --yes`, `run
 * ritual migrate`, `set RITUAL_MCP_TOKEN`) never writes that token into the
 * catalog. It names a `{placeholder}` and the call site passes the token from
 * this module, so a translator can move it but never alter it, and a renamed
 * flag cannot drift from the sentences that mention it.
 * `scripts/check-locales.ts` (check 13) rejects an English string that inlines
 * a flag, a `ritual <command>` line or a `RITUAL_*` variable again.
 *
 * `test/unit/cli-tokens.test.ts` checks every {@link FLAG} against an option and
 * every {@link COMMAND} against a command the real program registers;
 * {@link CONFIG_KEY} and {@link RETIRED_CONFIG_KEY} are checked by their types, against the config shape.
 *
 * Browser-safe and dependency-free (the one import is type-only): the admin SPA
 * and the i18n machinery name these tokens too.
 */

import type {
  CollectionSyncConfig,
  ManagedConfig,
  RitualConfig,
  SiteConfig,
} from '../config/ritual-config'

/** The binary's name, as the user types it at the start of a command line. */
export const CLI_NAME = 'ritual'

/** A long option, spelled exactly as it is typed. */
export type FlagToken = `--${string}`

/** A positional argument's placeholder in a usage line: `<direction>`. */
export type ArgumentToken = `<${string}>`

/** Long options the messages name, by camelCase name. */
export const FLAG = {
  add: '--add',
  all: '--all',
  allCopies: '--all-copies',
  allowRemoveAll: '--allow-remove-all',
  allowUnauthenticated: '--allow-unauthenticated',
  api: '--api',
  append: '--append',
  art: '--art',
  baseDir: '--base-dir',
  build: '--build',
  cacheImages: '--cache-images',
  card: '--card',
  cardId: '--card-id',
  cards: '--cards',
  categories: '--categories',
  changeDetection: '--change-detection',
  ci: '--ci',
  clear: '--clear',
  collection: '--collection',
  collections: '--collections',
  collectorNumber: '--collector-number',
  columns: '--columns',
  commander: '--commander',
  condition: '--condition',
  confirm: '--confirm',
  count: '--count',
  csv: '--csv',
  csvFile: '--csv-file',
  deck: '--deck',
  deckFormat: '--deck-format',
  decks: '--decks',
  denyHttp: '--deny-http',
  deploy: '--deploy',
  dialect: '--dialect',
  distDir: '--dist-dir',
  dryRun: '--dry-run',
  fields: '--fields',
  finish: '--finish',
  force: '--force',
  format: '--format',
  from: '--from',
  fromFile: '--from-file',
  global: '--global',
  hashOnly: '--hash-only',
  host: '--host',
  into: '--into',
  label: '--label',
  language: '--language',
  limit: '--limit',
  list: '--list',
  locale: '--locale',
  localeFile: '--locale-file',
  locales: '--locales',
  mcp: '--mcp',
  mcpPort: '--mcp-port',
  mcpToken: '--mcp-token',
  min: '--min',
  minOwned: '--min-owned',
  minRatio: '--min-ratio',
  moxfieldUserAgent: '--moxfield-user-agent',
  name: '--name',
  nameOnly: '--name-only',
  noCategories: '--no-categories',
  noChangeDetection: '--no-change-detection',
  noCommander: '--no-commander',
  noHeader: '--no-header',
  noInput: '--no-input',
  noOverwriteReadme: '--no-overwrite-readme',
  noSeed: '--no-seed',
  noSkills: '--no-skills',
  noSyncPrintings: '--no-sync-printings',
  note: '--note',
  only: '--only',
  outDir: '--out-dir',
  output: '--output',
  overwrite: '--overwrite',
  overwriteReadme: '--overwrite-readme',
  pages: '--pages',
  passwordStdin: '--password-stdin',
  port: '--port',
  prerelease: '--prerelease',
  priceSource: '--price-source',
  priceSources: '--price-sources',
  quantity: '--quantity',
  quoteAll: '--quote-all',
  random: '--random',
  refresh: '--refresh',
  removalPriority: '--removal-priority',
  remove: '--remove',
  section: '--section',
  sellMode: '--sell-mode',
  set: '--set',
  show: '--show',
  skills: '--skills',
  skipFormats: '--skip-formats',
  sort: '--sort',
  source: '--source',
  specific: '--specific',
  stdin: '--stdin',
  syncCategories: '--sync-categories',
  syncPrintings: '--sync-printings',
  tag: '--tag',
  themeFile: '--theme-file',
  to: '--to',
  toSection: '--to-section',
  token: '--token',
  transport: '--transport',
  type: '--type',
  untag: '--untag',
  url: '--url',
  username: '--username',
  verbose: '--verbose',
  verify: '--verify',
  wanted: '--wanted',
  wantedLists: '--wanted-lists',
  yes: '--yes',
} as const satisfies Record<string, FlagToken>

/** A command's path below the binary: `['cache', 'preload-all']`. */
export type CommandPath = readonly [string, ...string[]]

/**
 * Every top-level command, plus the subcommands the messages name, by camelCase
 * name. The top-level list is complete (a test holds it to the program), so
 * `scripts/check-locales.ts` can tell `ritual migrate` from "a ritual process".
 */
export const COMMAND = {
  addCard: ['add-card'],
  admin: ['admin'],
  adminSetup: ['admin', 'setup'],
  buildSite: ['build-site'],
  cache: ['cache'],
  cacheFeedHost: ['cache', 'feed', 'host'],
  cachePreloadAll: ['cache', 'preload-all'],
  cacheRefreshTags: ['cache', 'refresh-tags'],
  card: ['card'],
  categories: ['categories'],
  categoriesOrder: ['categories', 'order'],
  cleanup: ['cleanup'],
  collectionSync: ['collection-sync'],
  config: ['config'],
  configSet: ['config', 'set'],
  configUnset: ['config', 'unset'],
  deckSync: ['deck-sync'],
  deckSyncLink: ['deck-sync', 'link'],
  deckSyncStatus: ['deck-sync', 'status'],
  delete: ['delete'],
  depLicense: ['dep-license'],
  detectChanges: ['detect-changes'],
  diff: ['diff'],
  edit: ['edit'],
  export: ['export'],
  getPrimer: ['get-primer'],
  history: ['history'],
  import: ['import'],
  importAccount: ['import-account'],
  importChanges: ['import-changes'],
  initSite: ['init-site'],
  license: ['license'],
  listAllCards: ['list-all-cards'],
  lists: ['lists'],
  locale: ['locale'],
  login: ['login'],
  loginArchidekt: ['login', 'archidekt'],
  mcp: ['mcp'],
  metadata: ['metadata'],
  metadataUnset: ['metadata', 'unset'],
  migrate: ['migrate'],
  move: ['move'],
  new: ['new'],
  note: ['note'],
  price: ['price'],
  removeCard: ['remove-card'],
  rename: ['rename'],
  scry: ['scry'],
  selfUpdate: ['self-update'],
  sell: ['sell'],
  serve: ['serve'],
  setCard: ['set-card'],
  setListImage: ['set-list-image'],
  skills: ['skills'],
  skillsInstall: ['skills', 'install'],
} as const satisfies Record<string, CommandPath>

/** Environment variables the messages name, by camelCase name. */
export const ENV_VAR = {
  bundledLocales: 'RITUAL_BUNDLED_LOCALES',
  cacheFeedRefresh: 'RITUAL_CACHE_FEED_REFRESH',
  githubToken: 'GITHUB_TOKEN',
  i18nStrict: 'RITUAL_I18N_STRICT',
  locale: 'RITUAL_LOCALE',
  mcpToken: 'RITUAL_MCP_TOKEN',
  moxfieldUserAgent: 'MOXFIELD_USER_AGENT',
  noInput: 'RITUAL_NO_INPUT',
  version: 'RITUAL_VERSION',
} as const satisfies Record<string, Uppercase<string>>

/**
 * A `ritual.config.json` key or dotted key path, derived from the config shape so
 * a renamed key is a compile error here. It names whole blocks (`site`,
 * `managed`) and Ritual-owned keys (`managed.version`) too, so not every member
 * is something `ritual config set` accepts.
 */
export type ConfigKeyToken =
  | (keyof RitualConfig & string)
  | `site.${keyof SiteConfig & string}`
  | `managed.${keyof ManagedConfig & string}`
  | `collectionSync.${keyof CollectionSyncConfig & string}`

/** Config keys the messages name, by camelCase name. */
export const CONFIG_KEY = {
  artDir: 'artDir',
  cacheFeedUrl: 'cacheFeedUrl',
  cacheSource: 'cacheSource',
  collectionSyncPullTarget: 'collectionSync.pullTarget',
  defaultCategories: 'defaultCategories',
  defaultLanguage: 'defaultLanguage',
  defaultPriceSource: 'defaultPriceSource',
  exportPresets: 'exportPresets',
  managed: 'managed',
  managedVersion: 'managed.version',
  priceSources: 'priceSources',
  site: 'site',
  siteIncludeCollections: 'site.includeCollections',
  siteIncludeDecks: 'site.includeDecks',
  siteIncludeWantedLists: 'site.includeWantedLists',
  siteSellMode: 'site.sellMode',
  uiLocale: 'uiLocale',
} as const satisfies Record<string, ConfigKeyToken>

/** `M`, unless one of its values is a live config key — then `never`, which no value satisfies. */
type OnlyRetired<M extends Record<string, string>> = [Extract<M[keyof M], ConfigKeyToken>] extends [
  never,
]
  ? M
  : never

const RETIRED = {
  sitePrerelease: 'site.prerelease',
  siteVersion: 'site.version',
} as const

/**
 * Keys a migration removes. They are no longer in the config shape, but the
 * migration's description still names them, so the user can recognize what
 * changed in their file. Typed through {@link OnlyRetired}: a key that is live
 * again is a compile error here.
 */
export const RETIRED_CONFIG_KEY: OnlyRetired<typeof RETIRED> = RETIRED

/** One of {@link RETIRED_CONFIG_KEY}'s keys. */
export type RetiredConfigKey = (typeof RETIRED)[keyof typeof RETIRED]

/** Files and directories the messages name, by camelCase name. */
export const FILE = {
  config: 'ritual.config.json',
  decksDir: 'decks/',
  distDir: 'dist/',
  distLocalesDir: 'dist/locales/',
  gitignore: '.gitignore',
  globalSkillsDir: '~/.claude/skills',
  hashSidecar: '.sha256',
  primer: '.primer.md',
  readme: 'README.md',
  skillsDir: '.claude/skills',
} as const satisfies Record<string, string>

/** Example values a message shows the shape of, typed as the user would type them. */
export const EXAMPLE = {
  archidektDeckUrl: 'https://archidekt.com/decks/123456',
  artFile: 'proxies/sol-ring.jpg',
  artUrl: 'https://example.com/sol-ring.jpg',
  bannedPrinting: 'SLD:123',
  bannedPrintingFormat: 'SET:COLLECTOR',
  apiBaseUrl: 'https://ritual-api.example.com',
  cacheServerHost: 'localhost:4000',
  cacheServerUrl: 'http://localhost:4000',
  feedPublicUrl: 'http://<host>:<port>',
  feedUrl: 'https://feed.example.com/feed.json',
  /** CSV-import spellings and the tokens the importer writes for them. */
  // i18n-exempt: importer input spellings and the card-line tokens they become, matched verbatim
  importNormalization: '“Near Mint” → NM, “F” → foil, “side” → Sideboard',
} as const

/** Pages a message sends the user to. */
export const LINK = {
  scryfallSets: 'https://scryfall.com/sets',
} as const

/** The command that updates a Docker install, which `self-update` cannot. */
// i18n-exempt: a docker command line, typed verbatim
export const DOCKER_PULL_COMMAND = 'docker pull ghcr.io/sloshy/ritual'

/** `ritual <command> [args…]`: a whole command line, as the user types it. */
export function commandLine(command: CommandPath, ...args: readonly string[]): string {
  return [CLI_NAME, ...command, ...args].join(' ')
}

/** `<command> [args…]` without the binary — `config set`, as prose names it. */
export function bareCommandLine(command: CommandPath, ...args: readonly string[]): string {
  return [...command, ...args].join(' ')
}

/** A flag and its value: `--refresh auto`, `--pages <n>`. */
export function flagValue(flag: FlagToken, value: string): FlagToken {
  return `${flag} ${value}`
}
