/**
 * Parse a comma-separated string of set codes into a normalized lowercase array.
 * Trims whitespace, drops empty entries, removes duplicates while preserving order.
 *
 * The CLI and admin both consume user-typed set-code lists; this is the canonical
 * normalization step so behavior stays consistent across surfaces.
 */
export function parseSetCodesInput(value: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of value.split(',')) {
    const code = part.trim().toLowerCase()
    if (code.length === 0 || seen.has(code)) continue
    seen.add(code)
    result.push(code)
  }
  return result
}

/**
 * Format an array of set codes for display in a text input — uppercase, comma-separated.
 */
export function formatSetCodesForDisplay(sets: string[]): string {
  return sets.map((s) => s.toUpperCase()).join(', ')
}
