/**
 * `ui.*` — the shared `src/ui` component chrome (dialogs, quantity steppers,
 * modals) and the `src/editor` surfaces both SPAs embed. Consumed by the CLI's
 * browser-side surfaces and by both SPAs.
 *
 * The `ui.count.*` entries are the generic "N things" phrases that used to be
 * assembled by `countLabel(count, noun)` — a count plus a noun with an English
 * `s` glued on. They are separate keys per noun rather than one key with a
 * `{noun}` parameter because plural category and noun inflection are joined in
 * most languages: a translator needs the whole phrase.
 */

import type { MessageCatalogShape } from '../../types'

export const uiMessages = {
  'ui.dialog.cancel': 'Cancel',
  'ui.dialog.close': 'Close',
  'ui.dialog.done': 'Done',
  'ui.dialog.continue': 'Continue',
  'ui.quantity.copies': 'Copies',
  'ui.quantity.ofTotal': 'of {total}',
  'ui.quantity.decrease': 'Decrease',
  'ui.quantity.decreaseLabel': 'Decrease quantity',
  'ui.quantity.increase': 'Increase',
  'ui.quantity.increaseLabel': 'Increase quantity',

  // ── Field names shared by the editor's forms and the add-card dialog ───
  'ui.field.finish': 'Finish',
  'ui.field.condition': 'Condition',
  'ui.field.quantity': 'Quantity',

  // ── Counted nouns ─────────────────────────────────────────────────────
  'ui.count.cards': {
    $plural: 'count',
    one: '{count} card',
    other: '{count} cards',
  },
  'ui.count.changes': {
    $plural: 'count',
    one: '{count} change',
    other: '{count} changes',
  },
  'ui.count.lists': {
    $plural: 'count',
    one: '{count} list',
    other: '{count} lists',
  },

  // ── Cross-list selection ──────────────────────────────────────────────
  'ui.selection.confirmRemoveAll': {
    $plural: 'count',
    one: 'Remove {count} selected card from their lists?',
    other: 'Remove {count} selected cards from their lists?',
  },

  // ── Editor chrome shared by both SPAs (`src/editor`) ──────────────────
  'ui.editor.discardTitle': {
    $plural: 'count',
    one: 'Discard {count} change?',
    other: 'Discard {count} changes?',
  },
  'ui.editor.importLoaded': {
    $plural: 'count',
    one: 'Loaded {count} change as pending edits. Review them, then save or export.',
    other: 'Loaded {count} changes as pending edits. Review them, then save or export.',
  },
  'ui.editor.importConflicts': {
    $plural: 'count',
    one: '{count} change could not be matched to a card in this list and was skipped:',
    other: '{count} changes could not be matched to a card in this list and were skipped:',
  },
  'ui.editor.droppedNotes': {
    $plural: 'count',
    one: 'Note dropped on merge: {items}.',
    other: 'Notes dropped on merge: {items}.',
  },

  // ── Editor lifecycle status ───────────────────────────────────────────
  //
  // `{listType}` selects on `deck` / `collection` / `wanted` rather than
  // splicing a noun into a frame: "Loading " + noun cannot be declined, and the
  // English it used to produce for a wanted list read "wanted list list".
  'ui.editor.loading': {
    $select: 'listType',
    deck: 'Loading deck...',
    collection: 'Loading collection...',
    wanted: 'Loading wanted list...',
    other: 'Loading list...',
  },
  'ui.editor.loadFailed': {
    $select: 'listType',
    deck: 'Failed to load deck',
    collection: 'Failed to load collection',
    wanted: 'Failed to load wanted list',
    other: 'Failed to load list',
  },
  'ui.editor.loadListFailed': {
    $select: 'listType',
    deck: 'Failed to load deck list',
    collection: 'Failed to load collection list',
    wanted: 'Failed to load wanted lists',
    other: 'Failed to load lists',
  },
  'ui.editor.selectorLabel': {
    $select: 'listType',
    deck: 'Select Deck',
    collection: 'Select Collection',
    wanted: 'Select Wanted List',
    other: 'Select List',
  },
  'ui.editor.selectorPlaceholder': {
    $select: 'listType',
    deck: 'Choose a deck',
    collection: 'Choose a collection',
    wanted: 'Choose a wanted list',
    other: 'Choose a list',
  },

  // ── Save status ───────────────────────────────────────────────────────
  'ui.editor.saveSuccess': 'Changes saved successfully',
  'ui.editor.saveSuccessDroppedNotes': 'Changes saved successfully.{notes}',
  'ui.editor.saveConflict': 'Content has been modified. Please reload to continue editing.',
  'ui.editor.saveFailed': 'Save failed',
  'ui.editor.saveRequestFailed': 'Failed to save changes',

  // ── Action bar ────────────────────────────────────────────────────────
  'ui.editor.addCard': '+ Add Card',
  'ui.editor.addCardTitle': 'Add a card (Ctrl+Enter)',
  'ui.editor.addCardDefaults': 'Add Card Defaults',
  'ui.editor.defaultsActive': 'defaults active',
  'ui.editor.sections': 'Sections',
  'ui.editor.labels': 'Labels',
  'ui.editor.import': 'Import…',
  'ui.editor.changes': 'Changes',
  'ui.editor.undo': 'Undo',
  'ui.editor.saving': 'Saving...',
  'ui.editor.saveChanges': 'Save Changes',
  'ui.editor.discardChanges': 'Discard Changes',
  'ui.editor.shortcutsTitle': 'Keyboard shortcuts (?)',
  'ui.editor.shortcutsLabel': 'Keyboard shortcuts',

  // ── Section management ────────────────────────────────────────────────
  'ui.editor.manageSections': 'Manage Sections',
  'ui.editor.sectionsHelp':
    'Sections group cards on the list page. Names must be unique (case-insensitive).',
  'ui.editor.newSectionName': 'New section name',
  'ui.editor.addSection': 'Add Section',
  'ui.editor.sectionExists': 'A section named “{name}” already exists.',
  'ui.editor.sectionNameRequired': 'Enter a section name.',
  'ui.editor.sectionName': 'Section name',
  'ui.editor.rename': 'Rename',
  'ui.editor.delete': 'Delete',
  'ui.editor.deleteSectionDisabled': 'Only empty sections can be deleted',
  'ui.editor.moveToNewSection': 'Move to new section',
  'ui.editor.move': 'Move',
  'ui.editor.renameSection': 'Rename section',

  // ── Add-card defaults form ────────────────────────────────────────────
  'ui.editor.defaultsSets': 'Set codes',
  'ui.editor.defaultsSetsPlaceholder': 'e.g. FDN, SPG',
  'ui.editor.defaultsSetsHint':
    'When set, the printing picker shows only matching printings (with fallback to all if none match). Comma-separated, case-insensitive.',
  'ui.editor.defaultsAskEachTime': 'Ask each time',
  'ui.editor.defaultsClear': 'Clear all',
  'ui.editor.finishNonfoil': 'Nonfoil',
  'ui.editor.finishFoil': 'Foil',
  'ui.editor.finishEtched': 'Etched',

  // ── Change-printing prompt ────────────────────────────────────────────
  'ui.editor.changePrintingTitle': 'Change printing',
  'ui.editor.changePrintingPrompt':
    'How many of the {total} copies of {name} should get the new printing?',

  // ── Language picker ───────────────────────────────────────────────────
  'ui.editor.setLanguageTitle': 'Set language',
  'ui.editor.languageCurrent': '{name} ✓',

  // ── Pending-changes dialogs ───────────────────────────────────────────
  'ui.editor.pendingChanges': 'Pending changes',
  'ui.editor.pendingChangesTitle': 'Pending Changes ({count})',
  'ui.editor.noPendingChanges': 'No pending changes',
  'ui.editor.discardMessage': 'The following changes will be lost:',
  'ui.editor.discardConfirm': 'Yes, discard',

  // ── Change-bundle import dialog ───────────────────────────────────────
  'ui.editor.importTitle': 'Import changes',
  'ui.editor.importPrompt':
    'Upload or paste a change-list JSON to import into the current editor view.',
  'ui.editor.importPastePlaceholder': '…or paste JSON here',
  'ui.editor.importAction': 'Import',
  'ui.editor.importWrongKind': {
    $select: 'listType',
    deck: 'This file has no changes for a deck (it targets: {kinds}).',
    collection: 'This file has no changes for a collection (it targets: {kinds}).',
    wanted: 'This file has no changes for a wanted list (it targets: {kinds}).',
    other: 'This file has no changes for this list (it targets: {kinds}).',
  },
  'ui.editor.importAmbiguous': {
    $select: 'listType',
    deck: 'This file has changes for {count} decks and none match this list. Apply it with the admin Import Changes page or {command} instead.',
    collection:
      'This file has changes for {count} collections and none match this list. Apply it with the admin Import Changes page or {command} instead.',
    wanted:
      'This file has changes for {count} wanted lists and none match this list. Apply it with the admin Import Changes page or {command} instead.',
    other:
      'This file has changes for {count} lists and none match this list. Apply it with the admin Import Changes page or {command} instead.',
  },

  // ── Card context menu ─────────────────────────────────────────────────
  'ui.cardMenu.options': 'Options for {name}',
  'ui.cardMenu.setFoil': 'Set as Foil',
  'ui.cardMenu.setNonfoil': 'Set as Nonfoil',
  'ui.cardMenu.changePrinting': 'Change Printing…',
  'ui.cardMenu.setLabel': 'Set Label…',
  'ui.cardMenu.setLanguage': 'Set Language…',
  'ui.cardMenu.setCommander': 'Set as Commander',
  'ui.cardMenu.unsetCommander': 'Unset as Commander',
  'ui.cardMenu.moveToSection': 'Move to section…',
  'ui.cardMenu.moveToList': 'Move to list…',
  'ui.cardMenu.findInLists': 'Find in Lists',

  // ── Add-card dialog ───────────────────────────────────────────────────
  'ui.addCard.title': 'Add card',
  'ui.addCard.searchPlaceholder': 'Search for a card...',
  'ui.addCard.back': '← Back',
  'ui.addCard.selectPrinting': 'Select a printing for {name}',
  'ui.addCard.loadingPrintings': 'Loading printings…',
  'ui.addCard.setFilterFellBack':
    'No printings match the set filter ({sets}). Showing all printings.',
  'ui.addCard.noSpecificPrinting': 'No specific printing',
  'ui.addCard.prevPage': '← Prev',
  'ui.addCard.nextPage': 'Next →',
  'ui.addCard.pageOf': 'Page {page} of {total}',
  'ui.addCard.printingHeading': '{name} ({set}:{number})',
  'ui.addCard.languageOnly': 'This printing is only available in {languages}.',
  'ui.addCard.languageUnavailable':
    'This printing is not available in {preferred} — only {languages}. It will be added in {language}.',
  'ui.addCard.finishConditionHeading': 'Set finish & condition for {name} ({set}:{number})',
  'ui.addCard.quantityToAdd': 'Quantity to add',
  'ui.addCard.add': 'Add Card',
  'ui.addCard.update': 'Update Card',
  'ui.addCard.addAnother': 'Add Another Card',
  'ui.addCard.sourceNote': 'Search uses the {link} — results may differ from the admin editor.',
  'ui.addCard.scryfallApi': 'Scryfall API',
  'ui.addCard.priceUnknown': 'N/A',
  'ui.addCard.priceFoil': '{price} (foil)',
  'ui.addCard.priceEtched': '{price} (etched)',

  // ── Footer key hints (add-card dialog) ────────────────────────────────
  //
  // Short verb phrases rendered next to a `<kbd>` chip, so the budgets are
  // tight: the whole footer is one row.
  'ui.hint.navigate': 'navigate',
  'ui.hint.select': 'select',
  'ui.hint.close': 'close',
  'ui.hint.continue': 'continue',
  'ui.hint.printing': 'printing',
  'ui.hint.row': 'row',
  'ui.hint.choose': 'choose',
  'ui.hint.nextGroup': 'next group',
  'ui.hint.quantity': 'quantity',
  'ui.hint.addCard': 'add card',
  'ui.hint.addAnother': 'add + another',

  // ── Keyboard shortcuts reference ──────────────────────────────────────
  'ui.shortcuts.title': 'Keyboard Shortcuts',
  'ui.shortcuts.macNote': 'On macOS, use Cmd wherever Ctrl is shown.',
  'ui.shortcuts.groupEditor': 'Editor',
  'ui.shortcuts.groupActionBar': 'In the action bar',
  'ui.shortcuts.groupAddCardSearch': 'Add card — search',
  'ui.shortcuts.groupAddCardPrintings': 'Add card — printings',
  'ui.shortcuts.groupAddCardFinish': 'Add card — finish & condition',
  'ui.shortcuts.groupAnyDialog': 'Any dialog',
  'ui.shortcuts.addCard': 'Add a card',
  'ui.shortcuts.focusActionBar': 'Focus the action bar',
  'ui.shortcuts.showThisList': 'Show this list',
  'ui.shortcuts.moveBetweenButtons': 'Move between buttons',
  'ui.shortcuts.activateButton': 'Activate the focused button',
  'ui.shortcuts.returnFocus': 'Return focus to the list',
  'ui.shortcuts.moveThroughResults': 'Move through results',
  'ui.shortcuts.chooseCard': 'Choose the highlighted card',
  'ui.shortcuts.prevNextPrinting': 'Previous / next printing',
  'ui.shortcuts.prevNextRow': 'Previous / next row',
  'ui.shortcuts.choosePrinting': 'Choose the highlighted printing',
  'ui.shortcuts.changeGroupValue': 'Change the focused group’s value',
  'ui.shortcuts.nextGroup': 'Move to the next group',
  'ui.shortcuts.adjustQuantity': 'Adjust the quantity to add',
  'ui.shortcuts.addTheCard': 'Add the card',
  'ui.shortcuts.addThenAnother': 'Add the card, then start another',
  'ui.shortcuts.close': 'Close',
} as const satisfies MessageCatalogShape
