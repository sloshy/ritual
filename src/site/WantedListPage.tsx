import { buylistFieldsFor } from '../list-view/buylist-quotes'
import type { Component } from 'solid-js'
import { useListCategories } from './list-categories'
import { createSignal, createMemo, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import { seedCards, seedPrintings, sessionCacheVersion } from '../list-view/session-cache'
import { normalizeCardName } from '../card/term-match'
import { useT } from '../ui/i18n'
import { displayFinish, type Finish } from '../card/finish-condition'
import { storedLanguage } from '../card/card-language'
import { ListDescriptionSection } from './ListDescription'
import { PageCountAndTotal } from './PageStats'
import type { ScryfallCard } from '../scryfall/types'
import type { CardContextInfo } from '../list-view/card-context'
import type { WantedListCardEntry } from '../list/site-data'
import { pricesEnabled, sitePriceForFinish } from '../list-view/price-view'
import type { CardData, GroupBy, SortBy } from '../list-view/card-sorting'
import { CardModal } from '../list-view/CardModal'
import { ListPageShell, type ListPageChangelog, type ListPageExport } from './ListPageShell'
import type { FlatListPageProps } from './list-page-props'
import { useListPage } from './useListPage'
import { finishName, rarityName } from '../list-view/printing-display'
import { CardSection } from './CardSection'
import { labelFiltersFor, type CardLabelSelection } from '../card/card-labels'
import { deriveSectionOrder, sectionDefaultGroupBy } from '../list/section-format'
import { TradePrintingPicker } from './TradePrintingPicker'
import { canAddMoreToRight } from './useTradeState'
import { addAndToast, addPickedPrintingToTrade } from './useSelectionTrade'
import type { TradeSearchEntry } from './useTradeData'
import { resolveCardPreview } from '../card/image-sources'
import { hasSpecificPrinting } from '../card/card-printing'
import { printingKey } from '../card/printing-key'
import { resolveWantedCardEntry } from '../list-view/resolve-card'
import type { SourceCardMaps } from '../list-view/source-cards'
import {
  cardPriceText,
  cardPricelessReason,
  isPricelessCard,
  pricelessFacts,
} from '../list-view/priceless'
import type { SelectedCard } from '../list-view/useCardSelection'
import type { WantedBulkEditBundle } from '../list-view/selection-edit-actions'
import type { ExportFormat } from './ExportMenu'
import { frontMatterFor, wantedToText, wantedToMarkdown, wantedToCsv } from '../list/list-export'
import type { MetaEntry } from '../list-view/meta-entry'
import { wantedGroupByOptions } from './list-page-options'
import { buildEntryIndex, entryAtModalKey, findEntryIndex } from '../list-view/entry-index'
import { wantedStateLabel } from './wanted-page-logic'

/**
 * The label chips this page offers. Hoisted to module scope like the deck's and
 * the collection's: it is a property of the list *type*, and
 * the frame's URL sync reads it once at setup either way.
 *
 * Wanted-list entries carry no labels at all, so this is empty and every
 * `labels=` value a pasted link brings is dropped rather than filtering the page
 * to nothing.
 */
const WANTED_LABEL_FILTERS: readonly CardLabelSelection[] = labelFiltersFor('wanted')

// The sort fields this page offers, in order — shared by the toolbar's dropdown
// options and the URL sync's validation of incoming sort layers.
const WANTED_SORT_BYS: readonly SortBy[] = [
  'file-order',
  'name',
  'cmc',
  'price',
  'color-identity',
  'set-code',
  'edhrec',
  'tags',
  'category',
]
type WantedTradePicker = {
  cardName: string
  printings: ScryfallCard[]
  wantedEntry: WantedListCardEntry
}

type WantedListPageProps = FlatListPageProps<WantedListCardEntry, WantedBulkEditBundle>

export const WantedListPage: Component<WantedListPageProps> = (props) => {
  const t = useT()

  // Section order, including any empty sections from the build/save payload; falls back to the
  // sections discovered in the entries (in file order) when not provided.
  const sectionOrder = createMemo(() => deriveSectionOrder(props.sectionOrder, props.entries))
  const hasSections = createMemo(() => sectionOrder().length >= 2)

  // Intentional one-time seed for the toolbar's group-by signal (read once at construction;
  // it must not fight the user's later toolbar changes). The editor remounts these pages on
  // each load, so a stale seed is not reachable.
  const initialGroupBy: GroupBy = sectionDefaultGroupBy(props.entries)

  const [wantedTradePicker, setWantedTradePicker] = createSignal<WantedTradePicker | null>(null)

  const buildWantedSearchEntry = (
    entry: WantedListCardEntry,
    scryfallCard: ScryfallCard | null,
  ): TradeSearchEntry => ({
    name: entry.name,
    nameKey: normalizeCardName(entry.name),
    set: entry.set?.toLowerCase(),
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    // The row shows the real printing — it is the card being asked for — but a
    // copy wearing art of its own carries no price, so the rule travels with it.
    tags: entry.tags,
    customArt: entry.customArt,
    hasCustomArt: entry.hasCustomArt,
    note: entry.note,
    price: entry.price,
    scryfallCard,
    sourceName: props.name,
    sourceKind: 'wanted',
    maxQty: 1,
    cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
  })

  const handleWantedAddToTrade = (
    entry: WantedListCardEntry,
    scryfallCard: ScryfallCard | null,
  ) => {
    if (!hasSpecificPrinting(entry)) {
      setWantedTradePicker({
        cardName: entry.name,
        printings: props.printings[entry.name] ?? [],
        wantedEntry: entry,
      })
      return
    }
    const searchEntry = buildWantedSearchEntry(entry, scryfallCard)
    addAndToast(searchEntry, props.currency, props.useScryfallImgUrls ?? false)
  }

  const handleWantedTradePickerSelect = (printing: ScryfallCard, finish: Finish) => {
    const picker = wantedTradePicker()
    if (!picker) return
    setWantedTradePicker(null)
    addPickedPrintingToTrade(printing, finish, {
      sourceName: props.name,
      sourceKind: 'wanted',
      maxQty: 1,
      cardIds: picker.wantedEntry.cardId !== undefined ? [picker.wantedEntry.cardId] : [],
      currency: props.currency,
      useScryfallImgUrls: props.useScryfallImgUrls ?? false,
    })
  }

  const isWantedCardAddDisabled = (
    entry: WantedListCardEntry,
    scryfallCard: ScryfallCard | null,
  ): boolean => {
    if (!hasSpecificPrinting(entry)) return false
    const searchEntry = buildWantedSearchEntry(entry, scryfallCard)
    return !canAddMoreToRight(searchEntry)
  }

  /**
   * The card maps every entry resolves against — one object, rebuilt only when
   * the currency or the baked maps change, rather than per entry per pass.
   */
  const cardMaps = createMemo(
    (): SourceCardMaps => ({
      cards: props.cards,
      cardKingdom: props.cardsCardKingdom,
      currency: props.currency,
    }),
  )

  const currencyEntries = createMemo((): WantedListCardEntry[] => {
    sessionCacheVersion() // re-price after an in-session "Update Prices"
    return props.entries.map((entry) => {
      const card = resolveWantedCardEntry(entry, cardMaps())
      if (!card) return entry

      // A copy wearing custom art is not the printing a price would be for, so
      // it prices at nothing — the same rule the bake applies. (Wanted lines
      // carry no labels, so custom art is the only way one can be priceless.)
      //
      // An entry with no finish token is read at the printing's default finish,
      // not flatly as nonfoil: a foil-only printing has no nonfoil price to quote.
      const price = isPricelessCard(pricelessFacts(entry))
        ? 0
        : sitePriceForFinish(card, displayFinish(card, entry.finish), props.currency)
      return { ...entry, price }
    })
  })

  const computedTotalPrice = createMemo(() => {
    return currencyEntries().reduce((sum, e) => sum + e.price, 0)
  })

  // Resolved from the list's own record rather than read off the entry: the
  // editing panes carry no baked categories on their card data and pass the live
  // record instead. See `useListCategories`.
  const { categoriesFor, categoriesField } = useListCategories(() => props.categories)

  const allCards = createMemo((): CardData[] => {
    return currencyEntries().map((entry) => {
      const card = resolveWantedCardEntry(entry, cardMaps())
      return {
        name: entry.name,
        quantity: 1,
        cmc: card?.cmc ?? 0,
        edhrec: card?.edhrec_rank ?? 999999,
        price: entry.price,
        type: card?.type_line ?? '',
        section: entry.section,
        fileOrder: entry.fileOrder,
        setCode: entry.set ?? '',
        colorIdentity: card?.color_identity ?? [],
        hasPrinting: hasSpecificPrinting(entry),
        pinnedPrintingKey: hasSpecificPrinting(entry)
          ? printingKey(entry.set, entry.collectorNumber)
          : undefined,
        oracleTags: card?.oracleTags ?? [],
        artTags: card?.artTags ?? [],
        labels: [],
        tags: entry.tags,
        ...categoriesField(entry.name),
        customArt: entry.customArt,
        hasCustomArt: entry.hasCustomArt,
        finish: entry.finish,
        language: storedLanguage(entry.language),
        // Wanted lines carry no labels, so their art is the only way one can be
        // priceless — and the sidecar fact, not the display URL, is what says so.
        ...buylistFieldsFor(card, entry.finish, entry.language, pricelessFacts(entry)),
        card,
      }
    })
  })

  const page = useListPage<GroupBy, CardData>({
    identity: { kind: 'wanted', name: props.name, slug: () => props.slug },
    options: {
      groupByOptionsFor: (sellMode) => wantedGroupByOptions(sellMode, hasSections()),
      sortBys: WANTED_SORT_BYS,
      availableLabels: () => WANTED_LABEL_FILTERS,
      defaults: { groupBy: initialGroupBy, sortBy: 'file-order' },
    },
    cards: allCards,
    sectionOrder,
    categoryOrder: () => props.categories?.order ?? [],
    // Seed the session cache from this list's baked card data so the editor's
    // card search and the trade page reuse it instead of re-fetching.
    seed: () => {
      seedCards(props.cards)
      seedPrintings(props.printings)
      if (props.cardsCardKingdom) seedCards(props.cardsCardKingdom)
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

  const modalEntry = createMemo(() => entryAtModalKey(currencyEntries(), props.modalCardKey))

  const modalCard = createMemo((): ScryfallCard | null => {
    if (!modalEntry()) return null
    return resolveWantedCardEntry(modalEntry()!, cardMaps())
  })

  const modalAddToTrade = createMemo(() => {
    const entry = modalEntry()
    if (!entry || props.editMode || props.onCardMove) return undefined
    const scryfallCard = modalCard()
    return () => handleWantedAddToTrade(entry, scryfallCard)
  })

  const modalAddToTradeDisabled = createMemo(() => {
    const entry = modalEntry()
    if (!entry || !hasSpecificPrinting(entry)) return false
    const scryfallCard = modalCard()
    return isWantedCardAddDisabled(entry, scryfallCard)
  })

  const modalPrintings = createMemo(() =>
    modalEntry() ? (props.printings[modalEntry()!.name] ?? []) : [],
  )

  // Pre-computed index map for O(1) entry lookups (avoids O(n²) on large lists)
  const entryIndexMap = createMemo(() => buildEntryIndex(currencyEntries()))

  const entryIndexOf = (cardData: CardData): number => findEntryIndex(entryIndexMap(), cardData)

  const renderWantedListCard = (c: CardData) => {
    const entryIdx = entryIndexOf(c)
    const entry = currencyEntries()[entryIdx]
    const showTrade = !props.editMode && !props.onCardMove && entry !== undefined
    const selectKey = String(entryIdx)
    const specific = entry !== undefined && hasSpecificPrinting(entry)
    const buildSelected = (): SelectedCard => {
      const preview = resolveCardPreview(c.card, Boolean(props.useScryfallImgUrls), c.customArt)
      return {
        key: selectKey,
        name: c.name,
        set: specific ? entry.set.toLowerCase() : undefined,
        collectorNumber: specific ? entry.collectorNumber : undefined,
        finish: entry?.finish,
        language: storedLanguage(entry?.language),
        note: entry?.note,
        tags: entry?.tags,
        quantity: 1,
        groupSize: 1,
        price: c.price,
        scryfallCard: c.card,
        image: preview.image || undefined,
        sideways: preview.sideways,
        customArt: c.customArt,
        hasCustomArt: c.hasCustomArt,
        printings: specific ? undefined : (props.printings[c.name] ?? []),
        sourceName: props.name,
        sourceSlug: props.slug,
        sourceKind: 'wanted',
        maxQty: 1,
        cardIds: entry?.cardId !== undefined ? [entry.cardId] : [],
      }
    }
    const contextInfo = (): CardContextInfo => ({
      cardName: c.name,
      card: c.card,
      cardIds: entry?.cardId !== undefined ? [entry.cardId] : [],
      quantity: 1,
      set: entry?.set,
      collectorNumber: entry?.collectorNumber,
      finish: entry?.finish,
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
        hideCount={true}
        useScryfallImgUrls={props.useScryfallImgUrls}
        onCardClick={() => props.onOpenModal(String(entryIdx))}
        onTooltipEnter={(src, sideways) => page.tooltip.setTooltip({ src, sideways })}
        onTooltipLeave={() => page.tooltip.setTooltip(null)}
        collectionFinish={entry?.finish}
        collectionLanguage={storedLanguage(entry?.language)}
        collectionSetCN={
          entry && hasSpecificPrinting(entry)
            ? `${entry.set.toUpperCase()}:${entry.collectorNumber}`
            : undefined
        }
        collectionPrice={entry?.price}
        priceless={cardPricelessReason(c)}
        currency={props.currency}
        cardId={entry?.cardId}
        editMode={props.editMode}
        onIncrement={props.editMode && entry ? () => props.onCardIncrement?.(entry) : undefined}
        onDecrement={props.editMode && entry ? () => props.onCardDecrement?.(entry) : undefined}
        onContextMenu={
          props.editMode
            ? (rect) => props.onCardContextMenu?.(contextInfo(), rect)
            : !props.onCardMove && page.readMenu.enabled()
              ? (rect) => page.readMenu.open(contextInfo(), rect)
              : undefined
        }
        onMove={props.onCardMove ? (rect) => props.onCardMove!(contextInfo(), rect) : undefined}
        onAddToTrade={showTrade ? () => handleWantedAddToTrade(entry, c.card) : undefined}
        addToTradeDisabled={showTrade ? isWantedCardAddDisabled(entry, c.card) : undefined}
        selectable={entry !== undefined}
        selectState={page.selection.state(selectKey)}
        onToggleSelect={() => page.selection.toggle(buildSelected())}
      />
    )
  }

  const modalMeta = createMemo(() => {
    if (!modalEntry() || !modalCard()) return undefined
    const entry = modalEntry()!
    const card = modalCard()!
    const parts: MetaEntry[] = []
    if (pricesEnabled()) {
      parts.push({
        label: 'price',
        value: cardPriceText(t, entry, entry.price, props.currency),
      })
    }
    if (hasSpecificPrinting(entry)) {
      parts.push({
        label: 'set',
        value: `${entry.set.toUpperCase()}:${entry.collectorNumber}`,
      })
    }
    if (entry.finish) {
      parts.push({
        label: 'finish',
        value: finishName(t, entry.finish),
      })
    }
    const stateLabel = wantedStateLabel(t, entry.state)
    if (stateLabel !== undefined) {
      parts.push({ label: 'specificity', value: stateLabel })
    }
    parts.push({
      label: 'rarity',
      value: rarityName(t, card.rarity),
    })
    return parts
  })

  const serializeWanted = (format: ExportFormat): string => {
    switch (format) {
      case 'txt':
        return wantedToText(props.entries)
      case 'md':
        return wantedToMarkdown(
          props.name,
          props.entries,
          sectionOrder(),
          frontMatterFor({ description: props.description, image: props.listImage }),
        )
      case 'csv':
        return wantedToCsv(props.entries)
    }
  }

  // Built once: a stable object keeps the header's `<Show>` from flipping on every read.
  const exportFormats: ListPageExport = { serialize: serializeWanted }

  /** The changelog slot — the pages and the card data they render with, together. */
  const changelogBundle = createMemo((): ListPageChangelog | undefined =>
    props.changelog
      ? { pages: props.changelog, cards: props.cards, printings: props.printings }
      : undefined,
  )

  return (
    <ListPageShell
      page={page}
      title={props.name}
      fullWidth={Boolean(props.fullWidth ?? (props.editMode || props.onCardMove))}
      currency={props.currency}
      symbolMap={props.symbolMap}
      useScryfallImgUrls={props.useScryfallImgUrls}
      enableTrade={props.enableTrade}
      onCombine={props.onCombine}
      export={props.enableExport ? exportFormats : undefined}
      changelog={changelogBundle()}
      enablePriceRefresh={props.enablePriceRefresh}
      statsLead={
        <PageCountAndTotal
          count={props.entries.length}
          total={computedTotalPrice()}
          currency={props.currency}
        />
      }
      beforeCards={
        <ListDescriptionSection description={props.description} symbolMap={props.symbolMap} />
      }
      sections={
        <For each={page.cardGroups()}>
          {(group) => (
            <CardSection
              label={group.key}
              cards={group.cards}
              currency={props.currency}
              secondaryOf={page.toolbar.groupBy() === 'categories' ? group.category : undefined}
              renderCard={renderWantedListCard}
            />
          )}
        </For>
      }
      overlays={
        <>
          <CardModal
            open={Boolean(modalCard())}
            card={modalCard()}
            customArt={modalEntry()?.customArt}
            hasCustomArt={modalEntry()?.hasCustomArt}
            cardName={modalEntry()?.name ?? null}
            symbolMap={props.symbolMap}
            useScryfallImgUrls={props.useScryfallImgUrls}
            currency={props.currency}
            printings={modalPrintings()}
            onClose={props.onCloseModal}
            meta={modalMeta()}
            note={modalEntry()?.note}
            tags={modalEntry()?.tags}
            categories={categoriesFor(modalEntry()?.name)}
            onAddToTrade={modalAddToTrade()}
            addToTradeDisabled={modalAddToTradeDisabled()}
          />

          {/* Trade printing picker for wanted cards without specific printings */}
          <Show when={wantedTradePicker()}>
            {(picker) => (
              <TradePrintingPicker
                cardName={picker().cardName}
                printings={picker().printings}
                loading={false}
                useScryfallImgUrls={props.useScryfallImgUrls}
                currency={props.currency}
                onSelect={handleWantedTradePickerSelect}
                onClose={() => setWantedTradePicker(null)}
              />
            )}
          </Show>
        </>
      }
    />
  )
}
