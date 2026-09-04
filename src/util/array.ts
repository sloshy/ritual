/** Small array rules shared by more than one surface. */

/**
 * `list` with the entry at `index` swapped with its `delta` neighbour, or an
 * unchanged copy when either end is out of range. Both category reorder controls
 * (a card's primary-first chips and the list vocabulary in the Manage modal) are
 * this one rule.
 */
export function swapNeighbour<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = [...list]
  const target = index + delta
  const from = next[index]
  const to = next[target]
  if (from === undefined || to === undefined) return next
  next[index] = to
  next[target] = from
  return next
}
