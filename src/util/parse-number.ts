/**
 * Numeric parsing shared by every surface — CLI flags, HTTP query strings, and
 * anything else that receives a number as text. Layer-neutral on purpose: the
 * acceptance rule must be identical wherever a "positive integer" is asked for,
 * while each caller keeps its own error wording.
 */

/**
 * Parse a string that must be a strictly positive integer (digits only, no
 * sign, no decimals, no leading zeros, no whitespace). Returns `undefined` when
 * the input is not one — the caller owns the error representation for its
 * surface.
 */
export function parsePositiveInteger(raw: string): number | undefined {
  if (!/^[1-9]\d*$/.test(raw)) return undefined
  return Number.parseInt(raw, 10)
}

/**
 * {@link parsePositiveInteger} widened to accept `0` — the rule for an offset,
 * where zero is the ordinary "start at the beginning" value rather than a
 * degenerate one. A bare `0` is accepted; `00` and `01` are not, so the
 * no-leading-zeros rule still holds.
 */
export function parseNonNegativeInteger(raw: string): number | undefined {
  if (raw === '0') return 0
  return parsePositiveInteger(raw)
}

/**
 * The one refusal wording for a malformed `limit` query parameter, shared by
 * every route that takes one. `limit` means the same thing on all of them, so a
 * client that learns the rule from one refusal has learned it everywhere.
 */
export function invalidLimitMessage(raw: string): string {
  return `Invalid limit '${raw}'. Use a positive integer.`
}
