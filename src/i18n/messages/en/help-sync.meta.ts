/** Translator metadata for {@link helpSyncMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { helpSyncMessages } from './help-sync'

export const helpSyncMeta = {
  // ── Shared sync plumbing ──────────────────────────────────────────────
  'help.sync.direction': {
    description:
      "The `<direction>` argument of `collection-sync`. 'push' and 'pull' are the literal values the user types; Archidekt is a website name.",
  },
  'help.sync.yes': {
    description:
      '`--yes` on both sync commands. Branches on which surface is being synced; an unreadable line is one the list parser could not understand, and syncing drops it.',
  },
  'help.sync.only': {
    description:
      "`--only` on both sync commands. 'additions' and 'removals' are the literal values the user types.",
  },
  'help.sync.dryRun': { description: '`--dry-run` on both sync commands.' },

  // ── collection-sync ───────────────────────────────────────────────────
  'help.collectionSync.description': { description: 'Summary of the `collection-sync` command.' },
  'help.collectionSync.lists': { description: 'The `[lists...]` argument of `collection-sync`.' },
  'help.collectionSync.into': {
    description: '`collection-sync --into`. collectionSync.pullTarget is a config key.',
  },
  'help.collectionSync.removalPriority': {
    description:
      '`collection-sync --removal-priority`. An ambiguous removal is one where several lists hold copies of the removed card.',
  },
  'help.collectionSync.csv': {
    description: '`collection-sync --csv`. {threshold} is a whole number of cards.',
  },
  'help.collectionSync.csvFile': { description: '`collection-sync --csv-file`.' },
  'help.collectionSync.refresh': {
    description:
      '`collection-sync --refresh`. ask/auto/no-bulk/never are the literal values the user types.',
  },

  // ── deck-sync ─────────────────────────────────────────────────────────
  'help.deckSync.description': { description: 'Summary of the `deck-sync` command group.' },
  'help.deckSync.pull': { description: 'Summary of `deck-sync pull`.' },
  'help.deckSync.push': { description: 'Summary of `deck-sync push`.' },
  'help.deckSync.decks': {
    description: 'The `[decks...]` argument of `deck-sync push` and `deck-sync pull`.',
  },
  'help.deckSync.force': {
    description: '`deck-sync push --force`. `deck-sync status` is a command name.',
  },
  'help.deckSync.syncPrintings': {
    description:
      '`deck-sync pull/push --sync-printings`. "Printing" is a specific edition of a card; "finish" is its foil/etched treatment.',
  },
  'help.deckSync.link': { description: 'Summary of `deck-sync link`.' },
  'help.deckSync.linkDeck': { description: 'The `<deck>` argument of `deck-sync link`.' },
  'help.deckSync.linkUrl': {
    description: 'The `<url>` argument of `deck-sync link`. The example URL stays as-is.',
  },
  'help.deckSync.linkDryRun': { description: '`deck-sync link --dry-run`.' },
  'help.deckSync.status': { description: 'Summary of `deck-sync status`.' },

  // ── login ─────────────────────────────────────────────────────────────
  'help.login.description': {
    description: 'Summary of the `login` command group. Only Archidekt is supported today.',
  },
  'help.login.archidekt': { description: 'Summary of `login archidekt`.' },
  'help.login.forceLogin': { description: '`login archidekt --force-login`.' },
  'help.login.username': { description: '`login archidekt --username`.' },
  'help.login.passwordStdin': {
    description: '`login archidekt --password-stdin`. stdin is the standard input stream.',
  },
  'help.login.status': { description: 'Summary of `login status`.' },
  'help.login.logout': { description: 'Summary of `login logout`.' },

  // ── import ────────────────────────────────────────────────────────────
  'help.import.description': {
    description: 'Summary of the `import` command. The three site names stay as-is.',
  },
  'help.import.source': { description: 'The `<source>` argument of `import`.' },
  'help.import.type': {
    description: '`import --type`. {types} is a comma-separated list of literal list types.',
  },
  'help.import.name': { description: '`import --name`.' },
  'help.import.deckFormat': {
    description: '`import --deck-format`. commander/modern are literal format names.',
  },
  'help.import.columns': {
    description:
      "`import --columns`. The quoted mapping and {fields} are literal spellings the user types; '1-based' means the first column is 1, not 0.",
  },
  'help.import.noHeader': { description: '`import --no-header`.' },
  'help.import.append': { description: '`import --append`.' },
  'help.import.csv': { description: '`import --csv`.' },
  'help.import.overwrite': { description: '`import --overwrite`.' },
  'help.import.yes': { description: '`import --yes`.' },
  'help.import.syncPrintings': {
    description:
      '`import --sync-printings` / `import-account --sync-printings`: keep the exact printings a deck site states instead of being asked.',
  },
  'help.import.noSyncPrintings': {
    description:
      '`import --no-sync-printings` / `import-account --no-sync-printings`: drop the printings instead of being asked.',
  },
  'help.import.moxfieldUserAgent': {
    description:
      '`import --moxfield-user-agent`. User-Agent is an HTTP header and MOXFIELD_USER_AGENT an environment variable — both stay as-is.',
  },
  'help.import.dryRun': { description: '`import --dry-run`.' },

  // ── import-account ────────────────────────────────────────────────────
  'help.importAccount.description': { description: 'Summary of the `import-account` command.' },
  'help.importAccount.username': { description: 'The `[username]` argument of `import-account`.' },
  'help.importAccount.all': { description: '`import-account --all`.' },
  'help.importAccount.overwrite': { description: '`import-account --overwrite`.' },
  'help.importAccount.yes': { description: '`import-account --yes`.' },
  'help.importAccount.dryRun': { description: '`import-account --dry-run`.' },

  // ── import-changes ────────────────────────────────────────────────────
  'help.importChanges.description': {
    description:
      'Summary of the `import-changes` command. A change bundle is the JSON file the site editor exports when it cannot write to disk itself.',
  },
  'help.importChanges.file': { description: 'The `<file>` argument of `import-changes`.' },
  'help.importChanges.yes': { description: '`import-changes --yes`.' },

  // ── export ────────────────────────────────────────────────────────────
  'help.export.description': { description: 'Summary of the `export` command.' },
  'help.export.lists': {
    description:
      'The `[lists...]` argument of `export`. The three prefixes are literal spellings, colon included.',
  },
  'help.export.all': { description: '`export --all`. --card is a flag spelling.' },
  'help.export.card': { description: '`export --card`.' },
  'help.export.name': { description: '`export --name`.' },
  'help.export.set': { description: '`export --set`. A set code is a short code such as MKM.' },
  'help.export.finish': {
    description: '`export --finish`. {finishes} is a comma-separated list of literal finishes.',
  },
  'help.export.condition': {
    description:
      "`export --condition`. {conditions} is a comma-separated list of literal condition codes; 'none' is also literal.",
  },
  'help.export.labels': {
    description:
      '`export --labels`. {labels} is a comma-separated list of literal label tokens and {none} the literal token selecting unlabeled cards.',
  },
  'help.export.format': {
    description: '`export --format`. {formats} and csv are literal values.',
  },
  'help.export.columns': {
    description:
      '`export --columns`. {properties} is a comma-separated list of literal column names.',
  },
  'help.export.dialect': {
    description:
      '`export --dialect`. {dialects} and ritual are literal values; csv, json, text and md are format slugs.',
  },
  'help.export.noHeader': { description: '`export --no-header`.' },
  'help.export.quoteAll': { description: '`export --quote-all`.' },
  'help.export.out': { description: '`export --out`. stdout is the standard output stream.' },
  'help.export.preset': { description: '`export --preset`.' },
  'help.export.savePreset': { description: '`export --save-preset`.' },
} as const satisfies MetaFor<typeof helpSyncMessages>
