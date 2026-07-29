import { z } from 'zod'
import { DECK_FORMAT_KEYS } from '../deck-format'
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
/** Derived from the canonical format list, so the tool schema cannot drift from it. */
export const deckFormatSchema = z.enum(DECK_FORMAT_KEYS)

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
  .describe('Card name (case-insensitive; fuzzy match).')

export const cardIdField = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('Disambiguate by the persistent card ID (the &N suffix in list files).')

export const setField = z
  .string()
  .toLowerCase()
  .optional()
  .describe(
    'Set code, e.g. "mkm". Normalized to lowercase; pair with collectorNumber to pin a printing.',
  )

export const collectorNumberField = z
  .string()
  .optional()
  .describe('Collector number within the set. Pair with set to pin a specific printing.')

export const finishField = finishSchema.optional().describe('Finish; defaults to nonfoil.')

export const conditionField = conditionSchema
  .optional()
  .describe('Condition grade; defaults to NM.')

export const sectionField = z
  .string()
  .optional()
  .describe('Section (markdown "## Section") to place the card in. Defaults to the main section.')

export const quantityField = z
  .number()
  .int()
  .min(1)
  .default(1)
  .describe('Number of copies (default 1). Applied as one change per copy in a single save.')

export const copyIndexField = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe('Which copy of a deck line to target (0-based) when its quantity is above 1.')
