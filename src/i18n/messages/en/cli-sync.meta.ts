/** Translator metadata for {@link cliSyncMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { cliSyncMessages } from './cli-sync'

/**
 * Recurring notes for this fragment, so each `description` can stay short:
 *
 * - **Flag and command names are never translated.** `--overwrite`, `--csv`,
 *   `ritual login archidekt`, `<commit>` and friends are typed by the user
 *   exactly as spelled here.
 * - **`(s)` is deliberate.** Several messages inherited a count-agnostic
 *   "1 card(s)" form from before the catalog existed, and integration tests pin
 *   those bytes. A translation is free to replace the whole value with a
 *   `$plural` table — the validator accepts a translated plural where English
 *   is a plain string.
 * - **Interchange text is spliced in, not translated.** `{listType}` is a
 *   persisted slug (`deck` / `collection` / `wanted`), `{field}` is a CSV column
 *   label, `{dialect}` an export dialect name, `{format}` an export format —
 *   all English by contract (plan §4.9).
 */

export const cliSyncMeta = {
  // ── `login` ───────────────────────────────────────────────────────────
  'cli.login.loggedInAs': {
    description:
      'Printed when `ritual login archidekt` finds a session that is already usable. {username} is the Archidekt account name.',
  },
  'cli.login.sessionExpiredFor': {
    description:
      'Printed just before a fresh login prompt, when the stored session for {username} can no longer authenticate.',
  },
  'cli.login.needsCredentialFlags': {
    description:
      'Usage error: a scripted login gave one of --username / --password-stdin but not both.',
  },
  'cli.login.usernamePrompt': {
    description: 'Text prompt for the Archidekt account name or e-mail address.',
  },
  'cli.login.passwordPrompt': { description: 'Masked prompt for the Archidekt password.' },
  'cli.login.success': {
    description: 'Confirmation after a login; {username} is the account Archidekt reported.',
  },
  'cli.login.successUnnamed': {
    description:
      'Confirmation after a login when Archidekt reported no account name to show; the same line as cli.login.success minus the account clause.',
  },
  'cli.login.failed': {
    description: 'Error line after a failed login; {reason} is the message the auth service gave.',
  },
  'cli.login.cancelled': {
    description:
      'Stderr line when the credential prompt is escaped; the command exits with the usage code.',
  },
  'cli.prompt.subject.loginCredentials': {
    description:
      'Noun phrase naming what the interactive login wanted, spliced into "Input required: {subject} ({reason})". The two flags are CLI option names — leave them untranslated.',
  },
  'cli.login.emptyPassword': {
    description: 'Usage error: --password-stdin was given but stdin held no password.',
  },
  'cli.login.notLoggedIn': {
    description: 'The whole output of `ritual login status` when no login is stored.',
  },
  'cli.login.accountUnnamed': {
    description:
      'The account half of the `ritual login status` line when a token is stored but records no username. Completed by one of the cli.login.status* frames, so it ends without punctuation.',
  },
  'cli.login.accountNamed': {
    description:
      'The account half of the `ritual login status` line. Completed by one of the cli.login.status* frames, so it ends without punctuation.',
  },
  'cli.login.statusExpired': {
    description:
      '`ritual login status` for a login that can no longer authenticate. {account} is cli.login.accountNamed or cli.login.accountUnnamed.',
  },
  'cli.login.statusRefreshable': {
    description:
      '`ritual login status` for an expired access token that a stored refresh token can still renew — the next sync will work.',
  },
  'cli.login.statusValidUntil': {
    description:
      '`ritual login status` for a working session. {expiration} is an ISO timestamp, rendered by the caller.',
  },
  'cli.login.loggedOut': {
    description: 'Confirmation from `ritual login logout` when a stored login was cleared.',
  },
  'cli.login.nothingToClear': {
    description: 'Result of `ritual login logout` when there was no stored login.',
  },

  // ── `import` — conflicts and saves ────────────────────────────────────
  'cli.import.cancelled': {
    description:
      'The one-word refusal every import path emits when the user cancels a prompt. Also sets the usage exit code, so a script can tell a cancel from a successful no-op.',
  },
  'cli.import.conflict': {
    description:
      'Usage error: an import would replace an existing list and was not told it may. {target} is a file name.',
  },
  'cli.import.conflictCsv': {
    description:
      'The CSV flavour of cli.import.conflict — CSV imports can also append, so the advice names one more flag.',
  },
  'cli.import.conflictAction': {
    description:
      'The raw stdin prompt for an import name conflict. The bracketed letters O, R and C are what the answer is matched on, so keep them (or the initial letters of the translated words) inside the brackets. Ends with a space: the user types on the same line.',
  },
  'cli.import.overwritingFile': {
    description:
      'Stderr notice, printed even under --quiet, that a named file is about to be replaced.',
  },
  'cli.import.deckExistsId': {
    description:
      'A deck with the same source id already exists. "ID Match" names the reason the conflict was detected.',
  },
  'cli.import.fileExistsName': {
    description:
      'A list file with the same (case-folded) name already exists. "Name Conflict" names the reason.',
  },
  'cli.import.promptNewFileName': {
    description:
      'Raw stdin prompt after choosing [R]ename for a deck. Ends with a space: the user types on the same line. ".md" is a file extension, not a word.',
  },
  'cli.import.promptNewListName': {
    description:
      'Raw stdin prompt after choosing [R]ename for a collection or wanted list. {label} is the list type as prose ("collection", "wanted list"). Ends with a space.',
  },
  'cli.import.cancelledSave': {
    description: 'The import stopped because the user chose [C]ancel at the conflict prompt.',
  },
  'cli.import.dryRunOverwriteDeck': {
    description:
      'Dry-run preview of a deck import that would replace an existing file. The "[dry-run]" tag prefixes every previewed action and is not translated.',
  },
  'cli.import.dryRunSaveDeck': {
    description: 'Dry-run preview of a deck import that would create a new file.',
  },
  'cli.import.dryRunSavePrimer': {
    description:
      'Dry-run preview of the primer sidecar a deck import would write beside the deck file.',
  },
  'cli.import.savedDeck': { description: 'Confirmation that a deck import was written to {path}.' },
  'cli.import.savedPrimer': {
    description: 'Confirmation that a deck import wrote a primer sidecar to {path}.',
  },
  'cli.import.dryRunOverwriteList': {
    description:
      'Dry-run preview of a collection/wanted import that would replace an existing file. {label} is the list type as prose.',
  },
  'cli.import.dryRunSaveList': {
    description: 'Dry-run preview of a collection/wanted import that would create a new file.',
  },
  'cli.import.savedList': {
    description:
      'Confirmation that a collection/wanted import was written. {label} is the list type as prose.',
  },
  'cli.import.collectionNeedsPrinting': {
    description:
      'A collection line must name a printing, so an import whose lines do not is refused. {names} is a comma-separated sample of up to five card names; {more} is either empty or cli.import.andMore.',
  },
  'cli.import.andMore': {
    description:
      'The truncation suffix appended to a sample list of card names. Begins with a comma and a space, since it continues the preceding list.',
  },

  // ── `import` — source and flag validation ─────────────────────────────
  'cli.import.defaultedToDeck': {
    description:
      'Under --no-input the import cannot ask which kind of list to create, so it keeps the historical deck behaviour and says so.',
  },
  'cli.import.promptSyncPrintings': {
    description:
      'Yes/no prompt on a URL import: keep the exact printings (specific editions and foil/etched finishes) the deck site states, or import bare card names.',
  },
  'cli.import.defaultedToPrintings': {
    description:
      'Under --no-input the import cannot ask about keeping printings, so it keeps them (the historical behaviour) and says so. --no-sync-printings is a flag name.',
  },
  'cli.import.flagNotForUrl': {
    description: 'Usage error: {flag} is a CSV-only flag and the source is a URL.',
  },
  'cli.import.flagNeedsCsv': {
    description: 'Usage error: {flag} is a CSV-only flag and the source was not read as CSV.',
  },
  'cli.import.moxfieldAgentSourceOnly': {
    description:
      'Usage error: --moxfield-user-agent was given for a local file. Branch on the source kind that was resolved: "csv" or "text".',
  },
  'cli.import.syncPrintingsUrlOnly': {
    description:
      'Usage error: --sync-printings or --no-sync-printings was given for a local file, whose printings come from the file itself. Branch on the resolved source kind: "csv" or "text". The flag names stay as-is.',
  },
  'cli.import.invalidListType': {
    description:
      "Usage error for --type. {choices} is the comma-separated list of persisted slugs ('deck, collection, wanted') and is never translated.",
  },
  'cli.import.urlDeckOnly': {
    description:
      'Usage error: --type asked for a collection or wanted list, but the source is a deck URL. {label} is the list type as prose.',
  },
  'cli.import.fileNotFound': { description: 'The named import source does not exist on disk.' },
  'cli.import.readingFile': { description: 'Progress line before parsing a local text file.' },
  'cli.import.failed': {
    description: 'The catch-all import failure; {reason} is the underlying error text.',
  },

  // ── `import` — parse diagnostics ──────────────────────────────────────
  'cli.import.linesNotImported': {
    description:
      'Heading over the list of source lines the parser could not read. Content was lost, so the run also exits non-zero.',
  },
  'cli.import.advisory': {
    description:
      'Prefix for a line that WAS imported but whose shape suggests the file dialect was not fully understood. Nothing was lost.',
  },
  'cli.import.rowsFailed': {
    description: 'Heading over the list of CSV rows that failed validation.',
  },
  'cli.import.failureLine': {
    description:
      'One failed CSV row: its 1-based line number and its raw text. The reason prints on the following line, unlabelled.',
  },

  // ── `import` — CSV flow ───────────────────────────────────────────────
  'cli.import.overwriteAppendExclusive': {
    description: 'Usage error: --overwrite and --append ask for opposite things.',
  },
  'cli.import.csvUnreadable': { description: 'The CSV source could not be read from disk.' },
  'cli.import.csvParseFailed': {
    description: 'The CSV source is not parseable; {reason} is the parser detail.',
  },
  'cli.import.csvNoRows': { description: 'The CSV source parsed but held no rows at all.' },
  'cli.import.csvHeaderNoData': {
    description: 'The user answered that row one is a header, and the file has no other rows.',
  },
  'cli.import.csvNoDataRows': { description: 'Every row of the CSV was consumed by the header.' },
  'cli.import.noRowsImported': {
    description: 'Every CSV row failed validation, so nothing was written.',
  },
  'cli.import.nameEmpty': { description: 'Usage error: --name was given as an empty string.' },
  'cli.import.nameEmptyValidation': {
    description: 'Inline validation under the list-name prompt; shown while the field is empty.',
  },
  'cli.import.missingScriptedFlags': {
    description:
      'Usage error: prompts are unavailable, so every answer had to arrive as a flag. {flags} is a comma-separated list of the missing flag names.',
  },
  'cli.import.deckFormatDeckOnly': {
    description: 'Usage error: --deck-format was given for a collection or wanted list import.',
  },
  'cli.import.deckFormatNotAppend': {
    description:
      'Usage error: --deck-format was given alongside --append, which never creates a deck.',
  },
  'cli.import.promptListName': {
    description: 'Prompt for the target list name. {label} is the list type as prose.',
  },
  'cli.import.promptExisting': {
    description: 'Prompt heading when the CSV target already exists; the choices follow.',
  },
  'cli.import.choiceAppend': {
    description: 'Menu choice: add the imported cards to the existing list.',
  },
  'cli.import.choiceOverwrite': {
    description: 'Menu choice: replace the existing list with the import.',
  },
  'cli.import.promptDeckFormat': {
    description: 'Prompt for the deck format of a newly created deck. Ends with a colon.',
  },
  'cli.import.promptHasHeader': {
    description: 'Yes/no prompt opening the CSV column wizard.',
  },
  'cli.import.skippingHeader': {
    description:
      'The scripted CSV path never asks the header question, so it says which row it dropped. {row} is the raw line.',
  },
  'cli.import.headerLooksLikeData': {
    description:
      'Essential warning: a scripted import skipped a first row that does not look like a header, so a card was probably lost.',
  },
  'cli.import.repeatHint': {
    description:
      'Heading over the echoed non-interactive command equivalent to the wizard answers. The command itself is printed unchanged on the next line.',
  },
  'cli.import.columnNotPresent': {
    description: 'The first choice for an optional CSV field: this file has no such column.',
  },
  'cli.import.column': {
    description: 'A CSV column choice with no usable header text. {number} is 1-based.',
  },
  'cli.import.columnWithHeader': {
    description: 'A CSV column choice showing the header cell text. {number} is 1-based.',
  },
  'cli.import.columnSample': {
    description:
      'Appended to a column choice to show a sample cell value. Begins with a space and an em dash, since it continues the choice line.',
  },
  'cli.import.promptWhichColumn': {
    description:
      'Prompt asking which column holds a required card field. {field} is a CSV field label, English by contract.',
  },
  'cli.import.promptWhichColumnOptional': {
    description: 'cli.import.promptWhichColumn for a field the file may omit.',
  },
  'cli.import.dryRunOverwriteCsv': {
    description:
      'Dry-run preview of a CSV import that would replace an existing list. {listType} is a persisted slug.',
  },
  'cli.import.dryRunApplyCsv': {
    description:
      'Dry-run preview of a CSV import that creates or appends. Branch on the resolved import mode ("append", "create" or "overwrite"); {listType} is a persisted slug.',
  },
  'cli.import.appliedCsv': {
    description:
      'Confirmation after a CSV import. Branch on the resolved import mode ("append", "create" or "overwrite"); {listType} is a persisted slug.',
  },

  // ── `import-account` ──────────────────────────────────────────────────
  'cli.importAccount.noDecksSelf': {
    description: 'The logged-in account exposed no decks at all.',
  },
  'cli.importAccount.noDecksPublic': {
    description:
      'Archidekt answers an unknown username exactly like an account with no public decks, so the message names both possibilities rather than guessing.',
  },
  'cli.importAccount.selectionNeedsPrompt': {
    description:
      'Usage error raised before any network work: deck selection is a prompt and prompts are unavailable. {reason} explains why (no terminal, or --no-input).',
  },
  'cli.importAccount.needUsernameOrLogin': {
    description: 'Usage error: no username argument and no stored login to take one from.',
  },
  'cli.importAccount.fetchingOwn': {
    description: 'Progress line: fetching the stored account’s decks.',
  },
  'cli.importAccount.fetchingAuthenticated': {
    description:
      'Progress line: the named account is the logged-in one, so private decks are included.',
  },
  'cli.importAccount.fetchingPublic': {
    description: 'Progress line: fetching only the public decks of another account.',
  },
  'cli.importAccount.sessionExpiredFallback': {
    description: 'The stored session expired mid-run, so only public decks can be fetched.',
  },
  'cli.importAccount.sessionExpiredNoPrompt': {
    description:
      'The session expired and prompts are unavailable, so the user must log in separately.',
  },
  'cli.importAccount.sessionExpiredRelogin': {
    description: 'The session expired and a login prompt is about to open.',
  },
  'cli.importAccount.noToken': {
    description: 'The login flow finished without producing a usable access token.',
  },
  'cli.importAccount.foundDecks': {
    description:
      'Progress line reporting how many decks the account exposed. English does not inflect the noun here; a translation may replace this with a $plural table.',
  },
  'cli.importAccount.selectPrompt': { description: 'Heading of the multi-select deck picker.' },
  'cli.importAccount.deckFormatHint': {
    description:
      'Secondary line under a deck in the picker. {format} is the Archidekt format name, English by contract.',
  },
  'cli.importAccount.multiselectHint': {
    description:
      'Key hint under the deck picker. "Space" and "Return" are key names; use whatever those keys are called in the target language.',
  },
  'cli.importAccount.noneSelected': {
    description: 'The user submitted the picker with nothing ticked.',
  },
  'cli.importAccount.importingDecks': {
    description:
      'Progress line before the per-deck loop. English does not inflect the noun here; a translation may replace this with a $plural table.',
  },
  'cli.importAccount.processingDeck': {
    description: 'Per-deck progress line. {id} is the numeric Archidekt deck id.',
  },
  'cli.importAccount.skippedAtPrompt': {
    description:
      'Why one deck of a batch was skipped: its conflict prompt was cancelled. Also carried in the structured payload as that deck’s error text.',
  },
  'cli.importAccount.deckDone': {
    description:
      'Per-deck result line. The "planned" branch is the --dry-run wording, "saved" the wording for a deck actually written.',
  },
  'cli.importAccount.deckFailed': {
    description: 'Per-deck failure line; {reason} is the underlying error.',
  },
  'cli.importAccount.dryRunComplete': { description: 'Closing line of a --dry-run batch import.' },
  'cli.importAccount.done': { description: 'Closing line of a batch import that wrote files.' },

  // ── `import-changes` ──────────────────────────────────────────────────
  'cli.importChanges.unreadable': {
    description: 'The change-bundle file could not be read; {reason} is the filesystem error.',
  },
  'cli.importChanges.invalidBundle': {
    description: 'The file is not a valid change bundle; {reason} is the parser detail.',
  },
  'cli.importChanges.empty': { description: 'The bundle parsed but holds no changes.' },
  'cli.importChanges.confirmationRequired': {
    description:
      'Usage error: nothing can be asked (piped stdin or --no-input), so --yes is required.',
  },
  'cli.importChanges.confirmApply': {
    description:
      'The apply confirmation. {changes} and {lists} arrive already counted and pluralised (e.g. "3 changes", "2 lists").',
  },
  'cli.importChanges.listHeading': {
    description:
      'Identifies one target list in the preview. {type} is the list type as prose and {slug} is its persisted file slug, never translated. An icon is prefixed by the caller.',
  },
  'cli.importChanges.previewHeading': {
    description:
      'Preview heading for one list: {heading} is cli.importChanges.listHeading, {changes} an already-counted phrase.',
  },
  'cli.importChanges.movesHeading': {
    description:
      'Preview heading for the bundle’s cross-list moves (the copies that leave one list and land in another). {moves} is an already-counted phrase (e.g. "2 moves").',
  },
  'cli.importChanges.moveLine': {
    description:
      "One cross-list move in the preview. {change} is the rendered outgoing change (\"Move Sol Ring (C19:221) to Deck 'Burn'\"), which already names the destination; {from} is the pre-rendered English label of the source list (e.g. Collection 'Binder') — leave its shape alone.",
  },
  'cli.importChanges.replacementLine': {
    description:
      'Preview line under a move whose source list gets a printing back for the copy taken (the swap wizard’s "replace taken copies"). {change} is the rendered add ("Add Sol Ring (C21:263)"); {list} is the pre-rendered English label of the source list (e.g. Collection \'Binder\') — leave its shape alone.',
  },
  'cli.importChanges.listFailed': {
    description:
      'One list could not be written at all; {reason} is the failure text. A ✗ is prefixed by the caller.',
  },
  'cli.importChanges.listApplied': {
    description: 'One list’s applied count. A ✓ is prefixed by the caller.',
  },
  'cli.importChanges.listSkipped': {
    description:
      'The --quiet summary of skipped changes, which never gets suppressed. {reasons} is a comma-separated "reason: count" breakdown.',
  },
  'cli.importChanges.skippedChange': {
    description:
      'One skipped change and why. {change} is the rendered change description; a ⚠ is prefixed by the caller.',
  },

  // ── `detect-changes` — git detection ──────────────────────────────────
  'cli.detectChanges.missingFile': {
    description:
      'A file changed inside the commit range but is gone from the working tree, so it was skipped and the run is partial. Begins lowercase: it is rendered under a ⚠️ marker as a sentence fragment.',
  },
  'cli.detectChanges.wouldRename': {
    description:
      'Dry-run preview of moving a .changes.md changelog to follow its renamed list file.',
  },
  'cli.detectChanges.renamed': {
    description: 'A .changes.md changelog was moved to follow its list file.',
  },
  'cli.detectChanges.wouldDelete': {
    description: 'Dry-run preview of deleting the changelog of a deleted list file.',
  },
  'cli.detectChanges.deleted': { description: 'The changelog of a deleted list file was removed.' },
  'cli.detectChanges.upToDate': {
    description:
      'The file matches its .sha256 sidecar, so Ritual already recorded these changes. {label} is "kind/name", never translated.',
  },
  'cli.detectChanges.noCardChanges': {
    description:
      'The file changed but nothing about its cards did (front matter, prose, whitespace).',
  },
  'cli.detectChanges.changeCount': {
    description:
      'How many changelog entries a file is getting; the entries themselves are listed underneath. English does not inflect the noun here.',
  },
  'cli.detectChanges.gitProbeFailed': {
    description:
      'Prefix for a failure to even ask git whether this is a repository. git’s own detail follows on the next line.',
  },
  'cli.detectChanges.notGitRepo': {
    description:
      'Detection needs git history. The second line points at --hash-only, which works without git but forfeits changelog entries.',
  },
  'cli.detectChanges.resolveRefFailed': {
    description: 'Prefix for a failure to resolve the given commit; git’s own detail follows.',
  },
  'cli.detectChanges.unknownRef': {
    description: 'The given commit, tag, or branch does not exist in the repository at {path}.',
  },
  'cli.detectChanges.detectFailed': {
    description: 'Prefix for a failure while diffing; git’s own detail follows.',
  },
  'cli.detectChanges.applyFailed': {
    description: 'Writing the detected changelog entries failed; {reason} is the underlying error.',
  },
  'cli.detectChanges.comparing': {
    description: 'Opening progress line naming the commit being diffed against.',
  },
  'cli.detectChanges.dryRunNotice': {
    description: 'Follows the opening line under --dry-run. A blank line is added by the caller.',
  },
  'cli.detectChanges.noChanges': { description: 'The commit range touched no list files.' },
  'cli.detectChanges.dryRunComplete': { description: 'Closing line of a --dry-run detection.' },
  'cli.detectChanges.changelogsUpdated': {
    description: 'Closing line when changelog entries were written.',
  },
  'cli.detectChanges.noChangelogUpdates': {
    description: 'Closing line when list files changed but nothing needed a changelog entry.',
  },

  // ── `detect-changes` — sidecar modes ──────────────────────────────────
  'cli.detectChanges.noListFiles': {
    description:
      'Shared by --hash-only and --verify: there are no decks, collections, or wanted lists.',
  },
  'cli.detectChanges.stampWarning': {
    description:
      'Essential data-loss warning: stamping a diverged file declares its edits already recorded, so they will never get changelog entries. The affected files are listed underneath. Branch "dryRun" is the preview, "applied" the wording once files were stamped. Begins lowercase: rendered under a ⚠️ marker.',
  },
  'cli.detectChanges.stamped': {
    description:
      'Closing tally of --hash-only. Branch "dryRun" is the preview, "applied" the wording once files were stamped.',
  },
  'cli.detectChanges.verifySummary': {
    description:
      'Closing tally of --verify. {files} arrives already counted; the three numbers are the per-state counts.',
  },
  'cli.detectChanges.verifyAdvice': {
    description: 'Printed after --verify found drift: the two commands that resolve it.',
  },

  // ── `detect-changes` — mode selection ─────────────────────────────────
  'cli.detectChanges.modesExclusive': {
    description: 'Usage error: the two sidecar modes are mutually exclusive.',
  },
  'cli.detectChanges.verifyNoDryRun': {
    description:
      'Usage error: --verify writes nothing, so there is nothing for --dry-run to preview.',
  },
  'cli.detectChanges.missingCommit': {
    description:
      'Usage error: git detection needs a commit, and neither sidecar mode was requested.',
  },
  'cli.detectChanges.commitNotUsed': {
    description: 'Usage error: a commit was given alongside a sidecar mode, which never reads git.',
  },

  // ── Shared sync surface ───────────────────────────────────────────────
  'cli.sync.syncing': {
    description:
      'Header line opening one deck or collection list. {direction} is the persisted slug "push" or "pull", never translated. Subsequent lines for the same item are indented under it.',
  },
  'cli.sync.notSignedIn': {
    description:
      'Both sync commands refuse an unauthenticated run with this line. The quoted command is typed verbatim and is never translated.',
  },
  'cli.sync.accountUnnamed': {
    description:
      'A collection sync needs the numeric account id the login records, and this stored login has none — so it asks for a fresh sign-in rather than guessing.',
  },
  'cli.sync.costRemoveLines': {
    description:
      'What accepting a sync of files with unreadable lines costs, as a gerund clause completing "Sync 2 decks anyway, …?" — a sync rewrites the file, so the lines go.',
  },
  'cli.sync.costRemoveFromArchidekt': {
    description:
      'cli.sync.costRemoveLines for a collection push, where the loss lands on the remote side instead.',
  },

  // ── `deck-sync` ───────────────────────────────────────────────────────
  'cli.deckSync.syncedDecks': {
    description:
      'Opening clause of the closing tally. {decks} arrives already counted; {changed} counts the subset that actually differed, since a deck already in sync still counts as synced. Branch "dryRun" is the preview, "applied" the wording for a real run.',
  },
  'cli.deckSync.skipped': { description: 'Tally clause for decks the run did not attempt.' },
  'cli.deckSync.failed': {
    description: 'Tally clause for decks that failed. Joined to the others with commas.',
  },
  'cli.deckSync.decksFailed': {
    description: 'Stderr line reporting how many of the run’s decks failed.',
  },
  'cli.deckSync.linked': {
    description:
      '`deck-sync link` result. {id} is the numeric Archidekt deck id. Branch "dryRun" is the preview, "applied" the wording for a real run.',
  },
  'cli.deckSync.previouslyLinked': {
    description:
      'Follows cli.deckSync.linked when the deck was already linked elsewhere. {target} is a URL, or cli.deckSync.deckRef when only an id was recorded.',
  },
  'cli.deckSync.deckRef': {
    description: 'Names a deck by its numeric Archidekt id when no URL was recorded for it.',
  },
  'cli.deckSync.noLinkedDecks': { description: '`deck-sync status` with nothing linked yet.' },
  'cli.deckSync.linkedHeading': {
    description: 'Heading over the `deck-sync status` deck list. {decks} arrives already counted.',
  },
  'cli.deckSync.lastSynced': {
    description:
      'Per-deck detail line in `deck-sync status`. {when} is an ISO timestamp or cli.deckSync.never.',
  },
  'cli.deckSync.never': { description: 'Stands in for a timestamp when a deck has never synced.' },
  'cli.deckSync.collectionSynced': {
    description: 'The collection half of `deck-sync status`. {when} is an ISO timestamp.',
  },
  'cli.deckSync.collectionUnreadable': {
    description:
      'The recorded collection sync state exists but could not be read — deliberately not phrased as "never synced", which would be a claim the run cannot make.',
  },
  'cli.deckSync.collectionNever': {
    description: 'The collection half of `deck-sync status` when no sync has ever been recorded.',
  },

  // ── `collection-sync` ─────────────────────────────────────────────────
  'cli.collectionSync.intoRequiresName': {
    description: 'Usage error: --into was given as an empty string.',
  },
  'cli.collectionSync.removalPriorityRequiresName': {
    description: 'Usage error: --removal-priority was given as an empty string.',
  },
  'cli.collectionSync.csvFileRequiresPath': {
    description: 'Usage error: --csv-file was given as an empty string.',
  },
  'cli.collectionSync.csvFlagsExclusive': {
    description: 'Usage error: the two CSV flags ask for opposite things.',
  },
  'cli.collectionSync.ignoringInto': {
    description: 'Warning: a pull-only flag was given on a push.',
  },
  'cli.collectionSync.ignoringRemovalPriority': {
    description: 'Warning: a pull-only flag was given on a push.',
  },
  'cli.collectionSync.ignoringCsv': {
    description: 'Warning: a push-only flag was given on a pull.',
  },
  'cli.collectionSync.ignoringCsvFile': {
    description: 'Warning: a push-only flag was given on a pull.',
  },
  'cli.collectionSync.tally': {
    description:
      'The counts inside the closing line: copies added and removed. {waiting} is either empty or cli.collectionSync.awaitingUpload. The + and - signs mark direction and should be kept.',
  },
  'cli.collectionSync.awaitingUpload': {
    description:
      'Extra tally clause for copies written to a CSV file rather than pushed. Begins with a comma and a space, since it continues the tally.',
  },
  'cli.collectionSync.intoClause': {
    description:
      'Names the list a pull added to. Begins with a space, since it continues the closing line.',
  },
  'cli.collectionSync.notSynced': {
    description:
      'Closing line when the run failed at the run level and wrote nothing. {change} is cli.collectionSync.tally, {where} is empty or cli.collectionSync.intoClause.',
  },
  'cli.collectionSync.wouldSync': { description: 'Closing line of a --dry-run collection sync.' },
  'cli.collectionSync.synced': {
    description: 'Closing line of a collection sync that wrote changes.',
  },
  'cli.collectionSync.csvExported': {
    description:
      'The additions went to a CSV file instead of Archidekt, and only a manual upload will change that. {cards} arrives already counted (from domain.count.cards) while {count} selects the form, because both the verb ("was"/"were") and the pronoun ("it"/"them") agree with it; {url} is the Archidekt import page.',
  },
  'cli.collectionSync.csvPlanned': {
    description: 'The --dry-run preview of cli.collectionSync.csvExported.',
  },
  'cli.collectionSync.listsFailed': {
    description: 'Stderr line reporting how many of the run’s collection lists failed.',
  },

  // ── `export` (flag mode) ──────────────────────────────────────────────
  'cli.export.formatFlagConflict': {
    description:
      'Usage error: column and CSV-shape flags were combined with a fixed-line format. {flags} is an "and"-joined list of flag names; {format} is an export format slug.',
  },
  'cli.export.unknownPreset': {
    description:
      '--preset named something neither saved nor built in. {available} is a comma-separated list.',
  },
  'cli.export.savedPreset': {
    description: 'Confirmation for --save-preset. A ✓ is prefixed by the caller.',
  },
  'cli.export.exportedToFile': {
    description:
      'Confirmation that an export was written to a file. {cards} arrives already counted. A ✓ is prefixed by the caller.',
  },
  'cli.export.exportedToStdout': {
    description:
      'Confirmation that an export went to stdout. Printed to stderr so the payload stays parseable, and therefore names no destination.',
  },
  'cli.export.wizardNeedsTerminal': {
    description:
      'Usage error: a bare `ritual export` wants the wizard, which needs a terminal. The examples name flags and are not translated.',
  },

  // ── `export` wizard — header and menu ─────────────────────────────────
  'cli.exportWizard.menuTitle': { description: 'Heading of the export wizard main menu.' },
  'cli.exportWizard.nothingSelected': {
    description: 'Stands in for the sources summary while nothing has been added yet.',
  },
  'cli.exportWizard.sourcesLine': {
    description:
      'First header line: what has been selected and how many cards that comes to. {sources} is a " + "-joined summary; an icon is prefixed by the caller.',
  },
  'cli.exportWizard.filtersLine': {
    description:
      'Second header line. {filters} is a " · "-joined summary or cli.exportWizard.filtersNone.',
  },
  'cli.exportWizard.formatLine': {
    description:
      'Third header line. {format} is an uppercased export format slug, never translated.',
  },
  'cli.exportWizard.columnsSegment': {
    description:
      'Appended to the format header line when the format uses columns. Begins with a separator, since it continues the line. {columns} is a comma-separated list of column labels, English by contract.',
  },
  'cli.exportWizard.dialectValues': {
    description:
      'Names the non-default value dialect an export is using — shown in the wizard header and in a preset summary row. {dialect} is a dialect name, English by contract.',
  },
  'cli.exportWizard.csvLine': {
    description:
      'Fourth header line, CSV only. {header} is cli.exportWizard.on or .off; {quoting} is .quoteAllCells or .minimalQuoting.',
  },
  'cli.exportWizard.menuAddLists': {
    description: 'Menu row: pick whole lists. An icon is prefixed by the caller.',
  },
  'cli.exportWizard.menuAddCards': {
    description: 'Menu row: pick individual cards. An icon is prefixed.',
  },
  'cli.exportWizard.menuFilters': {
    description: 'Menu row showing the active filters. An icon is prefixed.',
  },
  'cli.exportWizard.menuLoadPreset': {
    description:
      'Menu row: load a saved or built-in preset. Hidden when none exist. An icon is prefixed.',
  },
  'cli.exportWizard.menuFormat': {
    description:
      'Menu row showing the current format. {format} is an uppercased slug. An icon is prefixed.',
  },
  'cli.exportWizard.menuColumns': {
    description: 'Menu row: choose columns and their order. An icon is prefixed.',
  },
  'cli.exportWizard.menuCsvOptions': {
    description:
      'Menu row summarising the CSV options. {header} is cli.exportWizard.on or .off; {quoting} is .quoteAll or .minimalQuoting. An icon is prefixed.',
  },
  'cli.exportWizard.menuSavePreset': {
    description: 'Menu row: save the current settings. An icon is prefixed.',
  },
  'cli.exportWizard.menuReview': {
    description:
      'Menu row: list the assembled cards. {cards} arrives already counted. An icon is prefixed.',
  },
  'cli.exportWizard.menuExport': {
    description: 'Menu row: write the file. {cards} arrives already counted. An icon is prefixed.',
  },
  'cli.exportWizard.menuExit': { description: 'Menu row: leave the wizard. An icon is prefixed.' },
  'cli.exportWizard.confirmExit': {
    description: 'Yes/no guard shown when leaving the wizard with cards still selected.',
  },

  // ── `export` wizard — shared vocabulary ───────────────────────────────
  'cli.exportWizard.done': {
    description: 'The "finish this sub-menu" row. The ✔ marks it apart from the options.',
  },
  'cli.exportWizard.back': {
    description: 'The "return to the previous menu" row. The ← marks it apart.',
  },
  'cli.exportWizard.on': {
    description: 'A toggle that is enabled, shown inline in a summary line.',
  },
  'cli.exportWizard.off': {
    description: 'A toggle that is disabled, shown inline in a summary line.',
  },
  'cli.exportWizard.quoteAllCells': { description: 'CSV quoting summary: every cell is quoted.' },
  'cli.exportWizard.minimalQuoting': {
    description: 'CSV quoting summary: only cells that need it are quoted.',
  },
  'cli.exportWizard.quoteAll': {
    description: 'The shorter "every cell is quoted" wording, used where the row is already long.',
  },
  'cli.exportWizard.alwaysQuote': {
    description: 'The CSV quoting menu row’s value for "quote every cell".',
  },
  'cli.exportWizard.minimal': {
    description: 'The CSV quoting menu row’s value for "quote only what needs it".',
  },
  'cli.exportWizard.any': {
    description: 'Filter choice: do not filter on this field. Sentence case (a menu row).',
  },
  'cli.exportWizard.anyValue': {
    description:
      'Filter value shown inline in a menu row when nothing is filtered. Lowercase (mid-line).',
  },
  'cli.exportWizard.anyClearFilter': {
    description: 'Toggle-filter choice that clears every selection.',
  },
  'cli.exportWizard.currentSuffix': {
    description:
      'Marks the choice matching the current setting. Begins with a space, since it is appended to a choice.',
  },

  // ── `export` wizard — sources ─────────────────────────────────────────
  'cli.exportWizard.allListsSelected': {
    description: 'Every list has already been added, so there is nothing to pick.',
  },
  'cli.exportWizard.allCardsPicked': {
    description: 'Every card has already been picked individually.',
  },
  'cli.exportWizard.promptAddList': {
    description: 'Heading of the list picker, carrying the running count.',
  },
  'cli.exportWizard.promptAddCard': {
    description:
      'Heading of the card picker; the trailing clause explains that typing searches every list.',
  },

  // ── `export` wizard — filters ─────────────────────────────────────────
  'cli.exportWizard.filtersNone': {
    description: 'Stands in for the filter summary when nothing is filtered. Lowercase (mid-line).',
  },
  'cli.exportWizard.filterName': { description: 'Filter summary segment for a name filter.' },
  'cli.exportWizard.filterSet': {
    description:
      'Filter summary segment for a set filter. {value} is an uppercased set code, never translated.',
  },
  'cli.exportWizard.filterLabels': {
    description:
      'Filter summary segment for a label filter. {value} is a "/"-joined list of label slugs.',
  },
  'cli.exportWizard.promptFilters': { description: 'Heading of the filter sub-menu.' },
  'cli.exportWizard.filterRowName': { description: 'Filter menu row for the card-name filter.' },
  'cli.exportWizard.filterRowSet': { description: 'Filter menu row for the set-code filter.' },
  'cli.exportWizard.filterRowFinish': { description: 'Filter menu row for the finish filter.' },
  'cli.exportWizard.filterRowCondition': {
    description: 'Filter menu row for the condition filter.',
  },
  'cli.exportWizard.filterRowLabels': { description: 'Filter menu row for the label filter.' },
  'cli.exportWizard.promptNameTerms': { description: 'Text prompt for the card-name filter.' },
  'cli.exportWizard.promptSetCode': { description: 'Text prompt for the set-code filter.' },
  'cli.exportWizard.promptFinish': { description: 'Heading of the finish filter picker.' },
  'cli.exportWizard.promptCondition': {
    description: 'Heading of the condition filter picker, which toggles any combination of grades.',
  },
  'cli.exportWizard.noConditionMarked': {
    description: 'Condition filter choice matching cards whose line records no condition.',
  },
  'cli.exportWizard.promptLabels': { description: 'Heading of the label filter picker.' },
  'cli.exportWizard.noLabels': {
    description: 'Label filter choice matching cards carrying no label at all.',
  },

  // ── `export` wizard — output shape ────────────────────────────────────
  'cli.exportWizard.promptFormat': { description: 'Heading of the export format picker.' },
  'cli.exportWizard.promptCsvOptions': { description: 'Heading of the CSV options sub-menu.' },
  'cli.exportWizard.csvHeaderRow': {
    description: 'CSV options row for the header toggle. {value} is cli.exportWizard.on or .off.',
  },
  'cli.exportWizard.csvQuoting': {
    description:
      'CSV options row for the quoting toggle. {value} is cli.exportWizard.alwaysQuote or .minimal.',
  },
  'cli.exportWizard.pickColumns': {
    description:
      'Heading of the column picker before anything has been picked; each pick appends to the order.',
  },
  'cli.exportWizard.keepCurrent': {
    description:
      'Column picker choice: leave the columns as they are. {columns} is an arrow-joined list of column labels, English by contract.',
  },
  'cli.exportWizard.resetDefault': {
    description: 'Column picker choice: go back to the default column set.',
  },
  'cli.exportWizard.orderSoFar': {
    description:
      'Heading of the column picker once picking has begun, showing the order built up so far.',
  },

  // ── `export` wizard — presets, review, write ──────────────────────────
  'cli.exportWizard.promptLoadPreset': { description: 'Heading of the preset picker.' },
  'cli.exportWizard.presetNoHeader': {
    description: 'Preset summary segment: this preset omits the CSV header row.',
  },
  'cli.exportWizard.loadedPreset': {
    description: 'Confirmation after loading a preset. A ✓ is prefixed by the caller.',
  },
  'cli.exportWizard.promptPresetName': {
    description: 'Text prompt for the name to save a preset under.',
  },
  'cli.exportWizard.enterName': {
    description: 'Inline validation under the preset name prompt while it is empty.',
  },
  'cli.exportWizard.presetExists': { description: 'Yes/no guard before replacing a saved preset.' },
  'cli.exportWizard.savedPreset': {
    description: 'Confirmation after saving a preset. A ✓ is prefixed by the caller.',
  },
  'cli.exportWizard.reviewEmpty': { description: 'The review screen with nothing selected yet.' },
  'cli.exportWizard.exportEmpty': { description: 'The export action with nothing selected yet.' },
  'cli.exportWizard.promptOutputFile': {
    description:
      'Text prompt for the export destination path; it is pre-filled with a default file name.',
  },
} as const satisfies MetaFor<typeof cliSyncMessages>
