/** Translator metadata for the `ui.*` namespace. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { uiMessages } from './ui'

export const uiMeta = {
  'ui.dialog.cancel': { description: 'Button that dismisses a dialog without applying it.' },
  'ui.dialog.close': { description: 'Button that closes a modal.' },
  'ui.dialog.done': {
    description:
      'Button that closes a dialog once the user has finished reading or working in it. Not a save — nothing is applied by pressing it.',
  },
  'ui.dialog.continue': {
    description: 'Button that accepts a notice and proceeds to the next step of a flow.',
  },
  'ui.quantity.copies': {
    description: 'Label above the quantity stepper in the copies dialog.',
    maxLen: 16,
  },
  'ui.quantity.ofTotal': {
    description:
      'Suffix showing how many copies exist in total, e.g. "of 4". {total} is a whole number.',
    maxLen: 16,
  },
  'ui.quantity.decrease': {
    description: 'Hover tooltip on the "−" button of an inline quantity ticker.',
    maxLen: 16,
  },
  'ui.quantity.decreaseLabel': {
    description: 'Screen-reader name for the "−" button of an inline quantity ticker.',
  },
  'ui.quantity.increase': {
    description: 'Hover tooltip on the "+" button of an inline quantity ticker.',
    maxLen: 16,
  },
  'ui.quantity.increaseLabel': {
    description: 'Screen-reader name for the "+" button of an inline quantity ticker.',
  },
  'ui.field.finish': {
    description:
      "Field name for a card's finish (nonfoil / foil / etched) — the physical treatment of the printing, not a state of completion.",
    maxLen: 16,
  },
  'ui.field.condition': {
    description:
      "Field name for a card's physical grade (Near Mint, Lightly Played, …), the collectors' condition scale.",
    maxLen: 16,
  },
  'ui.field.quantity': {
    description: 'Field name for how many copies of a card an action applies to.',
    maxLen: 16,
  },
  'ui.count.cards': {
    description:
      'A number of cards, on its own — rendered inside a longer sentence or as a standalone counter. {count} is a whole number.',
  },
  'ui.count.changes': {
    description:
      'A number of pending or applied edits to a list. {count} is a whole number. "Change" here is one edit (an add, a removal, a set-finish), not a modification in general.',
  },
  'ui.count.lists': {
    description:
      'A number of lists (decks, collections and wanted lists together). {count} is a whole number.',
  },
  'ui.selection.confirmRemoveAll': {
    description:
      'Confirmation asked before deleting every selected card from the lists holding it. {count} counts copies, not distinct cards.',
  },
  'ui.editor.discardTitle': {
    description:
      'Title of the dialog confirming that the pending edits will be thrown away. {count} is how many edits are lost.',
  },
  'ui.editor.importLoaded': {
    description:
      'Result of importing a change bundle into the editor: the changes are pending, not yet saved. {count} is how many were loaded.',
  },
  'ui.editor.importConflicts': {
    description:
      'Warning after importing a change bundle: these edits could not be applied — the card is missing, the action does not apply to this kind of list, or it would set a finish on a card with no printing. Ends in a colon because the skipped edits are listed underneath, each with its own reason.',
  },
  'ui.editor.importConflictItem': {
    description:
      'One skipped change in the import dialog: {change} is the rendered change line, {reason} one of the domain.importConflict.* phrases saying why it was skipped.',
  },
  'ui.editor.droppedNotes': {
    description:
      'Reported after a save merged a card into an existing line and its note could not be kept. {items} is a comma-separated list of card names with their dropped notes.',
  },
  'ui.editor.loading': {
    description:
      'Placeholder shown while an editor fetches the list it is about to edit. {listType} is deck, collection or wanted.',
  },
  'ui.editor.loadFailed': {
    description:
      'Error shown when the list an editor was opening could not be fetched. {listType} is deck, collection or wanted.',
  },
  'ui.editor.loadListFailed': {
    description:
      'Error shown when the *index* of lists to choose between could not be fetched, so the editor has nothing to offer in its picker. {listType} is deck, collection or wanted.',
  },
  'ui.editor.selectorLabel': {
    description:
      'Label of the dropdown that picks which list to edit (admin editors only). {listType} is deck, collection or wanted.',
    maxLen: 24,
  },
  'ui.editor.selectorPlaceholder': {
    description:
      'Empty-selection row of the dropdown that picks which list to edit. {listType} is deck, collection or wanted.',
    maxLen: 28,
  },
  'ui.editor.saveSuccess': {
    description: 'Confirmation banner after the editor successfully wrote its edits to disk.',
  },
  'ui.editor.saveSuccessDroppedNotes': {
    description:
      'Save confirmation when the save also had to drop a card note. {notes} is the already-rendered `ui.editor.droppedNotes` sentence and arrives with a leading space.',
  },
  'ui.editor.saveConflict': {
    description:
      'Error shown when the file changed on disk since the editor loaded it, so saving would overwrite someone else\'s edit. "Reload" means reopening the list, losing nothing already saved.',
  },
  'ui.editor.saveFailed': {
    description: 'Fallback error when the server refused a save without saying why.',
  },
  'ui.editor.saveRequestFailed': {
    description: 'Error when the save request never reached the server (offline, dropped network).',
  },
  'ui.editor.addCard': {
    description:
      'The editor action bar\'s primary button. The leading "+" is part of the label, not an icon.',
    maxLen: 20,
  },
  'ui.editor.addCardTitle': {
    description: 'Hover tooltip on the Add Card button, naming its keyboard shortcut.',
  },
  'ui.editor.addCardDefaults': {
    description:
      'Action bar button expanding the panel that pre-answers set / finish / condition for the cards added next.',
    maxLen: 24,
  },
  'ui.editor.defaultsActive': {
    description:
      'Screen-reader name of the dot marking that at least one add-card default is currently set.',
  },
  'ui.editor.sections': {
    description:
      'Action bar button opening the section manager. Sections are the named groups a list is split into.',
    maxLen: 16,
  },
  'ui.editor.labels': {
    description:
      'Action bar button opening the collection\'s default card labels ("for sale", "for trade", …).',
    maxLen: 16,
  },
  'ui.editor.import': {
    description:
      'Action bar button opening the dialog that loads an exported change file. The ellipsis marks that a dialog follows.',
    maxLen: 16,
  },
  'ui.editor.swapPrintings': {
    description:
      'Action-bar button (admin editor) opening the batch Swap Printings wizard for the whole list. The ellipsis marks that a dialog follows.',
    maxLen: 20,
  },
  'ui.editor.changes': {
    description:
      'Action bar button listing the edits made but not yet saved. Carries a count badge.',
    maxLen: 16,
  },
  'ui.editor.undo': {
    description: 'Action bar button reverting the most recent edit.',
    maxLen: 12,
  },
  'ui.editor.saving': {
    description: "The Save button's label while the save request is in flight.",
    maxLen: 20,
  },
  'ui.editor.saveChanges': {
    description: 'Action bar button writing the pending edits to disk.',
    maxLen: 20,
  },
  'ui.editor.discardChanges': {
    description: 'Action bar button throwing the pending edits away (asks for confirmation first).',
    maxLen: 24,
  },
  'ui.editor.shortcutsTitle': {
    description: 'Hover tooltip on the "?" button that opens the keyboard shortcuts reference.',
  },
  'ui.editor.shortcutsLabel': {
    description:
      'Screen-reader name of the "?" button that opens the keyboard shortcuts reference.',
  },
  'ui.editor.manageSections': {
    description: "Title of the dialog for adding, renaming and deleting a list's sections.",
  },
  'ui.editor.sectionsHelp': {
    description:
      'Explanation at the top of the section manager. "case-insensitive" means two names differing only in capitalisation count as the same name.',
  },
  'ui.editor.newSectionName': {
    description:
      'Both the placeholder of the new-section input and the field label of the new-section prompt.',
  },
  'ui.editor.addSection': {
    description: 'Button committing the typed name as a new section.',
    maxLen: 20,
  },
  'ui.editor.sectionExists': {
    description:
      'Validation error when the typed section name is already taken. {name} is the existing section, in its own capitalisation.',
  },
  'ui.editor.sectionNameRequired': {
    description: 'Validation error when the section-name field is left empty.',
  },
  'ui.editor.sectionName': {
    description: 'Field label of the rename-section prompt.',
  },
  'ui.editor.rename': {
    description: "Both the per-section rename button and the rename prompt's confirm button.",
    maxLen: 12,
  },
  'ui.editor.delete': {
    description: 'Per-section delete button in the section manager.',
    maxLen: 12,
  },
  'ui.editor.deleteSectionDisabled': {
    description:
      "Hover tooltip explaining why a section's Delete button is dead: it still holds cards.",
  },
  'ui.editor.moveToNewSection': {
    description:
      'Title of the prompt asking for a name for a section that is created by moving cards into it.',
  },
  'ui.editor.move': {
    description: 'Confirm button of the move-to-new-section prompt.',
    maxLen: 12,
  },
  'ui.editor.renameSection': { description: 'Title of the rename-a-section prompt.' },
  'ui.editor.defaultsSets': {
    description:
      'Field label for the Magic set codes (e.g. FDN) that narrow the printing picker while adding cards.',
    maxLen: 16,
  },
  'ui.editor.defaultsSetsPlaceholder': {
    description:
      'Example text inside the set-codes input. The codes themselves are never translated.',
  },
  'ui.editor.defaultsSetsHint': {
    description:
      'Explanation under the set-codes input: when the filter matches no printing the picker shows every printing instead.',
  },
  'ui.editor.defaultsAskEachTime': {
    description:
      'The "no default" option of the finish and condition radio groups — the dialog will keep asking per card.',
    maxLen: 20,
  },
  'ui.editor.defaultsClear': {
    description: 'Button resetting every add-card default back to unset.',
    maxLen: 16,
  },
  'ui.editor.finishNonfoil': {
    description: 'The plain, non-shiny printing of a card.',
    maxLen: 12,
  },
  'ui.editor.finishFoil': { description: 'The shiny printing of a card.', maxLen: 12 },
  'ui.editor.finishEtched': {
    description: 'The etched-foil printing of a card — a distinct treatment from ordinary foil.',
    maxLen: 12,
  },
  'ui.editor.changePrintingTitle': {
    description:
      'Title of the dialog that re-points a card at a different printing (a different set / collector number).',
  },
  'ui.editor.setPrintingTitle': {
    description:
      'Title of that same dialog when the card pins no printing yet, so one is being chosen for the first time rather than changed.',
  },
  'ui.editor.changePrintingPrompt': {
    description:
      "Asks how many of a stack's copies get the new printing. {total} is how many copies exist, {name} is the card name.",
  },
  'ui.editor.setLanguageTitle': {
    description:
      'Title of the picker choosing which printed language a card is held in — the card itself, not the interface.',
  },
  'ui.editor.languageCurrent': {
    description:
      "A language row in that picker, marked with a check because it is the card's current language. {name} is the language name.",
  },
  'ui.editor.pendingChanges': {
    description: 'Screen-reader name of the dialog listing the edits made but not yet saved.',
  },
  'ui.editor.pendingChangesTitle': {
    description:
      'Heading of that dialog. {count} is how many edits are pending; it is shown in parentheses rather than as prose.',
  },
  'ui.editor.noPendingChanges': {
    description: 'Empty state of the pending-changes dialog when nothing has been edited yet.',
  },
  'ui.editor.discardMessage': {
    description:
      'Sentence above the list of edits about to be thrown away. Ends in a colon because the edits follow.',
  },
  'ui.editor.discardConfirm': {
    description: 'The destructive button of the discard-changes dialog.',
    maxLen: 20,
  },
  'ui.editor.importTitle': { description: 'Title of the load-a-change-file dialog.' },
  'ui.editor.importPrompt': {
    description:
      'Instruction in that dialog: a change list is the JSON file another Ritual surface exported.',
  },
  'ui.editor.importPastePlaceholder': {
    description:
      'Placeholder of the textarea that accepts pasted JSON, as the alternative to picking a file.',
  },
  'ui.editor.importAction': {
    description: 'Button that applies the pasted or uploaded change file.',
    maxLen: 16,
  },
  'ui.editor.importWrongKind': {
    description:
      "Rejection when the change file targets other kinds of list than the one open. {listType} is the open list's kind; {kinds} is a comma-separated list of the kinds the file does target.",
  },
  'ui.editor.importAmbiguous': {
    description:
      'Rejection when the change file targets several lists of the right kind but none is the open one. {count} is how many it targets; {command} is the literal CLI command and is never translated.',
  },
  'ui.cardMenu.options': {
    description: 'Screen-reader name of the menu opened on a card tile. {name} is the card name.',
  },
  'ui.cardMenu.setFoil': {
    description: 'Menu row switching the card to its foil (shiny) printing.',
    maxLen: 24,
  },
  'ui.cardMenu.setNonfoil': {
    description: 'Menu row switching the card back to its plain, non-foil printing.',
    maxLen: 24,
  },
  'ui.cardMenu.foilNeedsPrinting': {
    description:
      'Tooltip on the disabled "set as foil" row, in both the single-card menu and the bulk selection menu, explaining that a card with no specific printing has no finish to set until one is chosen.',
  },
  'ui.cardMenu.finishUnavailable': {
    description:
      'Tooltip on the disabled foil row when the card pins a printing that simply is not sold in that finish — a different reason from the one above.',
  },
  'ui.cardMenu.changePrinting': {
    description:
      'Menu row opening the printing picker for this card. The ellipsis marks that a dialog follows.',
    maxLen: 24,
  },
  'ui.cardMenu.setPrinting': {
    description:
      'Menu row opening the printing picker for a card whose line pins no printing yet, so there is nothing to change — it is being set for the first time. The ellipsis marks that a dialog follows.',
    maxLen: 24,
  },
  'ui.cardMenu.setLabel': {
    description:
      'Menu row opening the label picker ("for sale", "for trade", "to keep"). Collections only.',
    maxLen: 24,
  },
  'ui.cardMenu.setCustomArt': {
    description:
      'Menu row opening the dialog that replaces this card’s printing image with a local file or an image URL. Admin editors only.',
    maxLen: 24,
  },
  'ui.cardMenu.setLanguage': {
    description: 'Menu row opening the picker for the language the physical card is printed in.',
    maxLen: 24,
  },
  'ui.cardMenu.setCommander': {
    description: "Menu row making this card the deck's commander (a Commander-format deck role).",
    maxLen: 24,
  },
  'ui.cardMenu.unsetCommander': {
    description: 'Menu row removing the commander role from this card.',
    maxLen: 24,
  },
  'ui.cardMenu.moveToSection': {
    description: 'Menu row moving the card to another named group within the same list.',
    maxLen: 24,
  },
  'ui.cardMenu.moveToList': {
    description: 'Menu row moving the card out of this list and into another one.',
    maxLen: 24,
  },
  'ui.cardMenu.swapPrinting': {
    description:
      'Card menu item opening the Swap Printings wizard for this one card, jumping straight to its printing picker.',
  },
  'ui.cardMenu.findInLists': {
    description: 'Menu row searching every list for other copies and printings of this card.',
    maxLen: 24,
  },
  'ui.addCard.title': {
    description: 'Screen-reader name of the multi-step dialog that adds a card to a list.',
  },
  'ui.addCard.searchPlaceholder': {
    description: "Placeholder of the card-name search box on the dialog's first step.",
  },
  'ui.addCard.back': {
    description:
      "Button returning to the dialog's previous step. The leading arrow is part of the label.",
    maxLen: 16,
  },
  'ui.addCard.selectPrinting': {
    description:
      'Heading of the printing-picker step. {name} is the card name. A printing is one particular set + collector number.',
  },
  'ui.addCard.loadingPrintings': {
    description: "Placeholder while the card's printings are being fetched.",
  },
  'ui.printingFilter.placeholder': {
    description:
      'Placeholder of the box narrowing a printing picker by set code and/or collector number — typing anywhere in the dialog also feeds it. Shared by the add-card grid and the trade picker. The example query must stay as it is.',
  },
  'ui.printingFilter.noMatches': {
    description: 'Shown when the typed set/collector-number query matches none of the printings.',
  },
  'ui.addCard.setFilterFellBack': {
    description:
      'Notice that the set-code default matched nothing so every printing is offered instead. {sets} is a comma-separated list of uppercase set codes and is never translated.',
  },
  'ui.addCard.noSpecificPrinting': {
    description:
      'The tile that adds the card without pinning it to a set or collector number — a deliberate choice, not an error.',
  },
  'ui.addCard.prevPage': {
    description:
      'Button paging back through the printing grid. The leading arrow is part of the label.',
    maxLen: 12,
  },
  'ui.addCard.nextPage': {
    description:
      'Button paging forward through the printing grid. The trailing arrow is part of the label.',
    maxLen: 12,
  },
  'ui.addCard.pageOf': {
    description: 'Position within the paged printing grid. {page} and {total} are whole numbers.',
  },
  'ui.addCard.printingHeading': {
    description:
      'Heading naming the printing under discussion. {name} is the card name; {set} and {number} are the set code and collector number, never translated.',
  },
  'ui.addCard.languageOnly': {
    description:
      'Notice that this printing exists in only these printed languages. {languages} is an already-joined list of language names.',
  },
  'ui.addCard.languageUnavailable': {
    description:
      'Notice that the preferred card language is unavailable for this printing, naming what will be recorded instead. {preferred} is the configured card language, {languages} the available ones, {language} the one that will be stamped.',
  },
  'ui.addCard.finishConditionHeading': {
    description:
      'Heading of the last step, where finish and condition are confirmed. {name} is the card name; {set} and {number} identify the printing and are never translated.',
  },
  'ui.addCard.quantityToAdd': {
    description: 'Screen-reader name of the ticker choosing how many copies to add.',
  },
  'ui.addCard.add': {
    description: 'Button committing the card and closing the dialog.',
    maxLen: 20,
  },
  'ui.addCard.update': {
    description:
      'Button committing the change and closing the dialog, in the change-printing flow where the card already exists in the list and only its printing is being re-targeted.',
    maxLen: 20,
  },
  'ui.addCard.addAnother': {
    description: 'Button committing the card and restarting the dialog for the next one.',
    maxLen: 24,
  },
  'ui.addCard.sourceNote': {
    description:
      'Attribution under the card-search box on the public site, where searches go straight to Scryfall instead of the local cache the admin editor uses. {link} is rendered as a hyperlink and may sit anywhere in the sentence.',
  },
  'ui.addCard.scryfallApi': {
    description:
      'The link text inside that attribution. "Scryfall" is a product name and is never translated; "API" may be if the local convention differs.',
  },
  'ui.addCard.optionsHeading': {
    description:
      'Heading of the optional per-card settings in the add-card dialog: the label the new card starts under, and its custom art.',
    maxLen: 24,
  },
  'ui.addCard.labelField': {
    description:
      'Label of the dropdown choosing the new card’s label override (Proxy, Keep, For Sale…), or the list’s default when nothing is picked.',
    maxLen: 16,
  },
  'ui.addCard.artField': {
    description:
      'Label of the text field holding the new card’s custom art: a path inside the configured art directory, or an image URL.',
    maxLen: 20,
  },
  'ui.addCard.artPlaceholder': {
    description:
      'Placeholder showing both accepted forms of a custom-art reference. The example path and URL are sample data and are not translated.',
  },
  'ui.addCard.artInvalid': {
    description:
      'Shown under the custom-art field when the typed reference cannot be used. {reason} is the parser’s own sentence, which is English engine prose.',
  },
  'ui.addCard.artPendingNote': {
    description:
      'Note under the custom-art field explaining that, unlike the printing itself, the art reaches the list only when the pending changes are saved.',
  },
  'ui.hint.navigate': {
    description: 'Footer key hint: the arrow keys walk the result list.',
    maxLen: 12,
  },
  'ui.hint.select': {
    description: 'Footer key hint: Enter takes the highlighted row.',
    maxLen: 12,
  },
  'ui.hint.close': { description: 'Footer key hint: Escape closes the dialog.', maxLen: 12 },
  'ui.hint.continue': {
    description: 'Footer key hint: Enter accepts the notice and moves on.',
    maxLen: 12,
  },
  'ui.hint.printing': {
    description: 'Footer key hint: ←/→ step one printing at a time.',
    maxLen: 12,
  },
  'ui.hint.row': {
    description: 'Footer key hint: ↑/↓ step a whole row of the printing grid.',
    maxLen: 12,
  },
  'ui.hint.filterPrintings': {
    description:
      'Footer key hint: typing letters or digits filters the printing grid by set code / collector number.',
    maxLen: 12,
  },
  'ui.hint.choose': {
    description: 'Footer key hint: ←/→ pick a value inside the focused radio group.',
    maxLen: 12,
  },
  'ui.hint.nextGroup': {
    description: 'Footer key hint: ↑/↓ move to the next group of options.',
    maxLen: 14,
  },
  'ui.hint.quantity': {
    description: 'Footer key hint: +/− adjust how many copies will be added.',
    maxLen: 12,
  },
  'ui.hint.addCard': { description: 'Footer key hint: Enter adds the card.', maxLen: 14 },
  'ui.hint.updateCard': {
    description:
      'Footer key hint: Enter commits the change, in the change-printing flow where the card already exists and only its printing is being re-targeted.',
    maxLen: 14,
  },
  'ui.hint.addAnother': {
    description: 'Footer key hint: Ctrl+Enter adds the card and starts another.',
    maxLen: 16,
  },
  'ui.swap.title': {
    description:
      'Heading of the Swap Printings wizard, a multi-step dialog that re-picks printings for cards using copies owned in other lists.',
    maxLen: 24,
  },
  'ui.swap.aria': { description: 'Screen-reader name of the Swap Printings wizard dialog.' },
  'ui.swap.back': { description: 'Button returning to the previous wizard step.', maxLen: 12 },
  'ui.swap.next': { description: 'Button advancing to the next wizard step.', maxLen: 12 },
  'ui.swap.apply': {
    description:
      'Final button of the wizard: writes the planned moves into the editor (nothing is saved to disk yet).',
    maxLen: 12,
  },
  'ui.swap.discard': {
    description: 'Final button of the wizard that closes it without applying anything.',
    maxLen: 12,
  },
  'ui.swap.step.cards': {
    description: 'Step indicator label: choosing which cards to swap.',
    maxLen: 12,
  },
  'ui.swap.step.sources': {
    description: 'Step indicator label: choosing which other lists may supply printings.',
    maxLen: 12,
  },
  'ui.swap.step.mode': {
    description:
      'Step indicator label: choosing how replacements are picked (manually or by price).',
    maxLen: 12,
  },
  'ui.swap.step.pick': {
    description: 'Step indicator label: the per-card printing picker.',
    maxLen: 12,
  },
  'ui.swap.step.review': {
    description: 'Step indicator label: reviewing what the automatic mode chose.',
    maxLen: 12,
  },
  'ui.swap.step.summary': {
    description: 'Step indicator label: the final summary of planned moves.',
    maxLen: 12,
  },
  'ui.swap.copies': {
    description: 'A number of physical copies of one card. {count} is a whole number.',
  },
  'ui.swap.quantity': {
    description: 'Compact quantity marker beside a card, like "×4". {count} is a whole number.',
    maxLen: 8,
  },
  'ui.swap.noPrice': {
    description:
      'Stand-in shown where a price would go when no market value is known. Keep it a short dash-like placeholder.',
    maxLen: 4,
  },
  'ui.swap.cards.heading': { description: 'Heading of the Cards step.' },
  'ui.swap.cards.selectAll': { description: 'Button checking every eligible card.', maxLen: 16 },
  'ui.swap.cards.selectNone': { description: 'Button unchecking every card.', maxLen: 16 },
  'ui.swap.cards.selected': {
    description:
      'Counter under the card list: how many cards are checked out of how many are eligible. Both are whole numbers.',
    maxLen: 32,
  },
  'ui.swap.cards.noPrintingSet': {
    description:
      'Note on a greyed-out card row that cannot be chosen because its line names no specific printing.',
    maxLen: 20,
  },
  'ui.swap.cards.none': {
    description: 'Empty state of the Cards step when no line of the list names a printing.',
  },
  'ui.swap.sources.heading': { description: 'Heading of the Sources step.' },
  'ui.swap.sources.label': {
    description: 'Caption in front of the list-scope control on the Sources step.',
    maxLen: 24,
  },
  'ui.swap.sources.note': {
    description:
      'Explanation under the Sources step: wanted lists start unchecked because their entries are not physical cards.',
  },
  'ui.swap.sources.none': {
    description: 'Empty state of the Sources step when the user has no other list at all.',
  },
  'ui.swap.sources.selectedCount': {
    description: 'Counter of how many lists are currently in scope. {count} is a whole number.',
  },
  'ui.swap.sources.loading': {
    description: 'Status text while the contents of the chosen source lists are being fetched.',
  },
  'ui.swap.sources.loadFailed': {
    description: 'Error text when fetching the chosen source lists failed.',
  },
  'ui.swap.sources.someFailed': {
    description:
      'Warning shown once the source lists loaded but some could not be read: those lists\u2019 copies are left out of the candidates. {count} is the number of unreadable lists.',
  },
  'ui.swap.mode.heading': { description: 'Heading of the Mode step.' },
  'ui.swap.mode.manual': {
    description: 'Mode radio: the user picks a printing per card by hand.',
    maxLen: 16,
  },
  'ui.swap.mode.manualHint': { description: 'One-line explanation under the Manual mode radio.' },
  'ui.swap.mode.mostExpensive': {
    description: 'Mode radio: automatically prefer the highest-priced owned copies.',
    maxLen: 20,
  },
  'ui.swap.mode.mostExpensiveHint': {
    description: 'One-line explanation under the Most expensive mode radio.',
  },
  'ui.swap.mode.leastExpensive': {
    description: 'Mode radio: automatically prefer the lowest-priced owned copies.',
    maxLen: 20,
  },
  'ui.swap.mode.leastExpensiveHint': {
    description: 'One-line explanation under the Least expensive mode radio.',
  },
  'ui.swap.unpriced.label': {
    description:
      'Label of the three-way control deciding what an automatic mode does with a card that has a candidate (or current printing) with no known price.',
  },
  'ui.swap.unpriced.skip': {
    description: 'Unpriced policy radio: leave such a card unchanged.',
    maxLen: 12,
  },
  'ui.swap.unpriced.skipHint': { description: 'One-line explanation of the Skip policy.' },
  'ui.swap.unpriced.ignore': {
    description: 'Unpriced policy radio: rank only the options that have a price.',
    maxLen: 12,
  },
  'ui.swap.unpriced.ignoreHint': { description: 'One-line explanation of the Ignore policy.' },
  'ui.swap.unpriced.force': {
    description: 'Unpriced policy radio: hand such a card to the manual picker.',
    maxLen: 12,
  },
  'ui.swap.unpriced.forceHint': { description: 'One-line explanation of the Ask-me policy.' },
  'ui.swap.unpriced.note': {
    description:
      'Reassurance under the unpriced control: a missing price is missing data, not a zero value.',
  },
  'ui.swap.finish.label': {
    description:
      'Label of the finish filter (any / foil / nonfoil) restricting which owned copies are offered.',
    maxLen: 16,
  },
  'ui.swap.finish.any': { description: 'Finish filter option: no restriction.', maxLen: 10 },
  'ui.swap.finish.foil': {
    description: 'Finish filter option: foil treatments only (foil or etched).',
    maxLen: 10,
  },
  'ui.swap.finish.nonfoil': { description: 'Finish filter option: plain copies only.', maxLen: 10 },
  'ui.swap.displaced.label': {
    description: 'Label of the control deciding where the copies being replaced go.',
    maxLen: 20,
  },
  'ui.swap.displaced.swap': {
    description:
      'Displaced-copies radio: each replaced copy goes back to the list its replacement came from.',
  },
  'ui.swap.displaced.swapHint': { description: 'One-line explanation of the swap policy.' },
  'ui.swap.displaced.override': {
    description:
      'Displaced-copies radio: every replaced copy goes to one chosen list (a select follows).',
  },
  'ui.swap.displaced.choose': {
    description: 'Placeholder option of the destination-list select.',
    maxLen: 16,
  },
  'ui.swap.pick.heading': {
    description: 'Heading of the per-card picker. {name} is the card name.',
  },
  'ui.swap.pick.progress': {
    description: 'Position counter in the picker, e.g. "2 of 5". Both are whole numbers.',
    maxLen: 24,
  },
  'ui.swap.pick.prev': {
    description: 'Button moving to the previous card in the picker.',
    maxLen: 16,
  },
  'ui.swap.pick.next': { description: 'Button moving to the next card in the picker.', maxLen: 16 },
  'ui.swap.pick.keep': {
    description:
      "Label of the picker row standing for the card's current printing (copies not reassigned stay as they are).",
    maxLen: 16,
  },
  'ui.swap.pick.assigned': {
    description:
      "Footer of the picker: how many of the card's copies have been given a new printing. Both are whole numbers.",
  },
  'ui.swap.pick.available': {
    description: 'How many copies a candidate row can supply. {count} is a whole number.',
    maxLen: 24,
  },
  'ui.swap.pick.take': {
    description: 'Screen-reader name of the number input on a candidate row.',
  },
  'ui.swap.pick.noCandidates': {
    description:
      'Empty state of the picker when the chosen source lists hold no other copy of the card.',
  },
  'ui.swap.pick.printingless': {
    description:
      'Printing label of a candidate row that stands for name-only entries (no set/collector number yet).',
    maxLen: 20,
  },
  'ui.swap.pick.printinglessPrompt': {
    description:
      'Question shown when the user clicks a printing-less candidate row: it lists the name-only entries and asks the user to pick one.',
  },
  'ui.swap.pick.printinglessHint': {
    description:
      'Explanation under the printing-less prompt: picking one opens the full printing chooser and removes the entry from its list when applied.',
  },
  'ui.swap.pick.printinglessNo': {
    description: 'Button dismissing the printing-less prompt and returning to the candidate rows.',
  },
  'ui.swap.pick.choosePrinting': {
    description:
      'Heading of the full printing grid opened for a printing-less entry. {name} is the card name.',
  },
  'ui.swap.pick.chosen': {
    description:
      'Shown on a printing-less row once a printing was picked for it. {printing} is a SET:number label.',
    maxLen: 24,
  },
  'ui.swap.pick.changePrinting': {
    description:
      'Button on a printing-less row reopening the printing grid to pick a different printing.',
    maxLen: 20,
  },
  'ui.swap.pick.backToRows': {
    description: 'Button leaving the printing grid and returning to the candidate rows.',
    maxLen: 20,
  },
  'ui.swap.pick.printingsFailed': {
    description: "Error text in the printing grid when fetching the card's printings failed.",
  },
  'ui.swap.review.heading': {
    description: 'Heading of the Review step after an automatic mode ran.',
  },
  'ui.swap.review.card': { description: 'Review table column: the card name.', maxLen: 12 },
  'ui.swap.review.current': {
    description: 'Review table column: the printing the card has now.',
    maxLen: 12,
  },
  'ui.swap.review.chosen': {
    description: 'Review table column: the printing(s) chosen to replace it.',
    maxLen: 12,
  },
  'ui.swap.review.value': {
    description: 'Review table column: the price before and after the swap.',
    maxLen: 12,
  },
  'ui.swap.review.keep': {
    description:
      'Review line for copies that stay on the current printing. {count} is a whole number.',
  },
  'ui.swap.review.unchanged': {
    description: 'Review line when no copy of a card is being swapped.',
    maxLen: 16,
  },
  'ui.swap.review.change': {
    description: 'Button on a review row opening the manual picker for that card.',
    maxLen: 12,
  },
  'ui.swap.flag.noCandidates': {
    description: 'Review chip: no other copy of the card exists in the chosen lists.',
    maxLen: 20,
  },
  'ui.swap.flag.unpriced': {
    description: 'Review chip: an option with no known price took part (or was skipped).',
    maxLen: 20,
  },
  'ui.swap.flag.needsManual': {
    description: 'Review chip: the automatic mode left this card for the user to pick by hand.',
    maxLen: 24,
  },
  'ui.swap.flag.partial': {
    description: 'Review chip: only some copies could be swapped before the supply ran out.',
    maxLen: 12,
  },
  'ui.swap.flag.needsDisplaced': {
    description:
      'Review/summary chip: a replaced copy would go to a wanted list, so a real destination must be chosen.',
    maxLen: 32,
  },
  'ui.swap.summary.heading': { description: 'Heading of the final Summary step.', maxLen: 16 },
  'ui.swap.summary.noMoves': {
    description:
      'Empty state of the Summary step: no card was given a new printing, so there is nothing to apply.',
  },
  'ui.swap.summary.fallbackLabel': {
    description:
      'Label of the required select on the Summary step choosing which real list receives copies displaced by replacements taken from a wanted list.',
  },
  'ui.swap.summary.fallbackRequired': {
    description: 'Validation hint under the fallback select while it is still empty.',
  },
  'ui.swap.summary.takes': {
    description:
      "Summary group heading for copies the edited list takes from another list. {list} is that list's name.",
  },
  'ui.swap.summary.sends': {
    description:
      "Summary group heading for copies the edited list sends to another list. {list} is that list's name.",
  },
  'ui.swap.summary.moveLine': {
    description:
      'One move in the summary: a count, the card name and its SET:number printing label.',
  },
  'ui.swap.summary.valueHeading': {
    description: 'Heading of the price-totals block on the Summary step.',
    maxLen: 12,
  },
  'ui.swap.summary.listTotal': {
    description:
      'Total value of the edited list before and after the swap. {before}/{after} are formatted prices or the "unknown" word.',
  },
  'ui.swap.summary.cardDelta': {
    description:
      'One card\'s value before and after the swap. {before}/{after} are formatted prices or the "unknown" word.',
  },
  'ui.swap.summary.unknown': {
    description:
      'Stand-in for a price total that cannot be computed because some copy has no known price.',
    maxLen: 12,
  },
  'ui.shortcuts.title': { description: 'Title of the keyboard shortcuts reference dialog.' },
  'ui.shortcuts.macNote': {
    description:
      'Footnote of that dialog: on macOS the Command key stands in wherever Control is listed. "Cmd" and "Ctrl" are key names as printed on the keyboard.',
  },
  'ui.shortcuts.groupEditor': {
    description: 'Shortcut group heading: keys that work anywhere in the list editor.',
  },
  'ui.shortcuts.groupActionBar': {
    description: 'Shortcut group heading: keys that work once focus is inside the action bar.',
  },
  'ui.shortcuts.groupAddCardSearch': {
    description: "Shortcut group heading: the add-card dialog's card-search step.",
  },
  'ui.shortcuts.groupAddCardPrintings': {
    description: "Shortcut group heading: the add-card dialog's printing-grid step.",
  },
  'ui.shortcuts.groupAddCardFinish': {
    description: "Shortcut group heading: the add-card dialog's finish-and-condition step.",
  },
  'ui.shortcuts.groupAnyDialog': {
    description: 'Shortcut group heading: keys that work in every dialog.',
  },
  'ui.shortcuts.addCard': { description: 'What Ctrl+Enter does: opens the add-card dialog.' },
  'ui.shortcuts.focusActionBar': {
    description: "What Ctrl+B does: moves focus to the editor's action bar.",
  },
  'ui.shortcuts.showThisList': {
    description: 'What "?" does: opens this very shortcuts reference.',
  },
  'ui.shortcuts.moveBetweenButtons': {
    description: 'What ←/→/Tab do inside the action bar.',
  },
  'ui.shortcuts.activateButton': { description: 'What Enter does on a focused action-bar button.' },
  'ui.shortcuts.returnFocus': {
    description: 'What Escape does in the action bar: hands focus back to the card list.',
  },
  'ui.shortcuts.moveThroughResults': { description: 'What ↑/↓ do in the card-search results.' },
  'ui.shortcuts.chooseCard': { description: 'What Enter does on a highlighted search result.' },
  'ui.shortcuts.prevNextPrinting': { description: 'What ←/→ do in the printing grid.' },
  'ui.shortcuts.prevNextRow': { description: 'What ↑/↓ do in the printing grid.' },
  'ui.shortcuts.filterPrintings': {
    description:
      'Shortcuts reference: typing letters or digits anywhere in the printing step filters the grid by set code / collector number.',
  },
  'ui.shortcuts.choosePrinting': { description: 'What Enter does on a highlighted printing.' },
  'ui.shortcuts.changeGroupValue': {
    description: 'What ←/→ do inside a finish/condition radio group.',
  },
  'ui.shortcuts.nextGroup': { description: 'What ↑/↓/Tab do on the finish-and-condition step.' },
  'ui.shortcuts.adjustQuantity': {
    description: 'What +/− do: change how many copies the add will commit.',
  },
  'ui.shortcuts.addTheCard': { description: 'What Enter does on the finish-and-condition step.' },
  'ui.shortcuts.addThenAnother': {
    description: 'What Ctrl+Enter does: commits the card and reopens the dialog for another.',
  },
  'ui.shortcuts.close': { description: 'What Escape does in any dialog.' },
} as const satisfies MetaFor<typeof uiMessages>
