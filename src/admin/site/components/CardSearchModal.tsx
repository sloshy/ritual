import type { FunctionalComponent } from 'preact'
import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import type { Finish, Condition, ScryfallCard } from '../../../types'
import type { CardPrintingOptions } from '../types/deck-changes'
import { getCardImageUrl } from '../card-utils'
import { isFinish } from '../../../finish-condition'

type CardSearchModalProps = {
  open: boolean
  onClose: () => void
  onAddCard: (
    cardName: string,
    options?: CardPrintingOptions,
    scryfallCard?: ScryfallCard,
    allPrintings?: ScryfallCard[],
  ) => void
  requirePrinting?: boolean
}

type Step = 'search' | 'printing' | 'finish-condition'

type PreviewCard = {
  name: string
  imageUrl: string
}

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const

function getCheapestPrinting(printings: ScryfallCard[]): ScryfallCard | undefined {
  const sorted = [...printings].sort((a, b) => {
    const aPrice = a.prices.usd !== null ? parseFloat(a.prices.usd) : Infinity
    const bPrice = b.prices.usd !== null ? parseFloat(b.prices.usd) : Infinity
    return aPrice - bPrice
  })
  return sorted[0]
}

function formatPrice(card: ScryfallCard): string {
  if (card.prices.usd !== null) return `$${card.prices.usd}`
  if (card.prices.usd_foil !== null) return `$${card.prices.usd_foil} (foil)`
  if (card.prices.usd_etched !== null) return `$${card.prices.usd_etched} (etched)`
  return 'N/A'
}

export const CardSearchModal: FunctionalComponent<CardSearchModalProps> = ({
  open,
  onClose,
  onAddCard,
  requirePrinting,
}) => {
  const [step, setStep] = useState<Step>('search')

  // Step 1: Search
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<string[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [previewCard, setPreviewCard] = useState<PreviewCard | null>(null)

  // Step 2: Printing selection
  const [selectedCardName, setSelectedCardName] = useState('')
  const [printings, setPrintings] = useState<ScryfallCard[]>([])
  const [printingHighlightIndex, setPrintingHighlightIndex] = useState(0)
  const [loadingPrintings, setLoadingPrintings] = useState(false)

  // Step 3: Finish & condition
  const [selectedPrinting, setSelectedPrinting] = useState<ScryfallCard | null>(null)
  const [selectedFinish, setSelectedFinish] = useState<Finish>('nonfoil')
  const [selectedCondition, setSelectedCondition] = useState<Condition>('NM')

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const inputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typedQueryRef = useRef('')
  const cardImageCache = useRef(new Map<string, string>())

  // Auto-focus search input when modal opens or returns to search step
  useEffect(() => {
    if (open && step === 'search') {
      const id = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(id)
    }
  }, [open, step])

  // Escape key closes modal from any step
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Cleanup debounce timer on unmount
  useEffect(
    () => () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    },
    [],
  )

  const fetchCardImage = useCallback(async (cardName: string) => {
    const cached = cardImageCache.current.get(cardName)
    if (cached) {
      setPreviewCard({ name: cardName, imageUrl: cached })
      return
    }
    try {
      const resp = await fetch(`/api/card-printings?name=${encodeURIComponent(cardName)}`, {
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as { success: boolean; printings: ScryfallCard[] }
      if (data.success && data.printings.length > 0) {
        const cheapest = getCheapestPrinting(data.printings)
        if (cheapest) {
          const imageUrl = getCardImageUrl(cheapest)
          if (imageUrl) {
            cardImageCache.current.set(cardName, imageUrl)
            setPreviewCard({ name: cardName, imageUrl })
          }
        }
      }
    } catch {
      // Silently ignore
    }
  }, [])

  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (searchQuery.length < 2) {
        setResults([])
        setHighlightedIndex(-1)
        setPreviewCard(null)
        return
      }
      try {
        const resp = await fetch(`/api/autocomplete?q=${encodeURIComponent(searchQuery)}`, {
          credentials: 'same-origin',
        })
        const data = (await resp.json()) as { success: boolean; names: string[] }
        if (data.success) {
          setResults(data.names)
          setHighlightedIndex(data.names.length > 0 ? 0 : -1)
          const firstName = data.names[0]
          if (firstName) fetchCardImage(firstName)
        }
      } catch {
        // Silently ignore network errors
      }
    },
    [fetchCardImage],
  )

  const handleInputChange = useCallback(
    (value: string) => {
      setQuery(value)
      typedQueryRef.current = value
      setHighlightedIndex(-1)
      setPreviewCard(null)

      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(value)
      }, 1000)
    },
    [performSearch],
  )

  // Select card name → move to printing selection
  const selectCardName = useCallback(async (cardName: string) => {
    setSelectedCardName(cardName)
    setStep('printing')
    setLoadingPrintings(true)
    setPrintingHighlightIndex(0)
    try {
      const resp = await fetch(`/api/card-printings?name=${encodeURIComponent(cardName)}`, {
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as { success: boolean; printings: ScryfallCard[] }
      if (data.success) setPrintings(data.printings)
    } catch {
      // Silently ignore
    } finally {
      setLoadingPrintings(false)
    }
  }, [])

  // Select a printing → add directly or move to finish/condition step
  const selectPrinting = useCallback(
    (printing: ScryfallCard | null) => {
      if (!printing) {
        const cheapest = printings.length > 0 ? getCheapestPrinting(printings) : undefined
        onAddCard(selectedCardName, undefined, cheapest, printings)
        onClose()
        return
      }

      const needsFinishStep =
        printing.finishes.length > 1 ||
        printing.finishes.some((f) => f === 'foil' || f === 'etched')

      if (!needsFinishStep && !requirePrinting) {
        onAddCard(
          selectedCardName,
          {
            set: printing.set,
            collectorNumber: printing.collector_number,
            finish:
              printing.finishes[0] !== undefined && isFinish(printing.finishes[0])
                ? printing.finishes[0]
                : 'nonfoil',
            condition: 'NM',
          },
          printing,
          printings,
        )
        onClose()
        return
      }

      setSelectedPrinting(printing)
      setSelectedFinish(
        printing.finishes.includes('nonfoil')
          ? 'nonfoil'
          : printing.finishes[0] !== undefined && isFinish(printing.finishes[0])
            ? printing.finishes[0]
            : 'nonfoil',
      )
      setSelectedCondition('NM')
      setStep('finish-condition')
    },
    [selectedCardName, onAddCard, onClose, requirePrinting],
  )

  // Keyboard navigation for search results
  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = Math.min(highlightedIndex + 1, results.length - 1)
        setHighlightedIndex(next)
        const name = results[next]
        if (name) {
          setQuery(name)
          fetchCardImage(name)
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (highlightedIndex <= 0) {
          setQuery(typedQueryRef.current)
          setHighlightedIndex(-1)
          setPreviewCard(null)
        } else {
          const next = highlightedIndex - 1
          setHighlightedIndex(next)
          const name = results[next]
          if (name) {
            setQuery(name)
            fetchCardImage(name)
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const index = highlightedIndex >= 0 ? highlightedIndex : 0
        const name = results[index]
        if (name) selectCardName(name)
      } else if (e.key === 'Backspace') {
        if (highlightedIndex >= 0 && query !== typedQueryRef.current) {
          e.preventDefault()
          setQuery(typedQueryRef.current)
          setHighlightedIndex(-1)
          setPreviewCard(null)
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Printable character during navigation — restore original query and append
        if (highlightedIndex >= 0) {
          e.preventDefault()
          const newQuery = typedQueryRef.current + e.key
          typedQueryRef.current = newQuery
          setQuery(newQuery)
          setHighlightedIndex(-1)
          setPreviewCard(null)
          if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
          searchTimeoutRef.current = setTimeout(() => {
            performSearch(newQuery)
          }, 1000)
        }
      }
    },
    [results, highlightedIndex, query, selectCardName, performSearch, fetchCardImage],
  )

  // Keyboard navigation for printing grid
  useEffect(() => {
    if (!open || step !== 'printing') return
    const hasNoPrintingOption = !requirePrinting
    const totalItems = printings.length + (hasNoPrintingOption ? 1 : 0)
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setPrintingHighlightIndex((prev) => Math.min(prev + 1, totalItems - 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPrintingHighlightIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (hasNoPrintingOption && printingHighlightIndex === 0) {
          selectPrinting(null)
        } else {
          const offset = hasNoPrintingOption ? 1 : 0
          const printing = printings[printingHighlightIndex - offset]
          if (printing) selectPrinting(printing)
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, step, printings, printingHighlightIndex, selectPrinting, requirePrinting])

  // Add card with selected finish and condition
  const handleAddWithOptions = useCallback(() => {
    if (!selectedPrinting) return
    onAddCard(
      selectedCardName,
      {
        set: selectedPrinting.set,
        collectorNumber: selectedPrinting.collector_number,
        finish: selectedFinish,
        condition: selectedCondition,
      },
      selectedPrinting,
      printings,
    )
    onClose()
  }, [
    selectedPrinting,
    selectedCardName,
    selectedFinish,
    selectedCondition,
    printings,
    onAddCard,
    onClose,
  ])

  const goBack = useCallback(() => {
    if (step === 'finish-condition') {
      setStep('printing')
      setSelectedPrinting(null)
    } else if (step === 'printing') {
      setStep('search')
      setQuery(typedQueryRef.current)
      setHighlightedIndex(-1)
      setSelectedCardName('')
      setPrintings([])
    }
  }, [step])

  if (!open) return null

  // Compute card preview position relative to modal
  const previewPositionStyle = (() => {
    if (!modalRef.current || !previewCard || step !== 'search') return 'display: none;'
    const rect = modalRef.current.getBoundingClientRect()
    const rightSpace = window.innerWidth - rect.right
    const left = rightSpace >= 260 ? rect.right + 16 : Math.max(0, rect.left - 256 - 16)
    return `left: ${left}px; top: ${rect.top}px;`
  })()

  return (
    <div
      class="search-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div class="search-modal" ref={modalRef}>
        {step === 'search' && (
          <>
            <div class="search-modal-header">
              <input
                ref={inputRef}
                type="text"
                placeholder="Search for a card..."
                value={query}
                onInput={(e) => handleInputChange(e.currentTarget.value)}
                onKeyDown={handleSearchKeyDown}
              />
              <button class="modal-close modal-close-btn-abs" onClick={onClose}>
                &times;
              </button>
            </div>
            <div
              class="search-modal-body"
              onMouseLeave={() => {
                setHighlightedIndex(-1)
                setQuery(typedQueryRef.current)
                setPreviewCard(null)
              }}
            >
              {results.map((name, i) => (
                <button
                  key={name}
                  class={`search-result-item${i === highlightedIndex ? ' search-result-item--highlighted' : ''}`}
                  onClick={() => selectCardName(name)}
                  onMouseEnter={() => {
                    setHighlightedIndex(i)
                    setQuery(name)
                    fetchCardImage(name)
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'printing' && (
          <>
            <div class="search-modal-header">
              <button onClick={goBack} class="search-tab-btn">
                ← Back
              </button>
              <h3 class="modal-heading-flex">Select a printing for {selectedCardName}</h3>
              <button class="modal-close modal-close-btn" onClick={onClose}>
                &times;
              </button>
            </div>
            <div class="search-modal-body">
              {loadingPrintings ? (
                <div class="empty-state">Loading printings…</div>
              ) : (
                <div class="printing-select-grid">
                  {!requirePrinting && (
                    <button
                      class={`printing-no-printing${printingHighlightIndex === 0 ? ' printing-no-printing--highlighted' : ''}`}
                      onClick={() => selectPrinting(null)}
                    >
                      No specific printing
                    </button>
                  )}
                  {printings.map((printing, i) => {
                    const offset = requirePrinting ? 0 : 1
                    const imageUrl = getCardImageUrl(printing)
                    return (
                      <button
                        key={printing.id}
                        class={`printing-select-card btn-unstyled${i + offset === printingHighlightIndex ? ' printing-select-card--highlighted' : ''}`}
                        onClick={() => selectPrinting(printing)}
                      >
                        {imageUrl && <img src={imageUrl} alt={printing.name} loading="lazy" />}
                        <div class="printing-label">
                          {printing.set.toUpperCase()} #{printing.collector_number}
                          {' · '}
                          {formatPrice(printing)}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {step === 'finish-condition' && selectedPrinting && (
          <>
            <div class="search-modal-header">
              <button onClick={goBack} class="search-tab-btn">
                ← Back
              </button>
              <h3 class="modal-heading-flex">
                Set finish & condition for {selectedCardName} ({selectedPrinting.set.toUpperCase()}:
                {selectedPrinting.collector_number})
              </h3>
              <button class="modal-close modal-close-btn" onClick={onClose}>
                &times;
              </button>
            </div>
            <div class="search-modal-body">
              <div class="finish-condition-grid">
                {(selectedPrinting.finishes.length > 1 ||
                  selectedPrinting.finishes.some((f) => f === 'foil' || f === 'etched')) && (
                  <div class="finish-condition-section">
                    <h4>Finish</h4>
                    <div class="radio-group">
                      {selectedPrinting.finishes.map((finish) => (
                        <label
                          key={finish}
                          class={`radio-option${selectedFinish === finish ? ' radio-option--selected' : ''}`}
                        >
                          <input
                            type="radio"
                            name="finish"
                            value={finish}
                            checked={selectedFinish === finish}
                            onChange={() => {
                              if (isFinish(finish)) setSelectedFinish(finish)
                            }}
                          />
                          {finish}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div class="finish-condition-section">
                  <h4>Condition</h4>
                  <div class="radio-group">
                    {CONDITIONS.map((condition) => (
                      <label
                        key={condition}
                        class={`radio-option${selectedCondition === condition ? ' radio-option--selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="condition"
                          value={condition}
                          checked={selectedCondition === condition}
                          onChange={() => setSelectedCondition(condition)}
                        />
                        {condition}
                      </label>
                    ))}
                  </div>
                </div>

                <button onClick={handleAddWithOptions} class="btn-add-card">
                  Add Card
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {previewCard && step === 'search' && (
        <div class="search-card-preview" style={previewPositionStyle}>
          <img src={previewCard.imageUrl} alt={previewCard.name} />
        </div>
      )}
    </div>
  )
}
