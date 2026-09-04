import { buylistFieldsFor } from '../list-view/buylist-quotes'
import type { Component } from 'solid-js'
import { useListCategories } from './list-categories'
import { createSignal, createMemo, For } from 'solid-js'
import { CardItem } from './CardItem'
import {
  seedCards,
  seedPrintings,
  overlayCard,
  sessionCacheVersion,
} from '../list-view/session-cache'
import { normalizeCardName } from '../card/term-match'
import { useT } from '../ui/i18n'
import { ListDescriptionSection } from './ListDescription'
import { PageCountAndTotal } from './PageStats'
import type { ScryfallCard } from '../scryfall/types'
import type { CardContextInfo } from '../list-view/card-context'
import type { CollectionCardEntry } from '../list/site-data'
import type { MetaEntry } from '../list-view/meta-entry'
import {
  cardLabelName,
  effectiveLabels,
  labelFiltersFor,
  type CardLabel,
  type CardLabelSelection,
  type PricelessReason,
} from '../card/card-labels'
import { cardPriceText, cardPricelessReason, pricelessFacts } from '../list-view/priceless'
import { pricesEnabled, sitePriceForFinish } from '../list-view/price-view'
import type { CardData, SortBy } from '../list-view/card-sorting'
import { collectionTradeMaxQty, collectionTradeQtyMap } from '../list-view/trade-qty'
import { CardModal } from '../list-view/CardModal'
import { ListPageShell, type ListPageChangelog, type ListPageExport } from './ListPageShell'
import type { FlatListPageProps } from './list-page-props'
import { useListPage } from './useListPage'
import { finishName, rarityName } from '../list-view/printing-display'
import { CardSection } from './CardSection'
import { collectionGroupByOptions, type CollectionGroupBy } from './list-page-options'
import { deriveSectionOrder, sectionDefaultGroupBy } from '../list/section-format'
import { buildEntryIndex, entryAtModalKey, findEntryIndex } from '../list-view/entry-index'
import { buildGroupIdIndex, groupCardIds, groupDuplicateEntries } from './collection-page-logic'
import { addEntryToLeftGuarded, canAddMoreToLeft } from './useTradeState'
import { toastTradeAdd } from './useSelectionTrade'
import type { TradeSearchEntry } from './useTradeData'
import { resolveCardPreview } from '../card/image-sources'
import type { SelectedCard } from '../list-view/useCardSelection'
import type { BulkEditBundle } from '../list-view/selection-edit-actions'
import type { ExportFormat } from './ExportMenu'
import {
  collectionToText,
  collectionToMarkdown,
  collectionToCsv,
  frontMatterFor,
} from '../list/list-export'
import { lookupPrintingCard, printingKey } from '../card/printing-key'
import { languageDisplayName, storedLanguage, type CardLanguage } from '../card/card-language'

// The sort fields this page offers, in order — shared by the toolbar's dropdown
// options and the URL sync's validation of incoming sort layers.
const COLLECTION_SORT_BYS: readonly SortBy[] = [
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

/**
 * The label chips this page offers, and the `labels=` values a shared URL may
 * name here — a collection takes the whole vocabulary. Derived rather than
 * listed, and known synchronously, as the frame's URL sync requires.
 */
const COLLECTION_LABEL_FILTERS: readonly CardLabelSelection[] = labelFiltersFor('collection')

type CollectionPageProps = FlatListPageProps<CollectionCardEntry, BulkEditBundle>

export const CollectionPage: Component<CollectionPageProps> = (props) => {
  const t = useT()

  // Section order, including any empty sections from the build/save payload; falls back to the
  // sections discovered in the entries (in file order) when not provided.
  const sectionOrder = createMemo(() => deriveSectionOrder(props.sectionOrder, props.entries))
  const hasSections = createMemo(() => sectionOrder().length >= 2)

  // Intentional one-time seed for the toolbar's group-by signal (read once at construction;
  // it must not fight the user's later toolbar changes). The editor remounts these pages on
  // each load, so a stale seed is not reachable.
  const initialGroupBy: CollectionGroupBy = sectionDefaultGroupBy(props.entries)

  const [groupDuplicates, setGroupDuplicates] = createSignal(false)

  /**
   * The entry's language as a variant dimension, folded so a bare line and an
   * explicit `en` agree; `undefined` display value means "no badge".
   */
  const entryLanguage = (entry: CollectionCardEntry): CardLanguage | undefined =>
    storedLanguage(entry.language)

  /**
   * The card object an entry *displays*: the `@lang` object for a non-en entry
   * when the build baked one, else the printing's default-language object.
   * Pricing deliberately does not use this — an entry prices from its printing's
   * default object regardless of language (see `currencyEntries`).
   */
  const entryCard = (entry: CollectionCardEntry): ScryfallCard | null =>
    overlayCard(lookupPrintingCard(props.cards, entry))

  // Aggregate copy counts per card variant for correct trade maxQty. Shared with
  // the combined view, which caps its unmerged tiles from the same groups.
  const collectionQtyMap = createMemo(() => collectionTradeQtyMap(props.entries))

  /** An entry's effective labels: its own override, else the list default. */
  const entryLabels = (entry: CollectionCardEntry): CardLabel[] =>
    effectiveLabels(entry.labels, props.listLabels)

  /**
   * Whether this copy carries no price by rule — a proxy (not a real card) or a
   * copy wearing custom art (not the printing a price would be for).
   */
  const entryPricelessReason = (entry: CollectionCardEntry): PricelessReason | undefined =>
    cardPricelessReason(pricelessFacts(entry, entryLabels(entry)))

  /**
   * The price cell's text for an entry: the marker when the copy carries no
   * price by rule, the formatted amount otherwise. "$0.00" would read as a
   * price rather than as the refusal to quote one.
   */
  const entryPriceText = (entry: CollectionCardEntry): string =>
    cardPriceText(t, pricelessFacts(entry, entryLabels(entry)), entry.price, props.currency)

  const buildCollectionSearchEntry = (
    entry: CollectionCardEntry,
    scryfallCard: ScryfallCard | null,
  ): TradeSearchEntry => {
    const maxQty = collectionTradeMaxQty(entry, collectionQtyMap())
    const labels = entryLabels(entry)
    return {
      name: entry.name,
      nameKey: normalizeCardName(entry.name),
      set: entry.set.toLowerCase(),
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
      language: entryLanguage(entry),
      labels: labels.length > 0 ? labels : undefined,
      tags: entry.tags,
      customArt: entry.customArt,
      hasCustomArt: entry.hasCustomArt,
      note: entry.note,
      price: entry.price,
      scryfallCard,
      sourceName: props.name,
      sourceKind: 'collection',
      maxQty,
      cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
    }
  }

  const handleCollectionAddToTrade = async (entry: CollectionCardEntry) => {
    const scryfallCard = entryCard(entry)
    const searchEntry = buildCollectionSearchEntry(entry, scryfallCard)
    // Guarded: a keep-labeled card confirms once before its first trade add.
    // This one handler covers both the tile "+ Trade" button and the card modal.
    if (await addEntryToLeftGuarded(searchEntry, props.currency))
      toastTradeAdd(searchEntry, props.useScryfallImgUrls ?? false)
  }

  const isCollectionCardAddDisabled = (entry: CollectionCardEntry): boolean => {
    const searchEntry = buildCollectionSearchEntry(entry, entryCard(entry))
    return !canAddMoreToLeft(searchEntry)
  }

  const currencyEntries = createMemo((): CollectionCardEntry[] => {
    sessionCacheVersion() // re-price after an in-session "Update Prices"
    return props.entries.map((entry) => {
      const cardKey = printingKey(entry.set, entry.collectorNumber)
      const card = overlayCard(props.cards[cardKey] ?? null)
      if (!card) return entry
      // A proxy and a custom-art copy price at 0 in every currency — the same
      // rule the bake and the price report apply, restated here because this
      // recompute replaces the baked figure whenever the currency changes or
      // prices are refreshed.
      const price =
        entryPricelessReason(entry) !== undefined
          ? 0
          : sitePriceForFinish(card, entry.finish, props.currency)
      return { ...entry, price }
    })
  })

  const computedTotalPrice = createMemo(() => {
    return currencyEntries().reduce((sum, e) => sum + e.price, 0)
  })

  // Build flat card list from entries. The displayed card is language-resolved
  // (a `[ja]` entry shows its ja scan when baked); the price stays the one
  // `currencyEntries` computed from the printing's default-language object.
  // Resolved from the list's own record rather than read off the entry: the
  // editing panes carry no baked categories on their card data and pass the live
  // record instead. See `useListCategories`.
  const { categoriesFor, categoriesField } = useListCategories(() => props.categories)

  const toCardData = (entry: CollectionCardEntry, quantity: number): CardData => {
    const card = entryCard(entry)
    const labels = entryLabels(entry)
    return {
      name: entry.name,
      quantity,
      cmc: card?.cmc ?? 0,
      edhrec: card?.edhrec_rank ?? 999999,
      price: entry.price,
      type: card?.type_line ?? '',
      section: entry.section,
      fileOrder: entry.fileOrder,
      // Lowercased like the identical builder in `combined-list.ts`. Paired with
      // `entryIndexMap` below, which keys on the same value.
      setCode: entry.set.toLowerCase(),
      colorIdentity: card?.color_identity ?? [],
      hasPrinting: true,
      pinnedPrintingKey: printingKey(entry.set, entry.collectorNumber),
      oracleTags: card?.oracleTags ?? [],
      artTags: card?.artTags ?? [],
      labels,
      tags: entry.tags,
      ...categoriesField(entry.name),
      customArt: entry.customArt,
      hasCustomArt: entry.hasCustomArt,
      finish: entry.finish,
      language: entryLanguage(entry),
      ...buylistFieldsFor(card, entry.finish, entry.language, pricelessFacts(entry, labels)),
      card,
    }
  }

  const allCards = createMemo((): CardData[] => {
    if (groupDuplicates()) {
      return groupDuplicateEntries(currencyEntries()).map(({ entry, count }) =>
        toCardData(entry, count),
      )
    }
    return currencyEntries().map((entry) => toCardData(entry, 1))
  })

  const page = useListPage<CollectionGroupBy, CardData>({
    identity: { kind: 'collection', name: props.name, slug: () => props.slug },
    options: {
      groupByOptionsFor: (sellMode) => collectionGroupByOptions(sellMode, hasSections()),
      sortBys: COLLECTION_SORT_BYS,
      availableLabels: () => COLLECTION_LABEL_FILTERS,
      defaults: { groupBy: initialGroupBy, sortBy: 'file-order' },
    },
    cards: allCards,
    sectionOrder,
    categoryOrder: () => props.categories?.order ?? [],
    // Seed the session cache from this collection's baked card data so the
    // editor's card search and the trade page reuse it instead of re-fetching.
    seed: () => {
      seedCards(props.cards)
      seedPrintings(props.printings)
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

  // Language-resolved like the tiles, so a `[ja]` entry's modal shows the ja scan.
  const modalCard = createMemo((): ScryfallCard | null => {
    const entry = modalEntry()
    if (!entry) return null
    return entryCard(entry)
  })

  const modalAddToTrade = createMemo(() => {
    const entry = modalEntry()
    if (!entry || props.editMode || props.onCardMove) return undefined
    return () => void handleCollectionAddToTrade(entry)
  })

  const modalAddToTradeDisabled = createMemo(() => {
    const entry = modalEntry()
    if (!entry) return true
    return isCollectionCardAddDisabled(entry)
  })

  const modalPrintings = createMemo(() =>
    modalEntry() ? (props.printings[modalEntry()!.name] ?? []) : [],
  )

  // Pre-computed index map for O(1) entry lookups (avoids O(n²) on large collections)
  const entryIndexMap = createMemo(() => buildEntryIndex(currencyEntries()))

  const entryIndexOf = (cardData: CardData): number => findEntryIndex(entryIndexMap(), cardData)

  // All card IDs a tile represents: every entry sharing the grouped tile's
  // duplicateGroupKey (or just the single entry when not grouping). The key →
  // IDs index is built once per card list, not once per tile.
  const groupIdIndex = createMemo(() => buildGroupIdIndex(currencyEntries()))

  const cardIdsOf = (entry: CollectionCardEntry): number[] =>
    groupCardIds(groupIdIndex(), entry, groupDuplicates())

  const renderCollectionCard = (c: CardData) => {
    const entryIdx = entryIndexOf(c)
    const entry = currencyEntries()[entryIdx]
    const showTrade = !props.editMode && !props.onCardMove && entry !== undefined
    const selectKey = String(entryIdx)
    const buildSelected = (): SelectedCard => {
      const preview = resolveCardPreview(c.card, Boolean(props.useScryfallImgUrls), c.customArt)
      return {
        key: selectKey,
        name: c.name,
        set: entry?.set.toLowerCase(),
        collectorNumber: entry?.collectorNumber,
        finish: entry?.finish,
        condition: entry?.condition,
        language: entry ? entryLanguage(entry) : undefined,
        labels: entry ? entryLabels(entry) : undefined,
        tags: entry?.tags,
        customArt: c.customArt,
        hasCustomArt: c.hasCustomArt,
        note: entry?.note,
        quantity: c.quantity,
        groupSize: c.quantity,
        price: c.price,
        scryfallCard: c.card,
        image: preview.image || undefined,
        sideways: preview.sideways,
        sourceName: props.name,
        sourceSlug: props.slug,
        sourceKind: 'collection',
        maxQty: c.quantity,
        cardIds: entry ? cardIdsOf(entry) : [],
      }
    }
    const contextInfo = (): CardContextInfo => ({
      cardName: c.name,
      card: c.card,
      cardIds: entry ? cardIdsOf(entry) : [],
      quantity: c.quantity,
      set: entry?.set,
      collectorNumber: entry?.collectorNumber,
      finish: entry?.finish,
      condition: entry?.condition,
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
        hideCount={!groupDuplicates()}
        useScryfallImgUrls={props.useScryfallImgUrls}
        onCardClick={() => props.onOpenModal(String(entryIdx))}
        onTooltipEnter={(src, sideways) => page.tooltip.setTooltip({ src, sideways })}
        onTooltipLeave={() => page.tooltip.setTooltip(null)}
        collectionFinish={entry?.finish}
        collectionCondition={entry?.condition}
        collectionLanguage={entry ? entryLanguage(entry) : undefined}
        collectionSetCN={entry ? `${entry.set.toUpperCase()}:${entry.collectorNumber}` : undefined}
        collectionPrice={entry?.price}
        labelBadges={entry?.labels}
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
        onAddToTrade={showTrade ? () => void handleCollectionAddToTrade(entry) : undefined}
        addToTradeDisabled={showTrade ? isCollectionCardAddDisabled(entry) : undefined}
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
    if (pricesEnabled()) parts.push({ label: 'price', value: entryPriceText(entry) })
    parts.push({
      label: 'set',
      value: `${entry.set.toUpperCase()}:${entry.collectorNumber}`,
    })
    if (entry.finish) {
      parts.push({
        label: 'finish',
        value: finishName(t, entry.finish),
      })
    }
    if (entry.condition) {
      parts.push({ label: 'condition', value: entry.condition })
    }
    const language = entryLanguage(entry)
    if (language) {
      parts.push({ label: 'language', value: languageDisplayName(language) })
    }
    // The modal is the full-truth view, so it shows the *effective* labels —
    // inherited defaults included — unlike the tiles, which badge overrides only.
    const labels = entryLabels(entry)
    if (labels.length > 0) {
      parts.push({
        label: 'labels',
        value: labels.map(cardLabelName).join(' · '),
      })
    }
    parts.push({
      label: 'rarity',
      value: rarityName(t, card.rarity),
    })
    return parts
  })

  const serializeCollection = (format: ExportFormat): string => {
    switch (format) {
      case 'txt':
        return collectionToText(props.entries)
      case 'md':
        return collectionToMarkdown(
          props.name,
          props.entries,
          sectionOrder(),
          frontMatterFor({
            description: props.description,
            labels: props.listLabels,
            image: props.listImage,
          }),
        )
      case 'csv':
        return collectionToCsv(props.entries)
    }
  }

  // Built once: a stable object keeps the header's `<Show>` from flipping on every read.
  const exportFormats: ListPageExport = { serialize: serializeCollection }

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
      extraToggles={[
        {
          label: t('site.collection.groupDuplicates'),
          checked: groupDuplicates(),
          onChange: () => setGroupDuplicates((prev) => !prev),
        },
      ]}
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
              renderCard={renderCollectionCard}
            />
          )}
        </For>
      }
      overlays={
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
      }
    />
  )
}
