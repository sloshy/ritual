import type { Component } from 'solid-js'
import { createSignal, createMemo, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import type { ScryfallCard } from '../types'
import type { CollectionCardEntry } from './data-types'
import type { ChangelogPage } from '../changelog-parser'
import type { PriceCurrency } from '../price-currency'
import { getCardPriceForFinish, formatPrice } from '../price-currency'
import {
  type GroupBy,
  type CardData,
  type CardGroup,
  groupAndSortCards,
  CARD_SIZE_WIDTHS,
} from './card-sorting'
import { CardModal } from './CardModal'
import { ChangelogModal } from './ChangelogModal'
import { capitalize } from './utils'
import { useTooltip } from './useTooltip'
import { Toolbar } from './Toolbar'
import { CardSection } from './CardSection'
import { useToolbarState } from './useToolbarState'

type CollectionGroupBy = 'type' | 'cmc' | 'color-identity' | 'price' | 'none'

interface CollectionPageProps {
  name: string
  entries: CollectionCardEntry[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  useScryfallImgUrls?: boolean
  totalPrice: number
  exportMdPath?: string
  exportCsvPath?: string
  modalCardKey: string | null
  onOpenModal: (cardKey: string) => void
  onCloseModal: () => void
  currency: PriceCurrency
  editMode?: boolean
  onAddCard?: () => void
  onCardIncrement?: (entry: CollectionCardEntry) => void
  onCardDecrement?: (entry: CollectionCardEntry) => void
  onCardContextMenu?: (cardKey: string, card: ScryfallCard | null, rect: DOMRect) => void
  unsavedChangeCount?: number
  changelog?: ChangelogPage[]
}

export const CollectionPage: Component<CollectionPageProps> = (props) => {
  const {
    viewMode,
    setViewMode,
    cardSize,
    setCardSize,
    groupBy,
    setGroupBy,
    sortBy,
    setSortBy,
    reverse,
    setReverse,
    reverseGroups,
    setReverseGroups,
    hideLands,
    setHideLands,
    priceGroupStrategy,
    setPriceGroupStrategy,
  } = useToolbarState<CollectionGroupBy>({ groupBy: 'none', sortBy: 'file-order' })
  const [groupDuplicates, setGroupDuplicates] = createSignal(false)
  const [hideUnpriced, setHideUnpriced] = createSignal(false)
  const [showChangelog, setShowChangelog] = createSignal(false)

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  const currencyEntries = createMemo((): CollectionCardEntry[] => {
    return props.entries.map((entry) => {
      const cardKey = `${entry.set}:${entry.collectorNumber}`
      const card = props.cards[cardKey] ?? null
      if (!card) return entry
      const price = getCardPriceForFinish(card, entry.finish, props.currency)
      return { ...entry, price }
    })
  })

  const computedTotalPrice = createMemo(() => {
    return currencyEntries().reduce((sum, e) => sum + e.price, 0)
  })

  // Build flat card list from entries
  const allCards = createMemo((): CardData[] => {
    if (groupDuplicates()) {
      // Group identical entries (same name+set+CN+finish+condition)
      const grouped = new Map<string, { entry: CollectionCardEntry; count: number }>()
      for (const entry of currencyEntries()) {
        const key = `${entry.name}|${entry.set}|${entry.collectorNumber}|${entry.finish}|${entry.condition}`
        const existing = grouped.get(key)
        if (existing) {
          existing.count++
        } else {
          grouped.set(key, { entry, count: 1 })
        }
      }

      const result: CardData[] = []
      for (const { entry, count } of grouped.values()) {
        const cardKey = `${entry.set}:${entry.collectorNumber}`
        const card = props.cards[cardKey] ?? null
        result.push({
          name: entry.name,
          quantity: count,
          cmc: card?.cmc ?? 0,
          edhrec: card?.edhrec_rank ?? 999999,
          price: entry.price,
          type: card?.type_line ?? '',
          section: 'Collection',
          fileOrder: entry.fileOrder,
          setCode: entry.set,
          colorIdentity: card?.color_identity ?? [],
          card,
        })
      }
      return result
    }

    return currencyEntries().map((entry) => {
      const cardKey = `${entry.set}:${entry.collectorNumber}`
      const card = props.cards[cardKey] ?? null
      return {
        name: entry.name,
        quantity: 1,
        cmc: card?.cmc ?? 0,
        edhrec: card?.edhrec_rank ?? 999999,
        price: entry.price,
        type: card?.type_line ?? '',
        section: 'Collection',
        fileOrder: entry.fileOrder,
        setCode: entry.set,
        colorIdentity: card?.color_identity ?? [],
        card,
      }
    })
  })

  const cardGroups = createMemo((): CardGroup[] => {
    let working = [...allCards()]

    if (hideLands()) {
      working = working.filter(
        (c) => !(c.cmc === 0 && (c.type.includes('Land') || c.type.includes('Basic'))),
      )
    }

    if (hideUnpriced()) {
      working = working.filter((c) => c.price > 0)
    }

    return groupAndSortCards(
      working,
      groupBy() as GroupBy,
      sortBy(),
      reverse(),
      [],
      priceGroupStrategy(),
      props.currency,
      reverseGroups(),
    )
  })

  // Find the modal entry and card
  const modalEntry = createMemo((): CollectionCardEntry | null => {
    if (!props.modalCardKey) return null
    const idx = parseInt(props.modalCardKey)
    if (!isNaN(idx) && currencyEntries()[idx]) return currencyEntries()[idx] ?? null
    return null
  })

  const modalCard = createMemo((): ScryfallCard | null => {
    if (!modalEntry()) return null
    const cardKey = `${modalEntry()!.set}:${modalEntry()!.collectorNumber}`
    return props.cards[cardKey] ?? null
  })

  // Pre-computed index map for O(1) entry lookups (avoids O(n²) on large collections)
  const entryIndexMap = createMemo(() => {
    const map = new Map<string, number>()
    currencyEntries().forEach((e, i) => {
      map.set(`${e.name}|${e.set}|${e.fileOrder}`, i)
    })
    return map
  })

  const findEntryIndex = (cardData: CardData): number => {
    return entryIndexMap().get(`${cardData.name}|${cardData.setCode}|${cardData.fileOrder}`) ?? -1
  }

  const renderCollectionCard = (c: CardData) => {
    const entryIdx = findEntryIndex(c)
    const entry = currencyEntries()[entryIdx]
    return (
      <CardItem
        name={c.name}
        quantity={c.quantity}
        card={c.card}
        symbolMap={props.symbolMap}
        viewMode={viewMode()}
        hideCount={!groupDuplicates()}
        useScryfallImgUrls={props.useScryfallImgUrls}
        onCardClick={() => props.onOpenModal(String(entryIdx))}
        onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
        onTooltipLeave={() => setTooltip(null)}
        collectionFinish={entry?.finish}
        collectionCondition={entry?.condition}
        collectionSetCN={entry ? `${entry.set.toUpperCase()}:${entry.collectorNumber}` : undefined}
        collectionPrice={entry?.price}
        currency={props.currency}
        editMode={props.editMode}
        onIncrement={props.editMode && entry ? () => props.onCardIncrement?.(entry) : undefined}
        onDecrement={props.editMode && entry ? () => props.onCardDecrement?.(entry) : undefined}
        onContextMenu={
          props.editMode ? (rect) => props.onCardContextMenu?.(c.name, c.card, rect) : undefined
        }
      />
    )
  }

  const modalMeta = createMemo(() => {
    if (!modalEntry() || !modalCard()) return undefined
    type MetaEntry = { label: string; value: string }
    const entry = modalEntry()!
    const card = modalCard()!
    const parts: MetaEntry[] = []
    parts.push({ label: 'price', value: formatPrice(entry.price, props.currency) })
    parts.push({
      label: 'set',
      value: `${entry.set.toUpperCase()}:${entry.collectorNumber}`,
    })
    if (entry.finish) {
      parts.push({
        label: 'finish',
        value: capitalize(entry.finish),
      })
    }
    if (entry.condition) {
      parts.push({ label: 'condition', value: entry.condition })
    }
    parts.push({
      label: 'rarity',
      value: capitalize(card.rarity),
    })
    return parts
  })

  const modalPrintings = createMemo(() =>
    modalEntry() ? (props.printings[modalEntry()!.name] ?? []) : [],
  )

  return (
    <div class={props.editMode ? 'page-full-width' : 'page-container'}>
      {/* Header */}
      <div class="page-header">
        <div>
          <h1 class="page-title">{props.name}</h1>
          <p class="page-stats">
            {props.entries.length} cards · Total:{' '}
            {formatPrice(computedTotalPrice(), props.currency)}
          </p>
        </div>
        <div class="btn-group">
          <Show when={props.editMode}>
            <button class="site-btn site-btn-add" onClick={props.onAddCard}>
              + Add Card
            </button>
          </Show>
          <Show when={props.changelog && props.changelog!.length > 0}>
            <button
              onClick={() => setShowChangelog(true)}
              class="site-btn site-btn-secondary btn-view-changes"
            >
              View Changes
            </button>
          </Show>
          <Show when={props.exportMdPath}>
            <a href={props.exportMdPath} download="" class="site-btn-download">
              Download MD
            </a>
          </Show>
          <Show when={props.exportCsvPath}>
            <a href={props.exportCsvPath} download="" class="site-btn-download">
              Download CSV
            </a>
          </Show>
        </div>
      </div>
      <Toolbar
        viewMode={viewMode()}
        onViewModeChange={setViewMode}
        cardSize={cardSize()}
        onCardSizeChange={setCardSize}
        groupBy={groupBy()}
        groupByOptions={[
          { value: 'type', label: 'Type' },
          { value: 'cmc', label: 'Mana Value' },
          { value: 'color-identity', label: 'Color Identity' },
          { value: 'price', label: 'Price' },
          { value: 'none', label: 'None' },
        ]}
        onGroupByChange={(v) => setGroupBy(v as CollectionGroupBy)}
        sortBy={sortBy()}
        sortByOptions={[
          { value: 'file-order', label: 'File Order' },
          { value: 'name', label: 'Name' },
          { value: 'cmc', label: 'Mana Value' },
          { value: 'price', label: 'Price' },
          { value: 'color-identity', label: 'Color Identity' },
          { value: 'set-code', label: 'Set Code' },
          { value: 'edhrec', label: 'EDHRec Rank' },
        ]}
        onSortByChange={setSortBy}
        priceGroupStrategy={priceGroupStrategy()}
        onPriceGroupStrategyChange={setPriceGroupStrategy}
        reverse={reverse()}
        onReverseChange={() => setReverse((prev) => !prev)}
        reverseGroups={reverseGroups()}
        onReverseGroupsChange={() => setReverseGroups((prev) => !prev)}
        hideLands={hideLands()}
        onHideLandsChange={() => setHideLands((prev) => !prev)}
        extraCheckboxes={[
          {
            label: 'Group Duplicates',
            checked: groupDuplicates(),
            onChange: () => setGroupDuplicates((prev) => !prev),
          },
          {
            label: 'Hide Unpriced',
            checked: hideUnpriced(),
            onChange: () => setHideUnpriced((prev) => !prev),
          },
        ]}
      />

      {/* Card sections */}
      <div
        class={`card-sections view-${viewMode()}`}
        style={`--card-width:${CARD_SIZE_WIDTHS[cardSize()]}px`}
      >
        <For each={cardGroups()}>
          {(group) => (
            <CardSection
              label={group.key}
              cards={group.cards}
              currency={props.currency}
              renderCard={renderCollectionCard}
            />
          )}
        </For>
      </div>

      {/* List-view hover tooltip */}
      <div
        ref={tooltipRef}
        class={`list-tooltip ${tooltip() ? 'visible' : ''} ${tooltip()?.sideways ? 'list-tooltip-sideways' : ''}`}
        style={`left:${tooltipPos().left}px;top:${tooltipPos().top}px;`}
      >
        <Show when={tooltip()}>
          <img src={tooltip()!.src} alt="" class={tooltip()!.sideways ? 'tooltip-rotated' : ''} />
        </Show>
      </div>

      {/* Card detail modal */}
      <CardModal
        open={Boolean(modalCard())}
        card={modalCard()}
        cardName={modalEntry()?.name ?? null}
        symbolMap={props.symbolMap}
        useScryfallImgUrls={props.useScryfallImgUrls}
        currency={props.currency}
        printings={modalPrintings()}
        onClose={props.onCloseModal}
        meta={modalMeta()}
        note={modalEntry()?.note}
      />

      {/* Changelog modal */}
      <Show when={props.changelog && props.changelog!.length > 0}>
        <ChangelogModal
          open={showChangelog()}
          changelog={props.changelog!}
          cards={props.cards}
          printings={props.printings}
          symbolMap={props.symbolMap}
          useScryfallImgUrls={props.useScryfallImgUrls}
          currency={props.currency}
          onClose={() => setShowChangelog(false)}
        />
      </Show>
    </div>
  )
}
