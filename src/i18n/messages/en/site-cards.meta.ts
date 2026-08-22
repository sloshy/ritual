/** Translator metadata for the `site-cards` fragment. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { siteCardsMessages } from './site-cards'

/**
 * The finish/rarity chips and the printing-picker buttons sit in a fixed-width
 * run beside a set code; a long word pushes the price out of the row.
 */
const CHIP_MAX_LEN = 16

export const siteCardsMeta = {
  // ── Finishes ──────────────────────────────────────────────────────────
  'site.finish.nonfoil': {
    description:
      "A card printed without a foil treatment, shown in a card's printing label. Title case.",
    maxLen: CHIP_MAX_LEN,
  },
  'site.finish.foil': {
    description: "A foil (shiny) printing of a card, shown in a card's printing label. Title case.",
    maxLen: CHIP_MAX_LEN,
  },
  'site.finish.etched': {
    description: "An etched-foil printing of a card, shown in a card's printing label. Title case.",
    maxLen: CHIP_MAX_LEN,
  },
  'site.finishChip.nonfoil': {
    description:
      'Lower-case variant of "Nonfoil" for the small per-finish buttons in the trade printing picker. Use the same word as site.finish.nonfoil if your language does not vary casing.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.finishChip.foil': {
    description:
      'Lower-case variant of "Foil" for the small per-finish buttons in the trade printing picker.',
    maxLen: CHIP_MAX_LEN,
  },
  'site.finishChip.etched': {
    description:
      'Lower-case variant of "Etched" for the small per-finish buttons in the trade printing picker.',
    maxLen: CHIP_MAX_LEN,
  },

  // ── Rarities ──────────────────────────────────────────────────────────
  'site.rarity.common': {
    description: "Scryfall rarity: the lowest rarity tier. Shown in the card modal's meta row.",
  },
  'site.rarity.uncommon': { description: 'Scryfall rarity: one tier above common.' },
  'site.rarity.rare': { description: 'Scryfall rarity: one tier above uncommon.' },
  'site.rarity.mythic': { description: 'Scryfall rarity: mythic rare, the highest ordinary tier.' },
  'site.rarity.special': {
    description: 'Scryfall rarity for cards outside the ordinary tiers (e.g. Timeshifted).',
  },
  'site.rarity.bonus': {
    description: 'Scryfall rarity for bonus-sheet cards printed outside the main set.',
  },

  // ── Card tile ─────────────────────────────────────────────────────────
  'site.card.select': {
    description: 'Accessible name of the checkbox that adds a card to the multi-select.',
  },
  'site.card.deselect': {
    description:
      'Accessible name of the same checkbox once the card is selected, so activating it removes the card.',
  },
  'site.card.backFaceAlt': {
    description:
      'Alt text for the reverse face of a double-faced card. {name} is the card name, untranslated.',
  },
  'site.card.showFront': {
    description: 'Button that turns a double-faced card back to its front face.',
  },
  'site.card.showBack': {
    description: 'Button that turns a double-faced card over to its back face.',
  },
  'site.card.addCopy': { description: 'Edit-mode button adding one more copy of this card.' },
  'site.card.removeCopy': {
    description: 'Edit-mode button removing one copy of this card (not the whole entry).',
  },
  'site.card.moreOptions': {
    description: 'Tooltip of the ⋯ button opening the per-card context menu.',
  },
  'site.card.moveTo': {
    description:
      'Button moving this card to another list. The trailing ellipsis signals that a picker opens.',
  },
  'site.card.addToTrade': {
    description: 'Tooltip of the small + button putting one copy of this card on the trade board.',
  },
  'site.card.tradeButton': {
    description:
      'Label of the same trade button in the compact list view, where there is room for a word. The leading + is decoration.',
  },
  'site.card.atMaxQuantity': {
    description:
      'Tooltip explaining why the trade button is disabled: every copy the list holds is already on the trade board.',
  },
  'site.card.buylistTitle': {
    description:
      'Tooltip on every buylist figure. The quote is per single copy and always in US dollars, whatever currency the page displays.',
  },
  'site.card.buylistOffer': {
    description:
      'The buyer\'s per-copy offer shown beside the retail price. "Buy" is what the store does, not the reader. {price} is already formatted with its currency.',
  },
  'site.card.markerProxy': {
    description:
      'Shown in place of a price on a card labeled as a proxy, which is not a real card and so is worth nothing. All-caps like a stamp; keep it short enough for a price column.',
  },
  'site.card.markerCustomArt': {
    description:
      'Shown in place of a price on a card given custom art, which is no longer the printing a price would be for. All-caps like a stamp; keep it short enough for a price column. Takes precedence over the proxy marker when a card is both.',
  },

  // ── Card modal ────────────────────────────────────────────────────────
  'site.cardModal.aria': {
    description:
      'Accessible name of the card-details dialog. {name} is the card name, untranslated.',
  },
  'site.cardModal.unknownCard': {
    description:
      'Stands in for the card name in the dialog\'s accessible name when it is not known yet — reads as "Card details: Card".',
  },
  'site.cardModal.unknownName': {
    description: 'Stands in for the card name in the other-printings heading when it is not known.',
  },
  'site.cardModal.backImageAlt': {
    description:
      'Alt text of the enlarged back face in the card dialog. {name} is the card name, untranslated.',
  },
  'site.cardModal.flip': {
    description:
      'Button turning the enlarged card over. The ⇄ glyph is part of the label; keep it beside the word.',
  },
  'site.cardModal.note': {
    description:
      "The owner's free-text note on this card entry. {note} is their own words, untranslated.",
  },
  'site.cardModal.viewOnScryfall': {
    description:
      'Link opening this card on scryfall.com in a new tab. Scryfall is a product name; the ↗ marks the external link.',
  },
  'site.cardModal.otherPrintingsHeading': {
    description:
      'Heading of the sub-view listing every other printing of this card. {name} is the card name, {count} how many printings there are.',
  },
  'site.cardModal.otherPrintingsButton': {
    description: 'Button opening that sub-view. {count} is how many other printings exist.',
  },
  'site.cardModal.findInLists': {
    description:
      'Button searching every deck, collection and wanted list for other copies of this card.',
  },
  'site.cardModal.tags': {
    description:
      "Toggle revealing the card's Scryfall tags. A caret is appended by the page, not by this string.",
  },
  'site.cardModal.oracleTags': {
    description: "Heading for tags describing what the card's rules text does.",
  },
  'site.cardModal.artTags': {
    description: "Heading for tags describing what the card's artwork depicts.",
  },
  'site.cardModal.noTagData': {
    description:
      'Shown when the tag panel is opened for a card the local Scryfall cache has no tag data for, with the remedy.',
  },
  'site.cardModal.addToTrade': {
    description:
      'Button putting this card on the trade board, from the card dialog. The leading + is decoration.',
  },
  'site.cardModal.back': {
    description:
      'Button leaving the other-printings sub-view for the card details. The ← is part of the label.',
  },
  'site.cardModal.sortReleaseDate': {
    description: 'Sort option ordering the other printings by the date their set was released.',
  },
  'site.cardModal.sortSetName': {
    description: 'Sort option ordering the other printings alphabetically by set name.',
  },
  'site.cardModal.sortPrice': {
    description: 'Sort option ordering the other printings by price.',
  },
  'site.cardModal.sortReversed': {
    description: 'Tooltip of the sort-direction button while the order is reversed.',
  },
  'site.cardModal.sortNormal': {
    description: 'Tooltip of the sort-direction button while the order is the default one.',
  },

  // ── Pagination ────────────────────────────────────────────────────────
  'site.pagination.prev': {
    description: 'Button showing the previous page of results. The ← is part of the label.',
  },
  'site.pagination.next': {
    description: 'Button showing the next page of results. The → is part of the label.',
  },
  'site.pagination.pageOf': {
    description:
      'Position within a paged list. {page} is the current page number, {total} how many pages there are.',
  },

  // ── Changelog modal ───────────────────────────────────────────────────
  'site.changelog.title': {
    description: 'Title of the dialog listing every recorded edit to this list, newest first.',
  },
  'site.changelog.newer': {
    description: 'Button stepping to a more recent batch of changes. The ← is part of the label.',
  },
  'site.changelog.older': {
    description: 'Button stepping to an older batch of changes. The → is part of the label.',
  },

  // ── Combine-with-list modal ───────────────────────────────────────────
  'site.combine.title': {
    description:
      'Title of the dialog that merges other lists into the current view so their cards are shown together.',
  },
  'site.combine.combiningWith': {
    description:
      "Names the list already in view, which is always part of the combination. {name} is that list's own name and is rendered in bold — place it anywhere in the sentence.",
  },
  'site.combine.allLists': { description: 'Checkbox including every list in the combination.' },
  'site.combine.allSelected': {
    description: 'Replaces the selected-count line while the "All lists" checkbox is ticked.',
  },
  'site.combine.sortLabel': {
    description: 'Label of the control choosing how the selectable lists are ordered.',
  },
  'site.combine.sortName': { description: 'Sort option ordering the lists by name.' },
  'site.combine.sortCount': {
    description: 'Sort option ordering the lists by how many cards they hold.',
  },
  'site.combine.sortType': {
    description: 'Sort option grouping the lists by kind (decks, then collections, then wanted).',
  },
  'site.combine.empty': {
    description: 'Shown when the only list that exists is the one already in view.',
  },
  'site.combine.view': {
    description: 'Button confirming the choice and opening the combined view.',
  },

  // ── Find-other-printings modal ────────────────────────────────────────
  'site.findPrintings.aria': {
    description:
      'Accessible name of the dialog listing every copy of one card across every list. {name} is the card name, untranslated.',
  },
  'site.findPrintings.unknownCard': {
    description:
      'Stands in for the card name in that accessible name before a card has been chosen.',
  },
  'site.findPrintings.title': {
    description: 'Heading of the same dialog, shown above the card name.',
  },
  'site.findPrintings.searching': {
    description: 'Status shown while every list is being loaded to search it.',
  },
  'site.findPrintings.viewBinder': {
    description: 'View option showing the found copies as card images in a grid.',
  },
  'site.findPrintings.viewList': {
    description: 'View option showing the found copies as compact text rows.',
  },
  'site.findPrintings.empty': {
    description: 'Result when no list holds a copy of the card.',
  },
  'site.findPrintings.currentList': {
    description:
      'Marks the group belonging to the list the reader is already viewing; the list name follows it. The dash is a separator between this marker and that name.',
  },

  // ── Selection menu and selection modal ────────────────────────────────
  'site.selection.defaultLabel': {
    description:
      'Default label of the button opening the bulk-action menu; the number of selected copies is appended in parentheses.',
  },
  'site.selection.clear': { description: 'Action emptying the selection on this page.' },
  'site.selection.actionsAria': {
    description: 'Accessible name of the menu of bulk actions over the selected cards.',
  },
  'site.selection.actions': {
    description:
      'Label of the button opening that menu from the fixed bottom bar on touch devices. Space is tight.',
    maxLen: 12,
  },
  'site.selection.dockCount': {
    description:
      'How many copies are selected, shown in the fixed bottom bar on touch devices. {count} is a whole number.',
  },
  'site.selection.viewAll': {
    description:
      'Opens a dialog listing every selected card. The trailing ellipsis signals that a dialog opens.',
  },
  'site.selection.addCopy': { description: 'Bulk action adding one copy of every selected card.' },
  'site.selection.removeCopy': {
    description:
      'Bulk action removing one copy of every selected card, leaving the entries in place.',
  },
  'site.selection.removeFromList': {
    description: 'Bulk action deleting every selected card from the list entirely.',
  },
  'site.selection.setFoil': { description: 'Bulk action marking every selected card as foil.' },
  'site.selection.setNonfoil': {
    description: 'Bulk action marking every selected card as not foil.',
  },
  'site.selection.setLanguage': {
    description:
      'Bulk action choosing which printed language every selected card is recorded in — the card language, not the interface language.',
  },
  'site.selection.changePrinting': {
    description:
      'Bulk action choosing which printing (set and collector number) the cards refer to.',
  },
  'site.selection.swapPrintings': {
    description:
      'Bulk action opening the Swap Printings wizard for the selected cards: re-pick their printings from copies owned in other lists.',
  },
  'site.selection.setCommander': {
    description: 'Bulk action making the selected cards the deck commander. Decks only.',
  },
  'site.selection.setLabel': {
    description:
      'Bulk action setting the for-sale / for-trade / to-keep label on the selected cards. Collections only.',
  },
  'site.selection.moveToSection': {
    description: 'Bulk action moving the selected cards into another section of the same list.',
  },
  'site.selection.moveToList': {
    description: 'Bulk action moving the selected cards out of this list into another one.',
  },
  'site.selection.copyText': {
    description: 'Copies the selection to the clipboard as plain decklist text.',
  },
  'site.selection.copyCsv': { description: 'Copies the selection to the clipboard as CSV.' },
  'site.selection.copyCart': {
    description:
      "Copies the selection as a CSV in one buyer's shopping-cart format. {buyer} is a store name (e.g. Card Kingdom).",
  },
  'site.selection.moveAllToList': {
    description:
      'Moves every selected card — which may come from several different lists — into one destination list.',
  },
  'site.selection.removeAll': {
    description: 'Deletes every selected card from whichever list it came from. Destructive.',
  },
  'site.selection.clearAll': {
    description: 'Empties the selection across every list, not just the page in view.',
  },
  'site.selection.modalAria': {
    description: 'Accessible name of the dialog listing every selected card.',
  },
  'site.selection.modalTitle': {
    description: 'Heading of that dialog. {count} is how many copies are selected.',
  },
  'site.selection.sell': {
    description:
      'Introduces what the selection is worth if sold to the chosen buyer, beside its retail value. Lower case: it sits mid-line after a separator.',
  },
  'site.selection.group': {
    description: 'Label of the control choosing how the selected cards are grouped.',
  },
  'site.selection.groupOrder': {
    description: 'Grouping option leaving the cards in the order they were selected.',
  },
  'site.selection.groupSource': {
    description: 'Grouping option gathering the cards under the list each came from.',
  },
  'site.selection.removeCard': {
    description:
      'Accessible name of the button dropping one card from the selection. {name} is the card name, untranslated.',
  },
  'site.selection.removeFromSelection': {
    description:
      'Tooltip of that same button. It removes the card from the selection only — the list is not touched.',
  },
  'site.selection.sourceDeck': {
    description: 'Names a deck as the list a selected card came from. Singular, compact.',
    maxLen: 14,
  },
  'site.selection.sourceCollection': {
    description: 'Names a collection as the list a selected card came from. Singular, compact.',
    maxLen: 14,
  },
  'site.selection.sourceWanted': {
    description: 'Names a wanted list as the list a selected card came from. Singular, compact.',
    maxLen: 14,
  },

  // ── Trade actions ─────────────────────────────────────────────────────
  'site.trade.addAction': {
    description:
      'Puts the chosen cards on the trade board — the scratch space for planning a trade with another player.',
  },

  // ── Cover card ────────────────────────────────────────────────────────
  'site.cover.noImage': {
    description: "Placeholder on a list's hero tile when no card art could be resolved for it.",
  },
  'site.cover.lowPrice': {
    description:
      'The cheapest printing total, shown beside the ordinary total on a hero tile. {price} is already formatted with its currency; keep the wording very short.',
    maxLen: 12,
  },

  // ── Trade printing picker ─────────────────────────────────────────────
  'site.tradePicker.aria': {
    description:
      'Accessible name of the dialog choosing which printing of a card goes on the trade board. {name} is the card name, untranslated.',
  },
  'site.tradePicker.title': { description: 'Heading of that same dialog.' },
  'site.tradePicker.wantedTag': {
    description:
      'Badge on a printing that some wanted list asks for specifically, so it is floated to the top.',
    maxLen: 12,
  },
  'site.tradePicker.loading': { description: 'Status while the printings are being fetched.' },
  'site.tradePicker.pageInfo': {
    description:
      'Position within the paged printing list plus the total. {page} is the current page, {total} how many pages there are, {count} how many printings matched.',
  },
  'site.printingPrice.na': {
    description:
      'Stands in for a price the selected price store does not publish for this printing and finish. Shown wherever a printing is priced — the card modal’s other-printings grid and the printing pickers. Very short.',
    maxLen: 8,
  },
  'site.printingPrice.alternate': {
    description:
      'One of a printing’s other finishes, listed under its main price. {price} is the formatted amount, {finish} the lower-case finish name (foil, etched).',
    maxLen: 24,
  },
  'site.tradePicker.languageNotice': {
    description:
      'Warning before adding a printing that exists only in another printed language. {language} is that language’s name; {token} is the code recorded in the file (e.g. ja) and must not be translated.',
  },
  'site.tradePicker.continue': {
    description: 'Accepts that warning and adds the printing anyway.',
  },
  'site.tradePicker.back': {
    description: 'Rejects that warning and returns to the printing list.',
  },

  // ── Move / label pickers ──────────────────────────────────────────────
  'site.move.toListTitle': {
    description: 'Title of the picker listing the lists a card can be moved into.',
  },
  'site.move.toSectionTitle': {
    description: 'Title of the picker listing the sections of this list a card can be moved into.',
  },
  'site.move.newSection': {
    description:
      'Last row of that picker: create a section that does not exist yet. The trailing ellipsis signals that a name is asked for next.',
  },
  'site.labels.pickerTitle': {
    description:
      'Title of the picker choosing a card’s for-sale / for-trade / to-keep label. The options themselves are domain.label.*.',
  },
} as const satisfies MetaFor<typeof siteCardsMessages>
