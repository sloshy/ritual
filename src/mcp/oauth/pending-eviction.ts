/** What eviction needs to know about an open consent page. */
export type PendingPageRef = {
  requestId: string
  /** The rate-limit key of the address that opened it. */
  addressKey: string
  /** When it lapses; pages share one lifetime, so the earliest is the oldest. */
  expiresAt: number
}

/**
 * The page to drop when the table of open consent pages is full: the oldest
 * page of the address holding the most pages, and among addresses tied for
 * the most, the oldest of their pages. So an address with fewer pages than
 * another never loses one, and a newcomer always gets in: only once every
 * address holds the same number does this fall back to the oldest page
 * overall. `undefined` only for an empty table.
 */
export function pageToEvict(pages: Iterable<PendingPageRef>): string | undefined {
  const counts = new Map<string, number>()
  const list = [...pages]
  for (const page of list) counts.set(page.addressKey, (counts.get(page.addressKey) ?? 0) + 1)
  let most = 0
  for (const count of counts.values()) most = Math.max(most, count)
  let oldest: PendingPageRef | undefined
  for (const page of list) {
    if (counts.get(page.addressKey) !== most) continue
    if (oldest === undefined || page.expiresAt < oldest.expiresAt) oldest = page
  }
  return oldest?.requestId
}
