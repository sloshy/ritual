import type { Finish, Condition, ScryfallCard } from './types'

export const VALID_FINISHES = ['nonfoil', 'foil', 'etched'] as const satisfies readonly Finish[]
export const VALID_CONDITIONS = [
  'NM',
  'LP',
  'MP',
  'HP',
  'DMG',
] as const satisfies readonly Condition[]

/** Human-readable labels for the condition codes, shared by every condition prompt. */
export const CONDITION_LABELS: Record<Condition, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
}

export function isFinish(value: string | undefined): value is Finish {
  return value !== undefined && (VALID_FINISHES as readonly string[]).includes(value)
}

/**
 * Parse a raw `--finish` flag value: case-insensitive, must be one of
 * {@link VALID_FINISHES}. Returns the normalized finish, or an error message
 * string (discriminate with {@link isFinish}) — callers wrap it in their own
 * error type (commander's `InvalidArgumentError` vs `CardCommandError`).
 */
export function normalizeFinishValue(raw: string): Finish | string {
  const normalized = raw.toLowerCase()
  if (!isFinish(normalized)) {
    return `Invalid finish '${raw}'. Use one of: ${VALID_FINISHES.join(', ')}.`
  }
  return normalized
}

export function isCondition(value: string | undefined): value is Condition {
  return value !== undefined && (VALID_CONDITIONS as readonly string[]).includes(value)
}

/**
 * The finishes a printing is actually offered in. Cache entries that carry no
 * usable finish data are treated as plain nonfoil, matching the default the
 * finish prompts fall back to.
 */
export function printingFinishes(printing: ScryfallCard): Finish[] {
  const available = (printing.finishes ?? []).filter(isFinish)
  return available.length > 0 ? available : ['nonfoil']
}

/**
 * The finish a printing is read at when none has been chosen: nonfoil when the
 * printing is offered in it, otherwise its first finish — foil-only and
 * etched-only printings have no nonfoil price to quote.
 *
 * Shared by collection pricing ({@link "./collection-file".resolveFinish}) and the
 * interactive pickers' price column, so a printing is never quoted at one finish
 * in a list total and a different one in the prompt that added it. The site's
 * trade planner deliberately keeps its own `defaultFinishForCard`: that one ranks
 * nonfoil > foil > etched because its result decides whether a finish token is
 * omitted from a shared trade URL, which is an encoding contract rather than a
 * display choice.
 */
export function defaultPrintingFinish(printing: ScryfallCard): Finish {
  const finishes = printingFinishes(printing)
  return finishes.includes('nonfoil') ? 'nonfoil' : finishes[0]!
}
