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
    one: '{count} change could not be applied to this list and was skipped:',
    other: '{count} changes could not be applied to this list and were skipped:',
  },
  'ui.editor.importConflictItem': '{change} — {reason}',
  'ui.editor.droppedNotes': {
    $plural: 'count',
    one: 'Note dropped on merge: {items}.',
    other: 'Notes dropped on merge: {items}.',
  },
  'ui.editor.prunedCategories': {
    $plural: 'count',
    one: 'Categories dropped for a card the list no longer holds: {items}.',
    other: 'Categories dropped for cards the list no longer holds: {items}.',
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
  'ui.editor.saveSuccessNotices': 'Changes saved successfully.{notes}',
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
  'ui.editor.coverImage': 'Cover Image…',
  'ui.editor.import': 'Import…',
  'ui.editor.swapPrintings': 'Swap Printings…',
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
  'ui.editor.setPrintingTitle': 'Set printing',
  'ui.editor.changePrintingPrompt':
    'How many of the {total} copies of {name} should get the new printing?',

  // ── Language picker ───────────────────────────────────────────────────
  'ui.editor.setLanguageTitle': 'Set language',
  'ui.editor.languageCurrent': '{name} ✓',

  // ── Tags dialog ───────────────────────────────────────────────────────
  'ui.editor.editTagsTitle': 'Edit tags',
  'ui.editor.tagsLabel': 'Tags',
  'ui.editor.tagsPlaceholder': 'Ramp, Card Draw',
  'ui.editor.tagsHint': 'Separate tags with commas. Leave the field empty to clear every tag.',
  'ui.editor.tagsSuggestions': 'Used in this list:',
  'ui.editor.tagsSave': 'Save',

  // ── Categories dialogs ────────────────────────────────────────────────
  'ui.editor.editCategoriesTitle': 'Edit categories',
  'ui.editor.categoriesLabel': 'Categories',
  'ui.editor.categoriesPlaceholder': 'Ramp, Artifacts',
  'ui.editor.categoriesHint':
    "Separate categories with commas. The first one is the card's primary category. Leave the field empty to clear them.",
  'ui.editor.categoriesSuggestions': 'Used in this list:',
  'ui.editor.categoriesSave': 'Save',
  'ui.editor.categoriesOrderLabel': 'Category order',
  'ui.editor.categoriesPrimaryBadge': 'primary',
  'ui.editor.categoriesMoveEarlier': 'Move earlier',
  'ui.editor.categoriesMoveLater': 'Move later',
  'ui.editor.categories': 'Categories',
  'ui.editor.manageCategories': 'Manage categories',
  'ui.editor.categoriesHelp':
    "Rename, reorder or remove this list's categories. Removing one takes it off every card that holds it.",
  'ui.editor.noCategories': 'This list has no categories yet.',
  'ui.editor.renameCategory': 'Rename category',
  'ui.editor.newCategoryName': 'New name',
  'ui.editor.categoryExists': 'A category called "{name}" already exists',
  'ui.editor.categoryInvalid': '{reason}',
  'ui.editor.moveCategoryUp': 'Move up',
  'ui.editor.moveCategoryDown': 'Move down',
  'ui.editor.removeCategory': 'Remove',

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
  'ui.cardMenu.foilNeedsPrinting': 'Set a printing first to choose a finish',
  'ui.cardMenu.finishUnavailable': 'This printing is not published in that finish',
  'ui.cardMenu.changePrinting': 'Change Printing…',
  'ui.cardMenu.setPrinting': 'Set Printing…',
  'ui.cardMenu.setLabel': 'Set Label…',
  'ui.cardMenu.editTags': 'Edit Tags…',
  'ui.cardMenu.editCategories': 'Edit Categories…',
  'ui.cardMenu.setLanguage': 'Set Language…',
  'ui.cardMenu.setCustomArt': 'Set Custom Art…',
  'ui.cardMenu.setCommander': 'Set as Commander',
  'ui.cardMenu.unsetCommander': 'Unset as Commander',
  'ui.cardMenu.moveToSection': 'Move to section…',
  'ui.cardMenu.moveToList': 'Move to list…',
  'ui.cardMenu.swapPrinting': 'Swap printing…',
  'ui.cardMenu.findInLists': 'Find in Lists',

  // ── Add-card dialog ───────────────────────────────────────────────────
  'ui.addCard.title': 'Add card',
  'ui.addCard.searchPlaceholder': 'Search for a card...',
  'ui.addCard.back': '← Back',
  'ui.addCard.selectPrinting': 'Select a printing for {name}',
  'ui.addCard.loadingPrintings': 'Loading printings…',
  'ui.printingFilter.placeholder': 'Filter by set or collector number (e.g. mkm 123)…',
  'ui.printingFilter.noMatches': 'No printings match your filter.',
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
  'ui.addCard.optionsHeading': 'Card options',
  'ui.addCard.labelField': 'Label',
  'ui.addCard.artField': 'Custom art',
  'ui.addCard.artPlaceholder': 'proxies/sol-ring.jpg or https://example.com/sol-ring.jpg',
  'ui.addCard.artInvalid': 'That custom art is not usable: {reason}',
  'ui.addCard.artPendingNote': 'Custom art is written when you save the list.',

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
  'ui.hint.filterPrintings': 'filter',
  'ui.hint.choose': 'choose',
  'ui.hint.nextGroup': 'next group',
  'ui.hint.quantity': 'quantity',
  'ui.hint.addCard': 'add card',
  'ui.hint.updateCard': 'update card',
  'ui.hint.addAnother': 'add + another',

  // ── Swap Printings wizard (shared by both editors) ───────────────────
  'ui.swap.title': 'Swap Printings',
  'ui.swap.aria': 'Swap Printings wizard',
  'ui.swap.back': '← Back',
  'ui.swap.next': 'Next',
  'ui.swap.apply': 'Apply',
  'ui.swap.discard': 'Discard',
  'ui.swap.step.cards': 'Cards',
  'ui.swap.step.sources': 'Sources',
  'ui.swap.step.mode': 'Mode',
  'ui.swap.step.pick': 'Pick',
  'ui.swap.step.review': 'Review',
  'ui.swap.step.replacements': 'Replacements',
  'ui.swap.step.summary': 'Summary',
  'ui.swap.copies': {
    $plural: 'count',
    one: '{count} copy',
    other: '{count} copies',
  },
  'ui.swap.quantity': '×{count}',
  'ui.swap.noPrice': '—',
  'ui.swap.cards.heading': 'Choose the cards to re-pick printings for',
  'ui.swap.cards.selectAll': 'Select all',
  'ui.swap.cards.selectNone': 'Select none',
  'ui.swap.cards.selected': '{count} of {total} selected',
  'ui.swap.cards.noPrintingSet': 'no printing set',
  'ui.swap.cards.none': 'This list has no cards, so there is nothing to swap.',
  'ui.swap.sources.heading': 'Which lists may supply replacement printings?',
  'ui.swap.sources.label': 'Take printings from:',
  'ui.swap.sources.note':
    'Wanted lists are off by default — their entries hold no physical cards, so choosing one means picking a printing for it.',
  'ui.swap.sources.none': 'There are no other lists to take printings from.',
  'ui.swap.sources.selectedCount': {
    $plural: 'count',
    one: '{count} list selected',
    other: '{count} lists selected',
  },
  'ui.swap.sources.loading': 'Loading the selected lists…',
  'ui.swap.sources.loadFailed': 'Could not load the selected lists. Go back and try again.',
  'ui.swap.sources.someFailed': {
    $plural: 'count',
    one: '{count} list could not be loaded; its copies are not offered.',
    other: '{count} lists could not be loaded; their copies are not offered.',
  },
  'ui.swap.mode.heading': 'How should replacements be chosen?',
  'ui.swap.mode.manual': 'Manual',
  'ui.swap.mode.manualHint': 'Pick a printing for each card yourself.',
  'ui.swap.mode.mostExpensive': 'Most expensive',
  'ui.swap.mode.mostExpensiveHint': 'Prefer the highest-valued copies you own.',
  'ui.swap.mode.leastExpensive': 'Least expensive',
  'ui.swap.mode.leastExpensiveHint': 'Prefer the lowest-valued copies you own.',
  'ui.swap.unpriced.label': 'Cards with an unpriced option',
  'ui.swap.unpriced.skip': 'Skip',
  'ui.swap.unpriced.skipHint': 'Leave the card unchanged and flag it for review.',
  'ui.swap.unpriced.ignore': 'Ignore',
  'ui.swap.unpriced.ignoreHint': 'Rank the priced options only.',
  'ui.swap.unpriced.force': 'Ask me',
  'ui.swap.unpriced.forceHint': 'Open the picker for the card so you decide.',
  'ui.swap.unpriced.note':
    'Unpriced means no market value is published — not that the copy is worthless.',
  'ui.swap.finish.label': 'Finish',
  'ui.swap.finish.any': 'Any',
  'ui.swap.finish.foil': 'Foil',
  'ui.swap.finish.nonfoil': 'Nonfoil',
  'ui.swap.displaced.label': 'Displaced copies',
  'ui.swap.displaced.swap': 'Swap with the source list',
  'ui.swap.displaced.swapHint': 'Each displaced copy goes to the list its replacement came from.',
  'ui.swap.displaced.override': 'Send all displaced copies to…',
  'ui.swap.displaced.choose': 'Choose a list',
  'ui.swap.replaceTaken.label': 'Cards without a printing',
  'ui.swap.replaceTaken.option': 'Replace the copies taken from other lists',
  'ui.swap.replaceTaken.hint':
    'A card with no printing set takes its printing from a copy owned elsewhere, and that list loses the copy. Turn this on to choose a printing each list gets back instead.',
  'ui.swap.replacements.heading': 'What do the source lists get back?',
  'ui.swap.replacements.hint':
    'Each line names copies taken from a list to set a printing here. Choose the printing that list now runs instead, or leave it one copy short.',
  'ui.swap.replacements.taken': '{count}× {name} ({printing}) taken from',
  'ui.swap.replacements.none': 'No replacement — the list loses the copies',
  'ui.swap.replacements.chosen': 'Gets back {count}× {printing}',
  'ui.swap.replacements.choose': 'Choose replacement…',
  'ui.swap.replacements.clear': 'No replacement',
  'ui.swap.replacements.backToRows': '← Back to the list',
  'ui.swap.summary.replacementLine': '{count}× {name} ({printing}) added back to {list}',
  'ui.swap.pick.heading': 'Pick printings for {name}',
  'ui.swap.pick.progress': '{index} of {total}',
  'ui.swap.pick.prev': 'Previous card',
  'ui.swap.pick.next': 'Next card',
  'ui.swap.pick.keep': 'Keep current',
  'ui.swap.pick.assigned': 'Assigned {assigned} of {total} — the rest keep the current printing.',
  'ui.swap.pick.available': '{count} available',
  'ui.swap.pick.take': 'Copies to take from this row',
  'ui.swap.pick.noCandidates': 'No copies of this card in the selected lists.',
  'ui.swap.pick.printingless': 'No printing set',
  'ui.swap.pick.printinglessPrompt': 'Is this one of these printing-less entries?',
  'ui.swap.pick.printinglessHint':
    'Choosing one lets you pick any printing for it; that entry then leaves its list.',
  'ui.swap.pick.printinglessNo': 'No — choose from the other matches',
  'ui.swap.pick.choosePrinting': 'Choose the printing for {name}',
  'ui.swap.pick.chosen': 'Chosen: {printing}',
  'ui.swap.pick.changePrinting': 'Change printing…',
  'ui.swap.pick.backToRows': 'Back to matches',
  'ui.swap.pick.printingsFailed': 'Could not load the printings for this card.',
  'ui.swap.review.heading': 'Review the planned swaps',
  'ui.swap.review.card': 'Card',
  'ui.swap.review.current': 'Current',
  'ui.swap.review.chosen': 'Chosen',
  'ui.swap.review.value': 'Value',
  'ui.swap.review.keep': {
    $plural: 'count',
    one: '{count} copy keeps the current printing',
    other: '{count} copies keep the current printing',
  },
  'ui.swap.review.unchanged': 'Unchanged',
  'ui.swap.review.change': 'Change…',
  'ui.swap.flag.noCandidates': 'no candidates',
  'ui.swap.flag.unpriced': 'unpriced option',
  'ui.swap.flag.needsManual': 'needs a manual pick',
  'ui.swap.flag.partial': 'partial',
  'ui.swap.flag.needsDisplaced': 'needs a displaced destination',
  'ui.swap.summary.heading': 'Summary',
  'ui.swap.summary.noMoves': 'Nothing to swap — no copies were assigned a new printing.',
  'ui.swap.summary.fallbackLabel': 'Displaced copies from wanted-list sources go to…',
  'ui.swap.summary.fallbackRequired': 'Choose where those displaced copies go before applying.',
  'ui.swap.summary.takes': 'Taken from {list}',
  'ui.swap.summary.sends': 'Sent to {list}',
  'ui.swap.summary.moveLine': '{count}× {name} ({printing})',
  'ui.swap.summary.valueHeading': 'Value',
  'ui.swap.summary.listTotal': 'This list: {before} → {after}',
  'ui.swap.summary.cardDelta': '{name}: {before} → {after}',
  'ui.swap.summary.unknown': 'unknown',

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
  'ui.shortcuts.filterPrintings': 'Filter by set code or collector number',
  'ui.shortcuts.choosePrinting': 'Choose the highlighted printing',
  'ui.shortcuts.changeGroupValue': 'Change the focused group’s value',
  'ui.shortcuts.nextGroup': 'Move to the next group',
  'ui.shortcuts.adjustQuantity': 'Adjust the quantity to add',
  'ui.shortcuts.addTheCard': 'Add the card',
  'ui.shortcuts.addThenAnother': 'Add the card, then start another',
  'ui.shortcuts.close': 'Close',
} as const satisfies MessageCatalogShape
