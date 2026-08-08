/**
 * `cli.*` — everything the terminal prints or prompts for, except Commander's
 * registered help text (that is `help.*`, resolved earlier in the boot
 * sequence). Never imported by `src/site/**` or `src/admin/site/**`; the
 * namespace boundary is what keeps the CLI's message inventory out of the SPA
 * bundles.
 */

import type { MessageCatalogShape } from '../../types'

export const cliMessages = {
  // ── Refused prompts (`--no-input`) ────────────────────────────────────
  //
  // `cli.prompt.subject.*` are short **noun phrases**, never questions: they are
  // interpolated into the declarative frame `errors.input.required`
  // ("Input required: {subject} ({reason}).") and a question spliced into that
  // frame is ungrammatical in most languages. A prompt names its subject with a
  // `subjectKey`; the prompt's own question text is never reused here.
  'cli.prompt.reason.noInput': 'prompts are disabled by --no-input / RITUAL_NO_INPUT',
  'cli.prompt.reason.noTty': 'no terminal available for prompts',
  'cli.prompt.subject.pass': 'pass {what}',
  'cli.prompt.subject.interactiveInput': 'interactive input',
  'cli.prompt.subject.listType': 'the kind of list to import into',
  'cli.prompt.subject.filterValue': 'a filter value',
  'cli.prompt.subject.exitChoice': 'a choice of what to do with the unsaved changes',

  // ── `prompts` library strings Ritual overrides ────────────────────────
  //
  // The library ships its own English for these and takes an override per
  // prompt; `ask()` supplies them so every prompt in the CLI speaks one
  // language. Its hardcoded multiselect "Instructions:" block has no override
  // and stays English — a documented gap, and there is exactly one multiselect.
  'cli.prompt.noMatches': 'no matches found',
  'cli.prompt.toggleOn': 'on',
  'cli.prompt.toggleOff': 'off',

  // ── Card summaries ────────────────────────────────────────────────────
  'cli.card.summary': '{name} ({set})',

  'cli.menu.saveAndExit': 'Save and exit',
  'cli.menu.exitWithoutSaving': 'Exit without saving',
  'cli.menu.cancelKeepEditing': 'Cancel (keep editing)',
  'cli.menu.exit': 'Exit',
  'cli.menu.back': 'Back',
  'cli.menu.cancel': 'Cancel',
  'cli.menu.switchList': 'Switch List',
  'cli.menu.addExactCopy': 'Add Exact Copy ({name})',
  'cli.menu.addSimilarCopy': 'Add Similar Copy ({name}, choose new options)',
  'cli.menu.addNote': 'Add Note ({name})',
  'cli.menu.editPrevious': 'Edit Previous Card ({name})',
  'cli.menu.undoLastAdd': 'Undo Last Add ({name})',
  'cli.menu.undoLastEdit': 'Undo Last Edit ({label})',
  'cli.menu.configureFilters': 'Configure Session Filters',
  'cli.menu.collectorMode': 'Switch to Collector Number Mode',
  'cli.menu.nameMode': 'Switch to Name Mode',
  'cli.menu.manageSets': 'Manage Set Codes (Active: {set})',
  'cli.menu.editMode': 'Switch to Edit Mode (edit existing cards)',
  'cli.menu.addMode': 'Switch to Add Mode',
  'cli.menu.viewChanges': 'View Session Changes ({count})',
  'cli.menu.save': {
    $plural: 'count',
    one: 'Save {count} change (keep editing)',
    other: 'Save {count} changes (keep editing)',
  },
  'cli.menu.saveDirty': 'Save changes (keep editing)',
  'cli.menu.saveAll': 'Save all changes ({scope})',
  'cli.menu.saveAllScope': '{count} across {lists}',
  'cli.menu.saveCurrent': 'Save current list changes ({count})',
  'cli.menu.saveCurrentPlain': 'Save current list changes',
  'cli.menu.addSetCode': 'Add Set Code',
  'cli.menu.removeSetCode': 'Remove Set Code',
  'cli.menu.setCodeActive': '{code} (active)',
  'cli.menu.noSetCode': 'none',

  // ── The interactive card session ──────────────────────────────────────
  //
  // Shared by the deck, collection, wanted, and unified `edit` sessions through
  // `CardSessionStrategy`, so this is the deepest interactive surface in the
  // CLI and one edit covers all four.
  'cli.session.loadingCards': 'Loading card database for autocomplete...',
  'cli.session.reloadingCards': 'Reloading card database with new filters...',
  'cli.session.loadedCards': 'Loaded {count} cards.',
  'cli.session.cacheEmpty': 'Card cache is empty.',
  'cli.session.createdFile': 'Created new {label} file: {file}',
  'cli.session.usingFile': 'Using {label} file: {file}',
  'cli.session.loadingSetData': 'Loading set data...',
  'cli.session.loadingSet': 'Loading {set}...',
  'cli.session.setCardsLoaded': '  {count} cards loaded',
  'cli.session.filtersUpdated': 'Session filters updated.',
  'cli.session.changesSaved': 'Changes saved.',
  'cli.session.changelogSaved': 'Changelog saved.',
  'cli.session.discardedAll': 'Discarded all unsaved changes.',
  'cli.session.exitingEditor': 'Exiting editor.',
  'cli.session.exitingManager': 'Exiting {manager}.',
  'cli.session.returningToLists': 'Returning to list selection.',
  'cli.session.cardNotFound': '❌ Card not found.',
  'cli.session.setFiltersActive':
    '(Note: Set filters are active: {sets}. The card might exist in a different set.)',
  'cli.session.addingSimilar': 'Adding a similar copy of {name}:',
  'cli.session.noteAdded': 'Note added to {name}: {note}',
  'cli.session.switchedToEdit':
    'Switched to edit mode. Pick an existing card to change or remove it.',
  'cli.session.switchedToAdd': 'Switched to add mode.',
  'cli.session.switchedToCollector': 'Switched to collector number mode. Active set: {set}',
  'cli.session.switchedToName': 'Switched to name mode.',
  'cli.session.editingCard': 'Editing: {name}',
  'cli.session.activeSetChanged': 'Active set changed to: {set}',
  'cli.session.setAlreadyAdded': 'Set {set} already added.',
  'cli.session.noSetsToRemove': 'No sets to remove.',
  'cli.session.setRemoved': 'Removed {set}',
  'cli.session.noChanges': 'No changes this session.',
  'cli.session.discardBlocked': 'Cannot discard this change yet — {reason}.',
  'cli.session.forceOptions': '{title} (Force Options)',
  'cli.session.streakHint': ' ({count}x {name})',

  // ── The interactive card session's prompts ────────────────────────────
  'cli.session.promptSearchToEdit': 'Search for a card to edit',
  'cli.session.promptCardName': 'Enter card name to add{streak}',
  'cli.session.promptCollectorNumber': 'Enter collector # for {set}{streak}',
  'cli.session.promptSetPlaceholder': 'SET',
  'cli.session.promptNote': 'Enter note:',
  'cli.session.promptNoteEdit': 'Note (empty clears it):',
  'cli.session.promptEditEntry': 'Edit {entry}:',
  'cli.session.promptManageSets': 'Manage Set Codes:',
  'cli.session.promptAddSetCode': 'Enter set code to add:',
  'cli.session.promptSelectSetToRemove': 'Select set to remove:',
  'cli.session.promptCollectorSets': 'Enter set codes to use (comma-separated, e.g., "FDN, SPG"):',
  'cli.session.promptSetFilter': 'Filter by Set Codes (comma separated, e.g. "ECL, ECC"):',
  'cli.session.promptDefaultFinish': 'Default Finish:',
  'cli.session.promptDefaultCondition': 'Default Condition:',
  'cli.session.promptDiscardChange': 'Discard {label}?',
  'cli.session.promptPickChangeToDiscard': {
    $plural: 'count',
    one: '{count} change this session — select one to discard it:',
    other: '{count} changes this session — select one to discard it:',
  },
  'cli.session.validateSetCodeEmpty': 'Set code cannot be empty',
  'cli.session.validateSetCodeRequired': 'At least one set code required',
  'cli.session.finishAlwaysPrompt': 'None (Always Prompt)',
  'cli.session.finishNonfoil': 'Nonfoil',
  'cli.session.finishFoil': 'Foil',
  'cli.session.finishEtched': 'Etched',
  'cli.session.conditionAlwaysPrompt': 'None (Always Prompt)',
  'cli.session.conditionDontCare': "Don't Care",

  // ── The shared unsaved-changes exit menu ──────────────────────────────
  'cli.exitMenu.promptCounted': {
    $plural: 'count',
    one: 'You have {count} unsaved change:',
    other: 'You have {count} unsaved changes:',
  },
  'cli.exitMenu.prompt': 'You have unsaved changes:',

  // ── Import prompts ────────────────────────────────────────────────────
  'cli.import.promptListType': 'What kind of list is this?',

  // ── Sentences whose *verb* or *pronoun* agrees with a count ───────────
  //
  // A bare `domain.count.*` fragment is not enough for these: English inflects
  // the verb ("1 file was" / "2 files were") or swaps a pronoun ("add it" /
  // "add them"), and a language with more plural categories inflects more. The
  // whole sentence is therefore one message.
  'cli.addCard.matchCount': {
    $plural: 'count',
    one: '{shown} card matches that name.',
    other: '{shown} cards match that name.',
  },
  'cli.cleanup.unreadableFiles': {
    $plural: 'count',
    one: '{count} file could not be read and was skipped (see the warnings above).',
    other: '{count} files could not be read and were skipped (see the warnings above).',
  },
  'cli.cleanup.decksNeedFormat': {
    $plural: 'count',
    one: '{count} deck still needs a format (run interactively to choose, or pass --skip-formats to leave as-is).',
    other:
      '{count} decks still need a format (run interactively to choose, or pass --skip-formats to leave as-is).',
  },
  'cli.resolveAmbiguity.needsDecision': {
    $plural: 'count',
    one: '{count} ambiguous removal needs a decision. {advice}',
    other: '{count} ambiguous removals need a decision. {advice}',
  },
  'cli.resolveAmbiguity.confirm': {
    $plural: 'count',
    one: '{count} removal is ambiguous. Resolve them one by one now?',
    other: '{count} removals are ambiguous. Resolve them one by one now?',
  },
  'cli.move.movedFewer': {
    $plural: 'count',
    one: 'Moved only {moved} of {count} requested copy.',
    other: 'Moved only {moved} of {count} requested copies.',
  },
  'cli.move.notEnoughCopies': {
    $plural: 'count',
    one: "Only {count} copy of '{name}' in {list} (requested {requested}).",
    other: "Only {count} copies of '{name}' in {list} (requested {requested}).",
  },
  'cli.scry.pageRange': {
    $plural: 'count',
    one: 'page 1',
    other: 'pages 1-{count}',
  },
  'cli.serve.buildFlagsIgnored': {
    $plural: 'count',
    one: '{flags} only applies when building; add --build to build the site before serving.',
    other: '{flags} only apply when building; add --build to build the site before serving.',
  },
  'cli.serve.uniqueCards': {
    $plural: 'count',
    one: '{count} unique card',
    other: '{count} unique cards',
  },

  // ── Skill install/update summary ──────────────────────────────────────
  //
  // {counted} arrives pre-rendered from `domain.count.skills` or
  // `domain.count.agentSkills` — the caller chooses which noun it is talking
  // about, so the count and its noun still agree.
  'cli.skills.written': {
    $select: 'verb',
    installedTo: '✓ Installed {counted} to {dir}',
    installedIn: '✓ Installed {counted} in {dir}',
    updatedIn: '✓ Updated {counted} in {dir}',
  },
  'cli.skills.upToDate': '• {counted} already up to date',
  'cli.skills.skipped': '⊘ {counted} with local edits left untouched ({forceHint})',
  'cli.skills.absent': {
    $plural: 'count',
    one: '• {counted} not installed; use `ritual skills install` to add it',
    other: '• {counted} not installed; use `ritual skills install` to add them',
  },

  // ── Unreadable-line gate, shared by deck sync and collection sync ─────
  //
  // Two subjects, three sentences each, rather than one sentence with the noun
  // spliced in: the verb agrees with the count *and* the noun is grammatically
  // gendered in most target languages, which a `{subject}` parameter cannot
  // express. `UNREADABLE_MESSAGES` in `src/commands/sync-helpers.ts` picks the
  // set.
  'cli.sync.unreadableDecks': {
    $plural: 'count',
    one: '{count} deck contains lines Ritual cannot read.',
    other: '{count} decks contain lines Ritual cannot read.',
  },
  'cli.sync.unreadableCollectionLists': {
    $plural: 'count',
    one: '{count} collection list contains lines Ritual cannot read.',
    other: '{count} collection lists contain lines Ritual cannot read.',
  },
  'cli.sync.confirmDecks': {
    $plural: 'count',
    one: 'Sync {count} deck anyway, {cost}?',
    other: 'Sync {count} decks anyway, {cost}?',
  },
  'cli.sync.confirmCollectionLists': {
    $plural: 'count',
    one: 'Sync {count} collection list anyway, {cost}?',
    other: 'Sync {count} collection lists anyway, {cost}?',
  },
  'cli.sync.refuseDecks':
    'Confirmation required: pass --yes to sync these decks non-interactively ({cost}), or fix the lines first.',
  'cli.sync.refuseCollectionLists':
    'Confirmation required: pass --yes to sync these collection lists non-interactively ({cost}), or fix the lines first.',
} as const satisfies MessageCatalogShape
