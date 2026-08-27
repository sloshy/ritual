import type { Component } from 'solid-js'
import { batch, createSignal, createEffect, createMemo, on, onCleanup, Show, For } from 'solid-js'
import { Modal } from '../../ui/Modal'
import {
  type Finish,
  type Condition,
  defaultPrintingFinish,
  printingFinishes,
} from '../../card/finish-condition'
import type { ScryfallCard } from '../../scryfall/types'
import { getCardImageUrl } from '../../card/card-image'
import type { EditorDefaults } from '../useEditorDefaults'
import type { AddCardExtras, AddCardFromSearch } from '../editor-config'
import type { CardLabel } from '../../card/card-labels'
import {
  readAddCardArt,
  type AddCardOptionsConfig,
  type AddCardOptionsState,
} from './AddCardOptions'
import type { SearchProvider } from '../search-provider'
import { useDocumentKeydown } from '../../ui/useDocumentKeydown'
import { filterPrintingsByQuery } from '../../card/collector-query'
import { type KeyHint, KeyChips } from '../../ui/KeyHints'
import {
  type PrintingCellOffset,
  firstCellOfPage,
  pageOfPrinting,
  printingsPageStart,
  totalPrintingPages,
} from '../printing-pagination'
import { stepQuantity } from '../../ui/quantity'
import { useT, useTKey } from '../../ui/i18n'
import { searchDebounceMs } from '../../config/search-debounce'
import { displayLanguage, storedLanguage, type CardLanguage } from '../../card/card-language'
import { defaultLanguage } from '../default-language'
import { dedupePrintingsByKey, printingLanguages } from '../../card/card-printing'
import { resolvePrintingLanguage } from '../../card/printing-language'
import { usePrintingQuotes } from '../../list-view/printing-quotes'
import {
  applySetFilter,
  getCheapestPrinting,
  resolveAutoOptions,
} from '../card-search/add-resolution'
import type { CardSearchStep, LanguageNotice } from '../card-search/dialog-state'
import { keyHintsFor } from '../card-search/key-hints'
import { SearchStep } from './card-search/SearchStep'
import { PrintingStep } from './card-search/PrintingStep'
import { LanguageNoticeStep } from './card-search/LanguageNoticeStep'
import { FinishConditionStep, QUANTITY_STEPPER_ID } from './card-search/FinishConditionStep'

/** Shared so the gated-off accessor keeps one identity instead of a fresh array. */
const NO_PRINTINGS: readonly ScryfallCard[] = []

type CardSearchModalProps = {
  open: boolean
  onClose: () => void
  onAddCard: AddCardFromSearch
  /** Backend resolving autocomplete + printings (admin API or Scryfall). */
  search: SearchProvider
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
  /**
   * Change-printing flow only: whether the targeted line already pins a printing.
   * When it does not, the dialog names itself "Set printing" — there is nothing
   * to change yet.
   */
  targetHasPrinting?: boolean
  /**
   * Offer the per-card add options (label override, custom art) alongside the
   * printing. Omitted in change-printing mode and wherever the dialog is reused
   * to pick a card rather than to add one — neither commits an `add`.
   */
  addOptions?: AddCardOptionsConfig
}

/** One stop in the finish/condition step's ↑/↓ walk. See {@link finishConditionGroups}. */
type FocusGroup = {
  /** The group's root, used to test whether it currently holds focus. */
  container: HTMLElement
  /** The element focused when the group is entered. */
  entry: HTMLElement
}

type PreviewCard = {
  name: string
  imageUrl: string
}

export const CardSearchModal: Component<CardSearchModalProps> = (props) => {
  const t = useT()
  // The footer hints are message keys held in a memo, resolved at render.
  const tKey = useTKey()
  const [step, setStep] = createSignal<CardSearchStep>('search')

  /** Whether this opening of the dialog is a change-printing flow. See {@link isAddFlow}. */
  const [changePrintingMode, setChangePrintingMode] = createSignal(false)

  // Step 1: Search
  const [query, setQuery] = createSignal('')
  const [results, setResults] = createSignal<string[]>([])
  const [highlightedIndex, setHighlightedIndex] = createSignal(-1)
  const [previewCard, setPreviewCard] = createSignal<PreviewCard | null>(null)

  // Step 2: Printing selection. The grid shows one row per physical printing
  // (`printings`, deduped by set:cn); `allLanguagePrintings` keeps the full
  // fetched list — one object per language under an `all_cards` cache — for
  // language resolution and for handing to the card-data stores.
  const [selectedCardName, setSelectedCardName] = createSignal('')
  const [printings, setPrintings] = createSignal<ScryfallCard[]>([])
  const [allLanguagePrintings, setAllLanguagePrintings] = createSignal<ScryfallCard[]>([])
  const [printingHighlightIndex, setPrintingHighlightIndex] = createSignal(0)
  const [printingsPage, setPrintingsPage] = createSignal(0)
  const [loadingPrintings, setLoadingPrintings] = createSignal(false)
  // Collector query narrowing the grid (`ds 12`, `mkm:123`) — the sites' twin
  // of the CLI's collector mode. Typed from anywhere in the step; the visible
  // input is never auto-focused so the arrow keys keep driving the grid.
  const [printingFilter, setPrintingFilter] = createSignal('')

  // Step 2b: language notice — the picked printing does not exist in the
  // configured default language, so the user confirms the stamped language.
  const [languageNotice, setLanguageNotice] = createSignal<LanguageNotice | null>(null)

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

  /** The grid's rows: the fetched printings narrowed by the collector query. */
  const visiblePrintings = createMemo(() => filterPrintingsByQuery(printingFilter(), printings()))

  // Card Kingdom quotes for the printings on offer. These come from
  // `/api/card-printings` and can be any card at all, so — unlike a list page's
  // — they are never baked and are always requested on demand. Gated on the
  // step: `printings()` outlives the dialog's close (only reopening clears it),
  // so an ungated effect would quote the last card looked at whenever the price
  // source changed somewhere else on the page.
  const quotablePrintings = createMemo(() =>
    props.open && step() === 'printing' ? printings() : NO_PRINTINGS,
  )
  usePrintingQuotes(quotablePrintings)

  /**
   * Cells the "No specific printing" tile takes from the first page. It also
   * shifts every printing one place along in the keyboard highlight index, which
   * runs over grid cells rather than printings. A live collector query hides
   * the tile — filtering by set or number means a specific printing is wanted,
   * and the tile has no set or number for the query to match.
   */
  const cellOffset = (): PrintingCellOffset =>
    props.requirePrinting || printingFilter().trim() !== '' ? 0 : 1

  const totalPrintingsPages = createMemo(() =>
    totalPrintingPages(visiblePrintings().length, cellOffset()),
  )
  /** Index into `visiblePrintings()` of the first printing on the current page. */
  const pageStart = createMemo(() => printingsPageStart(printingsPage(), cellOffset()))
  const paginatedPrintings = createMemo(() =>
    visiblePrintings().slice(pageStart(), printingsPageStart(printingsPage() + 1, cellOffset())),
  )

  // A query edit reshapes the whole grid, so the highlight and page restart at
  // the first remaining cell. Deferred: the initial empty filter must not clobber
  // the page state `selectCardName` just set.
  createEffect(
    on(
      printingFilter,
      () => {
        setPrintingsPage(0)
        setPrintingHighlightIndex(0)
      },
      { defer: true },
    ),
  )

  /**
   * Page the grid, moving the highlight onto the new page's first cell — leaving
   * it on cell 0 would highlight nothing (the "No specific printing" tile renders
   * on page 0 only) while Enter still committed that tile's choice.
   */
  const goToPage = (page: number): void => {
    batch(() => {
      setPrintingsPage(page)
      setPrintingHighlightIndex(firstCellOfPage(page))
    })
  }

  // Step 3: Finish & condition
  const [selectedPrinting, setSelectedPrinting] = createSignal<ScryfallCard | null>(null)
  const [selectedFinish, setSelectedFinish] = createSignal<Finish>('nonfoil')
  const [selectedCondition, setSelectedCondition] = createSignal<Condition>('NM')
  // The language the committed entry will be stamped with (undefined = English,
  // which writes a bare line). Resolved when the printing is picked; adding
  // never asks about language beyond the availability notice step.
  const [selectedAddLanguage, setSelectedAddLanguage] = createSignal<CardLanguage | undefined>(
    undefined,
  )
  const [quantity, setQuantity] = createSignal(1)

  // The per-card add options (see AddCardOptions). Held at dialog level, not per
  // step: the printing grid and the finish/condition step show the same row, and
  // a value typed on one must survive the walk to the other.
  const [addLabels, setAddLabels] = createSignal<CardLabel[]>([])
  const [addArt, setAddArt] = createSignal('')

  /** The typed art, parsed. `invalid` blocks every commit path in the add flow. */
  const addArtInput = createMemo(() => readAddCardArt(addArt()))
  /** The options row's live state, read lazily by whichever step is showing the row. */
  const addCardOptions: AddCardOptionsState = {
    get labels() {
      return addLabels()
    },
    setLabels: setAddLabels,
    get art() {
      return addArt()
    },
    setArt: setAddArt,
    get artInput() {
      return addArtInput()
    },
  }
  const addOptionsBlocked = (): boolean =>
    props.addOptions !== undefined && addArtInput().state === 'invalid'

  /** What the add options contribute to a commit, or undefined when they say nothing. */
  const addExtras = (): AddCardExtras | undefined => {
    if (props.addOptions === undefined) return undefined
    const parsed = addArtInput()
    const labels = addLabels()
    const extras: AddCardExtras = {}
    if (labels.length > 0) extras.labels = [...labels]
    if (parsed.state === 'valid') extras.art = parsed.art
    return extras.labels === undefined && extras.art === undefined ? undefined : extras
  }

  let inputRef: HTMLInputElement | undefined
  let modalRef: HTMLDivElement | undefined
  let printingGridRef: HTMLDivElement | undefined
  let finishConditionRef: HTMLDivElement | undefined
  let searchTimeout: ReturnType<typeof setTimeout> | null = null
  let typedQuery = ''
  const cardImageCache = new Map<string, string>()

  // Reset every step's state back to a fresh search. Runs when the modal opens
  // and again after "Add Another Card", which restarts the flow in place. A
  // debounce timer armed by the previous search must not survive the reset, or
  // it would repopulate the results with the stale query after it fires.
  const resetToSearch = () => {
    if (searchTimeout) clearTimeout(searchTimeout)
    searchTimeout = null
    setStep('search')
    setQuery('')
    setResults([])
    setHighlightedIndex(-1)
    setPreviewCard(null)
    setSelectedCardName('')
    setPrintings([])
    setAllLanguagePrintings([])
    setLanguageNotice(null)
    setPrintingHighlightIndex(0)
    setPrintingsPage(0)
    setPrintingFilter('')
    setLoadingPrintings(false)
    setSelectedPrinting(null)
    setSelectedFinish(props.defaults?.finish ?? 'nonfoil')
    setSelectedCondition(defaultCondition() ?? 'NM')
    setSelectedAddLanguage(undefined)
    setQuantity(1)
    // Cleared for "Add Another Card" as well as for a fresh open: a label or an
    // image belongs to the card it was typed for, and carrying either onto the
    // next card silently would be a worse default than re-picking it.
    setAddLabels([])
    setAddArt('')
    setSetFilterFellBack(false)
    typedQuery = ''
  }

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
        resetToSearch()
        // "Change printing" mode: jump straight to the printing step for the
        // already-known card instead of showing the search step.
        setChangePrintingMode(Boolean(props.initialCardName))
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
      const printings = await props.search.printings(cardName)
      if (printings.length > 0) {
        const cheapest = getCheapestPrinting(printings)
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
      const names = await props.search.autocomplete(searchQuery)
      setResults(names)
      setHighlightedIndex(names.length > 0 ? 0 : -1)
      const firstName = names[0]
      if (firstName) void fetchCardImage(firstName)
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
    setPrintingFilter('')
    try {
      const allPrintings = await props.search.printings(cardName)
      setAllLanguagePrintings(allPrintings)
      // One grid row per physical printing: an `all_cards` cache returns one
      // object per language for the same set:cn, deduped here preferring the
      // English (default) object.
      const { printings: filtered, fellBack } = applySetFilter(
        dedupePrintingsByKey(allPrintings),
        props.defaults?.sets ?? [],
      )
      setSetFilterFellBack(fellBack)
      setPrintings(filtered)
      // When the set-code default narrows to a single matching printing AND no
      // fallback was triggered, auto-advance with that printing — this is the
      // batch-entry shortcut that mirrors the CLI's session filters.
      if (filtered.length === 1 && !fellBack && (props.defaults?.sets.length ?? 0) > 0) {
        const only = filtered[0]!
        // Synchronous — SolidJS batches subsequent state changes (incl. setStep)
        // before the next render, so the printing step never visibly mounts.
        selectPrinting(only, allPrintings)
      }
    } catch {
      // Silently ignore
    } finally {
      setLoadingPrintings(false)
    }
  }

  // Select a printing → add directly or move to finish/condition step, via the
  // language-notice step when the printing is unavailable in the configured
  // default language. `unfilteredPrintings` is the full list to surface to the
  // consumer, used when the grid was narrowed by the set-code default (or
  // deduped by language) but the parent still wants the full set.
  const selectPrinting = (printing: ScryfallCard | null, unfilteredPrintings?: ScryfallCard[]) => {
    // An unreadable art reference stops the commit where it was typed — the row
    // is showing why — rather than adding the card without the image asked for.
    if (addOptionsBlocked()) return
    const allPrintings = unfilteredPrintings ?? allLanguagePrintings()
    if (!printing) {
      // No language is ever stamped here: without a set:cn there is no printing
      // whose available languages could be checked, so the entry stays bare (en).
      // Cheapest over one row per printing — foreign objects carry no prices of
      // their own and must not shadow the priced English object.
      const deduped = dedupePrintingsByKey(allPrintings)
      const cheapest = deduped.length > 0 ? getCheapestPrinting(deduped) : undefined
      props.onAddCard(selectedCardName(), undefined, cheapest, allPrintings, 1, addExtras())
      closeAfterCommit()
      return
    }

    const available = printingLanguages(allPrintings, printing.set, printing.collector_number)
    const { language, honoredPreferred } = resolvePrintingLanguage(
      allPrintings,
      printing.set,
      printing.collector_number,
      displayLanguage(defaultLanguage()),
    )
    if (!honoredPreferred) {
      // The printing is not available in the default language: surface a notice
      // with Continue (stamps `language`) and Back. This is the only language
      // interaction adding a card ever has. Deliberately stricter than
      // TradePrintingPicker (which notices only when the picked row itself is
      // non-default): the grid shows one row per set:cn, so the user never
      // explicitly chose a language and must be told when one is forced.
      setLanguageNotice({ printing, language, available, allPrintings })
      setStep('language-notice')
      return
    }
    commitPrinting(printing, language, allPrintings)
  }

  /**
   * Dismiss the dialog after a successful commit — but only in the add flow.
   *
   * In change-printing mode the parent owns what happens next: it may advance a
   * bulk run to the next selected card, move on to a quantity prompt, or close.
   * It expresses all three by driving this dialog's `open` prop, so the commit
   * has already closed (or re-aimed) the dialog by the time this runs. Calling
   * `onClose` on top of that would run the parent's *dismissal* path over its own
   * just-committed state — which is how a bulk run used to skip every other card.
   */
  const closeAfterCommit = (): void => {
    if (isAddFlow()) props.onClose()
  }

  /** Proceed with a picked printing whose entry language has been resolved. */
  const commitPrinting = (
    printing: ScryfallCard,
    language: CardLanguage,
    allPrintings: ScryfallCard[],
  ) => {
    // English writes a bare line, so it is stamped as "no token".
    const languageOption = storedLanguage(language)
    const auto = resolveAutoOptions(printing, {
      defaultFinish: props.defaults?.finish,
      defaultCondition: defaultCondition(),
      usesCondition: usesCondition(),
      requirePrinting: props.requirePrinting ?? false,
    })
    if (auto) {
      props.onAddCard(
        selectedCardName(),
        {
          set: auto.printing.set,
          collectorNumber: auto.printing.collector_number,
          finish: auto.finish,
          condition: auto.condition,
          language: languageOption,
        },
        auto.printing,
        allPrintings,
        1,
        addExtras(),
      )
      closeAfterCommit()
      return
    }

    // Fall through to the finish/condition step — pre-fill from defaults where
    // possible so the user only confirms unspecified fields.
    setSelectedPrinting(printing)
    setSelectedAddLanguage(languageOption)
    // `printingFinishes` (not a bare `.filter(isFinish)`) so a printing that
    // models no usable finish still offers nonfoil rather than nothing.
    const availableFinishes = printingFinishes(printing)
    setSelectedFinish(
      props.defaults?.finish && availableFinishes.includes(props.defaults.finish)
        ? props.defaults.finish
        : defaultPrintingFinish(printing),
    )
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

  /**
   * Columns the printing grid is currently laid out with, read back from the
   * resolved `grid-template-columns` so ↑/↓ step a whole row of whatever the
   * responsive `auto-fill` layout produced rather than a hardcoded count.
   */
  const printingGridColumns = (): number => {
    // The grid unmounts while a newly picked card's printings load, and a bare
    // ref is never cleared — so check it is still in the document before
    // measuring, or a detached node would report no tracks at all.
    if (!printingGridRef?.isConnected) return 1
    const template = getComputedStyle(printingGridRef).gridTemplateColumns
    const columns = template.split(' ').filter((track) => track !== '').length
    return Math.max(1, columns)
  }

  /** Whether the dialog is showing step `s` — the document-keydown gates. */
  const onStep = (s: CardSearchStep) => () => props.open && step() === s

  // Keyboard navigation for printing grid
  useDocumentKeydown((e) => {
    // The "No specific printing" tile, when offered, occupies highlight index 0
    // and shifts every printing one place along.
    const offset = cellOffset()
    const currentPrintings = visiblePrintings()
    const totalItems = currentPrintings.length + offset
    if (totalItems === 0) return
    // ←/→ step one card; ↑/↓ step one grid row. Both clamp to the ends of the
    // full printing list and pull the containing page into view.
    const moveHighlight = (delta: number) => {
      const newIdx = Math.min(Math.max(printingHighlightIndex() + delta, 0), totalItems - 1)
      const printingIdx = newIdx - offset
      batch(() => {
        setPrintingHighlightIndex(newIdx)
        setPrintingsPage(printingIdx >= 0 ? pageOfPrinting(printingIdx, offset) : 0)
      })
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      moveHighlight(1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moveHighlight(-1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveHighlight(printingGridColumns())
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveHighlight(-printingGridColumns())
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const idx = printingHighlightIndex()
      if (offset > 0 && idx === 0) {
        selectPrinting(null)
      } else {
        const printing = currentPrintings[idx - offset]
        if (printing) selectPrinting(printing)
      }
    }
  }, onStep('printing'))

  /**
   * True in the normal add flow, false in change-printing mode (which reuses this
   * dialog to re-target an existing card). Both extras of the finish/condition
   * step hang off it, along with the commit button's wording: there is no
   * "another" card to add when editing one, and the copy count was already
   * answered by the quantity prompt that opened the flow.
   *
   * Latched when the dialog opens rather than read live off `initialCardName`:
   * the parent clears that prop as part of closing, and the dialog stays mounted
   * through its exit animation — reading it live would visibly flip the closing
   * dialog back to add-card chrome mid-fade.
   */
  const isAddFlow = () => !changePrintingMode()
  const canAddAnother = isAddFlow
  const usesQuantity = isAddFlow

  const adjustQuantity = (delta: number) => setQuantity((q) => stepQuantity(q, delta))

  // Add card with selected finish and condition. With `addAnother`, the modal
  // returns to a fresh search step instead of closing.
  const handleAddWithOptions = (addAnother = false) => {
    const printing = selectedPrinting()
    if (!printing || addOptionsBlocked()) return
    props.onAddCard(
      selectedCardName(),
      {
        set: printing.set,
        collectorNumber: printing.collector_number,
        finish: selectedFinish(),
        condition: usesCondition() ? selectedCondition() : undefined,
        language: selectedAddLanguage(),
      },
      printing,
      allLanguagePrintings(),
      usesQuantity() ? quantity() : 1,
      addExtras(),
    )
    if (addAnother) {
      resetToSearch()
    } else {
      closeAfterCommit()
    }
  }

  // Focus the finish/condition step's first group on entry, so the arrow keys
  // drive the radios immediately (native radio-group behavior) without a Tab.
  createEffect(() => {
    if (!props.open || step() !== 'finish-condition') return
    const id = setTimeout(() => finishConditionGroups()[0]?.entry.focus(), 50)
    onCleanup(() => clearTimeout(id))
  })

  /**
   * The finish/condition step's groups in visual order. `container` answers
   * "which group holds focus right now" (a radio group's focused option may not
   * be its checked one), `entry` is what takes focus when the group is entered.
   * ↑/↓ walk this list.
   */
  const finishConditionGroups = (): FocusGroup[] => {
    // Bare refs are never cleared, so a detached node would answer queries about
    // a step that is no longer mounted.
    if (!finishConditionRef?.isConnected) return []
    const groups: FocusGroup[] = []
    for (const group of finishConditionRef.querySelectorAll<HTMLElement>('.radio-group')) {
      const entry =
        group.querySelector<HTMLInputElement>('input[type="radio"]:checked') ??
        group.querySelector<HTMLInputElement>('input[type="radio"]')
      if (entry) groups.push({ container: group, entry })
    }
    const stepper = finishConditionRef.querySelector<HTMLElement>(`#${QUANTITY_STEPPER_ID}`)
    if (stepper) groups.push({ container: stepper, entry: stepper })
    return groups
  }

  /** Move focus between the step's groups. Wraps at both ends. */
  const moveFinishConditionGroup = (delta: number) => {
    const groups = finishConditionGroups()
    if (groups.length === 0) return
    const active = document.activeElement
    const current = groups.findIndex((g) => g.container === active || g.container.contains(active))
    // From outside any group (e.g. a focused button), ↓ enters the first group
    // and ↑ the last.
    const next = current === -1 ? (delta > 0 ? 0 : groups.length - 1) : current + delta
    groups[(next + groups.length) % groups.length]?.entry.focus()
  }

  // Keys owned by the finish/condition step:
  // - Enter adds the card with the current selections; Ctrl/Cmd+Enter adds it and
  //   starts a fresh search for another. For plain Enter, buttons are exempt so it
  //   still activates the focused one ("← Back", "Add Card") through its own
  //   default action. The chord is handled even on a focused button — it is
  //   unambiguous, and the default action would otherwise click that button.
  // - ↑/↓ move between groups (finish, condition, quantity); ←/→ stay inside the
  //   focused group, handled natively by the radios and by the ticker itself.
  // - +/- adjust the quantity from anywhere in the step, without focusing it.
  useDocumentKeydown((e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      moveFinishConditionGroup(e.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (usesQuantity() && (e.key === '+' || e.key === '-')) {
      e.preventDefault()
      adjustQuantity(e.key === '+' ? 1 : -1)
      return
    }
    if (e.key !== 'Enter') return
    if (e.ctrlKey || e.metaKey) {
      if (!canAddAnother()) return
      e.preventDefault()
      handleAddWithOptions(true)
      return
    }
    if (e.target instanceof HTMLButtonElement) return
    e.preventDefault()
    handleAddWithOptions()
  }, onStep('finish-condition'))

  const goBack = () => {
    if (step() === 'language-notice') {
      setLanguageNotice(null)
      setStep('printing')
    } else if (step() === 'finish-condition') {
      setStep('printing')
      setSelectedPrinting(null)
      setSelectedAddLanguage(undefined)
      // The count belongs to the printing being confirmed: another printing may
      // be resolved by defaults and added straight from the grid, where there is
      // no ticker to show what would be committed.
      setQuantity(1)
    } else if (step() === 'printing') {
      // In change-printing mode there is no search step to return to. Read from
      // the latch, not the prop, so this agrees with the rest of the component
      // even once the parent has cleared `initialCardName` to close the dialog.
      if (!isAddFlow()) {
        props.onClose()
        return
      }
      // Same stale-timer guard as resetToSearch: the search step being returned
      // to must not have a leftover debounce fire over it.
      if (searchTimeout) clearTimeout(searchTimeout)
      searchTimeout = null
      setStep('search')
      setQuery(typedQuery)
      setHighlightedIndex(-1)
      setQuantity(1)
      setSelectedCardName('')
      setPrintings([])
      setPrintingsPage(0)
    }
  }

  /** Continue past the language notice, committing the printing with its stamped language. */
  const confirmLanguageNotice = () => {
    const notice = languageNotice()
    if (!notice) return
    setLanguageNotice(null)
    commitPrinting(notice.printing, notice.language, notice.allPrintings)
  }

  // Language-notice step keys: Enter continues (buttons exempt, so a focused
  // "← Back" still activates itself through its default action).
  useDocumentKeydown((e) => {
    if (e.key !== 'Enter') return
    if (e.target instanceof HTMLButtonElement) return
    e.preventDefault()
    confirmLanguageNotice()
  }, onStep('language-notice'))

  // Keyboard hints shown in the footer, one set per step.
  const keyHints = createMemo<KeyHint[]>(() =>
    keyHintsFor({
      step: step(),
      isAddFlow: isAddFlow(),
      usesQuantity: usesQuantity(),
      canAddAnother: canAddAnother(),
    }),
  )

  // Compute card preview position relative to modal.
  // Both signals are read before the `modalRef` check on purpose: `modalRef` is
  // only assigned once the modal's panel renders, which is after this memo's
  // first (dependency-collecting) run — short-circuiting on it would leave the
  // memo tracking nothing at all, frozen at its initial value forever.
  const previewPositionStyle = createMemo(() => {
    const card = previewCard()
    const onSearchStep = step() === 'search'
    if (!modalRef || !card || !onSearchStep) return 'display: none;'
    const rect = modalRef.getBoundingClientRect()
    const rightSpace = window.innerWidth - rect.right
    const left = rightSpace >= 260 ? rect.right + 16 : Math.max(0, rect.left - 256 - 16)
    return `left: ${left}px; top: ${rect.top}px;`
  })

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      size="lg"
      placement="top"
      panelClass="search-modal"
      aria-label={t(
        isAddFlow()
          ? 'ui.addCard.title'
          : props.targetHasPrinting
            ? 'ui.editor.changePrintingTitle'
            : 'ui.editor.setPrintingTitle',
      )}
      panelRef={(el) => (modalRef = el)}
      overlay={
        <Show when={previewCard() && step() === 'search'}>
          <div class="search-card-preview" style={previewPositionStyle()}>
            <Show when={previewCard()}>
              {(card) => <img src={card().imageUrl} alt={card().name} />}
            </Show>
          </div>
        </Show>
      }
    >
      <Show when={step() === 'search'}>
        <SearchStep
          query={query()}
          results={results()}
          highlightedIndex={highlightedIndex()}
          sourceNote={props.search.sourceNote}
          inputRef={(el) => (inputRef = el)}
          onInput={handleInputChange}
          onKeyDown={handleSearchKeyDown}
          onPick={(name) => void selectCardName(name)}
          onHover={(name, index) => {
            setHighlightedIndex(index)
            setQuery(name)
            void fetchCardImage(name)
          }}
          onLeave={() => {
            setHighlightedIndex(-1)
            setQuery(typedQuery)
            setPreviewCard(null)
          }}
        />
      </Show>

      <Show when={step() === 'printing'}>
        <PrintingStep
          cardName={selectedCardName()}
          loading={loadingPrintings()}
          hasPrintings={printings().length > 0}
          visibleCount={visiblePrintings().length}
          paginatedPrintings={paginatedPrintings()}
          pageStart={pageStart()}
          page={printingsPage()}
          totalPages={totalPrintingsPages()}
          highlightIndex={printingHighlightIndex()}
          cellOffset={cellOffset()}
          filter={printingFilter()}
          active={props.open && step() === 'printing'}
          setFilterFellBack={setFilterFellBack()}
          filterSets={props.defaults?.sets ?? []}
          blocked={addOptionsBlocked()}
          gridRef={(el) => (printingGridRef = el)}
          onFilter={setPrintingFilter}
          onPage={goToPage}
          onSelect={selectPrinting}
          onBack={goBack}
          addOptions={props.addOptions}
          options={addCardOptions}
        />
      </Show>

      <Show when={step() === 'language-notice' && languageNotice()}>
        {(notice) => (
          <LanguageNoticeStep
            cardName={selectedCardName()}
            notice={notice()}
            onContinue={confirmLanguageNotice}
            onBack={goBack}
          />
        )}
      </Show>

      <Show when={step() === 'finish-condition' && selectedPrinting()}>
        {(printing) => (
          <FinishConditionStep
            cardName={selectedCardName()}
            printing={printing()}
            finish={selectedFinish()}
            condition={selectedCondition()}
            quantity={quantity()}
            usesCondition={usesCondition()}
            usesQuantity={usesQuantity()}
            canAddAnother={canAddAnother()}
            isAddFlow={isAddFlow()}
            blocked={addOptionsBlocked()}
            groupRef={(el) => (finishConditionRef = el)}
            onFinish={setSelectedFinish}
            onCondition={setSelectedCondition}
            onQuantity={setQuantity}
            onAdd={handleAddWithOptions}
            onBack={goBack}
            addOptions={props.addOptions}
            options={addCardOptions}
          />
        )}
      </Show>

      <div class="search-modal-footer">
        <For each={keyHints()}>
          {(hint) => (
            <span>
              <KeyChips keys={hint.keys} />
              {tKey(hint.label)}
            </span>
          )}
        </For>
      </div>
    </Modal>
  )
}
