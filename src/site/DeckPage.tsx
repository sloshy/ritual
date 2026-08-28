import { buylistFieldsFor } from '../list-view/buylist-quotes'
import type { SellModeProps } from '../list-view/sell-mode'
import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import {
  seedCards,
  seedPrintings,
  overlayCard,
  sessionCacheVersion,
} from '../list-view/session-cache'
import { normalizeCardName } from '../card/term-match'
import { useT } from '../ui/i18n'
import type { Card } from '../card/card'
import type { ScryfallCard } from '../scryfall/types'
import type { Finish } from '../card/finish-condition'
import type { CardContextInfo } from '../list-view/card-context'
import type { BakedDeckCard, BakedDeckData, CardKingdomCards } from '../list/site-data'
import { sourceCards } from '../list-view/source-cards'
import {
  cardLabelName,
  effectiveLabels,
  labelFiltersFor,
  type CardLabel,
  type CardLabelSelection,
} from '../card/card-labels'
import {
  cardPricelessReason,
  isPricelessCard,
  pricelessFacts,
  pricelessMarkerText,
} from '../list-view/priceless'
import type { MetaEntry } from '../list-view/meta-entry'
import { rarityName } from '../list-view/printing-display'
import { findPrinting, hasSpecificPrinting } from '../card/card-printing'
import { storedLanguage } from '../card/card-language'
import { ListDescription } from './ListDescription'
import type { PriceCurrency } from '../pricing/price-currency'
import { formatPrice } from '../pricing/price-currency'
import { pricesEnabled, sitePrice } from '../list-view/price-view'
import {
  type GroupBy,
  type SortBy,
  type CardData,
  groupTotalPrice,
} from '../list-view/card-sorting'
import { deckGroupByOptions } from './list-page-options'
import { deckPrimerHash, partitionDeckCards } from './deck-page-logic'
import { CardModal } from '../list-view/CardModal'
import { ListPageShell, type ListPageChangelog, type ListPageExport } from './ListPageShell'
import type { ListPageCommonProps } from './list-page-props'
import { useListPage } from './useListPage'
import { TradePrintingPicker } from './TradePrintingPicker'
import { canAddMoreToLeft } from './useTradeState'
import { addAndToast, addPickedPrintingToTrade } from './useSelectionTrade'
import type { TradeSearchEntry } from './useTradeData'
import { resolveCardPreview } from '../card/image-sources'
import { CardSection } from './CardSection'
import { printingKey } from '../card/printing-key'
import { PrimerRenderer, buildToc } from './PrimerRenderer'
import type { SelectedCard } from '../list-view/useCardSelection'
import type { DeckBulkEditBundle } from '../list-view/selection-edit-actions'
import type { ExportFormat } from './ExportMenu'
import { isExtraSection, isSideboardSection } from '../list/deck-format'
import { deckToExportText, deckToMarkdown } from '../list/deck-text'
import { deckToCsv } from '../list/list-export'

type DeckTradePicker = { cardName: string; printings: ScryfallCard[]; deckEntry: Card }

/**
 * The label chips a deck's filter row offers, and the `labels=` values a shared
 * URL may name here. Derived from the vocabulary (decks carry `proxy` alone),
 * so the row cannot drift from what a deck line can actually hold — and known
 * synchronously, which is what the frame's URL sync needs at setup.
 */
const DECK_LABEL_FILTERS: readonly CardLabelSelection[] = labelFiltersFor('deck')

// The sort fields this page offers, in order — shared by the toolbar's dropdown
// options and the URL sync's validation of incoming sort layers.
const DECK_SORT_BYS: readonly SortBy[] = ['name', 'cmc', 'price', 'color-identity', 'edhrec']

export interface DeckPageProps extends SellModeProps, ListPageCommonProps {
  deck: BakedDeckData
  /**
   * The deck's default card labels from its front matter; a line's own labels
   * override replaces it entirely. Decks accept `proxy` alone.
   */
  listLabels?: CardLabel[]
  lowestPriceCards?: Record<string, ScryfallCard | null>
  lowestPriceCardsEur?: Record<string, ScryfallCard | null>
  lowestPriceCardsTix?: Record<string, ScryfallCard | null>
  /** Card Kingdom's own printing picks, read while the USD source is Card Kingdom. */
  cardsCardKingdom?: CardKingdomCards
  lowestPriceCardsCardKingdom?: CardKingdomCards
  /**
   * Tiles are keyed by card *name*, not printing: a deck shows one tile per
   * name, so the modal opens on the name rather than a `set:cn` key.
   */
  modalCardName: string | null
  onOpenModal: (cardName: string) => void
  missingCards?: Partial<Record<PriceCurrency, string[]>>
  slug: string
  primerOpen?: boolean
  sectionId?: string
  onCardIncrement?: (cardName: string) => void
  onCardDecrement?: (cardName: string) => void
  /** When provided (edit mode), enables bulk edit actions in the multi-select menu. */
  bulkEdit?: DeckBulkEditBundle
}

export const DeckPage: Component<DeckPageProps> = (props) => {
  const t = useT()

  const [lowestPriceRequested, setLowestPriceRequested] = createSignal(false)
  /**
   * "Lowest Price" re-targets every entry at the cheapest printing of its card,
   * which is the opposite of what editing does — the edit surface acts on the
   * printing each entry actually names (change-printing, per-printing quantity).
   * Editing therefore forces the view back to the real printings and locks the
   * toggle out rather than silently letting the two fight.
   */
  const lowestPrice = (): boolean => !props.editMode && lowestPriceRequested()
  const [missingCardsExpanded, setMissingCardsExpanded] = createSignal(false)

  const [deckTradePicker, setDeckTradePicker] = createSignal<DeckTradePicker | null>(null)

  /** A line's effective labels: its own override, else the deck's front-matter default. */
  const entryLabels = (entry: BakedDeckCard): CardLabel[] =>
    effectiveLabels(entry.labels, props.listLabels)

  // Build a fileOrder → original Card entry lookup for trade support.
  // Mirrors the order counter in allCards() so indices align.
  const deckEntryByOrder = createMemo(() => {
    const map = new Map<number, BakedDeckCard>()
    let order = 0
    for (const section of props.deck.sections) {
      for (const entry of section.cards) {
        map.set(order++, entry)
      }
    }
    return map
  })

  // First-occurrence name lookup used for the modal's "Add to Trade" button.
  const deckEntryByName = createMemo(() => {
    const map = new Map<string, BakedDeckCard>()
    for (const section of props.deck.sections) {
      for (const entry of section.cards) {
        if (!map.has(entry.name)) map.set(entry.name, entry)
      }
    }
    return map
  })

  const buildDeckSearchEntry = (
    cardName: string,
    entry: BakedDeckCard,
    scryfallCard: ScryfallCard | null,
    maxQty: number,
  ): TradeSearchEntry => ({
    name: cardName,
    nameKey: normalizeCardName(cardName),
    set: entry.set?.toLowerCase(),
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    labels: entryLabels(entry),
    // The board shows the real printing — it is the card being handed over —
    // but a proxy and a custom-art copy carry no price, so the rule has to
    // travel with the row or it is valued at the printing's retail.
    customArt: entry.customArt,
    hasCustomArt: entry.hasCustomArt,
    scryfallCard,
    sourceName: props.deck.name,
    sourceKind: 'deck',
    maxQty,
    cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
  })

  const handleDeckAddToTrade = (c: CardData, deckEntry: Card) => {
    if (!hasSpecificPrinting(deckEntry)) {
      setDeckTradePicker({
        cardName: c.name,
        printings: props.printings[c.name] ?? [],
        deckEntry,
      })
      return
    }
    const entry = buildDeckSearchEntry(c.name, deckEntry, c.card, c.quantity)
    addAndToast(entry, props.currency, props.useScryfallImgUrls ?? false)
  }

  const handleDeckTradePickerSelect = (printing: ScryfallCard, finish: Finish) => {
    const picker = deckTradePicker()
    if (!picker) return
    setDeckTradePicker(null)
    addPickedPrintingToTrade(printing, finish, {
      sourceName: props.deck.name,
      sourceKind: 'deck',
      maxQty: picker.deckEntry.quantity ?? 1,
      cardIds: picker.deckEntry.cardId !== undefined ? [picker.deckEntry.cardId] : [],
      currency: props.currency,
      useScryfallImgUrls: props.useScryfallImgUrls ?? false,
    })
  }

  const isDeckCardAddDisabled = (c: CardData, deckEntry: Card): boolean => {
    const entry = buildDeckSearchEntry(c.name, deckEntry, c.card, c.quantity)
    return !canAddMoreToLeft(entry)
  }

  const modalDeckEntry = createMemo(() =>
    props.modalCardName ? deckEntryByName().get(props.modalCardName) : undefined,
  )

  // Active card map based on lowest price toggle, currency, and USD source. The
  // store that priced a printing is the store that gets to pick it: under Card
  // Kingdom both the default and the cheapest pick come from CK's catalog, or
  // the tile would show a printing CK never stocked and price it at nothing.
  const activeCards = createMemo(() => {
    if (lowestPrice()) {
      if (props.currency === 'eur' && props.lowestPriceCardsEur) return props.lowestPriceCardsEur
      if (props.currency === 'tix' && props.lowestPriceCardsTix) return props.lowestPriceCardsTix
      if (props.lowestPriceCards) {
        return sourceCards({
          cards: props.lowestPriceCards,
          cardKingdom: props.lowestPriceCardsCardKingdom,
          currency: props.currency,
        })
      }
    }
    return sourceCards({
      cards: props.cards,
      cardKingdom: props.cardsCardKingdom,
      currency: props.currency,
    })
  })

  const hasLowestPriceCards = createMemo(() =>
    Boolean(
      props.lowestPriceCards ||
      props.lowestPriceCardsEur ||
      props.lowestPriceCardsTix ||
      props.lowestPriceCardsCardKingdom,
    ),
  )

  // Resolve the ScryfallCard to display for a deck entry. Each entry resolves its
  // own printing from the card's full printing list, so two entries of the same
  // card with different set/collector numbers render distinct art and price. The
  // "Lowest Price" toggle intentionally ignores the entry's printing (it shows
  // the cheapest printing per card name); name-only entries fall back to the
  // representative card.
  const resolveEntryCard = (entry: Card): ScryfallCard | null => {
    if (!lowestPrice() && hasSpecificPrinting(entry)) {
      const match = findPrinting(props.printings[entry.name], entry.set, entry.collectorNumber)
      if (match) return overlayCard(match)
    }
    return overlayCard(activeCards()[entry.name] ?? null)
  }

  const handleModalAddToTrade = () => {
    const cardName = props.modalCardName
    const entry = modalDeckEntry()
    if (!cardName || !entry) return
    if (!hasSpecificPrinting(entry)) {
      props.onCloseModal()
      setDeckTradePicker({
        cardName,
        printings: props.printings[cardName] ?? [],
        deckEntry: entry,
      })
      return
    }
    const scryfallCard = activeCards()[cardName] ?? null
    const searchEntry = buildDeckSearchEntry(cardName, entry, scryfallCard, entry.quantity)
    addAndToast(searchEntry, props.currency, props.useScryfallImgUrls ?? false)
  }

  const modalAddToTradeDisabled = createMemo(() => {
    const cardName = props.modalCardName
    const entry = modalDeckEntry()
    if (!cardName || !entry) return true
    if (!hasSpecificPrinting(entry)) return false // picker will handle
    const scryfallCard = activeCards()[cardName] ?? null
    const searchEntry = buildDeckSearchEntry(cardName, entry, scryfallCard, entry.quantity)
    return !canAddMoreToLeft(searchEntry)
  })

  // Missing cards for current currency
  const currentMissingCards = createMemo(() => {
    if (!props.missingCards) return []
    return props.missingCards[props.currency] ?? []
  })

  // Build flat card list with metadata
  const allCards = createMemo((): CardData[] => {
    sessionCacheVersion() // re-resolve card prices after an in-session "Update Prices"
    const result: CardData[] = []
    let order = 0
    for (const section of props.deck.sections) {
      for (const entry of section.cards) {
        const card = resolveEntryCard(entry)
        const labels = entryLabels(entry)
        result.push({
          name: entry.name,
          quantity: entry.quantity,
          cmc: card?.cmc ?? 0,
          edhrec: card?.edhrec_rank ?? 999999,
          // A proxy is not a real card, and a copy wearing custom art is not the
          // printing a price would be for: neither carries a price in any
          // currency — the same rule the bake and the price report apply.
          price:
            card && !isPricelessCard(pricelessFacts(entry, labels))
              ? sitePrice(card, props.currency)
              : 0,
          type: card?.type_line ?? '',
          section: section.name,
          fileOrder: order++,
          setCode: card?.set ?? '',
          colorIdentity: card?.color_identity ?? [],
          hasPrinting: hasSpecificPrinting(entry),
          pinnedPrintingKey: hasSpecificPrinting(entry)
            ? printingKey(entry.set, entry.collectorNumber)
            : undefined,
          oracleTags: card?.oracleTags ?? [],
          artTags: card?.artTags ?? [],
          labels,
          customArt: entry.customArt,
          hasCustomArt: entry.hasCustomArt,
          finish: entry.finish,
          language: storedLanguage(entry.language),
          ...buylistFieldsFor(card, entry.finish, entry.language, pricelessFacts(entry, labels)),
          card,
        })
      }
    }
    return result
  })

  const sectionOrder = createMemo(() => {
    return props.deck.sections.map((s) => s.name)
  })

  // Partition all cards into categories in a single O(n) pass so we avoid
  // re-scanning allCards separately for commander, sideboard, extras, and
  // mainboard.  cardGroups can then depend on mainboardCards rather than
  // allCards, so toolbar changes (groupBy, sortBy…) no longer re-trigger the
  // categorisation step.
  const partitioned = createMemo(() => partitionDeckCards(allCards()))

  // Deck price = mainboard + commander + sideboard only
  const mainAndSideboardCards = createMemo(() => {
    const p = partitioned()
    return [...p.commanderCards, ...p.mainboardCards, ...p.sideboardCards]
  })

  const totalPrice = createMemo(() => {
    return groupTotalPrice(mainAndSideboardCards())
  })

  // Extras price (maybeboard, tokens)
  const extrasPrice = createMemo(() => {
    return groupTotalPrice(partitioned().extraCards)
  })

  const page = useListPage<GroupBy, CardData>({
    identity: { kind: 'deck', name: props.deck.name, slug: () => props.slug },
    options: {
      groupByOptionsFor: deckGroupByOptions,
      sortBys: DECK_SORT_BYS,
      availableLabels: () => DECK_LABEL_FILTERS,
      defaults: { groupBy: 'type', sortBy: 'name' },
    },
    cards: allCards,
    // The commander is the deck's identity, and the sideboard and extras render
    // in their own sections, so only the mainboard is filtered and grouped.
    filterSource: () => partitioned().mainboardCards,
    // Deck price = commander + mainboard + sideboard; extras are excluded.
    valued: {
      pinned: () => partitioned().commanderCards,
      alsoFiltered: () => partitioned().sideboardCards,
    },
    sectionOrder,
    seed: () => {
      seedCards(props.cards)
      seedPrintings(props.printings)
      if (props.lowestPriceCards) seedCards(props.lowestPriceCards)
      if (props.lowestPriceCardsEur) seedCards(props.lowestPriceCardsEur)
      if (props.lowestPriceCardsTix) seedCards(props.lowestPriceCardsTix)
      if (props.cardsCardKingdom) seedCards(props.cardsCardKingdom)
      if (props.lowestPriceCardsCardKingdom) seedCards(props.lowestPriceCardsCardKingdom)
    },
    currency: () => props.currency,
    pricesDate: props.pricesDate,
    enableSellMode: () => Boolean(props.enableSellMode),
    bakedBuylist: props.bakedBuylist,
    enableUrlState: () => props.enableUrlState,
    shareLists: () => props.shareLists,
    addedCardNames: () => props.addedCardNames,
    bulkEdit: () => props.bulkEdit,
  })

  // Modal card data
  const modalCard = createMemo((): ScryfallCard | null => {
    if (!props.modalCardName) return null
    return activeCards()[props.modalCardName] ?? null
  })

  /**
   * The modal's meta row, built here rather than left to the modal's own
   * default: the modal holds only the Scryfall card, whose retail price a proxy
   * or custom-art copy does not have. Labels are the *effective* ones —
   * inherited deck default included — since the modal is the full-truth view,
   * unlike the tiles, which badge overrides only.
   */
  const modalMeta = createMemo((): MetaEntry[] | undefined => {
    const card = modalCard()
    const entry = modalDeckEntry()
    if (!card || !entry) return undefined
    const labels = entryLabels(entry)
    const marker = pricelessMarkerText(t, cardPricelessReason(pricelessFacts(entry, labels)))
    const price = marker === undefined ? sitePrice(card, props.currency) : 0
    const parts: MetaEntry[] = []
    if (pricesEnabled()) {
      if (marker !== undefined) parts.push({ label: 'price', value: marker })
      else if (price > 0) {
        parts.push({ label: 'price', value: formatPrice(price, props.currency) })
      }
    }
    parts.push({ label: 'set', value: `${card.set_name} (#${card.collector_number})` })
    if (labels.length > 0) {
      parts.push({ label: 'labels', value: labels.map(cardLabelName).join(' · ') })
    }
    parts.push({ label: 'rarity', value: rarityName(t, card.rarity) })
    return parts
  })

  const serializeDeck = (format: ExportFormat): string => {
    switch (format) {
      case 'txt':
        return deckToExportText(props.deck)
      case 'md':
        return deckToMarkdown(props.deck)
      case 'csv':
        return deckToCsv(props.deck)
    }
  }

  // Built once: a stable object keeps the header's `<Show>` from flipping on every read.
  const exportFormats: ListPageExport = { serialize: serializeDeck }

  /** The changelog slot — the pages and the card data they render with, together. */
  const changelogBundle = createMemo((): ListPageChangelog | undefined =>
    props.changelog
      ? { pages: props.changelog, cards: props.cards, printings: props.printings }
      : undefined,
  )

  const renderDeckCard = (hideCount: boolean) => (c: CardData) => {
    const deckEntry = deckEntryByOrder().get(c.fileOrder)
    const showTrade = !props.editMode && !props.onCardMove && deckEntry !== undefined
    const selectKey = String(c.fileOrder)
    // Name-only deck entries carry no pinned printing, so leave set/CN unset and
    // ship the printings list — adding such a card to a trade prompts for one.
    const specific = deckEntry !== undefined && hasSpecificPrinting(deckEntry)
    const buildSelected = (): SelectedCard => {
      const preview = resolveCardPreview(c.card, Boolean(props.useScryfallImgUrls), c.customArt)
      return {
        key: selectKey,
        name: c.name,
        set: specific ? deckEntry?.set?.toLowerCase() : undefined,
        collectorNumber: specific ? deckEntry?.collectorNumber : undefined,
        finish: deckEntry?.finish,
        condition: deckEntry?.condition,
        labels: c.labels.length > 0 ? c.labels : undefined,
        customArt: c.customArt,
        hasCustomArt: c.hasCustomArt,
        quantity: c.quantity,
        groupSize: c.quantity,
        price: c.price,
        scryfallCard: c.card,
        image: preview.image || undefined,
        sideways: preview.sideways,
        printings: specific ? undefined : (props.printings[c.name] ?? []),
        sourceName: props.deck.name,
        sourceSlug: props.slug,
        sourceKind: 'deck',
        maxQty: c.quantity,
        cardIds: deckEntry?.cardId !== undefined ? [deckEntry.cardId] : [],
      }
    }
    const contextInfo = (): CardContextInfo => ({
      cardName: c.name,
      card: c.card,
      cardIds: deckEntry?.cardId !== undefined ? [deckEntry.cardId] : [],
      quantity: c.quantity,
      set: deckEntry?.set,
      collectorNumber: deckEntry?.collectorNumber,
      finish: deckEntry?.finish,
      condition: deckEntry?.condition,
    })
    return (
      <CardItem
        name={c.name}
        quantity={c.quantity}
        card={c.card}
        customArt={c.customArt}
        symbolMap={props.symbolMap}
        buylistPrice={c.buylistPrice}
        viewMode={page.toolbar.viewMode()}
        hideCount={hideCount}
        useScryfallImgUrls={props.useScryfallImgUrls}
        onCardClick={() => props.onOpenModal(c.name)}
        onTooltipEnter={(src, sideways) => page.tooltip.setTooltip({ src, sideways })}
        onTooltipLeave={() => page.tooltip.setTooltip(null)}
        collectionFinish={deckEntry?.finish}
        // The entry's own price, not the printing's: a proxy computed 0 above,
        // and letting the tile re-derive from the Scryfall card would print a
        // retail figure the deck total does not include.
        collectionPrice={c.price}
        labelBadges={deckEntry?.labels}
        priceless={cardPricelessReason(c)}
        currency={props.currency}
        cardId={deckEntry?.cardId}
        editMode={props.editMode}
        onIncrement={props.editMode ? () => props.onCardIncrement?.(c.name) : undefined}
        onDecrement={props.editMode ? () => props.onCardDecrement?.(c.name) : undefined}
        onContextMenu={
          props.editMode
            ? (rect) => props.onCardContextMenu?.(contextInfo(), rect)
            : !props.onCardMove && page.readMenu.enabled()
              ? (rect) => page.readMenu.open(contextInfo(), rect)
              : undefined
        }
        onMove={props.onCardMove ? (rect) => props.onCardMove!(contextInfo(), rect) : undefined}
        onAddToTrade={showTrade ? () => handleDeckAddToTrade(c, deckEntry) : undefined}
        addToTradeDisabled={showTrade ? isDeckCardAddDisabled(c, deckEntry) : undefined}
        selectable
        selectState={page.selection.state(selectKey)}
        onToggleSelect={() => page.selection.toggle(buildSelected())}
      />
    )
  }

  const modalPrintings = createMemo(() => {
    if (!props.modalCardName) return []
    const direct = props.printings[props.modalCardName]
    if (direct) return direct
    // Fall back to the card's actual Scryfall name — primer keys may differ in
    // punctuation/casing from the deck's card name key used to index printings.
    const actualName = modalCard()?.name
    return (actualName ? props.printings[actualName] : undefined) ?? []
  })

  // Pre-compute extra sections for reactive rendering
  const extraSections = createMemo(() => {
    if (page.filters.filters.hideExtras || partitioned().extraCards.length === 0) return []
    const extraCards = page.filterVisible(partitioned().extraCards)
    return props.deck.sections
      .filter((s) => isExtraSection(s.name))
      .map((s) => ({
        name: s.name,
        cards: extraCards.filter((c) => c.section === s.name),
      }))
      .filter((s) => s.cards.length > 0)
  })
  return (
    <ListPageShell
      page={page}
      title={props.deck.name}
      fullWidth={Boolean(props.fullWidth ?? (props.editMode || props.onCardMove))}
      currency={props.currency}
      symbolMap={props.symbolMap}
      useScryfallImgUrls={props.useScryfallImgUrls}
      enableTrade={props.enableTrade}
      onCombine={props.onCombine}
      export={props.enableExport ? exportFormats : undefined}
      changelog={changelogBundle()}
      enablePriceRefresh={props.enablePriceRefresh}
      showHideExtras
      extraToggles={
        hasLowestPriceCards()
          ? [
              {
                label: t('site.deck.lowestPrice'),
                checked: lowestPrice(),
                onChange: () => setLowestPriceRequested((prev) => !prev),
                locked: props.editMode
                  ? { reason: t('site.deck.lowestPriceEditDisabled') }
                  : undefined,
              },
            ]
          : undefined
      }
      statsLead={
        <>
          <Show when={pricesEnabled()}>
            {t('site.stats.total', { amount: formatPrice(totalPrice(), props.currency) })}
          </Show>
          <Show
            when={
              pricesEnabled() &&
              !page.filters.filters.hideExtras &&
              partitioned().extraCards.length > 0
            }
          >
            <span class="page-stats-label">
              {' '}
              {t('site.deck.allCardsPrice', {
                amount: formatPrice(totalPrice() + extrasPrice(), props.currency),
              })}
            </span>
          </Show>
        </>
      }
      headerExtra={
        <Show when={props.deck.sourceUrl}>
          <a href={props.deck.sourceUrl} target="_blank" rel="noreferrer" class="copy-link">
            {t('site.deck.importedFrom', {
              source: (() => {
                // i18n-exempt: site names are proper nouns and stay as spelled.
                if (props.deck.sourceUrl!.includes('moxfield.com')) return 'Moxfield'
                if (props.deck.sourceUrl!.includes('archidekt.com')) return 'Archidekt'
                if (props.deck.sourceUrl!.includes('mtggoldfish.com')) return 'MTGGoldfish'
                return t('site.deck.sourceGeneric')
              })(),
            })}
          </a>
        </Show>
      }
      beforeCards={
        <>
          {/* Description / Primer */}
          <Show when={props.deck.description || props.deck.primer}>
            <div class="list-description-section">
              <ListDescription description={props.deck.description} symbolMap={props.symbolMap} />
              <Show when={props.deck.primer}>
                <div class="deck-primer">
                  <ExpandablePrimer
                    primer={props.deck.primer!}
                    slug={props.slug}
                    cards={activeCards()}
                    onOpenModal={props.onOpenModal}
                    primerOpen={props.primerOpen}
                    sectionId={props.sectionId}
                  />
                </div>
              </Show>
            </div>
          </Show>

          {/* Missing cards warning banner */}
          <Show when={currentMissingCards().length > 0}>
            <div class="missing-cards-banner">
              <button
                type="button"
                class="missing-cards-banner-toggle"
                onClick={() => setMissingCardsExpanded((prev) => !prev)}
              >
                <span>⚠️</span>
                <span class="missing-toggle-label">
                  {t('site.deck.missingPricing', {
                    count: currentMissingCards().length,
                    currency: props.currency.toUpperCase(),
                  })}
                </span>
                <span class="missing-toggle-arrow">{missingCardsExpanded() ? '▲' : '▼'}</span>
              </button>
              <Show when={missingCardsExpanded()}>
                <div class="missing-cards-banner-list">
                  <ul>
                    <For each={currentMissingCards()}>{(name) => <li>{name}</li>}</For>
                  </ul>
                </div>
              </Show>
            </div>
          </Show>
        </>
      }
      sections={
        <>
          {/* Commander section always shown first */}
          <Show when={partitioned().commanderCards.length > 0}>
            <CardSection
              label={
                props.deck.sections.find((s) => s.name.toLowerCase().includes('commander'))?.name ??
                // i18n-exempt: a board name, English by contract (see BOARDS).
                'Commander'
              }
              cards={partitioned().commanderCards}
              currency={props.currency}
              renderCard={renderDeckCard(true)}
            />
          </Show>

          {/* Dynamic sorted/grouped sections (mainboard only) */}
          <For each={page.cardGroups()}>
            {(group) => (
              <CardSection
                label={group.key}
                cards={group.cards}
                currency={props.currency}
                renderCard={renderDeckCard(false)}
              />
            )}
          </For>

          {/* Sideboard always shown at bottom, ungrouped */}
          <Show when={page.filteredAlso().length > 0}>
            <CardSection
              label={
                props.deck.sections.find((s) => isSideboardSection(s.name))?.name ??
                // i18n-exempt: a board name, English by contract (see BOARDS).
                'Sideboard'
              }
              cards={page.filteredAlso()}
              currency={props.currency}
              renderCard={renderDeckCard(false)}
            />
          </Show>

          {/* Extras (maybeboard, tokens) shown below sideboard, ungrouped */}
          <For each={extraSections()}>
            {(s) => (
              <CardSection
                label={s.name}
                cards={s.cards}
                currency={props.currency}
                renderCard={renderDeckCard(false)}
              />
            )}
          </For>
        </>
      }
      overlays={
        <>
          {/* Card detail modal */}
          <CardModal
            open={Boolean(modalCard())}
            card={modalCard()}
            customArt={modalDeckEntry()?.customArt}
            hasCustomArt={modalDeckEntry()?.hasCustomArt}
            cardName={props.modalCardName}
            symbolMap={props.symbolMap}
            useScryfallImgUrls={props.useScryfallImgUrls}
            currency={props.currency}
            printings={modalPrintings()}
            onClose={props.onCloseModal}
            meta={modalMeta()}
            onAddToTrade={!props.editMode && !props.onCardMove ? handleModalAddToTrade : undefined}
            addToTradeDisabled={
              !props.editMode && !props.onCardMove ? modalAddToTradeDisabled() : undefined
            }
          />

          {/* Trade printing picker for deck cards without specific printings */}
          <Show when={deckTradePicker()}>
            {(picker) => (
              <TradePrintingPicker
                cardName={picker().cardName}
                printings={picker().printings}
                loading={false}
                useScryfallImgUrls={props.useScryfallImgUrls}
                currency={props.currency}
                onSelect={handleDeckTradePickerSelect}
                onClose={() => setDeckTradePicker(null)}
              />
            )}
          </Show>
        </>
      }
    />
  )
}

// Expandable primer component with Markdown rendering and an optional TOC sidebar
type ExpandablePrimerProps = {
  primer: string
  slug: string
  cards: Record<string, ScryfallCard | null>
  onOpenModal: (cardName: string) => void
  primerOpen?: boolean
  sectionId?: string
}

function ExpandablePrimer(props: ExpandablePrimerProps) {
  const t = useT()
  const [expanded, setExpanded] = createSignal(Boolean(props.primerOpen || props.sectionId))

  // buildToc is a fast O(n) line-scan; createMemo with auto-tracking ensures it only
  // recomputes when the primer text changes, not on every re-render.
  const toc = createMemo(() => buildToc(props.primer))

  // Re-expand whenever the route navigates to the primer or a specific section
  createEffect(() => {
    if (props.primerOpen || props.sectionId) setExpanded(true)
  })

  // Scroll to the target section after the primer is expanded
  createEffect(() => {
    if (!expanded() || !props.sectionId) return
    document.getElementById(props.sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  return (
    <div>
      <Show
        when={expanded()}
        fallback={
          <div>
            <p class="text-hint">{t('site.deck.hasPrimer')}</p>
            <button
              class="link-action"
              aria-expanded={false}
              onClick={() => {
                setExpanded(true)
                history.replaceState(
                  null,
                  '',
                  deckPrimerHash(props.slug, true, window.location.hash),
                )
              }}
            >
              {t('site.list.readMore')}
            </button>
          </div>
        }
      >
        <div>
          <div class={`primer-layout ${toc().length > 0 ? 'primer-layout--with-toc' : ''}`}>
            <Show when={toc().length > 0}>
              <nav class="primer-toc">
                <p class="primer-toc-title">{t('site.deck.primerContents')}</p>
                <ul>
                  <For each={toc()}>
                    {(h) => (
                      <li class={`primer-toc-item primer-toc-level-${h.level}`}>
                        <a href={`#/deck/${props.slug}/primer/${h.id}`}>
                          {h.text.replace(/\*+/g, '')}
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </nav>
            </Show>
            <PrimerRenderer
              primerMarkdown={props.primer}
              cards={props.cards}
              onOpenModal={props.onOpenModal}
            />
          </div>
          <button
            class="link-action link-action-block"
            aria-expanded={true}
            onClick={() => {
              setExpanded(false)
              history.replaceState(
                null,
                '',
                deckPrimerHash(props.slug, false, window.location.hash),
              )
            }}
          >
            {t('site.list.showLess')}
          </button>
        </div>
      </Show>
    </div>
  )
}
