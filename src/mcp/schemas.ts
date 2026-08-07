import { z } from 'zod'
import { DECK_FORMAT_KEYS } from '../deck-format'
import { CARD_LABELS } from '../card-labels'
import { CARD_LANGUAGES } from '../card-language'
import { VALID_CONDITIONS, VALID_FINISHES } from '../finish-condition'
import { VALID_CURRENCIES } from '../price-currency'

/**
 * Shared zod field schemas composed into each tool's `inputSchema` object.
 * Centralizing them keeps the card-identity and printing fields consistent across
 * the add/remove/set/move tools and their descriptions in one place.
 */

export const listTypeSchema = z.enum(['deck', 'collection', 'wanted'])
/** Derived from the canonical currency list, so the tool schema cannot drift from it. */
export const currencySchema = z.enum(VALID_CURRENCIES)
export const finishSchema = z.enum(VALID_FINISHES)
export const conditionSchema = z.enum(VALID_CONDITIONS)
/**
 * A condition *update*: a grade, or `NONE` to clear a recorded grade — the same
 * vocabulary `ritual set-card --condition` accepts. Only the set-printing paths
 * take it; an `add` records a grade and has none to clear.
 */
export const conditionUpdateSchema = z.enum([...VALID_CONDITIONS, 'NONE'])
/** Derived from the canonical format list, so the tool schema cannot drift from it. */
export const deckFormatSchema = z.enum(DECK_FORMAT_KEYS)
/** Derived from the canonical label vocabulary, so the tool schema cannot drift from it. */
export const cardLabelSchema = z.enum(CARD_LABELS)
/**
 * A label-override *update*: the new override, where `sale` and `trade` combine
 * and `keep` stands alone, or an empty array to clear the override so the
 * collection's front-matter default applies again. Collections only.
 */
export const labelsUpdateField = z
  .array(cardLabelSchema)
  .describe(
    'New label override: "sale"/"trade" (combinable) or "keep" (exclusive). ' +
      'An empty array clears the override (the list default applies). Collections only.',
  )
/**
 * A label override attached to a newly added card — unlike
 * {@link labelsUpdateField} there is no override to clear, so an empty array is
 * rejected rather than meaning "clear". Collections only.
 */
export const labelsOverrideField = z
  .array(cardLabelSchema)
  .min(1)
  .optional()
  .describe(
    'Label override for the new card: "sale"/"trade" (combinable) or "keep" ' +
      '(exclusive). Collections only; omit to inherit the list default.',
  )

export const DECK_ONLY_FORMAT_MESSAGE = 'format is only valid when listType is "deck".'

/** A custom cross-field issue as the shared refinements report it. */
type RefinementIssue = { code: 'custom'; message: string }

/** The subset of a refinement context the shared refinements need (zod-version-agnostic). */
type RefinementIssueSink = { addIssue: (issue: RefinementIssue) => void }

/** The fields the deck-only `format` rule inspects. */
type ListTypeWithFormat = { listType: string; format?: unknown }

/**
 * Shared cross-field rule: `format` may only accompany `listType: "deck"`.
 * Used by every tool whose schema pairs a list type with an optional deck format.
 */
export function refineDeckOnlyFormat(val: ListTypeWithFormat, ctx: RefinementIssueSink): void {
  if (val.format !== undefined && val.listType !== 'deck') {
    ctx.addIssue({ code: 'custom', message: DECK_ONLY_FORMAT_MESSAGE })
  }
}

/** One list addressed like CLI list arguments, optionally pinned to a type. */
export const listRefSchema = z.object({
  listType: listTypeSchema.optional().describe('Pin the list type of an ambiguous name.'),
  name: z
    .string()
    .min(1)
    .describe('List name (matched like CLI list arguments; a slug/file basename also works).'),
})

export type ListRefInput = z.infer<typeof listRefSchema>

export const slugField = z
  .string()
  .min(1)
  .describe('List slug — the markdown file basename without ".md".')

export const cardNameField = z
  .string()
  .min(1)
  .describe(
    'Card name. Edits and removals match the entry name exactly (case-sensitive) — copy it from ' +
      'get_list. Validated against the local card cache: an unknown name is rejected with the ' +
      'closest cached names, unless the name is already in the list being edited.',
  )

export const cardIdField = z
  .number()
  .int()
  .positive()
  // Bounded so the advertised schema shows a meaningful ceiling rather than
  // JavaScript's MAX_SAFE_INTEGER: &N ids are per-file sequence numbers.
  .max(1_000_000)
  .optional()
  .describe('Disambiguate by the persistent card ID (the &N suffix in list files).')

/**
 * A required set code — the array-element form: `z.array(setCodeField)`.
 * Wrapping the optional {@link setField} in an array would admit `undefined`
 * elements.
 */
export const setCodeField = z
  .string()
  .toLowerCase()
  .describe('Set code, e.g. "mkm". Normalized to lowercase.')

export const setField = setCodeField
  .optional()
  .describe(
    'Set code, e.g. "mkm". Normalized to lowercase; pair with collectorNumber to pin a printing.',
  )

/** One list addressed exactly, by type + slug (no name matching). */
export const listSlugRefSchema = z.object({
  listType: listTypeSchema,
  slug: slugField,
})

export const collectorNumberField = z
  .string()
  .optional()
  .describe('Collector number within the set. Pair with set to pin a specific printing.')

export const finishField = finishSchema.optional().describe('Finish; defaults to nonfoil.')

/** Derived from the canonical language vocabulary, so the tool schema cannot drift from it. */
export const languageSchema = z.enum(CARD_LANGUAGES)

export const languageField = languageSchema
  .optional()
  .describe(
    'Scryfall language code (e.g. "ja"; "zhs"/"zht" for Chinese). Omitted (or "en") means ' +
      'English — a card line only carries a language token when it is not English. Adding never ' +
      'prompts for a language: the defaultLanguage config key stamps new cards.',
  )

export const conditionField = conditionSchema
  .optional()
  .describe('Condition grade; defaults to NM.')

/** The set-printing flavour of {@link conditionField}, which can also clear a grade. */
export const conditionUpdateField = conditionUpdateSchema
  .optional()
  .describe(
    'Condition grade, or "NONE" to clear a recorded grade. Omit to leave the current grade ' +
      'alone. NM is the unrecorded default, so setting NM also leaves the line ungraded.',
  )

export const sectionField = z
  .string()
  .optional()
  .describe('Section (markdown "## Section") to place the card in. Defaults to the main section.')

export const quantityField = z
  .number()
  .int()
  .min(1)
  // A bound no real deck or collection edit reaches, so the advertised schema
  // shows a number an agent can read instead of MAX_SAFE_INTEGER.
  .max(1_000)
  .default(1)
  .describe('Number of copies (default 1). Applied as one change per copy in a single save.')

export const copyIndexField = z
  .number()
  .int()
  .min(0)
  .max(10_000)
  .optional()
  .describe('Which copy of a deck line to target (0-based) when its quantity is above 1.')
