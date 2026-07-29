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
