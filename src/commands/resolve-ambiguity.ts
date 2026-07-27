/**
 * The CLI's answer to "which binder lost this card?".
 *
 * A pull can end up with removals it cannot place: only some of a printing's
 * copies are going, and they live in several collection lists. `--removal-priority`
 * answers that up front; without it, and with a terminal to ask on, this module
 * walks the copies one at a time and hands the engine a complete assignment.
 *
 * Resolution is all-or-nothing — the engine writes nothing until every ambiguity
 * is settled — so every path that does not produce a full assignment (no
 * terminal, a declined confirmation, a cancelled prompt) refuses with the reason
 * and lets the run fail without touching a file. The reason is returned rather
 * than logged: the engine puts it in the run's report, so a scripted run carries
 * it too and the terminal prints it exactly once.
 *
 * The prompt itself is injectable ({@link AskPrompt}) so the whole flow is
 * testable without a TTY.
 */

import {
  describeAmbiguousLists,
  describeCollectionKey,
  type AmbiguousRemoval,
} from '../collection-sync/describe'
import type { AmbiguityResolutionOutcome } from '../collection-sync/engine'
import type { RemovalAssignment, RemovalChoice } from '../collection-sync/diff'
import type { Logger } from '../logger'
import { ask } from './prompts-helpers'

/** The prompt seam: the shared {@link ask} helper in production, a stub in tests. */
export type AskPrompt = typeof ask

export type AmbiguityResolutionRequest = {
  /** The removals the engine could not place, in plan order. */
  ambiguous: readonly AmbiguousRemoval[]
  /**
   * Whether a prompt can run at all: text output, prompts enabled, a terminal,
   * and not a dry run. Decided by the command, since every one of those is a
   * property of the invocation rather than of the removals.
   */
  interactive: boolean
  /** Carries the per-removal context lines the prompts are read against. */
  logger: Logger
  /** Injectable for tests; the shared `ask` helper by default. */
  ask?: AskPrompt
}

/** How to settle the ambiguity without a terminal — the one actionable hint. */
const PRIORITY_ADVICE =
  'Pass --removal-priority <list> (repeatable, in priority order) to say which lists may lose copies, or run in a terminal to resolve them one by one.'

/** `2 ambiguous removals` / `1 ambiguous removal`. */
function countOf(count: number): string {
  return `${count} ambiguous removal${count === 1 ? '' : 's'}`
}

/**
 * Decide where every ambiguous removal's copies come from, or refuse with the
 * reason the decision could not be made — no terminal, a declined confirmation,
 * or a session cancelled part way through. The engine treats all three the same
 * way: the run fails and writes nothing, quoting the reason given here.
 */
export async function resolveAmbiguousRemovals(
  request: AmbiguityResolutionRequest,
): Promise<AmbiguityResolutionOutcome> {
  const { ambiguous, interactive, logger } = request
  const prompt = request.ask ?? ask

  if (!interactive) {
    const verb = ambiguous.length === 1 ? 'needs' : 'need'
    return {
      ok: false,
      message: `${countOf(ambiguous.length)} ${verb} a decision. ${PRIORITY_ADVICE}`,
    }
  }

  const confirmed = await prompt<boolean>({
    type: 'confirm',
    message: `${ambiguous.length} removal${ambiguous.length === 1 ? ' is' : 's are'} ambiguous. Resolve them one by one now?`,
    initial: false,
  })
  if (confirmed !== true) {
    return {
      ok: false,
      message: `${countOf(ambiguous.length)} left unresolved. ${PRIORITY_ADVICE}`,
    }
  }

  const assignments: RemovalAssignment[] = []
  for (const entry of ambiguous) {
    const card = describeCollectionKey(entry.name, entry.parts)
    logger.info(
      `${card}: ${entry.quantity} to remove — copies live in ${describeAmbiguousLists(entry.lists)}.`,
    )

    // Counted down as copies are placed, so each prompt offers only the lists
    // that still have a copy to give and says how many are left in each.
    const remaining = new Map(entry.lists.map((list) => [list.list, list.copies]))
    const taken = new Map<string, number>()

    for (let copy = 1; copy <= entry.quantity; copy++) {
      const list = await prompt<string>({
        type: 'select',
        message: `Which list lost ${card}? (copy ${copy} of ${entry.quantity})`,
        choices: [...remaining]
          .filter(([, left]) => left > 0)
          .map(([name, left]) => ({ title: `${name} (${left} left)`, value: name })),
      })
      if (list === undefined) {
        return {
          ok: false,
          message: `Cancelled after ${copy - 1} of ${entry.quantity} copies of ${card}.`,
        }
      }
      remaining.set(list, (remaining.get(list) ?? 0) - 1)
      taken.set(list, (taken.get(list) ?? 0) + 1)
    }

    const choices: RemovalChoice[] = [...taken].map(([list, copies]) => ({ list, copies }))
    assignments.push({ key: entry.key, choices })
  }

  return { ok: true, assignments }
}
