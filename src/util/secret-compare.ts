import { createHash, timingSafeEqual } from 'node:crypto'

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Compare a caller-supplied secret against the expected one in constant time.
 *
 * Both sides are hashed first, so the comparison always runs over two
 * equal-length digests: neither the position of the first mismatch nor the
 * expected secret's length shows up in the timing. A plain `===` leaks the
 * first, and `timingSafeEqual` on the raw strings throws on (and so leaks)
 * a length mismatch.
 */
export function secretsEqual(supplied: string, expected: string): boolean {
  return timingSafeEqual(digest(supplied), digest(expected))
}
