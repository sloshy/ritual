/**
 * The vocabularies of an export's condition and labels filters: the values a
 * user types after `--condition` / `--labels` (or sends in an API body).
 *
 * A module of its own so the refusals that offer these values can be worded
 * (`src/export-wording/message.ts`) without loading the list-file engines
 * `entries.ts` reads with — the config validator words a preset refusal through
 * the same module.
 *
 * Persistence fence: like everything under `src/export/`, never imports `src/i18n`.
 */

import { VALID_CONDITIONS, type Condition } from '../card/finish-condition'
import { CARD_LABEL_SELECTIONS, type CardLabelSelection } from '../card/card-labels'

/**
 * One condition-filter value: an explicit condition grade, or `'none'` to
 * match entries with no condition marked on their line.
 */
export type ConditionFilterValue = Condition | 'none'

export const CONDITION_FILTER_NONE = 'none'

/** Every condition-filter value, in canonical order, for flag help and refusals. */
export const CONDITION_FILTER_VALUES: readonly ConditionFilterValue[] = [
  ...VALID_CONDITIONS,
  CONDITION_FILTER_NONE,
]

/**
 * One labels-filter value: the shared selection vocabulary (`'none'` matches
 * collection entries whose effective label set is empty). The alias marks the
 * export-specific semantics: unlike the site's chips, a filter list here may
 * combine `keep` with the others — it selects, it doesn't declare.
 */
export type LabelFilterValue = CardLabelSelection

/** Every labels-filter value, in canonical order, for flag help and refusals. */
export const LABEL_FILTER_VALUES = CARD_LABEL_SELECTIONS
