/**
 * `site.*` — public-site chrome: the header, navigation, theme/locale
 * switchers, the mobile tab bar and overflow sheet, and the toolbar controls
 * that frame every list view.
 *
 * One of four `site` fragments (`site-chrome`, `site-cards`, `site-pages`,
 * `site-editor`) split purely so the surfaces can be converted independently
 * without four editors contending for one file. They share the `site`
 * namespace: keys still start with `site.` and the split is invisible to
 * translators, who see one flat catalog.
 *
 * Two authoring rules this fragment exists to hold the line on:
 *
 * 1. **No verb + noun concatenation.** `View all for sale` is one message, not
 *    `View all ` + a lowercased label — the article, case and word order of the
 *    second half are the translator's business.
 * 2. **Enum labels live in tables of keys, never of rendered strings** (see
 *    `src/ui/i18n.tsx`). The tables in `Toolbar.tsx`, `FilterMenu.tsx` and
 *    `index-filter.ts` hold the keys below and resolve them at render time, so
 *    a locale switch relabels the toolbar in the same render as the page text
 *    while `sort=`/`group=` URL values stay English slugs.
 */

import type { MessageCatalogShape } from '../../types'

export const siteChromeMessages = {
  // ── Branding ──────────────────────────────────────────────────────────
  // "Ritual" is the product name and stays as-is in every locale; only the
  // word describing the mark is translated.
  'site.brand.logoAlt': 'Ritual logo',

  // ── Header utility controls ───────────────────────────────────────────
  'site.header.pricesLabel': 'Prices:',
  'site.header.currencyUsd': 'USD ($)',
  'site.header.currencyEur': 'EUR (€)',
  'site.header.currencyTix': 'TIX',
  'site.header.editModeEdit': 'Edit',
  'site.header.editModeDone': 'Done',
  'site.header.editModeLeave': 'Leave edit mode',
  'site.header.editModeEditList': 'Edit this list locally',
  'site.header.editModeEnter': 'Enter edit mode, then open a list to edit',
  'site.header.theme': 'Theme',
  'site.header.themeEditing': 'Editing theme',
  'site.header.themeMenu': 'Theme menu',
  'site.header.themeMenuEditing': 'Theme menu (editor open)',
  'site.header.language': 'Language',
  'site.header.languageLabel': 'Language:',
  'site.header.primaryNav': 'Primary',

  // ── List-page toolbar ─────────────────────────────────────────────────
  'site.toolbar.groupLabel': 'Group:',
  'site.toolbar.sortLabel': 'Sort:',
  'site.toolbar.bracketsLabel': 'Brackets:',
  'site.toolbar.sortSheet': 'Sort',
  'site.toolbar.sortSheetTitle': 'Sort & Group',
  'site.toolbar.sheetGroup': 'Group',
  'site.toolbar.sheetBrackets': 'Brackets',
  'site.toolbar.sheetSort': 'Sort',
  'site.toolbar.sheetOrder': 'Order',
  'site.toolbar.sheetCardSize': 'Card size',
  'site.toolbar.sheetExtras': 'Extras',
  'site.toolbar.reverseSections': 'Reverse Sections',
  'site.toolbar.reverse': 'Reverse',
  'site.toolbar.selectMode': 'Select',
  'site.toolbar.selectModeTitle': 'Selection mode: tap cards to select them',
  'site.toolbar.sellMode': 'Sell mode',
  'site.toolbar.sellModeTitle': 'Sell mode: show buylist prices and filters',
  'site.toolbar.sellModeBusyTitle': 'Sell mode: fetching buylist prices…',
  'site.toolbar.sellModeBusyStatus': 'Fetching buylist prices',
  'site.toolbar.buyerLabel': 'Buyer:',
  'site.toolbar.sortAscending': 'Sorted ascending',
  'site.toolbar.sortDescending': 'Sorted descending',
  'site.toolbar.sortReverse': 'Reverse this sort',
  'site.toolbar.sortRemove': 'Remove this sort',
  'site.toolbar.sortAdd': 'Add another sort',

  // ── View modes and card sizes ─────────────────────────────────────────
  'site.viewMode.binder': 'Binder View',
  'site.viewMode.overlap': 'Overlap View',
  'site.viewMode.stack': 'Stack View',
  'site.viewMode.list': 'List View',
  'site.cardSize.large': 'Large cards',
  'site.cardSize.medium': 'Medium cards',
  'site.cardSize.small': 'Small cards',

  // ── Price-bracket grouping ────────────────────────────────────────────
  'site.brackets.archidekt': 'Archidekt',
  'site.brackets.five': 'Every $5',
  'site.brackets.ten': 'Every $10',

  // ── Filters menu ──────────────────────────────────────────────────────
  'site.filter.title': 'Filters',
  'site.filter.ariaLabel': 'Card filters',
  'site.filter.hideLands': 'Hide Lands',
  'site.filter.hideUnpriced': 'Hide Unpriced',
  'site.filter.hideExtras': 'Hide Extras',
  'site.filter.clear': 'Clear',
  'site.filter.name': 'Name',
  'site.filter.namePlaceholder': 'Search terms…',
  'site.filter.colorIdentity': 'Color Identity',
  'site.filter.colorMode': 'Color match mode',
  'site.filter.labels': 'Labels',
  'site.filter.labelMode': 'Label filter',
  'site.filter.labelUnlabeled': 'Unlabeled',
  'site.filter.labelSaleTitle': 'Cards labeled for sale',
  'site.filter.labelTradeTitle': 'Cards labeled for trade',
  'site.filter.labelKeepTitle': 'Cards labeled to keep (never combined with the other labels)',
  'site.filter.labelNoneTitle': 'Cards with no labels at all',
  'site.filter.buylist': 'Buylist',
  'site.filter.buylistMode': 'Buylist filter',
  'site.filter.buylistOn': 'On buylist',
  'site.filter.buylistOnTitle': 'Cards the buyer is currently buying',
  'site.filter.buylistOff': 'Not on buylist',
  'site.filter.buylistOffTitle': 'Cards the buyer is not currently buying',
  'site.filter.sets': 'Sets',
  'site.filter.setMode': 'Set match mode',
  'site.filter.setsPlaceholder': 'Set codes…',
  'site.filter.setsSuggestions': 'Set code suggestions',
  'site.filter.cardType': 'Card Type',
  'site.filter.cardTypeMode': 'Card type match mode',
  'site.filter.cardTypePlaceholder': 'Card types…',
  'site.filter.cardTypeSuggestions': 'Card type suggestions',
  'site.filter.oracleTags': 'Oracle Tags',
  'site.filter.oracleTagMode': 'Oracle Tags match mode',
  'site.filter.oracleTagsPlaceholder': 'Oracle tags…',
  'site.filter.oracleTagsSuggestions': 'Oracle tag suggestions',
  'site.filter.artTags': 'Art Tags',
  'site.filter.artTagMode': 'Art Tags match mode',
  'site.filter.artTagsPlaceholder': 'Art tags…',
  'site.filter.artTagsSuggestions': 'Art tag suggestions',
  'site.filter.manaValue': 'Mana Value',
  'site.filter.manaValueCompare': 'Mana value comparison',
  'site.filter.price': 'Price',
  'site.filter.priceWithSymbol': 'Price ({symbol})',
  'site.filter.priceCompare': 'Price comparison',
  'site.filter.buylistPrice': 'Buylist ($)',
  'site.filter.buylistPriceCompare': 'Buylist price comparison',
  'site.filter.copies': 'Copies',
  'site.filter.copiesCompare': 'Copies comparison',
  'site.filter.copiesMode': 'Copies match mode',
  'site.filter.numericPlaceholder': 'Any',
  'site.filter.removeTag': 'Remove {value}',

  // ── Filter match modes ────────────────────────────────────────────────
  //
  // One vocabulary across every multi-value filter, so the menu reads as one
  // control set. The tooltips name the filter's own noun rather than
  // interpolating it: "the selected {noun}" cannot be declined.
  'site.filterMode.include': 'Include',
  'site.filterMode.exclude': 'Exclude',
  'site.filterMode.exact': 'Exact',
  'site.filterMode.subset': 'Subset',
  'site.filterMode.name': 'Name',
  'site.filterMode.number': 'Number',
  'site.filterMode.cardTypeInclude': 'Match cards with any of the selected types',
  'site.filterMode.cardTypeExclude': 'Hide cards with any of the selected types',
  'site.filterMode.cardTypeExact': 'Match cards with all of the selected types',
  'site.filterMode.oracleTagInclude': 'Match cards with any of the selected oracle tags',
  'site.filterMode.oracleTagExclude': 'Hide cards with any of the selected oracle tags',
  'site.filterMode.oracleTagExact': 'Match cards with all of the selected oracle tags',
  'site.filterMode.artTagInclude': 'Match cards with any of the selected art tags',
  'site.filterMode.artTagExclude': 'Hide cards with any of the selected art tags',
  'site.filterMode.artTagExact': 'Match cards with all of the selected art tags',
  'site.filterMode.colorSubset': 'Card could be played in a deck of the selected colors',
  'site.filterMode.colorInclude': 'Card uses at least one of the selected colors',
  'site.filterMode.colorExclude': 'Card uses none of the selected colors',
  'site.filterMode.colorExact': 'Color identity is exactly the selected colors',
  'site.filterMode.setInclude': 'Show only cards from the selected sets',
  'site.filterMode.setExclude': 'Hide cards from the selected sets',
  'site.filterMode.copiesName': 'Count every printing of the card name together',
  'site.filterMode.copiesNumber': 'Count only the same set code and collector number',
  'site.filterMode.copiesFinish': 'Count only the same printing in the same finish',

  // ── Index (the three list-gallery tabs) ───────────────────────────────
  'site.index.decks': 'My Decks',
  'site.index.collections': 'My Collections',
  'site.index.wanted': 'My Wanted Lists',
  'site.index.viewAllDecks': 'View all decks',
  'site.index.viewAllWanted': 'View all wanted lists',
  'site.index.viewAllMenu': 'View all...',
  'site.index.viewAllMenuTitle': 'View collections',
  'site.index.viewAllCollections': 'View all collections',
  'site.index.viewAllSale': 'View all for sale',
  'site.index.viewAllTrade': 'View all for trade',
  'site.index.viewAllSaleOrTrade': 'View all for sale or trade',
  'site.index.viewAllKeep': 'View all to keep',
  'site.index.commander': 'Commander: {name}',
  'site.index.sortAlphabetical': 'Alphabetical',
  'site.index.sortRecent': 'Recently updated',
  'site.index.sortPrice': 'Current price',
  'site.index.sortLowestPrice': 'Lowest price',
  'site.index.groupNone': 'None',
  'site.index.groupFormat': 'Format',
  'site.index.otherFormat': 'Other',

  // ── Page stat line ────────────────────────────────────────────────────
  'site.stats.filtered': 'Filtered',
  'site.stats.selected': 'Selected',
  'site.stats.sellValue': 'Sell value',
  'site.stats.buylistTotal': 'Buylist total',
  'site.stats.buylistUnavailable': 'Buylist prices are unavailable: {reason}',

  // ── Price refresh ─────────────────────────────────────────────────────
  'site.prices.update': 'Update prices',
  'site.prices.updating': 'Updating…',

  // ── Quick switch (Ctrl-K) ─────────────────────────────────────────────
  'site.quickSwitch.title': 'Quick switch',
  'site.quickSwitch.placeholder': 'Jump to a list, commander, or card...',
  'site.quickSwitch.noMatches': 'No matches',
  'site.quickSwitch.navigate': 'navigate',
  'site.quickSwitch.open': 'open',
  'site.quickSwitch.close': 'close',
  'site.quickSwitch.kindDeck': 'Deck',
  'site.quickSwitch.kindCollection': 'Collection',
  'site.quickSwitch.kindWanted': 'Wanted',
  'site.quickSwitch.kindCommander': 'Commander',
  'site.quickSwitch.kindCard': 'Card',
  'site.quickSwitch.kindPrinting': 'Printing',
  'site.quickSwitch.inDeck': 'in deck "{name}"',
  'site.quickSwitch.inCollection': 'in collection "{name}"',
  'site.quickSwitch.inWanted': 'in wanted list "{name}"',

  // ── Theme picker and editor ───────────────────────────────────────────
  'site.theme.pickerTitle': 'Choose theme',
  'site.theme.builtIn': 'Built-in themes',
  'site.theme.customized': 'Customized',
  'site.theme.customize': 'Customize theme…',
  'site.theme.closeEditor': 'Close theme editor',
  'site.theme.discardTitle': 'Discard customizations?',
  'site.theme.discardMessage': 'Switching to {theme} will discard your theme customizations.',
  'site.theme.discardConfirm': 'Discard & switch',
  'site.theme.editorTitle': 'Theme editor',
  'site.theme.baseLabel': 'Base:',
  'site.theme.customNameLabel': 'Custom name:',
  'site.theme.resetAll': 'Reset all',
  'site.theme.import': 'Import…',
  'site.theme.downloadJson': 'Download JSON',
  'site.theme.readError': 'Could not read file',
  'site.theme.invalidJson': 'Invalid JSON: {error}',
  'site.theme.editVar': 'Edit {name}',
  'site.theme.resetVar': 'Reset to base theme',
  'site.theme.rawValue': 'Raw value',
  'site.theme.rawHint': "Couldn't parse as a color — edit the raw CSS value.",
  'site.theme.colorPreview': 'Current color preview',
  // ── Theme editor: variable groups and swatches ────────────────────────
  // Evaluated once at import by `src/site/theme-vars-metadata.ts`, so that
  // table holds these keys and the editor resolves them per render.
  // ── Groups (the editor's tab row) ─────────────────────────────────────
  'site.themeGroup.surfaces.label': 'Surfaces',
  'site.themeGroup.surfaces.description': 'Page and panel backgrounds at every interaction depth.',
  'site.themeGroup.borders.label': 'Borders',
  'site.themeGroup.borders.description': 'Border, separator, and focus-outline colors.',
  'site.themeGroup.text.label': 'Text',
  'site.themeGroup.text.description': 'Foreground text colors at varying emphasis levels.',
  'site.themeGroup.accent.label': 'Accent',
  'site.themeGroup.accent.description':
    'Highlight color used for links, focus rings, and visual emphasis.',
  'site.themeGroup.buttons.label': 'Buttons',
  'site.themeGroup.buttons.description': 'Surfaces and labels for the various button styles.',
  'site.themeGroup.status.label': 'Status',
  'site.themeGroup.status.description':
    'Success and error semantic colors. Bright on dark themes, deep on light themes for legibility.',
  'site.themeGroup.overlays.label': 'Overlays',
  'site.themeGroup.overlays.description':
    'Translucent dark scrims — and the text drawn on them — for modals, tooltips, and gradients on top of card art. Universal across themes.',
  'site.themeGroup.modals.label': 'Modals',
  'site.themeGroup.modals.description':
    'Corner rounding and drop-shadow shared by every modal dialog.',
  'site.themeGroup.flame.label': 'Flame icon',
  'site.themeGroup.flame.description':
    'Gradient stops for the app’s candle-flame logo and browser-tab favicon. Derived from the accent by default; the flame recolors live as you edit them.',
  'site.themeGroup.labels.label': 'Labels',
  'site.themeGroup.labels.description':
    'Tones for the For sale / For trade / To keep badges on collection cards and trade rows.',
  'site.themeGroup.misc.label': 'Misc',
  'site.themeGroup.misc.description': 'Sizing tokens and other non-color values.',

  // ── Variables (one swatch each) ───────────────────────────────────────
  'site.themeVar.bgBody.label': 'Page background',
  'site.themeVar.bgBody.description': 'The main background filling the entire viewport.',
  'site.themeVar.bgPanel.label': 'Panel background',
  'site.themeVar.bgPanel.description':
    'Background for raised surfaces — modals, sidebars, deck covers.',
  'site.themeVar.bgHover.label': 'Hover background',
  'site.themeVar.bgHover.description':
    'Subtle hover state for list rows, buttons, and other interactive surfaces.',
  'site.themeVar.bgActive.label': 'Active background',
  'site.themeVar.bgActive.description':
    'Pressed / selected state — accent-tinted to signal an active selection (e.g. an active toolbar button).',
  'site.themeVar.bgSubtle.label': 'Subtle background',
  'site.themeVar.bgSubtle.description':
    'Slightly recessed surface, used for inputs and inset areas.',
  'site.themeVar.border.label': 'Default border',
  'site.themeVar.border.description': 'Standard 1px borders between panels, cards, and inputs.',
  'site.themeVar.borderHover.label': 'Hover border',
  'site.themeVar.borderHover.description': 'Border color when an interactive surface is hovered.',
  'site.themeVar.borderFocus.label': 'Focus border',
  'site.themeVar.borderFocus.description':
    'Border color around the actively focused input or control.',
  'site.themeVar.borderSeparator.label': 'Separator',
  'site.themeVar.borderSeparator.description':
    'Faint horizontal rules between rows in lists and modals.',
  'site.themeVar.textPrimary.label': 'Primary text',
  'site.themeVar.textPrimary.description': 'Highest-emphasis text — headings and key labels.',
  'site.themeVar.textBody.label': 'Body text',
  'site.themeVar.textBody.description': 'Default body copy color.',
  'site.themeVar.textSecondary.label': 'Secondary text',
  'site.themeVar.textSecondary.description': 'De-emphasised text — subtitles, helper text.',
  'site.themeVar.textMuted.label': 'Muted text',
  'site.themeVar.textMuted.description': 'Quiet metadata text — counts, file paths, set codes.',
  'site.themeVar.textDim.label': 'Dim text',
  'site.themeVar.textDim.description': 'Lowest-emphasis text — placeholders and inactive labels.',
  'site.themeVar.textAccent.label': 'Accent text',
  'site.themeVar.textAccent.description':
    'Accent-colored text used for tag labels, quantity badges, and links.',
  'site.themeVar.accent.label': 'Accent',
  'site.themeVar.accent.description':
    'The primary highlight color of the theme. Used for focus rings, primary links, and emphasis.',
  'site.themeVar.accentHover.label': 'Accent hover',
  'site.themeVar.accentHover.description': 'Accent color shifted slightly for hover states.',
  'site.themeVar.accentDim.label': 'Accent dim',
  'site.themeVar.accentDim.description': 'Dimmed accent color for borders and subtle emphasis.',
  'site.themeVar.cardLink.label': 'Card link',
  'site.themeVar.cardLink.description':
    'Blue hyperlink color for card names (e.g. in the changes dialog). Deep on light themes, soft on dark themes.',
  'site.themeVar.cardLinkHover.label': 'Card link hover',
  'site.themeVar.cardLinkHover.description': 'Hover color for card-name hyperlinks.',
  'site.themeVar.progressEnd.label': 'Progress bar end',
  'site.themeVar.progressEnd.description':
    'Far end of the progress-bar gradient (the near end is the accent). A fixed teal across themes.',
  'site.themeVar.btnBg.label': 'Button surface',
  'site.themeVar.btnBg.description': 'Background for the default secondary buttons.',
  'site.themeVar.btnHover.label': 'Button hover',
  'site.themeVar.btnHover.description': 'Hover background for default secondary buttons.',
  'site.themeVar.btnText.label': 'Button label',
  'site.themeVar.btnText.description': 'Text color on default secondary buttons.',
  'site.themeVar.btnPrimary.label': 'Primary button',
  'site.themeVar.btnPrimary.description': 'Background for primary call-to-action buttons.',
  'site.themeVar.btnPrimaryHover.label': 'Primary button hover',
  'site.themeVar.btnPrimaryHover.description': 'Hover state for primary call-to-action buttons.',
  'site.themeVar.btnDanger.label': 'Danger button',
  'site.themeVar.btnDanger.description': 'Background for destructive action buttons.',
  'site.themeVar.btnDangerHover.label': 'Danger button hover',
  'site.themeVar.btnDangerHover.description': 'Hover state for destructive action buttons.',
  'site.themeVar.btnExport.label': 'Export button',
  'site.themeVar.btnExport.description': 'Background for export/download buttons.',
  'site.themeVar.btnExportHover.label': 'Export button hover',
  'site.themeVar.btnExportHover.description': 'Hover state for export/download buttons.',
  'site.themeVar.btnAdd.label': 'Add button',
  'site.themeVar.btnAdd.description': 'Background for "Add" / success buttons. Universal green.',
  'site.themeVar.btnAddHover.label': 'Add button hover',
  'site.themeVar.btnAddHover.description': 'Hover state for "Add" / success buttons.',
  'site.themeVar.btnOnColorText.label': 'On-color label',
  'site.themeVar.btnOnColorText.description':
    'Text color used on saturated colored buttons (primary / add / export). Should contrast with the button background, not the page background.',
  'site.themeVar.successBg.label': 'Success background',
  'site.themeVar.successBg.description': 'Translucent green background for success banners.',
  'site.themeVar.successBorder.label': 'Success border',
  'site.themeVar.successBorder.description': 'Border for success banners and badges.',
  'site.themeVar.successText.label': 'Success text',
  'site.themeVar.successText.description': 'Green text for prices, confirmations, and additions.',
  'site.themeVar.error.label': 'Error',
  'site.themeVar.error.description': 'Solid error/danger color used in destructive button hovers.',
  'site.themeVar.errorBg.label': 'Error background',
  'site.themeVar.errorBg.description':
    'Translucent red background for error banners and danger buttons.',
  'site.themeVar.errorBorder.label': 'Error border',
  'site.themeVar.errorBorder.description': 'Border for error banners and danger buttons.',
  'site.themeVar.errorText.label': 'Error text',
  'site.themeVar.errorText.description': 'Red text used for warnings and removal markers.',
  'site.themeVar.warningBg.label': 'Warning background',
  'site.themeVar.warningBg.description':
    'Translucent amber background for cautionary notices (e.g. stale prices, missing tag data).',
  'site.themeVar.warningBorder.label': 'Warning border',
  'site.themeVar.warningBorder.description': 'Border for cautionary notice banners.',
  'site.themeVar.warningText.label': 'Warning text',
  'site.themeVar.warningText.description': 'Amber text for cautionary notice banners.',
  'site.themeVar.labelSale.label': 'For sale',
  'site.themeVar.labelSale.description':
    'Tone of the SALE badge on collection cards labeled for sale.',
  'site.themeVar.labelTrade.label': 'For trade',
  'site.themeVar.labelTrade.description':
    'Tone of the TRADE badge on collection cards labeled for trade.',
  'site.themeVar.labelKeep.label': 'To keep',
  'site.themeVar.labelKeep.description':
    'Tone of the KEEP badge on collection cards labeled to keep, and the Keep tag on trade rows.',
  'site.themeVar.overlayLight.label': 'Light overlay',
  'site.themeVar.overlayLight.description':
    'Translucent dark scrim for shadows and small backdrops.',
  'site.themeVar.overlayMedium.label': 'Medium overlay',
  'site.themeVar.overlayMedium.description':
    'Translucent dark scrim for tooltips and hover backdrops.',
  'site.themeVar.overlayHeavy.label': 'Heavy overlay',
  'site.themeVar.overlayHeavy.description':
    'Strong dark scrim for modal backdrops and image gradients.',
  'site.themeVar.cardLabelText.label': 'Card label text',
  'site.themeVar.cardLabelText.description':
    'Card name shown on the hover label over card art. Stays bright on every theme so it reads against the dark scrim.',
  'site.themeVar.cardLabelMeta.label': 'Card label meta',
  'site.themeVar.cardLabelMeta.description':
    'Secondary detail (e.g. foil/etched finish) on the card hover label.',
  'site.themeVar.cardLabelPrice.label': 'Card label price',
  'site.themeVar.cardLabelPrice.description':
    'Price shown on the card hover label — a universally bright green.',
  'site.themeVar.cardLabelBuylist.label': 'Card buylist price',
  'site.themeVar.cardLabelBuylist.description':
    'Buylist offer shown beside the retail price in sell mode — a universally bright amber.',
  'site.themeVar.modalRadius.label': 'Modal radius',
  'site.themeVar.modalRadius.description': 'Corner rounding of modal dialog panels.',
  'site.themeVar.modalShadowColor.label': 'Modal shadow',
  'site.themeVar.modalShadowColor.description':
    'Tint of the drop shadow cast by modal dialog panels.',
  'site.themeVar.flameOuter1.label': 'Flame body (bright)',
  'site.themeVar.flameOuter1.description':
    'Brightest part of the flame’s dark outer body, near the inner core.',
  'site.themeVar.flameOuter2.label': 'Flame body (mid)',
  'site.themeVar.flameOuter2.description': 'Mid tone of the flame’s outer body.',
  'site.themeVar.flameOuter3.label': 'Flame body (edge)',
  'site.themeVar.flameOuter3.description': 'Darkest tone at the outer edge of the flame.',
  'site.themeVar.flameInner1.label': 'Flame core (hot)',
  'site.themeVar.flameInner1.description':
    'The hot, near-white center of the flame’s glowing inner core.',
  'site.themeVar.flameInner2.label': 'Flame core (glow)',
  'site.themeVar.flameInner2.description': 'Mid glow of the flame’s inner core.',
  'site.themeVar.flameInner3.label': 'Flame core (base)',
  'site.themeVar.flameInner3.description': 'Saturated base of the flame’s inner core.',
  'site.themeVar.cardRadius.label': 'Card radius',
  'site.themeVar.cardRadius.description':
    'Corner rounding of card images, as a percentage of the card width, so it scales with the card at every display size.',
} as const satisfies MessageCatalogShape
