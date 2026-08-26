/**
 * Walk a pre-split dotted path (e.g. `['admin', 'gitEnabled']`) into a nested
 * object. Returns undefined as soon as a segment is missing or a non-object is
 * reached.
 */
export function getAtPath(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}
