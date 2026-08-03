/**
 * The push-side divergence guard.
 *
 * A push makes Archidekt match the local file: a card added on archidekt.com
 * since the last sync reads as "gone from the source" and is set to quantity 0.
 * That is the documented semantics, but it is quiet data loss on the remote side
 * when the remote actually moved on — so a push compares the remote deck's
 * `updatedAt` against the `sourceUpdatedAt` the last sync recorded, and refuses
 * the deck unless the user asks for the overwrite with `--force`.
 *
 * **Both timestamps come from Archidekt.** `sourceUpdatedAt` is the remote
 * `updatedAt` a sync observed, copied verbatim into the deck's front matter —
 * deliberately *not* `lastSynced`, which is the local wall clock and would make
 * the comparison cross two clocks: a machine running behind the server would
 * diverge against its own push and never recover. One clock, so an exact
 * comparison is exact.
 */

/** A remote deck that changed after the local file's recorded sync. */
export type DeckDivergence = {
  /** The remote deck's `updatedAt`, verbatim. */
  remoteUpdatedAt: string
  /** The `sourceUpdatedAt` the deck's front matter carries. */
  syncedUpdatedAt: string
}

export type DivergenceInput = {
  /** The remote deck's update timestamp, as Archidekt reported it. */
  remoteUpdatedAt: string | undefined
  /** The remote `updatedAt` this deck last synced against, when one was recorded. */
  syncedUpdatedAt: string | null | undefined
}

/**
 * The three answers the guard can give. `unsynced` and `unknown` both let the
 * push through, but they are different facts and the caller reports them
 * differently: one is the documented first-sync case, the other is the guard
 * failing to run at all.
 */
export type DivergenceCheck =
  /** The remote has not changed since the recorded sync. */
  | { kind: 'clean' }
  /**
   * No recorded remote timestamp: the deck has never synced through Ritual (or
   * was linked by hand), so there is no moment to compare against and every
   * remote card is simply the state the first push overwrites.
   */
  | { kind: 'unsynced' }
  /**
   * Archidekt did not report a usable `updatedAt`, so the question could not be
   * asked. The push proceeds — inventing a divergence would block every push
   * against a response shape Ritual does not control — but the caller says so.
   */
  | { kind: 'unknown'; reason: string }
  | { kind: 'diverged'; divergence: DeckDivergence }

/** A timestamp's epoch milliseconds, or null when it is absent or unparseable. */
function epoch(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Whether the remote deck changed since the local file last synced against it.
 *
 * Equal timestamps are *not* divergence: the last sync is what recorded them.
 */
export function checkDeckDivergence(input: DivergenceInput): DivergenceCheck {
  const { remoteUpdatedAt, syncedUpdatedAt } = input
  if (typeof syncedUpdatedAt !== 'string' || syncedUpdatedAt.trim() === '') {
    return { kind: 'unsynced' }
  }
  if (typeof remoteUpdatedAt !== 'string' || remoteUpdatedAt.trim() === '') {
    return { kind: 'unknown', reason: 'Archidekt reported no update timestamp for this deck' }
  }

  const remote = epoch(remoteUpdatedAt)
  const synced = epoch(syncedUpdatedAt)
  if (remote === null) {
    return {
      kind: 'unknown',
      reason: `Archidekt reported an unreadable update timestamp ("${remoteUpdatedAt}")`,
    }
  }
  // A recorded value Ritual itself wrote, so an unreadable one means the front
  // matter was hand-edited — same "cannot ask the question" outcome, said so.
  if (synced === null) {
    return {
      kind: 'unknown',
      reason: `The deck's sourceUpdatedAt is not a readable timestamp ("${syncedUpdatedAt}")`,
    }
  }
  if (remote <= synced) return { kind: 'clean' }
  return { kind: 'diverged', divergence: { remoteUpdatedAt, syncedUpdatedAt } }
}

/** The reason a diverged deck fails, and the two ways forward. */
export function describeDivergence(divergence: DeckDivergence): string {
  return (
    `Remote deck changed since last sync (remote: ${divergence.remoteUpdatedAt}, ` +
    `last synced against: ${divergence.syncedUpdatedAt}) — pull first, or pass --force to ` +
    'overwrite remote changes.'
  )
}
