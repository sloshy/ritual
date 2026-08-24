import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
  Switch,
  Match,
  type JSX,
} from 'solid-js'
import type { ScryfallCard } from '../../types'
import type { PriceCurrency } from '../../price-currency'
import { displayLanguage, scryfallCardLanguage } from '../../card-language'
import { displayFinish } from '../../finish-condition'
import { getCardImageUrl } from '../../card-image'
import { enabledScopeRefs } from '../../site/find-scope'
import type { ListRefKey, NamedListRef } from '../../site/combined-list'
import { activeUsdSource, sitePriceForFinish } from '../../site/price-view'
import { buylistLoading } from '../../site/buylist-quotes'
import { usePrintingQuotes } from '../../site/printing-quotes'
import { isCardSideways } from '../../site/image-sources'
import { TooltipOverlay } from '../../site/TooltipOverlay'
import { useTooltip } from '../../site/useTooltip'
import { isAbortError } from '../../site/utils'
import { Modal } from '../../ui/Modal'
import { useT } from '../../ui/i18n'
import {
  attachReplacements,
  candidatePrice,
  collectSwapCandidates,
  displacedDestinationRequired,
  pinningMoves,
  planAllMoves,
  summarize,
  targetPinsPrinting,
} from '../swap-printings'
import type {
  CardSwapPlan,
  ChosenPrinting,
  DisplacedPolicy,
  FinishFilter,
  PlannedMoves,
  PriceOf,
  SwapCandidate,
  SwapMode,
  SwapMove,
  SwapSourceList,
  SwapSourceProvider,
  SwapSummary,
  SwapTarget,
  UnpricedPolicy,
} from '../swap-printings'
import {
  afterPlanning,
  autoPlanAll,
  consumedByOthers,
  defaultSourceExclusion,
  emptyPlan,
  needsManualKeys,
  previousStep,
  scopeKey,
  setAllocation,
  swapTargetKey,
  visibleSteps,
  type StepContext,
  type SwapWizardStep,
} from '../swap-printings/wizard-state'
import { CardsStep } from './swap-printings/CardsStep'
import { SourcesStep } from './swap-printings/SourcesStep'
import { ModeStep } from './swap-printings/ModeStep'
import { PickStep } from './swap-printings/PickStep'
import { ReplacementsStep } from './swap-printings/ReplacementsStep'
import { ReviewStep } from './swap-printings/ReviewStep'
import { SummaryStep } from './swap-printings/SummaryStep'
import {
  CardPreviewProvider,
  StepIndicator,
  type CardPreviewControl,
} from './swap-printings/shared'

export { swapTargetKey }

/** What the wizard is opened with (see the design record, §7.1 and §9). */
export type SwapWizardRequest = {
  /** The lines of the edited list, pinned and name-only alike, in list order. */
  targets: SwapTarget[]
  /** Keys ({@link swapTargetKey}) pre-checked on the Cards step; undefined = all. */
  preselected?: ReadonlySet<string>
  /** Single-card entry: skip straight to that card's picker (sources/mode at their defaults). */
  singleCard?: boolean
}

export type SwapPrintingsWizardProps = {
  /** The open request; null = closed. */
  request: SwapWizardRequest | null
  onClose: () => void
  /** Apply the planned moves into the editor; the wizard closes itself afterwards. */
  onApply: (moves: SwapMove[]) => void
  /** Other lists + their loader + full printings (for printing-less entries). */
  provider: SwapSourceProvider
  /** The list being edited (never a source). */
  editedRef: NamedListRef
  /** Real lists (deck/collection, never wanted, never the edited list) offered as displaced-copy destinations. */
  displacedTargets: () => NamedListRef[]
  currency: PriceCurrency
}

/** No replacement picks: what Apply reads while the option is off. */
const NO_PICKS: ReadonlyMap<string, ChosenPrinting> = new Map()

/** The step-indicator caption of each step. */
const STEP_LABELS = {
  cards: 'ui.swap.step.cards',
  sources: 'ui.swap.step.sources',
  mode: 'ui.swap.step.mode',
  pick: 'ui.swap.step.pick',
  review: 'ui.swap.step.review',
  replacements: 'ui.swap.step.replacements',
  summary: 'ui.swap.step.summary',
} as const satisfies Record<SwapWizardStep, string>

/**
 * The batch "Swap Printings" wizard (design record
 * `research/swap-printings-plan-2026-08-21.md` §1/§7.1): Cards → Sources →
 * Mode → Pick/Review → Summary, ending in `onApply(moves)`. State lives in
 * signals here; the pure transitions are in `swap-printings/wizard-state.ts`
 * and the planner in `swap-printings/`.
 */
export function SwapPrintingsWizard(props: SwapPrintingsWizardProps): JSX.Element {
  const t = useT()

  // ── Run state (reset on every open) ───────────────────────────────────
  const [ready, setReady] = createSignal(false)
  const [step, setStep] = createSignal<SwapWizardStep>('cards')
  const [checked, setChecked] = createSignal<Set<string>>(new Set<string>())
  const [excluded, setExcluded] = createSignal<Set<ListRefKey>>(new Set<ListRefKey>())
  const [sources, setSources] = createSignal<SwapSourceList[] | null>(null)
  /** Source lists the last load could not read; their copies are not on offer. */
  const [failedSources, setFailedSources] = createSignal<NamedListRef[]>([])
  const [loading, setLoading] = createSignal(false)
  const [loadFailed, setLoadFailed] = createSignal(false)
  const [mode, setMode] = createSignal<SwapMode>('manual')
  const [unpriced, setUnpriced] = createSignal<UnpricedPolicy>('skip')
  const [finish, setFinish] = createSignal<FinishFilter>('any')
  const [displaced, setDisplaced] = createSignal<DisplacedPolicy>({ kind: 'swap' })
  /** Plans by target key; a missing entry means "untouched" (every copy keeps its printing). */
  const [plans, setPlans] = createSignal<Map<string, CardSwapPlan>>(new Map())
  const [pickQueue, setPickQueue] = createSignal<string[]>([])
  const [pickIndex, setPickIndex] = createSignal(0)
  const [pickFromReview, setPickFromReview] = createSignal(false)
  const [pickFinish, setPickFinish] = createSignal<FinishFilter>('any')
  const [query, setQuery] = createSignal('')
  const [fallback, setFallback] = createSignal<NamedListRef | undefined>(undefined)
  /** The "replace taken copies" option: offer a replacement pick per source list and printing taken for a name-only card. */
  const [replaceTaken, setReplaceTaken] = createSignal(false)
  /** The replacement chosen per `replacementKey`. */
  const [picks, setPicks] = createSignal<Map<string, ChosenPrinting>>(new Map())

  let loadController: AbortController | null = null
  let loadedScope = ''
  const abortLoad = (): void => {
    loadController?.abort()
    loadController = null
  }
  onCleanup(abortLoad)

  // ── Derived ───────────────────────────────────────────────────────────
  const singleCard = (): boolean => props.request?.singleCard === true
  const targets = (): SwapTarget[] => props.request?.targets ?? []
  const targetByKey = createMemo<Map<string, SwapTarget>>(
    () => new Map(targets().map((target) => [swapTargetKey(target), target])),
  )
  const checkedKeys = createMemo<string[]>(() =>
    targets()
      .map(swapTargetKey)
      .filter((key) => checked().has(key)),
  )
  // The provider never lists the edited list (the swap controller owns that rule).
  const sourceLists = createMemo<NamedListRef[]>(() => props.provider.lists())
  const enabledRefs = createMemo<NamedListRef[]>(() => enabledScopeRefs(excluded(), sourceLists()))
  const displacedTargets = createMemo<NamedListRef[]>(() => props.displacedTargets())

  /**
   * The live price of one copy under the site's price source; 0 (no price)
   * reads as null. A non-English copy whose resolved object is the English
   * printing stays unpriced rather than borrowing English money — the same
   * refusal `price-view.ts` applies to non-English card objects.
   */
  const priceOf: PriceOf = (card, finishOf, language) => {
    if (!card) return null
    if (displayLanguage(language) !== 'en' && scryfallCardLanguage(card) === 'en') return null
    return sitePriceForFinish(card, displayFinish(card, finishOf), props.currency) || null
  }
  /** Structural collection — prices are read live by the rows and stamped on at plan time. */
  const noPrice: PriceOf = () => null

  /**
   * Candidates per checked target. Deliberately collected without prices so
   * the memo depends on the sources and the selection only — pricing inside
   * it would subscribe this whole walk to every arriving quote.
   */
  const candidatesByKey = createMemo<Map<string, SwapCandidate[]>>(() => {
    const loaded = sources()
    const result = new Map<string, SwapCandidate[]>()
    if (!loaded) return result
    for (const key of checkedKeys()) {
      const target = targetByKey().get(key)
      if (target) result.set(key, collectSwapCandidates(target, loaded, noPrice))
    }
    return result
  })
  const candidatesFor = (key: string): SwapCandidate[] => candidatesByKey().get(key) ?? []
  /** The candidates with the price the auto ranking reads, as of now. */
  const pricedCandidatesFor = (key: string): SwapCandidate[] =>
    candidatesFor(key).map((candidate) =>
      candidate.kind === 'printing'
        ? { ...candidate, price: candidatePrice(candidate, priceOf) }
        : candidate,
    )

  // Every card a price may be asked for — targets, candidates, and the
  // printings chosen for printing-less picks — so Card Kingdom quotes resolve.
  const quoteCards = createMemo<ScryfallCard[]>(() => {
    const cards: ScryfallCard[] = []
    for (const target of targets()) if (target.card) cards.push(target.card)
    for (const candidates of candidatesByKey().values()) {
      for (const candidate of candidates) if (candidate.card) cards.push(candidate.card)
    }
    for (const plan of plans().values()) {
      for (const allocation of plan.allocations) {
        if (allocation.printing) cards.push(allocation.printing.card)
      }
    }
    for (const pick of picks().values()) cards.push(pick.card)
    return cards
  })
  usePrintingQuotes(quoteCards)

  /**
   * Whether prices are still arriving: under the Card Kingdom source the
   * quotes for the candidate cards are fetched on demand, and an auto plan
   * snapshotted before they land would flag every card unpriced. The Mode
   * step's Next (the only place auto plans are built) waits for them.
   */
  const quotesSettling = (): boolean => activeUsdSource() === 'cardkingdom' && buylistLoading()

  const planFor = (key: string): CardSwapPlan | undefined => {
    const existing = plans().get(key)
    if (existing) return existing
    const target = targetByKey().get(key)
    return target ? emptyPlan(target, candidatesFor(key)) : undefined
  }
  const activePlans = createMemo<CardSwapPlan[]>(() => {
    const result: CardSwapPlan[] = []
    for (const key of checkedKeys()) {
      const plan = planFor(key)
      if (plan) result.push(plan)
    }
    return result
  })

  const currentPickKey = (): string | undefined => pickQueue()[pickIndex()]
  const consumedElsewhere = createMemo<ReadonlyMap<string, number>>(() =>
    consumedByOthers(plans(), currentPickKey() ?? '', checked()),
  )

  const needsFallback = createMemo<boolean>(() =>
    displacedDestinationRequired(activePlans(), displaced()),
  )
  const planned = createMemo<PlannedMoves>(() =>
    planAllMoves(activePlans(), props.editedRef, displaced(), fallback()),
  )
  /** The planned moves with the chosen replacements attached — what Apply hands over. */
  const hasNameOnly = createMemo<boolean>(() =>
    checkedKeys().some((key) => {
      const target = targetByKey().get(key)
      return target !== undefined && !targetPinsPrinting(target)
    }),
  )
  const pinning = createMemo<SwapMove[]>(() => pinningMoves(planned().moves))
  const hasReplacements = (): boolean => replaceTaken() && pinning().length > 0
  // Picks made and then switched off (the option unticked on the way back)
  // must not ride out on Apply.
  const finalMoves = createMemo<SwapMove[]>(() =>
    attachReplacements(planned().moves, hasReplacements() ? picks() : NO_PICKS),
  )
  const summary = createMemo<SwapSummary>(() => summarize(activePlans(), finalMoves(), priceOf))
  const canApply = (): boolean =>
    planned().moves.length > 0 &&
    !(needsFallback() && !fallback()) &&
    !planned().flags.includes('needs-displaced-destination')

  // ── Loading ───────────────────────────────────────────────────────────
  const ensureLoaded = (): void => {
    const refs = enabledRefs()
    const key = scopeKey(refs)
    if (key === loadedScope && (sources() !== null || loading())) return
    abortLoad()
    const controller = new AbortController()
    loadController = controller
    loadedScope = key
    batch(() => {
      setSources(null)
      setFailedSources([])
      setLoading(true)
      setLoadFailed(false)
      // Plans were built against the previous scope's candidates.
      setPlans(new Map())
    })
    props.provider
      .load(refs, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        batch(() => {
          setSources(result.lists)
          setFailedSources(result.failed)
          setLoading(false)
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        batch(() => {
          setLoading(false)
          setLoadFailed(true)
        })
      })
  }

  // ── Open / close ──────────────────────────────────────────────────────
  const reset = (): void => {
    const request = props.request
    if (!request) return
    abortLoad()
    loadedScope = ''
    const keys = request.targets.map(swapTargetKey)
    const preselected = request.preselected
    const active = preselected ? keys.filter((key) => preselected.has(key)) : keys
    batch(() => {
      setSources(null)
      setFailedSources([])
      setLoading(false)
      setLoadFailed(false)
      setChecked(new Set(active))
      setExcluded(defaultSourceExclusion(props.provider.lists()))
      setMode('manual')
      setUnpriced('skip')
      setFinish('any')
      setDisplaced({ kind: 'swap' })
      setPlans(new Map())
      setPickQueue([])
      setPickIndex(0)
      setPickFromReview(false)
      setPickFinish('any')
      setQuery('')
      setFallback(undefined)
      setReplaceTaken(false)
      setPicks(new Map())
      if (request.singleCard) {
        // The pick queue is always a subset of the checked cards.
        setPickQueue(active)
        setStep('pick')
      } else {
        setStep('cards')
      }
      setReady(true)
    })
    if (request.singleCard) ensureLoaded()
  }
  // `Modal.onOpen` resets on closed→open; this covers the rest: a request
  // replaced while the wizard is already open (reset for the new one), and a
  // close (abort the load, blank the panel until the next open seeds it).
  createEffect(
    on(
      () => props.request,
      (request, previous) => {
        if (!request) {
          abortLoad()
          setReady(false)
        } else if (previous && previous !== request) {
          // The same request re-read (the host rebuilt its props, e.g. on a
          // currency change) is not a new run.
          reset()
        }
      },
    ),
  )

  const close = (): void => props.onClose()

  // ── Transitions ───────────────────────────────────────────────────────
  const startPlanning = (): void => {
    const keys = checkedKeys()
    batch(() => {
      setPickFromReview(false)
      setPickIndex(0)
      setPickFinish(finish())
      setQuery('')
      const current = mode()
      if (current === 'manual') {
        setPickQueue(keys)
        setStep(keys.length > 0 ? 'pick' : afterPlanning(stepContext()))
        return
      }
      const targetsToPlan = keys.flatMap((key) => {
        const target = targetByKey().get(key)
        return target ? [target] : []
      })
      const result = autoPlanAll(
        targetsToPlan,
        (target) => pricedCandidatesFor(swapTargetKey(target)),
        swapTargetKey,
        { mode: current, unpriced: unpriced(), finish: finish() },
        priceOf,
      )
      setPlans(result)
      const manual = needsManualKeys(result)
      setPickQueue(manual)
      setStep(manual.length > 0 ? 'pick' : 'review')
    })
  }

  const advancePick = (): void => {
    if (pickIndex() < pickQueue().length - 1) {
      batch(() => {
        setPickIndex((i) => i + 1)
        setQuery('')
      })
      return
    }
    setStep(pickFromReview() || mode() !== 'manual' ? 'review' : afterPlanning(stepContext()))
  }

  const goNext = (): void => {
    switch (step()) {
      case 'cards':
        setStep('sources')
        return
      case 'sources':
        ensureLoaded()
        setStep('mode')
        return
      case 'mode':
        startPlanning()
        return
      case 'pick':
        advancePick()
        return
      case 'review':
        setStep(afterPlanning(stepContext()))
        return
      case 'replacements':
        setStep('summary')
        return
      case 'summary':
        return
    }
  }

  const stepContext = (): StepContext => ({
    mode: mode(),
    singleCard: singleCard(),
    pickFromReview: pickFromReview(),
    hasPickQueue: pickQueue().length > 0,
    hasReplacements: hasReplacements(),
  })

  const goBack = (): void => {
    const previous = previousStep(step(), stepContext())
    if (!previous) return
    batch(() => {
      if (previous === 'pick') setPickIndex(Math.max(0, pickQueue().length - 1))
      setStep(previous)
    })
  }

  const changeFromReview = (key: string): void => {
    batch(() => {
      setPickQueue([key])
      setPickIndex(0)
      setPickFromReview(true)
      setQuery('')
      setStep('pick')
    })
  }

  const setPickCount = (
    candidate: SwapCandidate,
    count: number,
    printing?: ChosenPrinting,
  ): void => {
    const key = currentPickKey()
    const plan = key === undefined ? undefined : planFor(key)
    if (key === undefined || !plan) return
    setPlans((prev) => {
      const next = new Map(prev)
      next.set(key, setAllocation(plan, candidate, count, printing))
      return next
    })
  }

  const setPick = (key: string, printing: ChosenPrinting | undefined): void => {
    setPicks((prev) => {
      const next = new Map(prev)
      if (printing) next.set(key, printing)
      else next.delete(key)
      return next
    })
  }

  const apply = (): void => {
    if (!canApply()) return
    props.onApply(finalMoves())
    close()
  }

  const nextDisabled = (): boolean => {
    switch (step()) {
      case 'cards':
        return checked().size === 0
      case 'sources':
        return enabledRefs().length === 0
      case 'mode':
        return loading() || loadFailed() || sources() === null || quotesSettling()
      case 'pick':
        return sources() === null
      // Rows left without a pick are a deliberate "no replacement".
      case 'replacements':
        return false
      default:
        return false
    }
  }

  const steps = createMemo<SwapWizardStep[]>(() => visibleSteps(stepContext()))
  const canGoBack = (): boolean => previousStep(step(), stepContext()) !== null

  // The hover preview every step shares. It lives in the Modal's overlay slot
  // so it escapes the panel's scroll clipping, and a card that resolved to
  // nothing still previews — as the placeholder, not as no preview at all.
  // Art comes straight from the card object (never the baked `images/<id>.jpg`
  // path) because the picker's grid shows arbitrary Scryfall printings the site
  // never baked — the same rule the add-card printing grid follows.
  const tip = useTooltip()
  const preview: CardPreviewControl = {
    show: (card) => {
      tip.setTooltip({
        src: card ? getCardImageUrl(card) : null,
        sideways: isCardSideways(card),
      })
    },
    hide: () => tip.setTooltip(null),
  }
  // A row hovered when the step (or the whole run) changes under the cursor
  // never gets its mouseleave, so the preview is cleared on every transition.
  createEffect(on([step, () => props.request], () => tip.setTooltip(null), { defer: true }))

  return (
    <Modal
      open={props.request !== null}
      onClose={close}
      onOpen={reset}
      size="lg"
      panelClass="swap-wizard-modal"
      aria-label={t('ui.swap.aria')}
      overlay={
        <TooltipOverlay
          tooltip={tip.tooltip()}
          pos={tip.tooltipPos()}
          tooltipRef={tip.tooltipRef}
          class="swap-wizard-tooltip"
        />
      }
    >
      <CardPreviewProvider value={preview}>
        <Show when={ready()}>
          <div class="search-modal-header swap-wizard-header">
            <Show when={canGoBack()}>
              <button type="button" class="search-tab-btn" onClick={goBack}>
                {t('ui.swap.back')}
              </button>
            </Show>
            <h3 class="modal-heading-flex">{t('ui.swap.title')}</h3>
            <StepIndicator steps={steps()} current={step()} label={(s) => t(STEP_LABELS[s])} />
          </div>
          <div class="search-modal-body swap-wizard-body">
            <Switch>
              <Match when={step() === 'cards'}>
                <CardsStep
                  targets={targets()}
                  targetKey={swapTargetKey}
                  checked={checked}
                  onToggle={(key) =>
                    setChecked((prev) => {
                      const next = new Set(prev)
                      if (next.has(key)) next.delete(key)
                      else next.add(key)
                      return next
                    })
                  }
                  onSetAll={(on) =>
                    setChecked(on ? new Set(targets().map(swapTargetKey)) : new Set<string>())
                  }
                />
              </Match>
              <Match when={step() === 'sources'}>
                <SourcesStep
                  lists={sourceLists}
                  excluded={excluded}
                  setExcluded={setExcluded}
                  enabledCount={() => enabledRefs().length}
                />
              </Match>
              <Match when={step() === 'mode'}>
                <ModeStep
                  mode={mode}
                  setMode={setMode}
                  unpriced={unpriced}
                  setUnpriced={setUnpriced}
                  finish={finish}
                  setFinish={setFinish}
                  displaced={displaced}
                  setDisplaced={setDisplaced}
                  displacedTargets={displacedTargets}
                  hasNameOnly={hasNameOnly}
                  replaceTaken={replaceTaken}
                  setReplaceTaken={setReplaceTaken}
                />
                <LoadStatus
                  loading={loading() || quotesSettling()}
                  failed={loadFailed()}
                  unreadable={failedSources().length}
                />
              </Match>
              <Match when={step() === 'pick'}>
                <Show
                  when={sources() !== null}
                  fallback={
                    <LoadStatus
                      loading={loading()}
                      failed={loadFailed()}
                      unreadable={failedSources().length}
                    />
                  }
                >
                  <Show when={currentPickKey()} keyed>
                    {(key) => (
                      <Show when={planFor(key)}>
                        {(plan) => (
                          <PickStep
                            plan={plan}
                            consumed={consumedElsewhere}
                            index={pickIndex() + 1}
                            total={pickQueue().length}
                            onPrev={pickIndex() > 0 ? () => setPickIndex((i) => i - 1) : null}
                            onNext={
                              pickIndex() < pickQueue().length - 1
                                ? () => setPickIndex((i) => i + 1)
                                : null
                            }
                            onSetCount={setPickCount}
                            finish={pickFinish}
                            setFinish={setPickFinish}
                            query={query}
                            setQuery={setQuery}
                            active={() => props.request !== null && step() === 'pick'}
                            printings={props.provider.printings}
                            priceOf={priceOf}
                            currency={props.currency}
                          />
                        )}
                      </Show>
                    )}
                  </Show>
                </Show>
              </Match>
              <Match when={step() === 'review'}>
                <ReviewStep
                  keys={checkedKeys}
                  planFor={planFor}
                  priceOf={priceOf}
                  currency={props.currency}
                  onChange={changeFromReview}
                />
              </Match>
              <Match when={step() === 'replacements'}>
                <ReplacementsStep
                  moves={pinning}
                  picks={picks}
                  onPick={setPick}
                  query={query}
                  setQuery={setQuery}
                  active={() => props.request !== null && step() === 'replacements'}
                  printings={props.provider.printings}
                  priceOf={priceOf}
                  currency={props.currency}
                />
              </Match>
              <Match when={step() === 'summary'}>
                <SummaryStep
                  moves={finalMoves}
                  summary={summary}
                  needsFallback={needsFallback}
                  fallback={fallback}
                  setFallback={setFallback}
                  displacedTargets={displacedTargets}
                  currency={props.currency}
                />
              </Match>
            </Switch>
          </div>
          <div class="confirm-dialog-actions swap-wizard-footer">
            <Show
              when={step() === 'summary'}
              fallback={
                <>
                  <button type="button" class="btn btn-secondary" onClick={close}>
                    {t('ui.dialog.cancel')}
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    disabled={nextDisabled()}
                    onClick={goNext}
                  >
                    {t('ui.swap.next')}
                  </button>
                </>
              }
            >
              <button type="button" class="btn btn-secondary" onClick={close}>
                {t('ui.swap.discard')}
              </button>
              <button type="button" class="btn btn-primary" disabled={!canApply()} onClick={apply}>
                {t('ui.swap.apply')}
              </button>
            </Show>
          </div>
        </Show>
      </CardPreviewProvider>
    </Modal>
  )
}

type LoadStatusProps = {
  loading: boolean
  failed: boolean
  /** Source lists the load could not read (the rest loaded); 0 when every list came through. */
  unreadable: number
}

/**
 * The source-loading status line shown under the Mode step and in place of an
 * unloaded picker, plus — once loaded — a note for any list that could not be
 * read, so a missing candidate is explained rather than silently absent.
 */
function LoadStatus(props: LoadStatusProps): JSX.Element {
  const t = useT()
  return (
    <>
      <Show when={props.loading || props.failed}>
        <p
          class="swap-wizard-note"
          classList={{ 'swap-wizard-note--warning': props.failed }}
          role="status"
        >
          {props.failed ? t('ui.swap.sources.loadFailed') : t('ui.swap.sources.loading')}
        </p>
      </Show>
      <Show when={!props.loading && !props.failed && props.unreadable > 0}>
        <p class="swap-wizard-note swap-wizard-note--warning" role="status">
          {t('ui.swap.sources.someFailed', { count: props.unreadable })}
        </p>
      </Show>
    </>
  )
}
