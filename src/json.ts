/**
 * Narrowing helpers for JSON that arrived from outside — a wire response, a
 * request body, a config file. A leaf module with no imports, so both a parser
 * reading an API's answer and a route reading a request body narrow the same way
 * instead of hand-rolling (or asserting) their own.
 */

/**
 * Whether a value is a plain JSON object, i.e. something whose properties may be
 * read. Arrays and `null` are objects to `typeof` but not to any caller of this,
 * so both are excluded.
 */
/** Narrows `unknown` to `string[]` — `Array.isArray` alone only yields `any[]`. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
