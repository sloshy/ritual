/**
 * One policy for coercing a user-supplied copy count into a valid range, shared
 * by every surface that asks "how many copies?" — the inline ticker, the copies
 * prompt, and the editor's add path. Kept in one place because the three used to
 * disagree on rounding and on what a non-finite value means.
 *
 * NaN — an emptied number field, or a caller's bad arithmetic — resolves to
 * `min` rather than propagating; ±Infinity clamps to the bound it runs into.
 */
export function clampQuantity(value: number, min = 1, max = Infinity): number {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(Math.round(value), min), max)
}

/** Clamp `value + delta` into `min`..`max`. See {@link clampQuantity}. */
export function stepQuantity(value: number, delta: number, min = 1, max = Infinity): number {
  return clampQuantity(value + delta, min, max)
}
