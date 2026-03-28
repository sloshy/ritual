import type { FunctionalComponent } from 'preact'
import { useState, useMemo, useCallback, useEffect } from 'preact/hooks'
import { CardItem } from './CardItem'
import type { DeckData, ScryfallCard } from '../types'
import type { ChangelogPage } from '../changelog-parser'
import { SymbolText } from './symbols'
import type { PriceCurrency } from '../price-currency'
import { getCardPrice, formatPrice } from '../price-currency'
import {
  type GroupBy,
  type CardData,
  type CardGroup,
  groupAndSortCards,
  groupTotalPrice,
  CARD_SIZE_WIDTHS,
} from './card-sorting'
import { CardModal } from './CardModal'
import { ChangelogModal } from './ChangelogModal'
import { useTooltip } from './useTooltip'
import { Toolbar } from './Toolbar'
import { CardSection } from './CardSection'
import { useToolbarState } from './useToolbarState'
import { PrimerRenderer, buildToc } from './PrimerRenderer'

const isCommanderSection = (s: string): boolean => s.toLowerCase().includes('commander')
const isSideboardSection = (s: string): boolean => s.toLowerCase().includes('sideboard')
const isExtraSection = (s: string): boolean => {
  const low = s.toLowerCase()
  return low.includes('maybeboard') || low.includes('token')
}

export interface DeckPageProps {
  deck: DeckData
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  lowestPriceCards?: Record<string, ScryfallCard | null>
  lowestPriceCardsEur?: Record<string, ScryfallCard | null>
  lowestPriceCardsTix?: Record<string, ScryfallCard | null>
  symbolMap: Record<string, string>
  exportPath?: string
  useScryfallImgUrls?: boolean
  modalCardName: string | null
  onOpenModal: (cardName: string) => void
  onCloseModal: () => void
  currency: PriceCurrency
  missingCards?: Partial<Record<PriceCurrency, string[]>>
  slug: string
  primerOpen?: boolean
  sectionId?: string
  editMode?: boolean
  onAddCard?: () => void
  onCardIncrement?: (cardName: string) => void
  onCardDecrement?: (cardName: string) => void
  onCardContextMenu?: (cardName: string, card: ScryfallCard | null, rect: DOMRect) => void
  unsavedChangeCount?: number
  changelog?: ChangelogPage[]
}

export const DeckPage: FunctionalComponent<DeckPageProps> = ({
  deck,
  cards,
  printings,
  lowestPriceCards,
  lowestPriceCardsEur,
  lowestPriceCardsTix,
  symbolMap,
  exportPath,
  useScryfallImgUrls,
  modalCardName,
  onOpenModal,
  onCloseModal,
  currency,
  missingCards,
  slug,
  primerOpen,
  sectionId,
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
  } = useToolbarState<GroupBy>({ groupBy: 'type', sortBy: 'name' })
  const [hideExtras, setHideExtras] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [lowestPrice, setLowestPrice] = useState(false)
  const [missingCardsExpanded, setMissingCardsExpanded] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)

  // Missing cards for current currency
  const currentMissingCards = useMemo(() => {
    if (!missingCards) return []
    return missingCards[currency] ?? []
  }, [missingCards, currency])

  // Active card map based on lowest price toggle and currency
  const activeCards = useMemo(() => {
    if (lowestPrice) {
      if (currency === 'eur' && lowestPriceCardsEur) return lowestPriceCardsEur
      if (currency === 'tix' && lowestPriceCardsTix) return lowestPriceCardsTix
      if (lowestPriceCards) return lowestPriceCards
    }
    return cards
  }, [lowestPrice, lowestPriceCards, lowestPriceCardsEur, lowestPriceCardsTix, cards, currency])

  const hasLowestPriceCards = Boolean(
    lowestPriceCards || lowestPriceCardsEur || lowestPriceCardsTix,
  )

  // Tooltip state for list-view hover preview
  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  // Build flat card list with metadata
  const allCards = useMemo((): CardData[] => {
    const result: CardData[] = []
    let order = 0
    for (const section of deck.sections) {
      for (const entry of section.cards) {
        const card = activeCards[entry.name] ?? null
        result.push({
          name: entry.name,
          quantity: entry.quantity,
          cmc: card?.cmc ?? 0,
          edhrec: card?.edhrec_rank ?? 999999,
          price: card ? getCardPrice(card, currency) : 0,
          type: card?.type_line ?? '',
          section: section.name,
          fileOrder: order++,
          setCode: card?.set ?? '',
          colorIdentity: card?.color_identity ?? [],
          card,
        })
      }
    }
    return result
  }, [deck, activeCards, currency])

  const sectionOrder = useMemo(() => {
    return deck.sections.map((s) => s.name)
  }, [deck])

  // Partition all cards into categories in a single O(n) pass so we avoid
  // re-scanning allCards separately for commander, sideboard, extras, and
  // mainboard.  cardGroups can then depend on mainboardCards rather than
  // allCards, so toolbar changes (groupBy, sortBy…) no longer re-trigger the
  // categorisation step.
  const { commanderCards, sideboardCards, extraCards, mainboardCards } = useMemo(() => {
    const commanderCards: CardData[] = []
    const sideboardCards: CardData[] = []
    const extraCards: CardData[] = []
    const mainboardCards: CardData[] = []
    for (const c of allCards) {
      if (isCommanderSection(c.section)) commanderCards.push(c)
      else if (isSideboardSection(c.section)) sideboardCards.push(c)
      else if (isExtraSection(c.section)) extraCards.push(c)
      else mainboardCards.push(c)
    }
    return { commanderCards, sideboardCards, extraCards, mainboardCards }
  }, [allCards])

  // Sorted and grouped cards (mainboard only)
  const cardGroups = useMemo((): CardGroup[] => {
    let working = mainboardCards

    if (hideLands) {
      working = working.filter(
        (c) => !(c.cmc === 0 && (c.type.includes('Land') || c.type.includes('Basic'))),
      )
    }

    return groupAndSortCards(
      working,
      groupBy,
      sortBy,
      reverse,
      sectionOrder,
      priceGroupStrategy,
      currency,
    )
  }, [
    mainboardCards,
    groupBy,
    sortBy,
    reverse,
    hideLands,
    sectionOrder,
    priceGroupStrategy,
    currency,
  ])

  // Deck price = mainboard + commander + sideboard only
  const mainAndSideboardCards = useMemo(() => {
    return [...commanderCards, ...mainboardCards, ...sideboardCards]
  }, [commanderCards, mainboardCards, sideboardCards])

  const totalPrice = useMemo(() => {
    return groupTotalPrice(mainAndSideboardCards)
  }, [mainAndSideboardCards])

  // Extras price (maybeboard, tokens)
  const extrasPrice = useMemo(() => {
    return groupTotalPrice(extraCards)
  }, [extraCards])

  // Modal card data
  const modalCard = useMemo((): ScryfallCard | null => {
    if (!modalCardName) return null
    return activeCards[modalCardName] ?? null
  }, [modalCardName, activeCards])

  const handleCopy = useCallback(async () => {
    if (!exportPath) return
    try {
      setCopyStatus('Fetching...')
      const response = await fetch(exportPath)
      if (!response.ok) throw new Error('Failed to fetch deck list')
      const text = await response.text()
      await navigator.clipboard.writeText(text)
      setCopyStatus('Copied!')
      setTimeout(() => setCopyStatus(null), 2000)
    } catch {
      setCopyStatus('Error!')
      setTimeout(() => setCopyStatus(null), 2000)
    }
  }, [exportPath])

  const viewModeClass = `view-${viewMode}`

  const renderDeckCard = (hideCount: boolean) => (c: CardData) => (
    <CardItem
      key={c.name}
      name={c.name}
      quantity={c.quantity}
      card={c.card}
      symbolMap={symbolMap}
      viewMode={viewMode}
      hideCount={hideCount}
      useScryfallImgUrls={useScryfallImgUrls}
      onCardClick={() => onOpenModal(c.name)}
      onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
      onTooltipLeave={() => setTooltip(null)}
      currency={currency}
      editMode={editMode}
      onIncrement={editMode ? () => onCardIncrement?.(c.name) : undefined}
      onDecrement={editMode ? () => onCardDecrement?.(c.name) : undefined}
      onContextMenu={editMode ? (rect) => onCardContextMenu?.(c.name, c.card, rect) : undefined}
    />
  )

  const modalPrintings = useMemo(() => {
    if (!modalCardName) return []
    const direct = printings[modalCardName]
    if (direct) return direct
    // Fall back to the card's actual Scryfall name — primer keys may differ in
    // punctuation/casing from the deck's card name key used to index printings.
    const actualName = modalCard?.name
    return (actualName ? printings[actualName] : undefined) ?? []
  }, [modalCardName, modalCard, printings])

  return (
    <div className={editMode ? 'w-full' : 'container mx-auto'}>
      {/* Header */}
      <div className="mb-6 flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{deck.name}</h1>
          <p className="text-sm text-gray-400">
            Total: {formatPrice(totalPrice, currency)}
            {!hideExtras && extraCards.length > 0 && (
              <span className="text-gray-500">
                {' '}
                (all cards: {formatPrice(totalPrice + extrasPrice, currency)})
              </span>
            )}
          </p>
          {deck.sourceUrl && (
            <a
              href={deck.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-gray-400 hover:text-white"
            >
              Imported from{' '}
              {(() => {
                if (deck.sourceUrl.includes('moxfield.com')) return 'Moxfield'
                if (deck.sourceUrl.includes('archidekt.com')) return 'Archidekt'
                if (deck.sourceUrl.includes('mtggoldfish.com')) return 'MTGGoldfish'
                return 'Source'
              })()}{' '}
              ↗
            </a>
          )}
        </div>
        {(exportPath || editMode || (changelog && changelog.length > 0)) && (
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
            {exportPath && (
              <a
                href={exportPath}
                download={`${deck.name.replace(/[^a-zA-Z0-9]/g, '_')}.txt`}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs font-semibold transition-colors"
              >
                Download
              </a>
            )}
            {exportPath && (
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold transition-colors cursor-pointer"
              >
                {copyStatus ?? 'Copy'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <Toolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        cardSize={cardSize}
        onCardSizeChange={setCardSize}
        groupBy={groupBy}
        groupByOptions={[
          { value: 'type', label: 'Type' },
          { value: 'section', label: 'Section' },
          { value: 'cmc', label: 'Mana Value' },
          { value: 'color-identity', label: 'Color Identity' },
          { value: 'price', label: 'Price' },
          { value: 'none', label: 'None' },
        ]}
        onGroupByChange={(v) => setGroupBy(v as GroupBy)}
        sortBy={sortBy}
        sortByOptions={[
          { value: 'name', label: 'Name' },
          { value: 'cmc', label: 'Mana Value' },
          { value: 'price', label: 'Price' },
          { value: 'color-identity', label: 'Color Identity' },
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
            label: 'Hide Extras',
            checked: hideExtras,
            onChange: () => setHideExtras((prev) => !prev),
          },
          ...(hasLowestPriceCards
            ? [
                {
                  label: 'Lowest Price',
                  checked: lowestPrice,
                  onChange: () => setLowestPrice((prev) => !prev),
                },
              ]
            : []),
        ]}
      />

      {/* Description / Primer */}
      {(deck.description || deck.primer) && (
        <div className="mb-6">
          {deck.description && (
            <div className="mb-4 text-sm text-gray-300">
              {deck.description.length > 200 ? (
                <ExpandableText text={deck.description} symbolMap={symbolMap} />
              ) : (
                <div className="whitespace-pre-wrap">
                  <SymbolText text={deck.description} symbolMap={symbolMap} />
                </div>
              )}
            </div>
          )}
          {deck.primer && (
            <div className="text-sm text-gray-300">
              <ExpandablePrimer
                primer={deck.primer}
                slug={slug}
                cards={activeCards}
                onOpenModal={onOpenModal}
                primerOpen={primerOpen}
                sectionId={sectionId}
              />
            </div>
          )}
        </div>
      )}

      {/* Missing cards warning banner */}
      {currentMissingCards.length > 0 && (
        <div className="missing-cards-banner">
          <button
            type="button"
            className="missing-cards-banner-toggle"
            onClick={() => setMissingCardsExpanded((prev) => !prev)}
          >
            <span>⚠️</span>
            <span className="flex-1 text-left">
              {currentMissingCards.length} card{currentMissingCards.length > 1 ? 's' : ''} missing{' '}
              {currency.toUpperCase()} pricing
            </span>
            <span className="text-xs">{missingCardsExpanded ? '▲' : '▼'}</span>
          </button>
          {missingCardsExpanded && (
            <div className="missing-cards-banner-list">
              <ul>
                {currentMissingCards.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Card sections */}
      <div
        className={`space-y-6 ${viewModeClass}`}
        style={`--card-width:${CARD_SIZE_WIDTHS[cardSize]}px`}
      >
        {/* Commander section always shown first */}
        {commanderCards.length > 0 && (
          <CardSection
            label={
              deck.sections.find((s) => s.name.toLowerCase().includes('commander'))?.name ??
              'Commander'
            }
            cards={commanderCards}
            currency={currency}
            renderCard={renderDeckCard(true)}
          />
        )}

        {/* Dynamic sorted/grouped sections (mainboard only) */}
        {cardGroups.map((group) => (
          <CardSection
            key={group.key}
            label={group.key}
            cards={group.cards}
            currency={currency}
            renderCard={renderDeckCard(false)}
          />
        ))}

        {/* Sideboard always shown at bottom, ungrouped */}
        {sideboardCards.length > 0 && (
          <CardSection
            label={deck.sections.find((s) => isSideboardSection(s.name))?.name ?? 'Sideboard'}
            cards={sideboardCards}
            currency={currency}
            renderCard={renderDeckCard(false)}
          />
        )}

        {/* Extras (maybeboard, tokens) shown below sideboard, ungrouped */}
        {!hideExtras &&
          extraCards.length > 0 &&
          deck.sections
            .filter((s) => isExtraSection(s.name))
            .map((s) => {
              const sectionCards = extraCards.filter((c) => c.section === s.name)
              if (sectionCards.length === 0) return null
              return (
                <CardSection
                  key={s.name}
                  label={s.name}
                  cards={sectionCards}
                  currency={currency}
                  renderCard={renderDeckCard(false)}
                />
              )
            })}
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
        key={modalCardName ?? ''}
        open={Boolean(modalCard)}
        card={modalCard}
        cardName={modalCardName}
        symbolMap={symbolMap}
        useScryfallImgUrls={useScryfallImgUrls}
        currency={currency}
        printings={modalPrintings}
        onClose={onCloseModal}
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

// Expandable text component for long plain-text descriptions
type ExpandableTextProps = {
  text: string
  symbolMap: Record<string, string>
}

function ExpandableText({ text, symbolMap }: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <div className="whitespace-pre-wrap">
        <SymbolText text={expanded ? text : text.slice(0, 200) + '…'} symbolMap={symbolMap} />
      </div>
      <button
        className="text-blue-400 cursor-pointer text-xs hover:underline"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? 'Show less' : 'Read more'}
      </button>
    </div>
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

function ExpandablePrimer({
  primer,
  slug,
  cards,
  onOpenModal,
  primerOpen,
  sectionId,
}: ExpandablePrimerProps) {
  const [expanded, setExpanded] = useState(() => Boolean(primerOpen || sectionId))

  // buildToc is a fast O(n) line-scan; useMemo with [primer] ensures it only
  // recomputes when the primer text changes, not on every re-render.
  const toc = useMemo(() => buildToc(primer), [primer])

  // Re-expand whenever the route navigates to the primer or a specific section
  useEffect(() => {
    if (primerOpen || sectionId) setExpanded(true)
  }, [primerOpen, sectionId])

  // Scroll to the target section after the primer is expanded
  useEffect(() => {
    if (!expanded || !sectionId) return
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [expanded, sectionId])

  // Use a ternary rather than two separate `&&` guards so the mutual exclusivity
  // of the collapsed/expanded states is obvious to the reader (and to the
  // Preact reconciler, which can reuse the single root <div> across transitions).
  return (
    <div>
      {!expanded ? (
        <div>
          <p className="text-gray-400 italic text-xs mb-1">This deck has a primer.</p>
          <button
            className="text-blue-400 cursor-pointer text-xs hover:underline"
            aria-expanded={false}
            onClick={() => {
              setExpanded(true)
              history.replaceState(null, '', `#/deck/${slug}/primer`)
            }}
          >
            Read more
          </button>
        </div>
      ) : (
        <div>
          <div className={`primer-layout ${toc.length > 0 ? 'primer-layout--with-toc' : ''}`}>
            {toc.length > 0 && (
              <nav className="primer-toc">
                <p className="primer-toc-title">Contents</p>
                <ul>
                  {toc.map((h) => (
                    <li key={h.id} className={`primer-toc-item primer-toc-level-${h.level}`}>
                      <a href={`#/deck/${slug}/primer/${h.id}`}>{h.text.replace(/\*+/g, '')}</a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
            <PrimerRenderer primerMarkdown={primer} cards={cards} onOpenModal={onOpenModal} />
          </div>
          <button
            className="text-blue-400 cursor-pointer text-xs hover:underline mt-4 block"
            aria-expanded={true}
            onClick={() => {
              setExpanded(false)
              history.replaceState(null, '', `#/deck/${slug}`)
            }}
          >
            Show less
          </button>
        </div>
      )}
    </div>
  )
}
