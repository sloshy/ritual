/**
 * Asserting on the structured refusals the change validators return
 * (`ChangeProblemResult`, `src/changes/change-problem.ts`): the English a
 * reader of the API sees, checked to be exactly what the problem's key and
 * params render to.
 */

import type {
  ChangeProblem,
  ChangeProblemResult,
  ChangeProblemSite,
  ChangeProblemSubject,
} from '../../src/changes/change-problem'
import { changeProblemMessage } from '../../src/changes/change-problem-message'
import { keyedMessage } from './api-message'

/** The subject a validator test locates its problems at: "The change". */
export const A_CHANGE: ChangeProblemSubject = { kind: 'change' }

/** A bundle's first move, as the record a move-payload problem is about: "Move #1". */
export const MOVE_1: ChangeProblemSite = { subject: { kind: 'bundle-move', move: 1 } }

/** A problem's English (asserted keyed, nested parts included). */
export function problemEnglish(problem: ChangeProblem): string {
  return keyedMessage(changeProblemMessage(problem))
}

/**
 * A change bundle every surface refuses the same way — its one move's `from`
 * is not an object — so each boundary's test reads the same problem.
 */
export const MALFORMED_MOVE_BUNDLE = {
  format: 'ritual-change-bundle',
  version: 1,
  exportedAt: '2026-06-04T00:00:00.000Z',
  lists: [],
  moves: [
    { id: 'm1', timestamp: 1, cardName: 'Sol Ring', from: 5, to: { kind: 'deck', name: 'D' } },
  ],
}

/** {@link MALFORMED_MOVE_BUNDLE}'s refusal, in English. */
export const MALFORMED_MOVE_ENGLISH = 'Move #1 "from" is not an object.'

/**
 * A validator's outcome: its refusal's English when it refused (asserted keyed,
 * nested parts included), its value when it accepted — so
 * `expect(outcome(decode(x))).toBe('…')` fails with what it got rather than an
 * opaque shape mismatch, and `.toMatchObject(…)` reads the accepted value.
 */
export function outcome<T>(result: ChangeProblemResult<T>): T | string {
  return result.ok ? result.value : problemEnglish(result.problem)
}

/** The accepted value, or a thrown error naming the refusal. */
export function accepted<T>(result: ChangeProblemResult<T>): T {
  if (result.ok) return result.value
  throw new Error(`expected the input to be accepted, got: ${String(outcome(result))}`)
}
