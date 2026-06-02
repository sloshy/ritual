import { z } from 'zod'
import { VALID_CONDITIONS, VALID_FINISHES } from '../finish-condition'

/**
 * Shared zod field schemas composed into each tool's `inputSchema` raw shape.
 * Centralizing them keeps the card-identity and printing fields consistent across
 * the add/remove/set/move tools and their descriptions in one place.
 */

export const listTypeSchema = z.enum(['deck', 'collection', 'wanted'])
export const finishSchema = z.enum(VALID_FINISHES)
export const conditionSchema = z.enum(VALID_CONDITIONS)

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
