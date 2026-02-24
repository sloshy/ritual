import type { FunctionalComponent, ComponentChildren } from 'preact'
import { useState, useMemo, useCallback, useEffect, useRef } from 'preact/hooks'
import { CardItem } from './CardItem'
import type { DeckData, ScryfallCard } from '../types'
import { isDoubleFacedCard, resolveCardImageSources } from './image-sources'

type ViewMode = 'binder' | 'list' | 'overlap' | 'stack'
type GroupBy = 'type' | 'section' | 'cmc' | 'none'
type SortBy = 'name' | 'cmc' | 'price' | 'edhrec'

interface CardData {
  name: string
  quantity: number
  cmc: number
  edhrec: number
  price: number
  type: string
  section: string
  card: ScryfallCard | null
}

interface CardGroup {
  key: string
  cards: CardData[]
}

interface DeckPageProps {
  deck: DeckData
  cards: Record<string, ScryfallCard | null>
  symbolMap: Record<string, string>
  exportPath?: string
  useScryfallImgUrls?: boolean
  modalCardName: string | null
  onOpenModal: (cardName: string) => void
  onCloseModal: () => void
}

export const DeckPage: FunctionalComponent<DeckPageProps> = ({
  deck,
  cards,
  symbolMap,
  exportPath,
  useScryfallImgUrls,
  modalCardName,
  onOpenModal,
  onCloseModal,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('binder')
  const [groupBy, setGroupBy] = useState<GroupBy>('type')
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [reverse, setReverse] = useState(false)
  const [hideLands, setHideLands] = useState(false)
  const [showExtras, setShowExtras] = useState(false)
  const [showingBack, setShowingBack] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  // Tooltip state
  const [tooltipSrc, setTooltipSrc] = useState<string | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)

  const replaceSymbols = useCallback(
    (text: string) => {
      if (!text) return text
      const parts = text.split(/(\{.*?\})/g)
      return parts.map((part, i) => {
        if (symbolMap[part]) {
          return (
            <img
              key={i}
              src={symbolMap[part]}
              alt={part}
              className="inline-block h-4 w-4 mx-0.5 align-middle"
            />
          )
        }
        return part
      })
    },
    [symbolMap],
  )

  // Build flat card list with metadata
  const allCards = useMemo((): CardData[] => {
    const result: CardData[] = []
    for (const section of deck.sections) {
      for (const entry of section.cards) {
        const card = cards[entry.name] ?? null
        result.push({
          name: entry.name,
          quantity: entry.quantity,
          cmc: card?.cmc ?? 0,
          edhrec: card?.edhrec_rank ?? 999999,
          price: parseFloat(card?.prices.usd || '0'),
          type: card?.type_line ?? '',
          section: section.name,
          card,
        })
      }
    }
    return result
  }, [deck, cards])

  const sectionOrder = useMemo(() => {
    return deck.sections.map((s) => s.name)
  }, [deck])

  // Commander cards (always shown separately)
  const commanderCards = useMemo(() => {
    return allCards.filter((c) => c.section.toLowerCase().includes('commander'))
  }, [allCards])

  // Sorted and grouped cards
  const cardGroups = useMemo((): CardGroup[] => {
    let working = allCards.filter((c) => !c.section.toLowerCase().includes('commander'))

    if (!showExtras) {
      working = working.filter((c) => {
        const s = c.section.toLowerCase()
        return !s.includes('sideboard') && !s.includes('maybeboard') && !s.includes('token')
      })
    }

    if (hideLands) {
      working = working.filter(
        (c) => !(c.cmc === 0 && (c.type.includes('Land') || c.type.includes('Basic'))),
      )
    }

    const sortFn = (a: CardData, b: CardData): number => {
      if (sortBy === 'name') {
        return reverse ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
      }
      const key = sortBy as 'cmc' | 'price' | 'edhrec'
      return reverse ? b[key] - a[key] : a[key] - b[key]
    }

    let groups: Record<string, CardData[]> = {}

    if (groupBy === 'none') {
      groups['Full Deck'] = [...working].sort(sortFn)
    } else if (groupBy === 'cmc') {
      for (const c of working) {
        const key = c.cmc.toString()
        if (!groups[key]) groups[key] = []
        groups[key]!.push(c)
      }
    } else if (groupBy === 'type') {
      const getType = (t: string): string => {
        if (t.includes('Creature')) return 'Creature'
        if (t.includes('Planeswalker')) return 'Planeswalker'
        if (t.includes('Instant')) return 'Instant'
        if (t.includes('Sorcery')) return 'Sorcery'
        if (t.includes('Artifact')) return 'Artifact'
        if (t.includes('Enchantment')) return 'Enchantment'
        if (t.includes('Land')) return 'Land'
        return 'Other'
      }
      for (const c of working) {
        const key = getType(c.type)
        if (!groups[key]) groups[key] = []
        groups[key]!.push(c)
      }
    } else if (groupBy === 'section') {
      for (const c of working) {
        if (!groups[c.section]) groups[c.section] = []
        groups[c.section]!.push(c)
      }
    }

    let keys = Object.keys(groups)
    if (groupBy === 'cmc') {
      keys.sort((a, b) => parseInt(a) - parseInt(b))
    } else if (groupBy === 'type') {
      const order = [
        'Creature',
        'Planeswalker',
        'Instant',
        'Sorcery',
        'Artifact',
        'Enchantment',
        'Land',
        'Other',
      ]
      keys.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    } else if (groupBy === 'section') {
      keys.sort((a, b) => sectionOrder.indexOf(a) - sectionOrder.indexOf(b))
    }

    return keys
      .filter((key) => groups[key] && groups[key]!.length > 0)
      .map((key) => ({
        key,
        cards: groups[key]!.sort(sortFn),
      }))
  }, [allCards, groupBy, sortBy, reverse, hideLands, showExtras, sectionOrder])

  // Modal card data
  const modalCard = useMemo((): ScryfallCard | null => {
    if (!modalCardName) return null
    return cards[modalCardName] ?? null
  }, [modalCardName, cards])

  // Close modal on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseModal()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCloseModal])

  // Reset flip state when modal changes
  useEffect(() => {
    setShowingBack(false)
  }, [modalCardName])

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

  // Tooltip mouse tracking
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!tooltipSrc) return
      const tooltipW = 240
      const tooltipH = tooltipRef.current?.offsetHeight || 340
      const margin = 16
      const x = e.clientX
      const y = e.clientY
      const vw = window.innerWidth
      const vh = window.innerHeight

      let left = x + margin
      let top = y - tooltipH / 2

      if (left + tooltipW > vw) left = x - tooltipW - margin
      if (top < margin) top = margin
      if (top + tooltipH > vh - margin) top = vh - tooltipH - margin

      setTooltipPos({ left, top })
    },
    [tooltipSrc],
  )

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove)
    return () => document.removeEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove])

  const viewModeClass = `view-${viewMode}`

  const renderSection = (label: string, sectionCards: CardData[], isCommander: boolean) => {
    if (sectionCards.length === 0) return null
    const sectionId = label.replace(/[^a-zA-Z0-9]/g, '_')
    return (
      <div key={label} data-section={label}>
        <div className="section-divider" id={sectionId}>
          <h2>
            <a href={`#${sectionId}`} className="hover:underline">
              {label}
            </a>
          </h2>
          <span className="section-count">
            {sectionCards.reduce((sum, c) => sum + c.quantity, 0)}
          </span>
        </div>
        <div className="binder-grid">
          {sectionCards.map((c) => (
            <CardItem
              key={c.name}
              name={c.name}
              quantity={c.quantity}
              card={c.card}
              symbolMap={symbolMap}
              hideCount={isCommander}
              useScryfallImgUrls={useScryfallImgUrls}
              onCardClick={() => onOpenModal(c.name)}
              onTooltipEnter={(src) => setTooltipSrc(src)}
              onTooltipLeave={() => setTooltipSrc(null)}
            />
          ))}
        </div>
      </div>
    )
  }

  // Modal rendering
  const renderModal = () => {
    const isDfc = modalCard ? isDoubleFacedCard(modalCard) : false
    const imgSources = modalCard
      ? resolveCardImageSources(modalCard, Boolean(useScryfallImgUrls))
      : null

    const oracleHtml = modalCard ? buildOracleHtml(modalCard, isDfc, symbolMap) : ''
    const manaCostHtml = modalCard ? buildManaCostHtml(modalCard, isDfc, symbolMap) : ''
    const frontType = modalCard?.card_faces?.[0]?.type_line || modalCard?.type_line || ''
    const isSideways = frontType.includes('Room') || frontType.includes('Battle')

    const metaParts: string[] = []
    if (modalCard?.prices.usd) metaParts.push(`$${modalCard.prices.usd}`)
    if (modalCard) metaParts.push(`${modalCard.set_name} (#${modalCard.collector_number})`)
    if (modalCard)
      metaParts.push(modalCard.rarity.charAt(0).toUpperCase() + modalCard.rarity.slice(1))

    return (
      <div
        className={`card-modal-backdrop ${modalCard ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) onCloseModal()
        }}
      >
        <div className="card-modal" style="position:relative;">
          <button className="modal-close" aria-label="Close" onClick={onCloseModal}>
            &times;
          </button>
          <div className="card-modal-image">
            {!showingBack ? (
              <img
                src={imgSources?.frontImage || ''}
                alt={modalCardName || ''}
                className={isSideways ? 'sideways' : ''}
              />
            ) : (
              <img src={imgSources?.backImage || ''} alt={`${modalCardName || ''} (Back)`} />
            )}
            {isDfc && imgSources?.backImage && (
              <button className="flip-btn" onClick={() => setShowingBack(!showingBack)}>
                Flip ↻
              </button>
            )}
          </div>
          <div className="card-modal-details">
            <div className="modal-card-name">{modalCardName}</div>
            <div className="modal-type-line">{modalCard?.type_line}</div>
            <div className="modal-mana-cost" dangerouslySetInnerHTML={{ __html: manaCostHtml }} />
            <div
              className="modal-oracle-text"
              dangerouslySetInnerHTML={{ __html: oracleHtml.replace(/\n/g, '<br>') }}
            />
            <div className="modal-meta">
              {metaParts.map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{deck.name}</h1>
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
        {exportPath && (
          <div className="flex gap-2">
            <a
              href={exportPath}
              download={`${deck.name.replace(/[^a-zA-Z0-9]/g, '_')}.txt`}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs font-semibold transition-colors"
            >
              Download
            </a>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold transition-colors cursor-pointer"
            >
              {copyStatus || 'Copy'}
            </button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap gap-3 items-center text-xs">
        <div className="view-toggle">
          {(['binder', 'list', 'overlap', 'stack'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              data-view={mode}
              className={viewMode === mode ? 'active' : ''}
              title={`${mode.charAt(0).toUpperCase() + mode.slice(1)} View`}
              onClick={() => setViewMode(mode)}
            >
              {mode === 'binder' ? '▦' : mode === 'list' ? '☰' : mode === 'overlap' ? '⧗' : '▥'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-gray-500">Group:</label>
          <select
            className="bg-gray-800 text-gray-200 rounded px-2 py-1 border border-gray-700 focus:border-blue-500 outline-none"
            value={groupBy}
            onChange={(e) => setGroupBy((e.target as HTMLSelectElement).value as GroupBy)}
          >
            <option value="type">Type</option>
            <option value="section">Section</option>
            <option value="cmc">Mana Value</option>
            <option value="none">None</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-gray-500">Sort:</label>
          <select
            className="bg-gray-800 text-gray-200 rounded px-2 py-1 border border-gray-700 focus:border-blue-500 outline-none"
            value={sortBy}
            onChange={(e) => setSortBy((e.target as HTMLSelectElement).value as SortBy)}
          >
            <option value="name">Name</option>
            <option value="cmc">Mana Value</option>
            <option value="price">Price</option>
            <option value="edhrec">EDHRec Rank</option>
          </select>
        </div>
        <label className="flex items-center gap-1 text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded"
            checked={reverse}
            onChange={() => setReverse(!reverse)}
          />
          Reverse
        </label>
        <label className="flex items-center gap-1 text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded"
            checked={hideLands}
            onChange={() => setHideLands(!hideLands)}
          />
          Hide Lands
        </label>
        <label className="flex items-center gap-1 text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded"
            checked={showExtras}
            onChange={() => setShowExtras(!showExtras)}
          />
          Extras
        </label>
      </div>

      {/* Description / Primer */}
      {(deck.description || deck.primer) && (
        <div className="mb-6">
          {deck.description && (
            <div className="mb-4 text-sm text-gray-300">
              {deck.description.length > 200 ? (
                <ExpandableText text={deck.description} replaceSymbols={replaceSymbols} id="desc" />
              ) : (
                <div className="whitespace-pre-wrap">{replaceSymbols(deck.description)}</div>
              )}
            </div>
          )}
          {deck.primer && (
            <div className="text-sm text-gray-300">
              {deck.primer.length > 200 ? (
                <ExpandableText text={deck.primer} replaceSymbols={replaceSymbols} id="primer" />
              ) : (
                <div className="whitespace-pre-wrap">{replaceSymbols(deck.primer)}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Card sections */}
      <div className={`space-y-6 ${viewModeClass}`}>
        {/* Commander section always shown first */}
        {commanderCards.length > 0 &&
          renderSection(
            deck.sections.find((s) => s.name.toLowerCase().includes('commander'))?.name ||
              'Commander',
            commanderCards,
            true,
          )}

        {/* Dynamic sorted/grouped sections */}
        {cardGroups.map((group) => renderSection(group.key, group.cards, false))}
      </div>

      {/* List-view hover tooltip */}
      <div
        ref={tooltipRef}
        className={`list-tooltip ${tooltipSrc ? 'visible' : ''}`}
        style={`left:${tooltipPos.left}px;top:${tooltipPos.top}px;`}
      >
        {tooltipSrc && <img src={tooltipSrc} alt="" />}
      </div>

      {/* Card detail modal */}
      {renderModal()}
    </div>
  )
}

// Expandable text component for long descriptions/primers
function ExpandableText({
  text,
  replaceSymbols,
  id,
}: {
  text: string
  replaceSymbols: (text: string) => ComponentChildren
  id: string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <div className="whitespace-pre-wrap">
        {replaceSymbols(expanded ? text : text.slice(0, 200) + '…')}
      </div>
      <button
        className="text-blue-400 cursor-pointer text-xs hover:underline"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Show less' : 'Read more'}
      </button>
    </div>
  )
}

// Helper functions moved from CardItem (used for modal)
function buildManaCostHtml(
  card: ScryfallCard,
  isDFC: boolean,
  symbolMap: Record<string, string>,
): string {
  if (isDFC && card.card_faces) {
    return card.card_faces
      .map((f) => renderSymbolsToHtml(f.mana_cost || '', symbolMap))
      .filter(Boolean)
      .join(' // ')
  }
  return renderSymbolsToHtml(card.mana_cost || '', symbolMap)
}

function buildOracleHtml(
  card: ScryfallCard,
  isDFC: boolean,
  symbolMap: Record<string, string>,
): string {
  if (isDFC && card.card_faces) {
    return card.card_faces
      .map((face) => {
        const header = `<strong>${escapeHtml(face.name)}</strong> <em>(${escapeHtml(face.type_line)})</em>`
        const text = renderSymbolsToHtml(face.oracle_text || '', symbolMap)
        return `${header}\n${text}`
      })
      .join('\n\n---\n\n')
  }
  return renderSymbolsToHtml(card.oracle_text || '', symbolMap)
}

function renderSymbolsToHtml(text: string, symbolMap: Record<string, string>): string {
  if (!text) return ''
  const parts = text.split(/(\{.*?\})/g)
  return parts
    .map((part) => {
      if (symbolMap[part]) {
        return `<img src="${symbolMap[part]}" alt="${escapeHtml(part)}" style="display:inline-block;height:0.9rem;width:0.9rem;vertical-align:middle;margin:0 1px;">`
      }
      return escapeHtml(part)
    })
    .join('')
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
