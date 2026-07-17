import type { Finish, Condition } from './types'

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
