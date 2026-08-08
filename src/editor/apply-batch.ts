import type { ChangeEvent } from '../change-event'
import { formatChange } from '../change-message'
import type { ListType } from '../list-type'

/**
 * Why a change did not apply:
 * - `no-target` — the card-targeting change matched no entry (wrong name/id).
 * - `not-applicable` — the action can never apply to this list type
 *   (commander actions on a flat list).
 */
export type MissReason = 'no-target' | 'not-applicable'

/** Options accepted by the change-apply engines beyond the change itself. */
export type ApplyChangeOptions = {
  /** Called when the change does not apply, with the reason. */
  onMiss?: (reason: MissReason) => void
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
): ApplyBatchResult<TData, TChange> {
  const unmatched: UnmatchedChange<TChange>[] = []
  let current = data
  for (const change of changes) {
    current = apply(current, change, { onMiss: (reason) => unmatched.push({ change, reason }) })
  }
  return { data: current, unmatched }
}

/**
 * One entry per unapplied change: the change as text, and why it did not apply.
 *
 * The itemised counterpart of {@link describeUnmatchedChanges}' one-line
 * summary, for surfaces that report a structured list (the MCP tools' error
 * payload) rather than prose.
 */
export function listUnmatchedChanges(unmatched: readonly UnmatchedChange<ChangeEvent>[]): string[] {
  return unmatched.map((item) => `${formatChange(item.change)} (${item.reason})`)
}

/** The list a batch of unmatched changes was aimed at, for the error message. */
export type UnmatchedTarget = { type: ListType; slug: string }

/**
 * One shared wording for "these changes did not apply", used by every surface
 * that rejects a batch (MCP mutations, the collection save handler, the
 * one-shot CLI path) so the phrasing cannot drift. Surfaces append their own
 * recovery hints — this text stays client-neutral.
 *
 * **English by contract, deliberately not routed through `t()`.** Its callers
 * are `src/mcp/mutations.ts` and `src/admin/api/collection-save.ts`, and MCP
 * result prose is English regardless of the operator's UI locale (plan §11).
 * The editors never render it: they surface the *rendered* `message` the API
 * returned, as `statusText`. It becomes localizable when Phase 5 widens
 * `ApiResult` with a `messageKey`, which is where the split between "what the
 * agent reads" and "what the human reads" is introduced.
 */
export function describeUnmatchedChanges(
  unmatched: readonly UnmatchedChange<ChangeEvent>[],
  target: UnmatchedTarget,
): string {
  const list = (items: readonly UnmatchedChange<ChangeEvent>[]): string =>
    items.map((item) => `"${formatChange(item.change)}"`).join(', ')
  const noTarget = unmatched.filter((item) => item.reason === 'no-target')
  const notApplicable = unmatched.filter((item) => item.reason === 'not-applicable')

  const parts: string[] = []
  if (noTarget.length > 0) {
    parts.push(
      `${noTarget.length} change(s) matched no card in ${target.type} "${target.slug}": ` +
        `${list(noTarget)} — card names match exactly (case-sensitive)`,
    )
  }
  if (notApplicable.length > 0) {
    parts.push(
      `${notApplicable.length} change(s) never apply to a ${target.type} list: ${list(notApplicable)}`,
    )
  }
  return `${parts.join('; ')}. Nothing was saved.`
}
