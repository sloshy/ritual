/**
 * The controller half of the "Swap Printings" wizard, shared by the deck and
 * flat-list controllers: holds the open request, builds it from the live list,
 * and applies the wizard's planned moves as change events.
 * Design record: `research/swap-printings-plan-2026-08-21.md` §3 and §7.2.
 */

import { type Accessor, batch, createSignal } from 'solid-js'
import type { ChangeInput } from '../changes/change-event'
import type { ListType } from '../list/list-type'
import type { PriceCurrency } from '../pricing/price-currency'
import { listRefKey, type NamedListRef } from '../site/combined-list'
import type { SwapMove, SwapSourceProvider, SwapTarget } from './swap-printings'
import type { UseEditorResult } from './useEditor'
import {
  type SwapListKind,
  type SwapScope,
  buildSwapRequest,
  swapMovesToChanges,
} from './swap-targets'
import type { SwapPrintingsWizardProps, SwapWizardRequest } from './components/SwapPrintingsWizard'

/** The display settings a host supplies when mounting the wizard. */
export type SwapWizardDisplay = {
  currency: PriceCurrency
}

/** What a list controller contributes to the shared swap logic. */
export type SwapControllerDeps<TData, TCardEntry> = {
  editor: UseEditorResult<TData, TCardEntry>
  listType: ListType
  kind: SwapListKind
  /** The live list as wizard targets (see `deckSwapTargets` / `flatSwapTargets`). */
  targetsOf: (data: TData) => SwapTarget[]
  /** The editor's reducer, applied per operation. */
  applyChange: (data: TData, change: ChangeInput) => TData
  /** Copies the line with this id holds (a deck line's quantity; 1 on a flat list). */
  quantityOf: (data: TData, cardId: number) => number
  /**
   * The standing line an arriving copy of `move`'s printing would merge onto
   * (see `SwapApplyContext.mergeTargetId`); probed against the data as the ops
   * before it left it. A flat-list host answers undefined.
   */
  mergeTargetId: (data: TData, move: SwapMove) => number | undefined
}

/** The swap surface a list controller exposes. */
export type SwapController = {
  /** The open wizard request; null while closed. */
  swapRequest: Accessor<SwapWizardRequest | null>
  /** Open the wizard on every line, or on the lines a selection names (one = single-card entry). */
  openSwapPrintings: (scope: SwapScope) => void
  closeSwapPrintings: () => void
  /** Record and apply the wizard's planned moves as change events, in one batch. */
  applySwapMoves: (moves: SwapMove[]) => void
  /** The list being edited, as the wizard and the planner name it. */
  editedListRef: Accessor<NamedListRef>
  /** Real lists (decks and collections other than the edited one) a displaced copy may be sent to. */
  displacedTargets: Accessor<NamedListRef[]>
  /**
   * The wizard's props for a host to mount, or undefined when the editor was
   * configured without a source provider (no wizard is offered then).
   */
  swapWizardProps: (display: SwapWizardDisplay) => SwapPrintingsWizardProps | undefined
}

export function createSwapController<TData, TCardEntry>(
  deps: SwapControllerDeps<TData, TCardEntry>,
): SwapController {
  const { editor } = deps
  const [swapRequest, setSwapRequest] = createSignal<SwapWizardRequest | null>(null)

  const editedListRef = (): NamedListRef => {
    const slug = editor.slug() ?? ''
    return {
      type: deps.listType,
      slug,
      name: editor.list().find((item) => item.slug === slug)?.name ?? slug,
    }
  }

  /**
   * The configured provider with the edited list filtered out of its `lists()`
   * — the controller does the exclusion because only it knows which list is
   * open (the admin editor switches lists without remounting). Built once: the
   * config is fixed for the editor's life, and a stable object keeps the
   * wizard from treating every render as a new provider.
   */
  const raw = editor.swapSources()
  const provider: SwapSourceProvider | undefined = raw && {
    lists: () => {
      const editedKey = listRefKey(editedListRef())
      return raw.lists().filter((ref) => listRefKey(ref) !== editedKey)
    },
    load: raw.load,
    printings: raw.printings,
  }

  const displacedTargets = (): NamedListRef[] =>
    (provider?.lists() ?? []).filter((ref) => ref.type !== 'wanted')

  const openSwapPrintings = (scope: SwapScope): void => {
    // No provider, no wizard mounted: a request nothing renders could never be closed.
    if (!provider) return
    const data = editor.data()
    if (data === null) return
    setSwapRequest(buildSwapRequest(deps.targetsOf(data), scope))
  }

  const closeSwapPrintings = (): void => {
    setSwapRequest(null)
  }

  const applySwapMoves = (moves: SwapMove[]): void => {
    const initial = editor.data()
    if (initial === null) return
    // The ops are pulled one at a time and each applied to `current` before
    // the next is produced, so the merge probe reads the list as it stands
    // after the ops before it (a line an out op drained, or an in op created).
    let current: TData = initial
    batch(() => {
      const ops = swapMovesToChanges(moves, {
        kind: deps.kind,
        allocateId: editor.pool.allocate,
        quantityOf: (cardId) => deps.quantityOf(current, cardId),
        mergeTargetId: (move) => deps.mergeTargetId(current, move),
      })
      for (const op of ops) {
        editor.changes.addChange(op.change)
        current = deps.applyChange(current, op.change)
        if (op.release !== undefined) editor.pool.release(op.release)
      }
      editor.setData(() => current)
    })
  }

  // Getters, not eager reads: the hosts hand this object to `EditorShell`,
  // where `<Show>` memoizes it and the wizard reads the props lazily — so a
  // prop subscribes its reader only to what it actually reads, rather than to
  // every signal this builder touched (the request, the slug, the list names).
  const swapWizardProps = (display: SwapWizardDisplay): SwapPrintingsWizardProps | undefined => {
    if (!provider) return undefined
    return {
      get request() {
        return swapRequest()
      },
      onClose: closeSwapPrintings,
      onApply: applySwapMoves,
      provider,
      get editedRef() {
        return editedListRef()
      },
      displacedTargets,
      currency: display.currency,
    }
  }

  return {
    swapRequest,
    openSwapPrintings,
    closeSwapPrintings,
    applySwapMoves,
    editedListRef,
    displacedTargets,
    swapWizardProps,
  }
}
