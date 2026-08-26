/**
 * Batch Mode for the interactive `ritual move` session: pick many cards across
 * several lists, then send the whole selection to one destination.
 *
 * The flow is three screens — which lists to view, which cards to take, where
 * they go — and it queues into exactly the same pending-move state the
 * single-card flow does, so `View Pending Changes`, chained moves, and the
 * save-on-exit menu all behave identically.
 */

import prompts, { type Choice } from 'prompts'
import { listRefLabel } from '../changes/change-event'
import { t } from '../i18n/t'
import {
  applyVirtualMove,
  batchSelectableKeys,
  buildCardSearchChoices,
  toggleItemTitle,
  type CardSearchChoice,
  type MoveSessionConfig,
  type VirtualCard,
} from './move-helpers'
import type { ListEntry } from '../list/list-info'
import { ask, suggestCardsWithMenu } from '../cli/prompts'
import { promptListToggle } from './move-toggle'
import {
  promptDestinationSection,
  promptMoveDestination,
  resolveMovePrinting,
} from './move-prompts'

/** Whether the session stays in Batch Mode after a round, or drops back to the card search. */
export type BatchRoundResult = 'continue' | 'exit'

/**
 * Batch Mode's own state. The viewed lists are seeded from the session's `Move
 * FROM` filter when the mode is switched on and are independent from then on:
 * narrowing what a batch looks at is a per-batch decision, not a change to the
 * session's filters.
 */
export type BatchSession = {
  /** File paths of the lists whose cards the batch screen shows. */
  sources: Set<string>
}

export function createBatchSession(config: MoveSessionConfig): BatchSession {
  return { sources: new Set(config.enabledSources) }
}

/**
 * Batch Mode's menu sentinels. A literal union rather than bare strings, so a
 * renamed sentinel is a compile error at every comparison instead of a menu row
 * that silently stops responding.
 */
const BATCH_SENTINELS = [
  '__BATCH_DONE__',
  '__BATCH_SELECT_ALL__',
  '__BATCH_SELECT_FROM__',
  '__BATCH_EXIT__',
] as const
type BatchSentinel = (typeof BATCH_SENTINELS)[number]
const BATCH_SENTINEL_SET: ReadonlySet<string> = new Set(BATCH_SENTINELS)

/** A choice on the batch card screen is a menu row when its value is a known sentinel. */
export const isBatchMenuChoice = (choice: Choice): boolean =>
  typeof choice.value === 'string' && BATCH_SENTINEL_SET.has(choice.value)

/** What the batch card screen's menu rows need to know about the current selection. */
export type BatchMenuState = {
  selectedCount: number
  /** More than one list is being viewed, which turns "Select all" into "Select all from…". */
  multiSource: boolean
  /** Every card on screen is already selected, which flips "Select all" to "Deselect all". */
  allSelected: boolean
}

/** One row of the batch card screen's menu, whose value is always a sentinel. */
type BatchMenuChoice = Choice & { value: BatchSentinel }

/**
 * The rows above the cards on the batch selection screen: finish, the select-all
 * affordance for the current view, and the way out of Batch Mode.
 */
export function buildBatchMenuChoices(state: BatchMenuState): BatchMenuChoice[] {
  return [
    { title: t('cli.move.batchDone', { count: state.selectedCount }), value: '__BATCH_DONE__' },
    state.multiSource
      ? { title: t('cli.move.batchSelectAllFrom'), value: '__BATCH_SELECT_FROM__' }
      : {
          title: state.allSelected ? t('cli.move.batchDeselectAll') : t('cli.move.batchSelectAll'),
          value: '__BATCH_SELECT_ALL__',
        },
    { title: t('cli.move.batchExit'), value: '__BATCH_EXIT__' },
  ]
}

/** Batch Mode's list picker imposes no floor: emptying it is how you leave. */
const SOURCES_MAY_BE_EMPTY = false

/**
 * Run one round of Batch Mode: choose the viewed lists, select cards, and queue
 * them to a destination. Returns `continue` to stay in Batch Mode (the next
 * round reopens at the list picker with the same lists still ticked) or `exit`
 * to hand the session back to the single-card search.
 */
export async function runBatchRound(
  state: Map<string, VirtualCard>,
  config: MoveSessionConfig,
  batch: BatchSession,
): Promise<BatchRoundResult> {
  await promptListToggle(batch.sources, config.allLists, 'batch', SOURCES_MAY_BE_EMPTY)
  // Emptying the list picker is the way out of Batch Mode from that screen —
  // there is nothing to show, so there is nothing to stay for.
  if (batch.sources.size === 0) {
    console.log(t('cli.move.batchNoSources'))
    return 'exit'
  }

  const selected = new Set<string>()

  while (true) {
    const selectable = batchSelectableKeys(state, batch.sources)
    // Nothing left to pick — every card is queued already, or the lists are
    // empty. Staying would loop between an empty screen and the list picker.
    if (selectable.size === 0) {
      console.log(t('cli.move.batchNoCards'))
      return 'exit'
    }
    pruneSelection(selected, selectable)

    const menuChoices = buildBatchMenuChoices({
      selectedCount: selected.size,
      multiSource: batch.sources.size > 1,
      allSelected: isEverySelected(selectable, selected),
    })
    const cardChoices = buildCardSearchChoices(state, batch.sources, selected)

    const selection = await ask<string>({
      type: 'autocomplete',
      message: t('cli.move.batchPrompt', { count: selected.size }),
      subjectKey: 'cli.prompt.subject.cardsToMove',
      choices: [...menuChoices, ...cardChoices],
      limit: 12,
      // The menu rows stay visible while the cards filter: they are how the
      // screen is left, and typing must never strand the user on it.
      suggest: suggestCardsWithMenu({ isMenuChoice: isBatchMenuChoice, emptyShows: 'all' }),
    })

    if (selection === undefined || selection === '__BATCH_EXIT__') return 'exit'

    if (selection === '__BATCH_SELECT_ALL__') {
      const deselect = isEverySelected(selectable, selected)
      for (const key of selectable) {
        if (deselect) selected.delete(key)
        else selected.add(key)
      }
      continue
    }

    if (selection === '__BATCH_SELECT_FROM__') {
      const paths = await promptSelectAllFrom(config.allLists, batch.sources)
      if (paths !== undefined) {
        for (const key of batchSelectableKeys(state, new Set(paths))) selected.add(key)
      }
      continue
    }

    if (selection === '__BATCH_DONE__') {
      if (selected.size === 0) {
        console.log(t('cli.move.batchNoneSelected'))
        continue
      }
      // Backing out of the destination (or queueing nothing at all) keeps the
      // selection, so the work of picking the cards survives an Escape.
      const outcome = await queueBatch(state, config, selected, cardChoices)
      if (outcome === 'cancelled') continue
      return 'continue'
    }

    // Card row: toggle it.
    if (selected.has(selection)) selected.delete(selection)
    else selected.add(selection)
  }
}

/**
 * Drop from the selection every card the screen no longer shows — one queued by
 * an earlier round, say — so the count above the list is always what is on it.
 */
export function pruneSelection(selected: Set<string>, selectable: ReadonlySet<string>): void {
  for (const key of selected) {
    if (!selectable.has(key)) selected.delete(key)
  }
}

/** Whether every card on screen is ticked, which is what flips "Select all". */
function isEverySelected(selectable: ReadonlySet<string>, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return false
  for (const key of selectable) {
    if (!selected.has(key)) return false
  }
  return true
}

/** The "select all from…" screen resolves to a sentinel or a list's file path. */
type SelectAllFromResponse = { action?: string }

/**
 * "Select all from…": pick which of the viewed lists to take wholesale, or all
 * of them at once. Returns the chosen file paths, or `undefined` when the user
 * backed out.
 */
async function promptSelectAllFrom(
  allLists: ListEntry[],
  sources: ReadonlySet<string>,
): Promise<string[] | undefined> {
  const lists = allLists.filter((l) => sources.has(l.filePath))
  const picked = new Set<string>()

  while (true) {
    const choices: Choice[] = lists.map((l) => ({
      title: toggleItemTitle(picked.has(l.filePath), listRefLabel(l.ref)),
      value: l.filePath,
    }))
    choices.push(
      { title: t('cli.move.batchAllSelectedLists'), value: '__ALL__' },
      { title: t('cli.move.batchContinue'), value: '__CONTINUE__' },
      { title: t('cli.move.back'), value: '__BACK__' },
    )

    const response = (await prompts({
      type: 'select',
      name: 'action',
      message: t('cli.move.batchSelectFromPrompt'),
      choices,
    })) as SelectAllFromResponse

    const action = response.action
    if (action === undefined || action === '__BACK__') return undefined
    // Exclusive by construction: every viewed list, whatever the boxes say.
    if (action === '__ALL__') return lists.map((l) => l.filePath)
    if (action === '__CONTINUE__') {
      if (picked.size === 0) {
        console.log(t('cli.move.batchNoListsPicked'))
        continue
      }
      return [...picked]
    }
    if (picked.has(action)) picked.delete(action)
    else picked.add(action)
  }
}

/** What a batch's selection resolves to once a destination is known. */
export type BatchQueuePlan = {
  /** The cards to move, in the order the screen listed them. */
  moves: VirtualCard[]
  /** Selected cards already sitting in the destination, which stay where they are. */
  sameList: number
  /**
   * Selected cards no longer in the session's movable state. Unreachable while
   * the screen and the selection are rebuilt from the same predicate each pass;
   * counted rather than dropped silently so that stays checkable.
   */
  stale: number
}

/**
 * Resolve a batch's ticked keys into the cards that will actually move. Pure —
 * the prompting and the mutation both happen in {@link queueBatch}.
 */
export function planBatchQueue(
  state: Map<string, VirtualCard>,
  order: readonly CardSearchChoice[],
  selected: ReadonlySet<string>,
  dest: ListEntry,
): BatchQueuePlan {
  const plan: BatchQueuePlan = { moves: [], sameList: 0, stale: 0 }
  for (const choice of order) {
    if (!selected.has(choice.value)) continue
    const vc = state.get(choice.value)
    if (!vc || vc.pendingMove !== null) {
      plan.stale++
      continue
    }
    if (vc.currentList.filePath === dest.filePath) {
      plan.sameList++
      continue
    }
    plan.moves.push(vc)
  }
  return plan
}

/** Whether a batch reached the destination, or the user backed out of it. */
type QueueOutcome = 'queued' | 'cancelled'

/**
 * Ask for the batch's destination (and deck section) and queue every selected
 * card to it. `cancelled` means nothing was queued and the selection is intact:
 * either the user backed out of a question, or every selected card turned out
 * to be unmovable to that destination and deserves another one.
 */
async function queueBatch(
  state: Map<string, VirtualCard>,
  config: MoveSessionConfig,
  selected: Set<string>,
  order: readonly CardSearchChoice[],
): Promise<QueueOutcome> {
  const validDests = config.allLists.filter((l) => config.enabledDestinations.has(l.filePath))
  if (validDests.length === 0) {
    console.log(t('cli.move.noDestinations'))
    return 'cancelled'
  }

  const dest = await promptMoveDestination(
    validDests,
    t('cli.move.batchDestination', { count: selected.size }),
  )
  if (dest === undefined) return 'cancelled'

  const section = await promptDestinationSection(dest)
  if (section.kind === 'cancelled') return 'cancelled'

  const plan = planBatchQueue(state, order, selected, dest)

  let queued = 0
  let noPrinting = 0
  let abandoned = 0
  for (const [index, vc] of plan.moves.entries()) {
    const printing = await resolveMovePrinting(vc.card, dest)
    // An escaped printing prompt ends the batch rather than asking the same
    // question of every remaining card: the user is done, not undecided.
    if (printing.kind === 'cancelled') {
      abandoned = plan.moves.length - index
      break
    }
    if (printing.kind === 'none') {
      noPrinting++
      continue
    }
    if (printing.kind === 'resolved') vc.card = printing.card

    applyVirtualMove(state, vc.physicalKey, dest, { section: section.section })
    queued++
  }

  if (queued > 0) {
    console.log(t('cli.move.batchQueued', { count: queued, list: listRefLabel(dest.ref) }))
  }
  if (plan.sameList > 0) {
    console.log(t('cli.move.batchSkippedSameList', { count: plan.sameList }))
  }
  if (noPrinting > 0) console.log(t('cli.move.batchSkippedPrinting', { count: noPrinting }))
  if (abandoned > 0) console.log(t('cli.move.batchAbandoned', { count: abandoned }))

  // Nothing moved — keep the selection so another destination can be tried.
  if (queued === 0) return 'cancelled'
  selected.clear()
  return 'queued'
}
