/**
 * Internal: project a printing tuple keeping only the fields that are set.
 *
 * The planner's records omit absent keys rather than carrying `undefined`
 * (the editors' event payloads are compared and serialized as-is), so the
 * always-present projection `printingOptionsFrom` in `change-event.ts` is not
 * the right shape here. One helper so every record builder covers the same
 * tuple — a new printing dimension is one edit, not a silent drop at each site.
 */

import { storedLanguage } from '../../card-language'
import type { PrintingTuple } from '../../change-event'

/** The optional half of a printing tuple: everything but set and collector number. */
export type PrintingDetails = Pick<PrintingTuple, 'finish' | 'condition' | 'language'>

/** `finish`/`condition`/`language` from `tuple`, present only when set; `en` folds to absent. */
export function definedPrintingDetails(tuple: PrintingDetails): PrintingDetails {
  const details: PrintingDetails = {}
  if (tuple.finish !== undefined) details.finish = tuple.finish
  if (tuple.condition !== undefined) details.condition = tuple.condition
  const language = storedLanguage(tuple.language)
  if (language !== undefined) details.language = language
  return details
}
