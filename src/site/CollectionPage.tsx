import type { FunctionalComponent } from 'preact'
import { useState, useMemo } from 'preact/hooks'
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
  onCardContextMenu?: (cardKey: string, card: ScryfallCard | null) => void
  unsavedChangeCount?: number
  changelog?: ChangelogPage[]
}

export const CollectionPage: FunctionalComponent<CollectionPageProps> = ({
  name,
  entries,
  cards,
  printings,
  symbolMap,
  useScryfallImgUrls,
  totalPrice: _totalPrice,
  exportMdPath,
  exportCsvPath,
  modalCardKey,
  onOpenModal,
  onCloseModal,
  currency,
  editMode,
  onAddCard,
  onCardIncrement,
  onCardDecrement,
  onCardContextMenu,
  unsavedChangeCount: _unsavedChangeCount,
  changelog,
}) => {
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
    hideLands,
    setHideLands,
    priceGroupStrategy,
    setPriceGroupStrategy,
  } = useToolbarState<CollectionGroupBy>({ groupBy: 'none', sortBy: 'file-order' })
  const [groupDuplicates, setGroupDuplicates] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  const currencyEntries = useMemo((): CollectionCardEntry[] => {
    return entries.map((entry) => {
      const cardKey = `${entry.set}:${entry.collectorNumber}`
      const card = cards[cardKey] ?? null
      if (!card) return entry
      const price = getCardPriceForFinish(card, entry.finish, currency)
      return { ...entry, price }
    })
  }, [entries, cards, currency])

  const computedTotalPrice = useMemo(() => {
    return currencyEntries.reduce((sum, e) => sum + e.price, 0)
  }, [currencyEntries])

  // Build flat card list from entries
  const allCards = useMemo((): CardData[] => {
    if (groupDuplicates) {
      // Group identical entries (same name+set+CN+finish+condition)
      const grouped = new Map<string, { entry: CollectionCardEntry; count: number }>()
      for (const entry of currencyEntries) {
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
        const card = cards[cardKey] ?? null
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

    return currencyEntries.map((entry) => {
      const cardKey = `${entry.set}:${entry.collectorNumber}`
      const card = cards[cardKey] ?? null
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
  }, [currencyEntries, cards, groupDuplicates])

  const cardGroups = useMemo((): CardGroup[] => {
    let working = [...allCards]

    if (hideLands) {
      working = working.filter(
        (c) => !(c.cmc === 0 && (c.type.includes('Land') || c.type.includes('Basic'))),
      )
    }

    return groupAndSortCards(
      working,
      groupBy as GroupBy,
      sortBy,
      reverse,
      [],
      priceGroupStrategy,
      currency,
    )
  }, [allCards, groupBy, sortBy, reverse, hideLands, priceGroupStrategy, currency])

  // Find the modal entry and card
  const modalEntry = useMemo((): CollectionCardEntry | null => {
    if (!modalCardKey) return null
    const idx = parseInt(modalCardKey)
    if (!isNaN(idx) && currencyEntries[idx]) return currencyEntries[idx]
    return null
  }, [modalCardKey, currencyEntries])

  const modalCard = useMemo((): ScryfallCard | null => {
    if (!modalEntry) return null
    const cardKey = `${modalEntry.set}:${modalEntry.collectorNumber}`
    return cards[cardKey] ?? null
  }, [modalEntry, cards])

  const viewModeClass = `view-${viewMode}`

  // Pre-computed index map for O(1) entry lookups (avoids O(n²) on large collections)
  const entryIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    currencyEntries.forEach((e, i) => {
      map.set(`${e.name}|${e.set}|${e.fileOrder}`, i)
    })
    return map
  }, [currencyEntries])

  const findEntryIndex = (cardData: CardData): number => {
    return entryIndexMap.get(`${cardData.name}|${cardData.setCode}|${cardData.fileOrder}`) ?? -1
  }

  const renderCollectionCard = (c: CardData) => {
    const entryIdx = findEntryIndex(c)
    const entry = currencyEntries[entryIdx]
    const cardKey = `${c.name}|${c.setCode}|${c.fileOrder}`
    return (
      <CardItem
        key={cardKey}
        name={c.name}
        quantity={c.quantity}
        card={c.card}
        symbolMap={symbolMap}
        viewMode={viewMode}
        hideCount={!groupDuplicates}
        useScryfallImgUrls={useScryfallImgUrls}
        onCardClick={() => onOpenModal(String(entryIdx))}
        onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
        onTooltipLeave={() => setTooltip(null)}
        collectionFinish={entry?.finish}
        collectionCondition={entry?.condition}
        collectionSetCN={entry ? `${entry.set.toUpperCase()}:${entry.collectorNumber}` : undefined}
        collectionPrice={entry?.price}
        currency={currency}
        editMode={editMode}
        onIncrement={editMode && entry ? () => onCardIncrement?.(entry) : undefined}
        onDecrement={editMode && entry ? () => onCardDecrement?.(entry) : undefined}
        onContextMenu={editMode ? () => onCardContextMenu?.(c.name, c.card) : undefined}
      />
    )
  }

  const modalMeta = useMemo(() => {
    if (!modalEntry || !modalCard) return undefined
    type MetaEntry = { label: string; value: string }
    const parts: MetaEntry[] = []
    parts.push({ label: 'price', value: formatPrice(modalEntry.price, currency) })
    parts.push({
      label: 'set',
      value: `${modalEntry.set.toUpperCase()}:${modalEntry.collectorNumber}`,
    })
    if (modalEntry.finish) {
      parts.push({
        label: 'finish',
        value: capitalize(modalEntry.finish),
      })
    }
    if (modalEntry.condition) {
      parts.push({ label: 'condition', value: modalEntry.condition })
    }
    parts.push({
      label: 'rarity',
      value: capitalize(modalCard.rarity),
    })
    return parts
  }, [modalEntry, modalCard, currency])

  const modalPrintings = useMemo(
    () => (modalEntry ? (printings[modalEntry.name] ?? []) : []),
    [modalEntry, printings],
  )

  return (
    <div className={editMode ? 'w-full' : 'container mx-auto'}>
      {/* Header */}
      <div className="mb-6 flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{name}</h1>
          <p className="text-sm text-gray-400">
            {entries.length} cards · Total: {formatPrice(computedTotalPrice, currency)}
          </p>
        </div>
        <div className="flex gap-2">
          {editMode && (
            <button
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-semibold transition-colors cursor-pointer"
              onClick={onAddCard}
            >
              + Add Card
            </button>
          )}
          {changelog && changelog.length > 0 && (
            <button
              onClick={() => setShowChangelog(true)}
              className="btn-view-changes px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs font-semibold transition-colors cursor-pointer"
            >
              View Changes
            </button>
          )}
          {exportMdPath && (
            <a
              href={exportMdPath}
              download
              className="px-3 py-1 bg-gray-800 text-gray-200 rounded border border-gray-700 hover:bg-gray-700 text-sm"
            >
              Download MD
            </a>
          )}
          {exportCsvPath && (
            <a
              href={exportCsvPath}
              download
              className="px-3 py-1 bg-gray-800 text-gray-200 rounded border border-gray-700 hover:bg-gray-700 text-sm"
            >
              Download CSV
            </a>
          )}
        </div>
      </div>
      <Toolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        cardSize={cardSize}
        onCardSizeChange={setCardSize}
        groupBy={groupBy}
        groupByOptions={[
          { value: 'type', label: 'Type' },
          { value: 'cmc', label: 'Mana Value' },
          { value: 'color-identity', label: 'Color Identity' },
          { value: 'price', label: 'Price' },
          { value: 'none', label: 'None' },
        ]}
        onGroupByChange={(v) => setGroupBy(v as CollectionGroupBy)}
        sortBy={sortBy}
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
        priceGroupStrategy={priceGroupStrategy}
        onPriceGroupStrategyChange={setPriceGroupStrategy}
        reverse={reverse}
        onReverseChange={() => setReverse((prev) => !prev)}
        hideLands={hideLands}
        onHideLandsChange={() => setHideLands((prev) => !prev)}
        extraCheckboxes={[
          {
            label: 'Group Duplicates',
            checked: groupDuplicates,
            onChange: () => setGroupDuplicates((prev) => !prev),
          },
        ]}
      />

      {/* Card sections */}
      <div
        className={`space-y-6 ${viewModeClass}`}
        style={`--card-width:${CARD_SIZE_WIDTHS[cardSize]}px`}
      >
        {cardGroups.map((group) => (
          <CardSection
            key={group.key}
            label={group.key}
            cards={group.cards}
            currency={currency}
            renderCard={renderCollectionCard}
          />
        ))}
      </div>

      {/* List-view hover tooltip */}
      <div
        ref={tooltipRef}
        className={`list-tooltip ${tooltip ? 'visible' : ''} ${tooltip?.sideways ? 'list-tooltip-sideways' : ''}`}
        style={`left:${tooltipPos.left}px;top:${tooltipPos.top}px;`}
      >
        {tooltip && (
          <img src={tooltip.src} alt="" className={tooltip.sideways ? 'tooltip-rotated' : ''} />
        )}
      </div>

      {/* Card detail modal */}
      <CardModal
        open={Boolean(modalCard)}
        card={modalCard}
        cardName={modalEntry?.name ?? null}
        symbolMap={symbolMap}
        useScryfallImgUrls={useScryfallImgUrls}
        currency={currency}
        printings={modalPrintings}
        onClose={onCloseModal}
        meta={modalMeta}
        note={modalEntry?.note}
      />

      {/* Changelog modal */}
      {changelog && changelog.length > 0 && (
        <ChangelogModal
          open={showChangelog}
          changelog={changelog}
          cards={cards}
          printings={printings}
          symbolMap={symbolMap}
          useScryfallImgUrls={useScryfallImgUrls}
          currency={currency}
          onClose={() => setShowChangelog(false)}
        />
      )}
    </div>
  )
}
