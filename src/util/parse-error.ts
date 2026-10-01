/**
 * The error branch of a parser that returns `T | ParseError` (AGENTS.md,
 * "Parsers"): a plain message, typically an English detail that a caller
 * splices into a localized frame.
 */
export type ParseError = { error: string }

export function isParseError(value: unknown): value is ParseError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'string'
  )
}
