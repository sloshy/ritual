/**
 * `site.*` — the card surfaces of the public site: the card modal, printing
 * pickers, price and quote lines, tag and filter chips, and the selection
 * menus that act on cards.
 *
 * One of four `site` fragments (see `site-chrome.ts` for why the namespace is
 * split across files).
 *
 * Two conventions worth knowing before editing:
 *
 * - **Leading/trailing arrow glyphs stay inside the message** (`← Prev`,
 *   `Next →`, `Flip ⇄`). They are directional decoration attached to the word,
 *   so a translator writing right-to-left or reordering a phrase needs to move
 *   them with it rather than have the component staple one on afterwards.
 * - **Raw domain tokens never reach the user through `capitalize()`.** A finish
 *   or rarity used to be rendered by upper-casing its Scryfall token, which left
 *   a translator with a code path and no string. Each token now has its own key
 *   here, resolved through `src/site/printing-display.ts`.
 */

import type { MessageCatalogShape } from '../../types'

export const siteCardsMessages = {
  // ── Finishes ──────────────────────────────────────────────────────────
  //
  // Two casings, deliberately. `site.finish.*` is the Title-cased name shown in
  // a card's printing label — `(SLD:1234 · Foil · NM)`. `site.finishChip.*` is
  // the lower-case chip on the trade printing picker's per-finish buttons,
  // which sit beside the raw set code and read as a token there. A language
  // that does not distinguish the two can give both keys the same wording.
  //
  // The finish *tokens* themselves (`foil`, `etched`) are file-format
  // vocabulary and are never translated; only these labels are.
  'site.finish.nonfoil': 'Nonfoil',
  'site.finish.foil': 'Foil',
  'site.finish.etched': 'Etched',
  'site.finishChip.nonfoil': 'nonfoil',
  'site.finishChip.foil': 'foil',
  'site.finishChip.etched': 'etched',

  // ── Rarities ──────────────────────────────────────────────────────────
  'site.rarity.common': 'Common',
  'site.rarity.uncommon': 'Uncommon',
  'site.rarity.rare': 'Rare',
  'site.rarity.mythic': 'Mythic',
  'site.rarity.special': 'Special',
  'site.rarity.bonus': 'Bonus',

  // ── Card tile ─────────────────────────────────────────────────────────
  'site.card.select': 'Select card',
  'site.card.deselect': 'Deselect card',
  'site.card.backFaceAlt': '{name} (back)',
  'site.card.showFront': 'Show front face',
  'site.card.showBack': 'Show back face',
  'site.card.addCopy': 'Add copy',
  'site.card.removeCopy': 'Remove copy',
  'site.card.moreOptions': 'More options',
  'site.card.moveTo': 'Move To…',
  'site.card.addToTrade': 'Add to trade',
  'site.card.tradeButton': '+ Trade',
  'site.card.atMaxQuantity': 'Already at maximum quantity',
  'site.card.buylistTitle': 'Buylist offer per copy (USD)',
  'site.card.buylistOffer': 'Buy {price}',
  'site.card.markerProxy': 'PROXY',
  'site.card.markerCustomArt': 'CUSTOM',

  // ── Card modal ────────────────────────────────────────────────────────
  'site.cardModal.aria': 'Card details: {name}',
  'site.cardModal.unknownCard': 'Card',
  'site.cardModal.unknownName': 'Unknown',
  'site.cardModal.backImageAlt': '{name} (Back)',
  'site.cardModal.flip': 'Flip ⇄',
  'site.cardModal.note': 'NOTE: {note}',
  'site.cardModal.viewOnScryfall': 'View on Scryfall ↗',
  'site.cardModal.otherPrintingsHeading': 'Other Printings of {name} ({count})',
  'site.cardModal.otherPrintingsButton': 'Other Printings ({count})',
  'site.cardModal.findInLists': 'Find in Lists',
  'site.cardModal.tags': 'Scryfall Tags',
  'site.cardModal.cardTags': 'Tags',
  'site.cardModal.cardCategories': 'Categories',
  'site.cardModal.oracleTags': 'Oracle Tags',
  'site.cardModal.artTags': 'Art Tags',
  'site.cardModal.noTagData':
    'No tag data for this card — the card cache is incomplete. Tags are only available for cards the site was built with; rebuild the cache to include them.',
  'site.cardModal.addToTrade': '+ Add to Trade',
  'site.cardModal.back': '← Back',
  'site.cardModal.sortReleaseDate': 'Release Date',
  'site.cardModal.sortSetName': 'Set Name',
  'site.cardModal.sortPrice': 'Price',
  'site.cardModal.sortReversed': 'Reversed',
  'site.cardModal.sortNormal': 'Normal order',

  // ── Pagination shared by the card modal and the printing pickers ──────
  'site.pagination.prev': '← Prev',
  'site.pagination.next': 'Next →',
  'site.pagination.pageOf': 'Page {page} of {total}',

  // ── Changelog modal ───────────────────────────────────────────────────
  //
  // The change *lines* themselves come from `domain.change.*` via
  // `changeMessage`; only the dialog's own chrome lives here.
  'site.changelog.title': 'Change History',
  'site.changelog.newer': '← Newer',
  'site.changelog.older': 'Older →',

  // ── Combine-with-list modal ───────────────────────────────────────────
  'site.combine.title': 'Combine with list',
  'site.combine.combiningWith': 'Combining with {name}',
  'site.combine.allLists': 'All lists',
  'site.combine.allSelected': 'All lists selected',
  'site.combine.sortLabel': 'Sort:',
  'site.combine.sortName': 'Name',
  'site.combine.sortCount': 'Card Count',
  'site.combine.sortType': 'Type',
  'site.combine.empty': 'No other lists to combine with.',
  'site.combine.view': 'View',

  // ── Find-other-printings modal ────────────────────────────────────────
  'site.findPrintings.aria': 'Other copies of {name}',
  'site.findPrintings.unknownCard': 'card',
  'site.findPrintings.title': 'Other Copies',
  'site.findPrintings.searching': 'Searching every list…',
  'site.findPrintings.viewBinder': 'Binder',
  'site.findPrintings.viewList': 'List',
  'site.findPrintings.empty': 'No copies found in any list.',
  'site.findPrintings.currentList': 'Current List —',

  // ── Selection menu and selection modal ────────────────────────────────
  'site.selection.defaultLabel': 'Selected',
  'site.selection.clear': 'Clear selection',
  'site.selection.actionsAria': 'Selection actions',
  'site.selection.actions': 'Actions',
  'site.selection.dockCount': '{count} selected',
  'site.selection.viewAll': 'View all selections…',
  'site.selection.addCopy': 'Add a copy',
  'site.selection.removeCopy': 'Remove a copy',
  'site.selection.removeFromList': 'Remove from list',
  'site.selection.setFoil': 'Set as Foil',
  'site.selection.setNonfoil': 'Set as Nonfoil',
  'site.selection.setLanguage': 'Set Language…',
  'site.selection.changePrinting': 'Change Printing…',
  'site.selection.swapPrintings': 'Swap Printings…',
  'site.selection.setCommander': 'Set as Commander',
  'site.selection.setLabel': 'Set Label…',
  'site.selection.addTag': 'Add Tag…',
  'site.selection.moveToSection': 'Move to section…',
  'site.selection.moveToList': 'Move to list…',
  'site.selection.copyText': 'Copy as Text',
  'site.selection.copyCsv': 'Copy as CSV',
  'site.selection.copyCart': 'Copy {buyer} cart CSV',
  'site.selection.moveAllToList': 'Move all to list…',
  'site.selection.removeAll': 'Remove all selected',
  'site.selection.clearAll': 'Clear all selections',
  'site.selection.modalAria': 'Selected cards',
  'site.selection.modalTitle': 'Selected Cards ({count})',
  'site.selection.sell': 'sell',
  'site.selection.group': 'Group:',
  'site.selection.groupOrder': 'Selection order',
  'site.selection.groupSource': 'By source',
  'site.selection.removeCard': 'Remove {name}',
  'site.selection.removeFromSelection': 'Remove from selection',

  // The list a selected card came from, shown as `Deck · Aristocrats`. Short
  // singular forms rather than `domain.listTypeSingular.*` ("Wanted List"):
  // this is a compact breadcrumb beside a card name, not a list heading.
  'site.selection.sourceDeck': 'Deck',
  'site.selection.sourceCollection': 'Collection',
  'site.selection.sourceWanted': 'Wanted',

  // ── Trade actions ─────────────────────────────────────────────────────
  'site.trade.addAction': 'Add to Trade',

  // ── Cover card (deck/list hero tile) ──────────────────────────────────
  'site.cover.noImage': 'No Image',
  'site.cover.lowPrice': 'low {price}',

  // ── Trade printing picker ─────────────────────────────────────────────
  'site.tradePicker.aria': 'Select printing for {name}',
  'site.tradePicker.title': 'Select Printing: {name}',
  'site.tradePicker.wantedTag': 'Wanted',
  'site.tradePicker.loading': 'Loading printings…',
  'site.tradePicker.pageInfo': {
    $plural: 'count',
    one: 'Page {page} of {total} · {count} printing',
    other: 'Page {page} of {total} · {count} printings',
  },
  'site.printingPrice.na': 'N/A',
  'site.printingPrice.alternate': '{price} ({finish})',
  'site.tradePicker.languageNotice':
    'This printing is only available in {language} — it will be recorded as [{token}].',
  'site.tradePicker.continue': 'Continue',
  'site.tradePicker.back': 'Back',

  // ── Move / label pickers ──────────────────────────────────────────────
  'site.move.toListTitle': 'Move to list',
  'site.move.toSectionTitle': 'Move to section',
  'site.move.newSection': 'New section…',
  'site.labels.pickerTitle': 'Set label',
} as const satisfies MessageCatalogShape
