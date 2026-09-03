/**
 * Type guards shared by the parse boundaries. `Array.isArray` narrows `unknown`
 * to `any[]`, which would let an element slip through a parser un-typed; this
 * keeps the boundary opaque so every element still has to be checked.
 */

/** `Array.isArray` narrowed to `readonly unknown[]` rather than `any[]`. */
export function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}
