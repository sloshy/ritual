/**
 * The "happened recently" rule Ritual's once-in-a-while advisories share (the
 * migration offer's snooze, the update check's cache and its notice).
 */

/**
 * Whether `time` lies within `windowMs` before `now`. A time in the future (a
 * clock that moved backwards) is not recent, so a skewed clock can never
 * silence an advisory for good. `undefined` (never happened) is not recent.
 */
export function isWithinWindow(time: number | undefined, now: number, windowMs: number): boolean {
  if (time === undefined) return false
  const elapsed = now - time
  return elapsed >= 0 && elapsed < windowMs
}
