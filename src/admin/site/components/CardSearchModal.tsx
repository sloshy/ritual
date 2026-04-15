import type { Component } from 'solid-js'
import { createSignal, createEffect, createMemo, onCleanup, Show, For } from 'solid-js'
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

const PRINTING_PAGE_SIZE = 8

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

export const CardSearchModal: Component<CardSearchModalProps> = (props) => {
  const [step, setStep] = createSignal<Step>('search')

  // Step 1: Search
  const [query, setQuery] = createSignal('')
  const [results, setResults] = createSignal<string[]>([])
  const [highlightedIndex, setHighlightedIndex] = createSignal(-1)
  const [previewCard, setPreviewCard] = createSignal<PreviewCard | null>(null)

  // Step 2: Printing selection
  const [selectedCardName, setSelectedCardName] = createSignal('')
  const [printings, setPrintings] = createSignal<ScryfallCard[]>([])
  const [printingHighlightIndex, setPrintingHighlightIndex] = createSignal(0)
  const [printingsPage, setPrintingsPage] = createSignal(0)
  const [loadingPrintings, setLoadingPrintings] = createSignal(false)

  const totalPrintingsPages = createMemo(() => Math.ceil(printings().length / PRINTING_PAGE_SIZE))
  const paginatedPrintings = createMemo(() =>
    printings().slice(
      printingsPage() * PRINTING_PAGE_SIZE,
      (printingsPage() + 1) * PRINTING_PAGE_SIZE,
    ),
  )

  // Step 3: Finish & condition
  const [selectedPrinting, setSelectedPrinting] = createSignal<ScryfallCard | null>(null)
  const [selectedFinish, setSelectedFinish] = createSignal<Finish>('nonfoil')
  const [selectedCondition, setSelectedCondition] = createSignal<Condition>('NM')

  let inputRef: HTMLInputElement | undefined
  let modalRef: HTMLDivElement | undefined
  let searchTimeout: ReturnType<typeof setTimeout> | null = null
  let typedQuery = ''
  const cardImageCache = new Map<string, string>()

  // Reset all state when modal opens
  createEffect(() => {
    if (props.open) {
      setStep('search')
      setQuery('')
      setResults([])
      setHighlightedIndex(-1)
      setPreviewCard(null)
      setSelectedCardName('')
      setPrintings([])
      setPrintingHighlightIndex(0)
      setPrintingsPage(0)
      setLoadingPrintings(false)
      setSelectedPrinting(null)
      setSelectedFinish('nonfoil')
      setSelectedCondition('NM')
      typedQuery = ''
    }
  })

  // Auto-focus search input when modal opens or returns to search step
  createEffect(() => {
    if (props.open && step() === 'search') {
      const id = setTimeout(() => inputRef?.focus(), 50)
      onCleanup(() => clearTimeout(id))
    }
  })

  // Escape key closes modal from any step
  createEffect(() => {
    if (!props.open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', handler)
    onCleanup(() => document.removeEventListener('keydown', handler))
  })

  // Cleanup debounce timer on unmount
  onCleanup(() => {
    if (searchTimeout) clearTimeout(searchTimeout)
  })

  const fetchCardImage = async (cardName: string) => {
    const cached = cardImageCache.get(cardName)
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
            cardImageCache.set(cardName, imageUrl)
            setPreviewCard({ name: cardName, imageUrl })
          }
        }
      }
    } catch {
      // Silently ignore
    }
  }

  const performSearch = async (searchQuery: string) => {
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
  }

  const handleInputChange = (value: string) => {
    setQuery(value)
    typedQuery = value
    setHighlightedIndex(-1)
    setPreviewCard(null)

    if (searchTimeout) clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => {
      performSearch(value)
    }, 1000)
  }

  // Select card name → move to printing selection
  const selectCardName = async (cardName: string) => {
    setSelectedCardName(cardName)
    setStep('printing')
    setLoadingPrintings(true)
    setPrintingHighlightIndex(0)
    setPrintingsPage(0)
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
  }

  // Select a printing → add directly or move to finish/condition step
  const selectPrinting = (printing: ScryfallCard | null) => {
    if (!printing) {
      const currentPrintings = printings()
      const cheapest =
        currentPrintings.length > 0 ? getCheapestPrinting(currentPrintings) : undefined
      props.onAddCard(selectedCardName(), undefined, cheapest, currentPrintings)
      props.onClose()
      return
    }

    const needsFinishStep =
      printing.finishes.length > 1 || printing.finishes.some((f) => f === 'foil' || f === 'etched')

    if (!needsFinishStep && !props.requirePrinting) {
      props.onAddCard(
        selectedCardName(),
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
        printings(),
      )
      props.onClose()
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
  }

  // Keyboard navigation for search results
  const handleSearchKeyDown = (e: KeyboardEvent) => {
    const currentResults = results()
    const currentIndex = highlightedIndex()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(currentIndex + 1, currentResults.length - 1)
      setHighlightedIndex(next)
      const name = currentResults[next]
      if (name) {
        setQuery(name)
        fetchCardImage(name)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (currentIndex <= 0) {
        setQuery(typedQuery)
        setHighlightedIndex(-1)
        setPreviewCard(null)
      } else {
        const next = currentIndex - 1
        setHighlightedIndex(next)
        const name = currentResults[next]
        if (name) {
          setQuery(name)
          fetchCardImage(name)
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const index = currentIndex >= 0 ? currentIndex : 0
      const name = currentResults[index]
      if (name) selectCardName(name)
    } else if (e.key === 'Backspace') {
      if (currentIndex >= 0 && query() !== typedQuery) {
        e.preventDefault()
        setQuery(typedQuery)
        setHighlightedIndex(-1)
        setPreviewCard(null)
      }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Printable character during navigation — restore original query and append
      if (currentIndex >= 0) {
        e.preventDefault()
        const newQuery = typedQuery + e.key
        typedQuery = newQuery
        setQuery(newQuery)
        setHighlightedIndex(-1)
        setPreviewCard(null)
        if (searchTimeout) clearTimeout(searchTimeout)
        searchTimeout = setTimeout(() => {
          performSearch(newQuery)
        }, 1000)
      }
    }
  }

  // Keyboard navigation for printing grid
  createEffect(() => {
    if (!props.open || step() !== 'printing') return
    const hasNoPrintingOption = !props.requirePrinting
    const offset = hasNoPrintingOption ? 1 : 0
    const handler = (e: KeyboardEvent) => {
      const currentPrintings = printings()
      const totalItems = currentPrintings.length + offset
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        const newIdx = Math.min(printingHighlightIndex() + 1, totalItems - 1)
        setPrintingHighlightIndex(newIdx)
        const printingIdx = newIdx - offset
        if (printingIdx >= 0) {
          setPrintingsPage(Math.floor(printingIdx / PRINTING_PAGE_SIZE))
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        const newIdx = Math.max(printingHighlightIndex() - 1, 0)
        setPrintingHighlightIndex(newIdx)
        const printingIdx = newIdx - offset
        if (printingIdx >= 0) {
          setPrintingsPage(Math.floor(printingIdx / PRINTING_PAGE_SIZE))
        } else {
          setPrintingsPage(0)
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const idx = printingHighlightIndex()
        if (hasNoPrintingOption && idx === 0) {
          selectPrinting(null)
        } else {
          const printing = currentPrintings[idx - offset]
          if (printing) selectPrinting(printing)
        }
      }
    }
    document.addEventListener('keydown', handler)
    onCleanup(() => document.removeEventListener('keydown', handler))
  })

  // Add card with selected finish and condition
  const handleAddWithOptions = () => {
    const printing = selectedPrinting()
    if (!printing) return
    props.onAddCard(
      selectedCardName(),
      {
        set: printing.set,
        collectorNumber: printing.collector_number,
        finish: selectedFinish(),
        condition: selectedCondition(),
      },
      printing,
      printings(),
    )
    props.onClose()
  }

  const goBack = () => {
    if (step() === 'finish-condition') {
      setStep('printing')
      setSelectedPrinting(null)
    } else if (step() === 'printing') {
      setStep('search')
      setQuery(typedQuery)
      setHighlightedIndex(-1)
      setSelectedCardName('')
      setPrintings([])
      setPrintingsPage(0)
    }
  }

  // Compute card preview position relative to modal
  const previewPositionStyle = createMemo(() => {
    if (!modalRef || !previewCard() || step() !== 'search') return 'display: none;'
    const rect = modalRef.getBoundingClientRect()
    const rightSpace = window.innerWidth - rect.right
    const left = rightSpace >= 260 ? rect.right + 16 : Math.max(0, rect.left - 256 - 16)
    return `left: ${left}px; top: ${rect.top}px;`
  })

  return (
    <Show when={props.open}>
      <div
        class="search-modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose()
        }}
      >
        <div class="search-modal" ref={modalRef!}>
          <Show when={step() === 'search'}>
            <>
              <div class="search-modal-header">
                <input
                  ref={inputRef!}
                  type="text"
                  placeholder="Search for a card..."
                  value={query()}
                  onInput={(e) => handleInputChange(e.currentTarget.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                <button class="modal-close modal-close-btn-abs" onClick={props.onClose}>
                  &times;
                </button>
              </div>
              <div
                class="search-modal-body"
                onMouseLeave={() => {
                  setHighlightedIndex(-1)
                  setQuery(typedQuery)
                  setPreviewCard(null)
                }}
              >
                <For each={results()}>
                  {(name, i) => (
                    <button
                      class={`search-result-item${i() === highlightedIndex() ? ' search-result-item--highlighted' : ''}`}
                      onClick={() => selectCardName(name)}
                      onMouseEnter={() => {
                        setHighlightedIndex(i())
                        setQuery(name)
                        fetchCardImage(name)
                      }}
                    >
                      {name}
                    </button>
                  )}
                </For>
              </div>
            </>
          </Show>

          <Show when={step() === 'printing'}>
            <>
              <div class="search-modal-header">
                <button onClick={goBack} class="search-tab-btn">
                  ← Back
                </button>
                <h3 class="modal-heading-flex">Select a printing for {selectedCardName()}</h3>
                <button class="modal-close modal-close-btn" onClick={props.onClose}>
                  &times;
                </button>
              </div>
              <div class="search-modal-body">
                <Show
                  when={!loadingPrintings()}
                  fallback={<div class="empty-state">Loading printings…</div>}
                >
                  <div class="printing-select-grid">
                    <Show when={!props.requirePrinting && printingsPage() === 0}>
                      <button
                        class={`printing-no-printing${printingHighlightIndex() === 0 ? ' printing-no-printing--highlighted' : ''}`}
                        onClick={() => selectPrinting(null)}
                      >
                        No specific printing
                      </button>
                    </Show>
                    <For each={paginatedPrintings()}>
                      {(printing, i) => {
                        const offset = props.requirePrinting ? 0 : 1
                        const globalIdx = printingsPage() * PRINTING_PAGE_SIZE + i() + offset
                        const imageUrl = getCardImageUrl(printing)
                        return (
                          <button
                            class={`printing-select-card btn-unstyled${globalIdx === printingHighlightIndex() ? ' printing-select-card--highlighted' : ''}`}
                            onClick={() => selectPrinting(printing)}
                          >
                            <Show when={imageUrl}>
                              {(url) => <img src={url()} alt={printing.name} loading="lazy" />}
                            </Show>
                            <div class="printing-label">
                              {printing.set.toUpperCase()} #{printing.collector_number}
                              {' · '}
                              {formatPrice(printing)}
                            </div>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </div>
              <Show when={totalPrintingsPages() > 1}>
                <div class="printing-select-pagination">
                  <button
                    disabled={printingsPage() === 0}
                    onClick={() => {
                      setPrintingsPage((p) => p - 1)
                      setPrintingHighlightIndex(0)
                    }}
                  >
                    ← Prev
                  </button>
                  <span>
                    Page {printingsPage() + 1} of {totalPrintingsPages()}
                  </span>
                  <button
                    disabled={printingsPage() >= totalPrintingsPages() - 1}
                    onClick={() => {
                      setPrintingsPage((p) => p + 1)
                      setPrintingHighlightIndex(0)
                    }}
                  >
                    Next →
                  </button>
                </div>
              </Show>
            </>
          </Show>

          <Show when={step() === 'finish-condition' && selectedPrinting()}>
            {(printing) => (
              <>
                <div class="search-modal-header">
                  <button onClick={goBack} class="search-tab-btn">
                    ← Back
                  </button>
                  <h3 class="modal-heading-flex">
                    Set finish & condition for {selectedCardName()} ({printing().set.toUpperCase()}:
                    {printing().collector_number})
                  </h3>
                  <button class="modal-close modal-close-btn" onClick={props.onClose}>
                    &times;
                  </button>
                </div>
                <div class="search-modal-body">
                  <div class="finish-condition-grid">
                    <Show
                      when={
                        printing().finishes.length > 1 ||
                        printing().finishes.some((f) => f === 'foil' || f === 'etched')
                      }
                    >
                      <div class="finish-condition-section">
                        <h4>Finish</h4>
                        <div class="radio-group">
                          <For each={printing().finishes}>
                            {(finish) => (
                              <label
                                class={`radio-option${selectedFinish() === finish ? ' radio-option--selected' : ''}`}
                              >
                                <input
                                  type="radio"
                                  name="finish"
                                  value={finish}
                                  checked={selectedFinish() === finish}
                                  onChange={() => {
                                    if (isFinish(finish)) setSelectedFinish(finish)
                                  }}
                                />
                                {finish}
                              </label>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <div class="finish-condition-section">
                      <h4>Condition</h4>
                      <div class="radio-group">
                        <For each={CONDITIONS}>
                          {(condition) => (
                            <label
                              class={`radio-option${selectedCondition() === condition ? ' radio-option--selected' : ''}`}
                            >
                              <input
                                type="radio"
                                name="condition"
                                value={condition}
                                checked={selectedCondition() === condition}
                                onChange={() => setSelectedCondition(condition)}
                              />
                              {condition}
                            </label>
                          )}
                        </For>
                      </div>
                    </div>

                    <button onClick={handleAddWithOptions} class="btn-add-card">
                      Add Card
                    </button>
                  </div>
                </div>
              </>
            )}
          </Show>
        </div>

        <Show when={previewCard() && step() === 'search'}>
          <div class="search-card-preview" style={previewPositionStyle()}>
            <Show when={previewCard()}>
              {(card) => <img src={card().imageUrl} alt={card().name} />}
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}
