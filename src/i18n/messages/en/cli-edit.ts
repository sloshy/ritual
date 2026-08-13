/**
 * `cli.*` messages for the interactive editors — the unified `edit` session, list lifecycle, history, and cleanup.
 *
 * A fragment of the cli namespace, split out purely so the command surfaces can
 * be converted independently without contending for one file. Every key still
 * begins with `cli.`, and a translator sees one flat catalog.
 *
 * Two conventions run through this fragment:
 *
 * - **Icons and markers stay in the code.** `🗑️`, `➕`, `← `, `+ ` and the
 *   indentation of printed blocks are layout, not wording, so they are neither
 *   translatable nor counted against a `maxLen` budget.
 * - **A list type is a `$select`, never a spliced noun.** `deck` /
 *   `collection` / `wanted list` are gendered in most target languages, so a
 *   sentence naming one is written out per type rather than interpolating the
 *   noun into a shared frame (the same reasoning as
 *   `errors.resolveList.noListsOfType`).
 */

import type { MessageCatalogShape } from '../../types'

export const cliEditMessages = {
  // ── Session manager names ─────────────────────────────────────────────
  //
  // Spliced into `cli.session.exitingManager` ("Exiting {manager}.") by the
  // shared card-session engine, one per strategy.
  'cli.manager.deck': 'deck manager',
  'cli.manager.collection': 'collection manager',
  'cli.manager.wanted': 'wanted list manager',
  'cli.manager.editor': 'editor',

  // ── Row decorations shared by every picker ────────────────────────────
  'cli.edit.current': '{label} (current)',
  'cli.edit.new': '{label} (new)',

  // ── The bare list-type noun ───────────────────────────────────────────
  //
  // Spliced into `cli.session.createdFile` / `cli.session.usingFile` by
  // `ensureListFile`, which is why this is a bare noun rather than a sentence.
  'cli.edit.listNoun': {
    $select: 'type',
    deck: 'deck',
    collection: 'collection',
    wanted: 'wanted list',
  },

  // ── The unified `edit` command ────────────────────────────────────────
  'cli.edit.promptSelectList': 'Select a list to edit',
  'cli.edit.promptNewListName': {
    $select: 'type',
    deck: 'Enter name for new deck:',
    collection: 'Enter name for new collection:',
    wanted: 'Enter name for new wanted list:',
  },
  'cli.edit.nameEmpty': 'Name cannot be empty',
  'cli.edit.badgeNew': 'new',
  'cli.edit.badgeUnsaved': '{count} unsaved change(s)',
  'cli.edit.listFileExists': {
    $select: 'type',
    deck: 'A deck already exists at {file}.',
    collection: 'A collection already exists at {file}.',
    wanted: 'A wanted list already exists at {file}.',
  },
  'cli.edit.pendingCollision': {
    $select: 'type',
    deck: "A deck named '{name}' is already open in this session (it matches '{query}' under list-name folding).",
    collection:
      "A collection named '{name}' is already open in this session (it matches '{query}' under list-name folding).",
    wanted:
      "A wanted list named '{name}' is already open in this session (it matches '{query}' under list-name folding).",
  },
  'cli.edit.createdList': {
    $select: 'type',
    deck: 'Created deck "{name}" (saved when you save the editor).',
    collection: 'Created collection "{name}" (saved when you save the editor).',
    wanted: 'Created wanted list "{name}" (saved when you save the editor).',
  },
  'cli.edit.creatingList': {
    $select: 'type',
    deck: 'Creating deck "{name}"...',
    collection: 'Creating collection "{name}"...',
    wanted: 'Creating wanted list "{name}"...',
  },
  'cli.edit.savingList': {
    $select: 'type',
    deck: 'Saving deck "{name}"...',
    collection: 'Saving collection "{name}"...',
    wanted: 'Saving wanted list "{name}"...',
  },
  'cli.edit.openingLists': {
    $plural: 'count',
    one: 'Opening {count} list...',
    other: 'Opening {count} lists...',
  },
  'cli.edit.noInteractiveEditor':
    'the interactive editor is unavailable — use the one-shot commands (add-card, remove-card, set-card, note, move) to edit lists from scripts',
  'cli.edit.creationChange': {
    $select: 'type',
    deck: 'Created this deck',
    collection: 'Created this collection',
    wanted: 'Created this wanted list',
  },
  'cli.edit.discardCardChangesFirst': {
    $select: 'type',
    deck: "discard this deck's {count} card change(s) first",
    collection: "discard this collection's {count} card change(s) first",
    wanted: "discard this wanted list's {count} card change(s) first",
  },
  'cli.edit.discardInboundMovesFirst': {
    $select: 'type',
    deck: 'discard the {count} pending move(s) into this deck first',
    collection: 'discard the {count} pending move(s) into this collection first',
    wanted: 'discard the {count} pending move(s) into this wanted list first',
  },
  'cli.edit.discardedList': {
    $select: 'type',
    deck: 'Discarded deck "{name}".',
    collection: 'Discarded collection "{name}".',
    wanted: 'Discarded wanted list "{name}".',
  },

  // ── The multi-list scopes ─────────────────────────────────────────────
  'cli.scope.allLists': 'All Lists',
  'cli.scope.allOfType': {
    $select: 'type',
    deck: 'All Decks',
    collection: 'All Collections',
    wanted: 'All Wanted Lists',
  },
  'cli.edit.promptAddTarget': 'Add to which list?',
  'cli.edit.noListSelected': 'No list selected. Skipping.',

  // ── Session changes and the edit-mode undo stack ──────────────────────
  'cli.edit.sessionAdd': 'Added {label}',
  'cli.edit.undoBlockedGone': 'the change no longer exists',
  'cli.edit.undoBlockedNewer': 'discard the newer "{label}" first',
  'cli.edit.cannotDiscardYet': 'Cannot discard "{label}" yet — {reason}.',
  'cli.edit.undid': 'Undid {label}.',
  'cli.edit.undoHistoryCleared': '(Edit undo history cleared by the discard.)',

  // ── What an edit-mode operation is called ─────────────────────────────
  //
  // Short noun phrases, not sentences: each is spliced into `cli.edit.undid`,
  // `cli.edit.cannotDiscardYet` and the Undo Last Edit menu row, so it has to
  // read as the *object* of "Undo …" rather than as a statement of its own.
  'cli.editLabel.printing': 'printing on {name}',
  'cli.editLabel.finish': 'finish on {name}',
  'cli.editLabel.condition': 'condition on {name}',
  'cli.editLabel.language': 'language on {name}',
  'cli.editLabel.labels': 'labels on {name}',
  'cli.editLabel.note': 'note on {name}',
  'cli.editLabel.section': 'section of {name}',
  'cli.editLabel.removeCopy': 'removing a copy of {name}',
  'cli.editLabel.removal': 'removal of {name}',
  'cli.editLabel.moveToList': 'move of {name} to {list}',

  // ── The edit-mode action menu ─────────────────────────────────────────
  'cli.editAction.changePrinting': 'Change Printing',
  'cli.editAction.changeFinish': 'Change Finish',
  'cli.editAction.changeCondition': 'Change Condition',
  'cli.editAction.changeLanguage': 'Change Language',
  'cli.editAction.changeLabel': 'Change Label',
  'cli.editAction.moveToSection': 'Move to Section',
  'cli.editAction.moveToList': 'Move to Another List',
  'cli.editAction.editNote': 'Edit Note',
  'cli.editAction.addCopy': 'Add a Copy',
  'cli.editAction.removeCopy': 'Remove a Copy',
  'cli.editAction.removeAllCopies': 'Remove All Copies ({count})',
  'cli.editAction.removeCard': 'Remove Card',
  'cli.editAction.remove': 'Remove',

  // ── What an edit did ──────────────────────────────────────────────────
  //
  // `{line}` is an already-rendered canonical card line (`2 Sol Ring (C19:221)
  // [foil] — Main &5`), so it is never translated and never reordered inside.
  'cli.edit.confirmRemove': 'Remove {line}?',
  'cli.edit.changedLine': 'Changed: {line}',
  'cli.edit.addedLine': 'Added: {line}',
  'cli.edit.addedLineTotal': 'Added: {line} ({count}x total)',
  'cli.edit.editedLine': 'Edited: {line}',
  'cli.edit.removedLine': 'Removed: {line}',
  'cli.edit.discardedCard': 'Discarded: {name}',
  'cli.edit.removedPlaceholder': '(removed) &{id}',
  'cli.edit.noteSet': 'Note set on {name}.',
  'cli.edit.noteCleared': 'Note cleared on {name}.',
  'cli.edit.noPrintings': 'No printings found.',
  'cli.edit.noPrintingsNameOnly': 'No printings found. Adding name only.',
  'cli.edit.fileWarning': '{file}: {warning}',

  // ── Moving a card to another list ─────────────────────────────────────
  'cli.edit.promptMoveTarget': 'Move {name} to which list?',
  'cli.edit.noMoveTargets': 'There is no other list to move this card to.',
  'cli.edit.moveNeedsPrinting':
    'Cannot move {name} into a collection: no printings found to pin it to.',
  'cli.edit.movedToList': 'Moved: {line} → {list} (delivered on save)',
  'cli.edit.moveNoteDropped':
    'The note on {name} will not follow it — notes do not move across lists.',
  'cli.edit.savingMoveDest': 'Saving {name} (received moved cards)…',
  'cli.edit.moveCommitFailed': 'Could not deliver moved cards, so {name} was left unsaved: {error}',
  'cli.edit.moveWriteFailed':
    'A write failed while saving moved cards — some destinations may already hold them; {name} was left unsaved: {error}',

  // ── Deck sessions ─────────────────────────────────────────────────────
  'cli.deck.promptFormat': 'Deck format:',
  'cli.deck.formatNotSet': 'not set',
  'cli.deck.formatChanged': 'Format changed to {format}.',
  'cli.deck.tagsNone': 'none',
  'cli.deck.promptTags': 'Tags (comma separated; empty clears them):',
  'cli.deck.tagsSet': 'Tags set to: {tags}.',
  'cli.deck.tagsCleared': 'Tags cleared.',
  'cli.deck.menuTargetSection': 'Set Target Section ({section})',
  'cli.deck.menuChangeFormat': 'Change Format ({format})',
  'cli.deck.menuEditTags': 'Edit Tags ({tags})',
  'cli.deck.promptEveryTime': 'Prompt every time',
  'cli.deck.promptEveryTimeInline': 'prompt every time',
  'cli.deck.newSection': 'New Section',
  'cli.deck.newSectionMore': 'New section…',
  'cli.deck.promptNewSectionName': 'New section name:',
  'cli.deck.sectionNameEmpty': 'Section name cannot be empty',
  'cli.deck.promptAddSection': 'Add to which section?',
  'cli.deck.promptMoveSection': 'Move to which section?',
  'cli.deck.promptTargetSection': 'Add cards to section:',
  'cli.deck.targetSectionSet': 'Target section: {section}.',
  'cli.deck.filtersUpdatedSection': 'Session filters updated. Target section: {section}.',
  'cli.deck.addedCard': 'Added: {card} to {section}',
  'cli.deck.addedAnother': 'Added another {name} to {section} ({count}x total)',
  'cli.deck.removedFromSection': 'Removed: {name} from {section}',
  'cli.deck.noSectionSelected': 'No section selected. Skipping.',
  'cli.deck.editedPrinting': 'Edited {name} → {printing}',

  // ── Collection sessions ───────────────────────────────────────────────
  'cli.collection.promptLabel': 'Label:',
  'cli.collection.promptDefaultLabels': 'Default labels:',
  'cli.collection.menuListLabels': 'Edit List Labels (default: {labels})',
  'cli.collection.labelsNone': 'none',
  'cli.collection.defaultLabelsSet': 'Default labels set to [{labels}].',
  'cli.collection.defaultLabelsCleared': 'Default labels cleared.',
  'cli.collection.frontMatterUnreadable':
    "The file's front matter could not be read as YAML, so editing the default labels would overwrite it. Fix the block by hand first.",
  'cli.collection.noPrintingsSkip': 'No printings found. Skipping.',

  // ── Wanted-list sessions ──────────────────────────────────────────────
  'cli.wanted.promptSpecificity': 'How specific for {name}?',
  'cli.wanted.specificityNameOnly': 'Name only (cheapest printing)',
  'cli.wanted.specificitySpecific': 'Choose specific printing',
  'cli.wanted.noPreference': 'No preference',
  'cli.wanted.noPreferenceAny': 'No preference (any finish)',

  // ── The printing / finish / condition pickers ─────────────────────────
  'cli.printing.promptSelect': 'Select Printing:',
  'cli.printing.promptFinish': 'Select Finish:',
  'cli.printing.promptFinishShort': 'Finish:',
  'cli.printing.promptCondition': 'Condition:',
  'cli.printing.promptLanguage': 'Language:',
  'cli.printing.row': '{setName} ({set}) #{number} [{rarity}]',
  'cli.printing.languageBadge': '({languages} only)',
  'cli.printing.languageRow': '{name} ({code})',
  'cli.printing.languageUnavailable':
    '{printing} is not available in {language} — only {available}.',
  'cli.printing.useLanguage': 'Use {language} ({code})',
  'cli.printing.pickAnother': 'Pick another printing',
  'cli.printing.noSetFilterMatch':
    'No printings found matching set filters [{sets}]. Showing all printings.',
  'cli.printing.noneCached': "No printings of '{name}' found in the card cache.",
  'cli.printing.pinNotFound':
    "No printing {printing} of '{name}'. Available printings: {listed}{more}.",
  'cli.printing.andMore': ', and {count} more',
  'cli.printing.finishUnavailable':
    "Printing {printing} of '{name}' is not available in {finish}. Available finishes: {available}.",

  // ── `ritual history` ──────────────────────────────────────────────────
  'cli.history.limitInvalid': "--limit must be a positive integer (got '{value}').",
  'cli.history.typeFlagConflict': 'Specify only one of --deck, --collection, or --wanted.',
  'cli.history.limitRequiresShow': '--limit requires --show.',
  'cli.history.outputRequiresShow': '--output {output} requires --show.',
  'cli.history.noEditorHeadless':
    'the interactive history editor is unavailable — use --show to print the change history from a script',
  'cli.history.noHistory': 'No change history recorded.',
  'cli.history.setCount': {
    $plural: 'count',
    one: '{count} change set',
    other: '{count} change sets',
  },
  'cli.history.heading': {
    $select: 'type',
    deck: "Change history for Deck '{name}' — {sets}.",
    collection: "Change history for Collection '{name}' — {sets}.",
    wanted: "Change history for Wanted List '{name}' — {sets}.",
  },
  'cli.history.setHeading': '{timestamp}  ({changes})',
  'cli.history.noListsOfType': {
    $select: 'type',
    deck: 'No deck lists found.',
    collection: 'No collection lists found.',
    wanted: 'No wanted list lists found.',
  },
  'cli.history.promptSelectList': 'Select a list (type to filter):',
  'cli.history.listRow': '{name} — {type}',
  'cli.history.promptMain': 'Change history (type to filter sets):',
  'cli.history.undoLast': 'Undo last change ({count})',
  'cli.history.preview': 'Preview changes to be saved',
  'cli.history.rewrite': 'Rewrite all change sets with defaults',
  'cli.history.promptSetAction': 'Action for this change set:',
  'cli.history.deleteSet': 'Delete this change set',
  'cli.history.combineSet': 'Combine with another change set',
  'cli.history.editTimestamp': 'Edit timestamp',
  'cli.history.setDeleted': 'Change set deleted (in memory).',
  'cli.history.noOtherSet': 'No other change set to combine with.',
  'cli.history.promptCombine':
    'Combine with which other set (type to filter)? Its entries move in, then it is deleted:',
  'cli.history.setsCombined': 'Change sets combined (in memory).',
  'cli.history.promptTimestamp': 'New ISO-8601 timestamp:',
  'cli.history.timestampInvalid':
    'Must be a valid ISO-8601 timestamp (e.g. 2026-05-29T12:00:00.000Z).',
  'cli.history.timestampUpdated': 'Timestamp updated (in memory).',
  'cli.history.proseWarning': '{count} hand-written line(s) will be discarded.',
  'cli.history.confirmRewrite':
    'Replace ALL change sets with a single set describing the list as it stands now?{warning}',
  'cli.history.rewriteYes': 'Yes, rewrite with defaults',
  'cli.history.rewriteNo': 'No, cancel',
  'cli.history.emptyList': 'The list is empty — nothing to rewrite.',
  'cli.history.rewrote':
    'Rewrote history as a single change set with {count} entr(y/ies) (in memory).',
  'cli.history.nothingToUndo': 'Nothing to undo.',
  'cli.history.reverted': 'Reverted the last change.',
  'cli.history.previewHeading': '── Preview of changes to be saved ──',
  'cli.history.previewSets': 'Change sets: {before} → {after}',
  'cli.history.previewLines': 'Change lines: {before} → {after}',
  'cli.history.noPending': 'No changes pending — the file would be written unchanged.',
  'cli.history.resultingSets': 'Resulting change sets (newest first):',
  'cli.history.noneEmptied': '(none — the changelog would be emptied)',
  'cli.history.promptDonePreview': 'Done previewing?',
  'cli.history.backToMenu': 'Back to menu',
  'cli.history.noChangesToSave': 'No changes to save.',
  'cli.history.saved': 'Saved {count} change set(s) to {file}',
  'cli.history.discardedAll': 'Discarded all changes.',

  // ── One-shot line edits (`set-card`, `remove-card`, `note`) ───────────
  'cli.lineMutate.appendIntoOpenFence':
    'The file ends inside an unclosed code fence, so a new card line appended at the end would be read as prose. Close the fence first.',
  'cli.lineMutate.targetLineGone':
    'Card line no longer present in file (it may have been edited concurrently).',
  'cli.lineMutate.conflictingLabels':
    'The target line carries a conflicting labels token [{token}], which a rewrite would drop. Fix the token in the file first.',

  // ── The Archidekt CSV-upload decision ─────────────────────────────────
  'cli.csvUpload.flagAdvice':
    'Pass --csv to upload them as one CSV import, or --csv-file <path> to write the CSV for a manual upload.',
  'cli.csvUpload.tooMany':
    '{cards} would be added — more than {threshold}, so adding them one at a time would cost {searches} printing searches. {advice}',
  'cli.csvUpload.prompt': {
    $plural: 'count',
    one: '{cards} would be added — more than {threshold}. How should it reach Archidekt?',
    other: '{cards} would be added — more than {threshold}. How should they reach Archidekt?',
  },
  'cli.csvUpload.optionUpload': 'Upload them automatically as one CSV import (recommended)',
  'cli.csvUpload.optionExport': 'Save the CSV to a file for a manual upload',
  'cli.csvUpload.optionIndividual': 'Add them individually (slow; may be rate limited)',
  'cli.csvUpload.optionCancel': 'Cancel the run',
  'cli.csvUpload.cancelled': 'Cancelled before adding {cards}. {advice}',
  'cli.csvUpload.promptPath': 'Write the CSV where? (import it at {url})',
} as const satisfies MessageCatalogShape
