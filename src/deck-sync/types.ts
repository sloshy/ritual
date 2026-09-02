/**
 * @fileoverview The deck-sync engine's vocabulary: the public option, event
 * and result types every surface consumes (re-exported through `engine.ts`),
 * plus the {@link DeckTarget} and {@link SyncFlow} bags the resolution,
 * download and upload halves share.
 */

import type { ArchidektClient } from '../clients/ArchidektClient'
import type { DeckFrontMatter } from '../list/deck-file'
import type { DeckData } from '../list/deck'
import type {
  ConfirmUnreadable,
  SyncChangeFilter,
  SyncDirection,
  SyncEvent,
  SyncEventHandler,
  SyncItemStatus,
  SyncLogLevel,
  UnreadableSource,
} from '../sync/common'

// ── Public surface ────────────────────────────────────────────────────

/** What happened to one deck during a sync run. */
export type DeckSyncStatus = SyncItemStatus
export type DeckSyncDeckResult = {
  name: string
  status: DeckSyncStatus
  reason?: string
  /**
   * Printing differences the run found for this deck — applied, unless the run
   * was a dry run or the deck failed. Present only when the run synced printings, so
   * structured consumers — `--output json`, the MCP report, the admin page's
   * non-streaming fallback — see them without reading the log.
   */
  printingsChanged?: number
  /**
   * Cards the two sides hold at different printings, which a run that is not
   * syncing printings leaves alone. An advisory: present only when there is at
   * least one such card, and never on a `--sync-printings` run, which
   * reconciles them instead.
   */
  printingsUnaligned?: string[]
}

/** The report a run produces: per-deck results plus the failure count. */
export type DeckSyncReport = {
  direction: SyncDirection
  decks: DeckSyncDeckResult[]
  failedCount: number
  /**
   * Decks whose files hold lines the parser cannot read, with those lines.
   * Reported whether the run went ahead or refused them, so every consumer —
   * including `--output json` and the non-streaming endpoint, which never see
   * the `unreadable-lines` event — can show what accepting would delete.
   */
  unreadable: UnreadableDeck[]
  /**
   * True when the caller cancelled the run before every deck had started. The
   * decks it never reached are in {@link decks} as `skipped`; the ones it had
   * finished are reported exactly as an uncancelled run would report them.
   */
  cancelled: boolean
}

export type DeckSyncLogLevel = SyncLogLevel

/**
 * A deck file the parser could not fully read. Syncing re-serializes the file,
 * so every line listed in `warnings` would be deleted by the save.
 */
export type UnreadableDeck = UnreadableSource

/**
 * Decide whether decks carrying unreadable lines may sync anyway (declared on
 * {@link ConfirmUnreadable} in `sync-common`): called once, before any deck
 * syncs, with every affected deck.
 */
export type { ConfirmUnreadable }

/** One step of a deck sync run — the shared {@link SyncEvent}, carrying deck results. */
export type DeckSyncEvent = SyncEvent<DeckSyncDeckResult>

export type DeckSyncEventHandler = SyncEventHandler<DeckSyncDeckResult>

export type DeckSyncOptions = {
  direction: SyncDirection
  /** An Archidekt access token; callers obtain one from `ArchidektAuth.getToken()`. */
  token: string
  /** Deck names to sync; empty (the default) syncs every Archidekt-linked deck. */
  deckNames?: string[]
  /** Report what would sync without writing files or pushing changes. */
  dryRun?: boolean
  /**
   * Apply only one side of each deck's diff — additions or removals, relative to
   * the sync destination (local files on a pull, Archidekt on a push). Omitted,
   * every change applies. Skipped changes are still counted and logged.
   */
  only?: SyncChangeFilter
  /**
   * Push a deck whose remote copy changed since its recorded `sourceUpdatedAt`,
   * overwriting those remote changes. Without it such a deck fails; see
   * {@link checkDeckDivergence}. Meaningless on a pull, which never writes to
   * Archidekt.
   */
  force?: boolean
  /**
   * Also sync each card's exact printing — set, collector number, and finish
   * (the CLI's `--sync-printings`). Off by default, matching the historical
   * name-and-quantity-only diff: a pull rewrites local printings to the
   * remote's, and a push moves remote entries to the local file's printings,
   * so it is opt-in per run. A card held at several printings at once is
   * reconciled printing by printing — copies are added, removed, or re-pinned
   * so both sides hold the same printings — which is why it is opt-in: without
   * it, a printing difference is reported and left alone. The `only` filter
   * does not apply to printing updates, which neither add nor remove cards.
   */
  syncPrintings?: boolean
  onEvent?: DeckSyncEventHandler
  /**
   * Confirm syncing decks whose files carry unreadable lines. Omitted, such
   * decks fail — a sync must never silently delete a line it could not parse.
   * Never consulted under `dryRun`, which writes nothing and so has nothing to
   * confirm.
   */
  confirmUnreadable?: ConfirmUnreadable
  /** Injectable for tests; a fresh {@link ArchidektClient} by default. */
  client?: ArchidektClient
  /**
   * Cancel the run. Honoured at deck boundaries only: the deck in flight
   * finishes, every deck after it is reported `skipped` with
   * `SYNC_CANCELLED_REASON`, and the report's `cancelled` flag is set. Nothing
   * is ever left half-synced, which is what makes a cancelled run safe to rerun.
   */
  signal?: AbortSignal
}

export type DeckSyncRun = {
  report: DeckSyncReport
  /**
   * Every file the run wrote — each synced deck, its `.sha256` sidecar, and any
   * changelog it appended to. Always empty on a dry run. Callers that commit a
   * run (the admin endpoints) stage exactly this set.
   */
  writtenFiles: string[]
}

/** A deck `deck-sync` can operate on: linked to Archidekt and carrying a source id. */
export type SyncableDeck = {
  /** File basename without `.md` — the identifier the API and UI address decks by. */
  slug: string
  name: string
  sourceId: string
  sourceUrl: string
  /** When this deck last synced, or null if it never has. */
  lastSynced: string | null
}

export type DeckTarget = {
  filePath: string
  frontMatter: DeckFrontMatter
  deck: DeckData
  sourceId: string
}

/** The per-deck half of a run: results plus the files it wrote, and whether it was cut short. */
export type SyncOutcome = {
  decks: DeckSyncDeckResult[]
  writtenFiles: string[]
  cancelled: boolean
}

/** Everything a direction's flow needs beyond the decks it was handed. */
export type SyncFlow = {
  client: ArchidektClient
  token: string
  direction: SyncDirection
  dryRun: boolean
  only: SyncChangeFilter | undefined
  /** Overwrite a remote deck that changed since the last sync (push only). */
  force: boolean
  /** Also sync each card's exact printing and finish. */
  syncPrintings: boolean
  emit: DeckSyncEventHandler
  /** See {@link DeckSyncOptions.signal}. */
  signal: AbortSignal | undefined
}
