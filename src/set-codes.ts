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

/** A single parsed set code (normalized lowercase), or a user-facing error. */
export type SetCodeParseResult = { ok: true; code: string } | { ok: false; error: string }

/**
 * Parse a single user-supplied set code: trimmed, lowercased, and required to
 * be plain alphanumeric (`mkm`, `2xm`, ...). The canonical validation for every
 * `--set`-style flag, so all surfaces reject the same malformed input.
 */
export function parseSetCode(raw: string): SetCodeParseResult {
  const code = raw.trim().toLowerCase()
  if (!/^[a-z0-9]+$/.test(code)) {
    return { ok: false, error: `Invalid set code '${raw}'.` }
  }
  return { ok: true, code }
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
