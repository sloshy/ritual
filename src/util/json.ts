/**
 * Narrowing helpers for JSON that arrived from outside — a wire response, a
 * request body, a config file. A leaf module with no imports, so both a parser
 * reading an API's answer and a route reading a request body narrow the same way
 * instead of hand-rolling (or asserting) their own.
 */

/** Any value JSON can represent. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject

/** A JSON object. */
export type JsonObject = { [key: string]: JsonValue }

/** Narrows `unknown` to `string[]` — `Array.isArray` alone only yields `any[]`. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * Whether a value is a plain JSON object, i.e. something whose properties may be
 * read. Arrays and `null` are objects to `typeof` but not to any caller of this,
 * so both are excluded.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Where a `JSON.parse` failure points: a 1-based line and column. */
export type JsonErrorPosition = { line: number; column: number }

/**
 * Each engine's position frame, anchored to the end of its message: V8 quotes
 * the offending input earlier in the message, so an unanchored match would read
 * a position out of the user's own text (`JSON.parse('line 5 column 9')`).
 * JavaScriptCore names no position at all.
 */
const JSON_POSITION_FRAMES: readonly RegExp[] = [
  // V8: `… in JSON at position 1 (line 1 column 2)`
  /\(line (\d+) column (\d+)\)$/,
  // SpiderMonkey: `JSON.parse: … at line 1 column 2 of the JSON data`
  /at line (\d+) column (\d+) of the JSON data$/,
]

/**
 * The line and column a `JSON.parse` failure names, read from the engine's own
 * message when it gives one, else `undefined`. Only the two numbers are taken:
 * the engine's English text never reaches a reader.
 */
export function jsonErrorPosition(error: unknown): JsonErrorPosition | undefined {
  if (!(error instanceof Error)) return undefined
  for (const frame of JSON_POSITION_FRAMES) {
    const match = frame.exec(error.message)
    if (match !== null) return { line: Number(match[1]), column: Number(match[2]) }
  }
  return undefined
}
