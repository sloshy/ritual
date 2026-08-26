import type { MoveFromOptions, PrintingTupleWithId } from '../../changes/change-event'
import { LIST_TYPE_DISPLAY } from '../../list/list-type'
import { t } from '../../i18n/t'
import { resolveCardPrinting, type PrintingFilterConfig } from './prompts'
import { ask, suggestByTitleTerms } from '../../cli/prompts'
import type { UnifiedListRef } from './edit-lists'

/**
 * The destination side of the edit-mode "Move to Another List" action: which
 * lists a card can move to, the destination picker, and the printing
 * resolution a name-only card needs before it may enter a collection. The
 * source-side bookkeeping (model removal, changelog, undo) lives with the rest
 * of the edit operations in `flat-list-edit.ts` and `deck-edit.ts`; the
 * destination side of a *saved* move is committed by `saveOpenList` in
 * `edit-lists.ts`.
 *
 * This module deliberately does not import `edit-lists.ts` at runtime (only
 * its types): it sits below the strategies, which `edit-lists.ts` imports.
 */

/**
 * A list's icon and name, as shown wherever lists are mixed together in the
 * TUI. Display text — distinct from `change-event.ts`'s `listRefLabel`, whose
 * quoted English form is spliced into persisted changelog lines.
 */
export function listRefTitle(ref: UnifiedListRef): string {
  return `${LIST_TYPE_DISPLAY[ref.type].icon} ${ref.name}`
}

/**
 * Every list a move could target, including lists created this session that
 * have no file yet. Callers filter out the list the card is moving from.
 */
export type MoveTargetsProvider = () => Promise<UnifiedListRef[]>

/** What a strategy needs to offer the Move to Another List edit action. */
export type MoveDeps = {
  targets: MoveTargetsProvider
  /** The file of the list being edited, excluded from the destination picker. */
  selfFile: string
  sessionConfig: PrintingFilterConfig
  excludeDigitalOnly: boolean
}

/**
 * The printing fields the destination picker can resolve for a name-only card
 * entering a collection. Deliberately not the whole printing tuple: finish and
 * condition always ride from the source entry, and typing them here would
 * invite setting them with no one reading them.
 */
export type ResolvedMovePrinting = Pick<PrintingTupleWithId, 'set' | 'collectorNumber' | 'language'>

/**
 * A resolved move destination. `printing` is set only when the picker had to
 * resolve one — a name-only card entering a collection — and then carries the
 * language too when the printing picker's availability confirm resolved it;
 * otherwise the entry's own printing fields ride the move unchanged.
 */
export type MoveDestination = {
  target: UnifiedListRef
  printing: ResolvedMovePrinting | null
}

/**
 * The `move-from` options a move records: the source entry's printing, with
 * the destination-resolved fields laid over it. The single statement of the
 * override rule — set, collector number, and language may come from the
 * picker; finish and condition always come from the source entry.
 */
export function moveFromOptionsFor(
  source: PrintingTupleWithId,
  dest: MoveDestination,
): MoveFromOptions {
  return {
    set: dest.printing?.set ?? source.set,
    collectorNumber: dest.printing?.collectorNumber ?? source.collectorNumber,
    finish: source.finish,
    condition: source.condition,
    language: dest.printing?.language ?? source.language,
    cardId: source.cardId,
    to: { type: dest.target.type, name: dest.target.name },
  }
}

/** Inputs to {@link resolveMoveDestination}. */
export type ResolveMoveArgs = {
  deps: MoveDeps
  cardName: string
  /** Whether the moving entry already pins a set and collector number. */
  hasPrinting: boolean
}

/** Pick the list a card should move to. Returns undefined when cancelled. */
async function promptMoveTarget(
  targets: UnifiedListRef[],
  cardName: string,
): Promise<UnifiedListRef | undefined> {
  return ask<UnifiedListRef>({
    type: 'autocomplete',
    message: t('cli.edit.promptMoveTarget', { name: cardName }),
    choices: targets.map((target) => ({ title: listRefTitle(target), value: target })),
    limit: 12,
    suggest: suggestByTitleTerms,
  })
}

/**
 * The interactive half of a cross-list move: pick the destination list and,
 * for a name-only card headed into a collection (whose format requires a
 * printing on every line), resolve the printing it should arrive as. Returns
 * null when there is nowhere to move to or the user backs out.
 */
export async function resolveMoveDestination(
  args: ResolveMoveArgs,
): Promise<MoveDestination | null> {
  const { deps, cardName, hasPrinting } = args
  const targets = (await deps.targets()).filter((target) => target.file !== deps.selfFile)
  if (targets.length === 0) {
    console.log(t('cli.edit.noMoveTargets'))
    return null
  }
  const target = await promptMoveTarget(targets, cardName)
  if (!target) return null

  if (target.type !== 'collection' || hasPrinting) {
    return { target, printing: null }
  }
  const result = await resolveCardPrinting(cardName, deps.sessionConfig, deps.excludeDigitalOnly)
  if (result.kind === 'cancelled') return null
  if (result.kind === 'none') {
    console.error(t('cli.edit.moveNeedsPrinting', { name: cardName }))
    return null
  }
  const printing: ResolvedMovePrinting = {
    set: result.printing.set.toLowerCase(),
    collectorNumber: result.printing.collector_number,
    // Only what the availability confirm resolved; absent, the moving entry's
    // own language token rides along.
    language: result.language,
  }
  return { target, printing }
}
