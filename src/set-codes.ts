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

export type SetCodesInputScan = {
  /** Completed, normalized set codes. */
  tags: string[]
  /** The trailing token still being typed. */
  remainder: string
}

/**
 * Scan a (possibly partial) set-code input into completed codes plus a trailing
 * remainder still being typed. Whitespace and commas separate codes; a pasted value
 * with several separators yields several tags, and any unfinished trailing token
 * stays as the remainder.
 */
export function scanSetCodesInput(value: string): SetCodesInputScan {
  if (!/[\s,]/.test(value)) return { tags: [], remainder: value }
  const endsWithSeparator = /[\s,]$/.test(value)
  const tokens = value.split(/[\s,]+/).filter(Boolean)
  const remainder = endsWithSeparator ? '' : (tokens.pop() ?? '')
  return { tags: parseSetCodesInput(tokens.join(',')), remainder }
}
