import type { ChangeEvent } from './change-event'
import { changeRef } from './change-message'
import { DEFAULT_LOCALE } from '../i18n/runtime'
import {
  renderSyncMessage,
  syncList,
  syncMessage,
  syncRef,
  type NonEmpty,
  type SyncListParam,
  type SyncMessage,
  type SyncMessageRef,
} from '../sync/message'
import type { ListType } from '../list/list-type'
import type { CardLabel } from '../card/card-labels'

/**
 * Why a change did not apply:
 * - `no-target` — the card-targeting change matched no entry (wrong name/id).
 * - `not-applicable` — the action can never apply to this list type
 *   (commander actions on a flat list).
 * - `needs-printing` — a `set-finish` would put a foil/etched token on an entry
 *   that pins no printing. See `canSetFinish` in `src/card-printing.ts`.
 */
export type MissReason = (typeof MISS_REASONS)[number]

/** Every {@link MissReason}, in the order a refusal names them. */
export const MISS_REASONS = ['no-target', 'not-applicable', 'needs-printing'] as const

/** Options accepted by the change-apply engines beyond the change itself. */
export type ApplyChangeOptions = {
  /** Called when the change does not apply, with the reason. */
  onMiss?: (reason: MissReason) => void
  /**
   * The list's own front-matter default labels. A `move-to` arriving here
   * lands the labels it carries against them (`arrivalLabels`: unstated labels
   * take this default, and the override written is the minimal one), and a deck
   * `add` merges onto a line by effective labels measured against them — which
   * is why the deck reducer requires the key (`DeckApplyOptions`). Omitted on a
   * flat list, the list is treated as having no default; only its `move-to`
   * reads it, and every move seam passes it.
   */
  listLabels?: readonly CardLabel[]
}

/**
 * The shape shared by the three change-apply engines and every seam that
 * stores one behind a generic. Typing seams with this (rather than a
 * two-parameter function type) keeps the options slot visible to the
 * compiler, so a point-free `array.reduce(applyChange, data)` — which would
 * put the element index in the options slot — stays a compile error
 * everywhere.
 */
export type ApplyChange<TData, TChange = ChangeEvent> = (
  data: TData,
  change: TChange,
  options?: ApplyChangeOptions,
) => TData

/** One change that did not apply, with why. */
export type UnmatchedChange<TChange> = { change: TChange; reason: MissReason }

export type ApplyBatchResult<TData, TChange> = {
  data: TData
  unmatched: UnmatchedChange<TChange>[]
}

/**
 * Apply an ordered batch, collecting every change that did not apply. Detection
 * is interleaved with application — a later change may target a card an
 * earlier change in the same batch added, so validating against the initial
 * state would reject valid batches.
 */
export function applyChangesCollectingMisses<TData, TChange>(
  data: TData,
  changes: readonly TChange[],
  apply: ApplyChange<TData, TChange>,
  options: BatchApplyOptions<TData, TChange> = {},
): ApplyBatchResult<TData, TChange> {
  const unmatched: UnmatchedChange<TChange>[] = []
  let current = data
  for (const change of changes) {
    options.before?.(current, change)
    current = apply(current, change, {
      listLabels: options.listLabels,
      onMiss: (reason) => unmatched.push({ change, reason }),
    })
  }
  return { data: current, unmatched }
}

/** What {@link applyChangesCollectingMisses} takes beyond the batch. */
export type BatchApplyOptions<TData, TChange> = {
  /** Handed to every apply; see {@link ApplyChangeOptions.listLabels}. */
  listLabels?: readonly CardLabel[]
  /** Called with the list as it stands just before each change applies. */
  before?: (current: TData, change: TChange) => void
}

/**
 * One entry per unapplied change: the change described in English, and why it
 * did not apply (the machine reason).
 *
 * The itemised counterpart of {@link describeUnmatchedChanges}' summary, for
 * surfaces that report a structured list (the save route's `unmatched`, which
 * the MCP tools pass on) rather than prose. English, like every API field an
 * agent reads, whatever the server's own UI language.
 */
export function listUnmatchedChanges(unmatched: readonly UnmatchedChange<ChangeEvent>[]): string[] {
  return unmatched.map(
    (item) => `${renderSyncMessage(changeRef(item.change), DEFAULT_LOCALE)} (${item.reason})`,
  )
}

/** The list a batch of unmatched changes was aimed at, for the error message. */
export type UnmatchedTarget = { type: ListType; slug: string }

/** One reason's clause, built from the changes that carry it. */
type MissDescriber = (
  items: readonly UnmatchedChange<ChangeEvent>[],
  target: UnmatchedTarget,
) => SyncMessageRef

/** The changes in a clause, each quoted, in the locale's plain (unit) list. */
const listChanges = (items: readonly UnmatchedChange<ChangeEvent>[]): SyncListParam =>
  syncList(
    items.map((item) =>
      syncRef('domain.changes.unmatched.quotedChange', { change: changeRef(item.change) }),
    ),
    'unit',
  )

/**
 * `satisfies Record<MissReason, …>` rather than a chain of ifs: a new refusal
 * reason cannot be added without deciding how it reads, and the alternative is
 * a message that ends "Nothing was saved." while naming nothing.
 */
const MISS_DESCRIBERS = {
  'no-target': (items, target) =>
    syncRef('domain.changes.unmatched.noTarget', {
      count: items.length,
      list: syncRef('domain.changes.unmatched.namedList', {
        type: target.type,
        slug: target.slug,
      }),
      changes: listChanges(items),
    }),
  'not-applicable': (items, target) =>
    syncRef('domain.changes.unmatched.notApplicable', {
      count: items.length,
      list: syncRef('domain.changes.unmatched.listOfType', { type: target.type }),
      changes: listChanges(items),
    }),
  'needs-printing': (items) =>
    syncRef('domain.changes.unmatched.needsPrinting', {
      count: items.length,
      changes: listChanges(items),
    }),
} as const satisfies Record<MissReason, MissDescriber>

/**
 * One shared wording for "these changes did not apply", used by every surface
 * that rejects a batch — the list save route (which the editors, the MCP
 * mutations and the bundle import all go through) and the collection-sync
 * apply path — so the phrasing cannot drift. Surfaces append their own
 * recovery hints; this text stays client-neutral.
 *
 * A message, not a string: English plus its key and nested params, so the
 * save route answers an agent in English while the admin editor words the same
 * refusal — each change description included — in its reader's language.
 */
export function describeUnmatchedChanges(
  unmatched: NonEmpty<UnmatchedChange<ChangeEvent>>,
  target: UnmatchedTarget,
): SyncMessage {
  const clauses: SyncMessageRef[] = []
  for (const reason of MISS_REASONS) {
    const items = unmatched.filter((item) => item.reason === reason)
    if (items.length > 0) clauses.push(MISS_DESCRIBERS[reason](items, target))
  }
  // Independent clauses, joined pairwise in the reader's locale (`A; B`).
  return syncMessage('domain.changes.unmatched.summary', {
    reasons: syncList(clauses, 'clauses'),
  })
}
