import type { Component } from 'solid-js'
import { createSignal, createEffect, createMemo, on, onCleanup, Show, For } from 'solid-js'
import type { Finish, Condition, ScryfallCard } from '../../../types'
import type { CardPrintingOptions } from '../../../change-event'
import { getCardImageUrl } from '../card-utils'
import { isFinish, VALID_CONDITIONS } from '../../../finish-condition'
import type { EditorDefaults } from '../hooks/useEditorDefaults'

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
  /**
   * Defaults applied to printing filtering and finish/condition pre-selection.
   * The defaults' `kind` also drives whether condition is tracked at all
   * (wanted lists do not).
   */
  defaults?: EditorDefaults
  /**
   * When set, the modal skips the card-search step and opens straight on the
   * printing selection for this card. Used by the "change printing" flow, which
   * reuses this dialog but already knows which card is being edited. In this mode
   * "← Back" from the printing step closes the modal (there is no search to
   * return to).
   */
  initialCardName?: string
}

type PrintingsResponse = { success: boolean; printings: ScryfallCard[] }
type AutocompleteResponse = { success: boolean; names: string[] }

type AddOptionsInput = {
  printing: ScryfallCard
  finish: Finish
  condition: Condition | undefined
}

type Step = 'search' | 'printing' | 'finish-condition'

/** A keyboard shortcut hint shown in the modal footer (e.g. ↑↓ "navigate"). */
type KeyHint = { keys: string[]; label: string }

const PRINTING_PAGE_SIZE = 8

/**
 * Default debounce (ms) before an autocomplete request fires while typing.
 * Kept high enough to avoid hammering the autocomplete API on each keystroke.
 */
const DEFAULT_SEARCH_DEBOUNCE_MS = 1000

/**
 * Runtime override seam for {@link DEFAULT_SEARCH_DEBOUNCE_MS}, set on the global
 * object. Shared with the e2e helper that injects it (`disableSearchDebounce`).
 */
export type SearchDebounceOverride = { __ritualSearchDebounceMs__?: number }

/**
 * Resolve the autocomplete debounce, honoring an optional runtime override.
 * End-to-end tests set the override to `0` so search assertions don't depend on
 * a wall-clock timer (which makes them flaky under parallel load); production
 * leaves it unset and gets {@link DEFAULT_SEARCH_DEBOUNCE_MS}.
 */
function searchDebounceMs(): number {
  const override = (globalThis as unknown as SearchDebounceOverride).__ritualSearchDebounceMs__
  return typeof override === 'number' && Number.isFinite(override)
    ? override
    : DEFAULT_SEARCH_DEBOUNCE_MS
}

type PreviewCard = {
  name: string
  imageUrl: string
}

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

  // Tracks whether the set filter was applied to the current `printings()` value,
  // and whether it had to fall back because no printings matched.
  const [setFilterFellBack, setSetFilterFellBack] = createSignal(false)

  // Derived: whether this list type tracks card condition. Wanted lists do not.
  // Falls back to `requirePrinting` for legacy callers that pass no defaults
  // (collections require printing AND condition; decks/wanted opt out).
  const usesCondition = createMemo(() => {
    const d = props.defaults
    if (d) return d.kind !== 'wanted'
    return props.requirePrinting ?? true
  })

  // Pull the defaulted condition (if any). Encapsulates the kind narrowing so
  // it doesn't have to be repeated at each read site.
  const defaultCondition = (): Condition | undefined => {
    const d = props.defaults
    if (!d || d.kind === 'wanted') return undefined
    return d.condition
  }

  const totalPrintingsPages = createMemo(() => Math.ceil(printings().length / PRINTING_PAGE_SIZE))
  const paginatedPrintings = createMemo(() =>
    printings().slice(
      printingsPage() * PRINTING_PAGE_SIZE,
      (printingsPage() + 1) * PRINTING_PAGE_SIZE,
    ),
  )

  /**
   * Apply the set-code default to a list of printings. If the filter excludes
   * everything, fall back to the unfiltered list and surface a hint.
   */
  const applySetFilter = (allPrintings: ScryfallCard[]): ScryfallCard[] => {
    const filterSets = props.defaults?.sets ?? []
    if (filterSets.length === 0) {
      setSetFilterFellBack(false)
      return allPrintings
    }
    const filtered = allPrintings.filter((p) => filterSets.includes(p.set.toLowerCase()))
    if (filtered.length === 0) {
      setSetFilterFellBack(true)
      return allPrintings
    }
    setSetFilterFellBack(false)
    return filtered
  }

  /**
   * Decide whether the finish/condition step can be skipped given the printing
   * and the active defaults. Returns the resolved options when skip is safe.
   *
   * Skip rules:
   * - Finish answered when the user's default applies, or the printing has exactly
   *   one nonfoil-only finish (matching the legacy auto-skip behavior).
   * - Condition answered when the user's default applies, or this list type
   *   doesn't track condition (wanted lists), or the legacy "no specific printing
   *   required" path supplies the NM default for decks.
   */
  const resolveAutoOptions = (printing: ScryfallCard): AddOptionsInput | null => {
    const availableFinishes = printing.finishes.filter(isFinish)

    let finish: Finish | undefined
    if (props.defaults?.finish && availableFinishes.includes(props.defaults.finish)) {
      finish = props.defaults.finish
    } else if (
      availableFinishes.length === 1 &&
      !availableFinishes.some((f) => f === 'foil' || f === 'etched')
    ) {
      finish = availableFinishes[0]
    }

    if (finish === undefined) return null

    const conditionDefault = defaultCondition()
    let condition: Condition | undefined
    if (conditionDefault !== undefined) {
      condition = conditionDefault
    } else if (!usesCondition()) {
      condition = undefined
    } else if (!props.requirePrinting) {
      // Legacy path for decks: condition is optional and defaults to NM.
      condition = 'NM'
    } else {
      // Collections require an explicit condition; without a default we cannot skip.
      return null
    }

    return { printing, finish, condition }
  }

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
  // Keyed on `props.open` so reopening always resets, but a defaults change while
  // the modal is open never re-runs this (which would wipe the user's in-progress
  // search). Reads of props.defaults / props.initialCardName inside use their
  // current values at open time.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return
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
        setSelectedFinish(props.defaults?.finish ?? 'nonfoil')
        setSelectedCondition(defaultCondition() ?? 'NM')
        setSetFilterFellBack(false)
        typedQuery = ''
        // "Change printing" mode: jump straight to the printing step for the
        // already-known card instead of showing the search step.
        if (props.initialCardName) {
          void selectCardName(props.initialCardName)
        }
      },
    ),
  )

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
      const data = (await resp.json()) as PrintingsResponse
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
      const data = (await resp.json()) as AutocompleteResponse
      if (data.success) {
        setResults(data.names)
        setHighlightedIndex(data.names.length > 0 ? 0 : -1)
        const firstName = data.names[0]
        if (firstName) void fetchCardImage(firstName)
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
      void performSearch(value)
    }, searchDebounceMs())
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
      const data = (await resp.json()) as PrintingsResponse
      if (data.success) {
        const filtered = applySetFilter(data.printings)
        setPrintings(filtered)
        // When the set-code default narrows to a single matching printing AND no
        // fallback was triggered, auto-advance with that printing — this is the
        // batch-entry shortcut that mirrors the CLI's session filters.
        if (
          filtered.length === 1 &&
          !setFilterFellBack() &&
          (props.defaults?.sets.length ?? 0) > 0
        ) {
          const only = filtered[0]!
          // Synchronous — SolidJS batches subsequent state changes (incl. setStep)
          // before the next render, so the printing step never visibly mounts.
          selectPrinting(only, data.printings)
        }
      }
    } catch {
      // Silently ignore
    } finally {
      setLoadingPrintings(false)
    }
  }

  // Select a printing → add directly or move to finish/condition step.
  // `unfilteredPrintings` is the full list to surface to the consumer, used when the
  // grid was narrowed by the set-code default but the parent still wants the full set.
  const selectPrinting = (printing: ScryfallCard | null, unfilteredPrintings?: ScryfallCard[]) => {
    const allPrintings = unfilteredPrintings ?? printings()
    if (!printing) {
      const cheapest = allPrintings.length > 0 ? getCheapestPrinting(allPrintings) : undefined
      props.onAddCard(selectedCardName(), undefined, cheapest, allPrintings)
      props.onClose()
      return
    }

    const auto = resolveAutoOptions(printing)
    if (auto) {
      props.onAddCard(
        selectedCardName(),
        {
          set: auto.printing.set,
          collectorNumber: auto.printing.collector_number,
          finish: auto.finish,
          condition: auto.condition,
        },
        auto.printing,
        allPrintings,
      )
      props.onClose()
      return
    }

    // Fall through to the finish/condition step — pre-fill from defaults where
    // possible so the user only confirms unspecified fields.
    setSelectedPrinting(printing)
    const availableFinishes = printing.finishes.filter(isFinish)
    const preferredFinish: Finish | undefined =
      props.defaults?.finish && availableFinishes.includes(props.defaults.finish)
        ? props.defaults.finish
        : availableFinishes.includes('nonfoil')
          ? 'nonfoil'
          : availableFinishes[0]
    setSelectedFinish(preferredFinish ?? 'nonfoil')
    setSelectedCondition(defaultCondition() ?? 'NM')
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
        void fetchCardImage(name)
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
          void fetchCardImage(name)
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const index = currentIndex >= 0 ? currentIndex : 0
      const name = currentResults[index]
      if (name) void selectCardName(name)
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
          void performSearch(newQuery)
        }, searchDebounceMs())
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
        condition: usesCondition() ? selectedCondition() : undefined,
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
      // In change-printing mode there is no search step to return to.
      if (props.initialCardName) {
        props.onClose()
        return
      }
      setStep('search')
      setQuery(typedQuery)
      setHighlightedIndex(-1)
      setSelectedCardName('')
      setPrintings([])
      setPrintingsPage(0)
    }
  }

  // Keyboard hints shown in the footer, mirroring the public site's quick-switch
  // dialog. The search and printing steps support arrow/Enter navigation; the
  // finish-condition step is a short terminal form, so it only advertises Esc.
  const keyHints = createMemo<KeyHint[]>(() => {
    if (step() === 'finish-condition') {
      return [{ keys: ['Esc'], label: 'close' }]
    }
    return [
      { keys: ['↑', '↓'], label: 'navigate' },
      { keys: ['Enter'], label: 'select' },
      { keys: ['Esc'], label: 'close' },
    ]
  })

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
        <div
          class="search-modal"
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-label="Add card"
        >
          <Show when={step() === 'search'}>
            <>
              <div class="search-modal-header">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search for a card..."
                  value={query()}
                  onInput={(e) => handleInputChange(e.currentTarget.value)}
                  onKeyDown={handleSearchKeyDown}
                />
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
                      onClick={() => void selectCardName(name)}
                      onMouseEnter={() => {
                        setHighlightedIndex(i())
                        setQuery(name)
                        void fetchCardImage(name)
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
              </div>
              <div class="search-modal-body">
                <Show
                  when={!loadingPrintings()}
                  fallback={<div class="empty-state">Loading printings…</div>}
                >
                  <Show when={setFilterFellBack()}>
                    <div class="search-modal-hint">
                      No printings match the set filter (
                      {props.defaults?.sets.map((s) => s.toUpperCase()).join(', ')}). Showing all
                      printings.
                    </div>
                  </Show>
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

                    <Show when={usesCondition()}>
                      <div class="finish-condition-section">
                        <h4>Condition</h4>
                        <div class="radio-group">
                          <For each={VALID_CONDITIONS}>
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
                    </Show>

                    <button onClick={handleAddWithOptions} class="btn-add-card">
                      Add Card
                    </button>
                  </div>
                </div>
              </>
            )}
          </Show>

          <div class="search-modal-footer">
            <For each={keyHints()}>
              {(hint) => (
                <span>
                  <For each={hint.keys}>{(key) => <kbd>{key}</kbd>}</For>
                  {hint.label}
                </span>
              )}
            </For>
          </div>
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
