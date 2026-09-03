/**
 * The cross-list move engine: the physical-card index, the in-memory virtual
 * state a session edits, and the two commits (moves, removals) that write it
 * to disk. Shared by `ritual move`, the admin move routes and the MCP tools;
 * the prompts and menus that drive it live under `src/commands/move*.ts`.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { t } from '../i18n/t'
import { appendChangelog } from '../changes/changelog-writer'
import {
  createMoveFromChange,
  createMoveToChange,
  createRemoveChange,
  printingOptionsFrom,
} from '../changes/change-event'
import { importFromTextFile } from '../importers/text-file'
import { parseCollectionFile } from './collection-file'
import { parseWantedListFile } from './wanted-file'
import {
  loadStagedOrThrow,
  applyRemoveFromStaged,
  adoptedCardId,
  applyAddToStaged,
  stagedCardIds,
  writeStagedFiles,
  type DroppedNote,
  type PhysicalCard,
  type StagedAddResult,
  type StagedFile,
} from './move-staging'
import {
  createCardArtCache,
  type CardArtReconcileFailure,
  type CardArtReconcileInput,
  type CardArtRef,
} from './card-art'
import { reconcileListRefs } from './list-refs'
import type { ListEntry } from './list-info'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PendingMove = {
  originalList: ListEntry
}

export type VirtualCard = {
  physicalKey: string
  card: PhysicalCard
  /** Where the card currently sits (may be different from card.listEntry after pending moves). */
  currentList: ListEntry
  /**
   * Destination deck section for the pending move (deck destinations only).
   * Not part of card identity — it only steers the destination-side add.
   */
  destSection?: string
  pendingMove: PendingMove | null
  /** Marked for deletion from its source list (cross-list bulk remove). */
  pendingRemove?: true
}

/** A VirtualCard that has been committed to a pending move (pendingMove is guaranteed non-null). */
export type CommittedVirtualCard = VirtualCard & { pendingMove: PendingMove }

export type MoveSessionConfig = {
  enabledSources: Set<string>
  enabledDestinations: Set<string>
  allLists: ListEntry[]
}

// ── Loading ───────────────────────────────────────────────────────────────────

/** Physical cards plus every read/parse problem encountered building them. */
export interface PhysicalCardLoad {
  cards: PhysicalCard[]
  /**
   * One line per list that could not be fully read, phrased for an API client
   * (`decks/burn.md: could not be read or parsed; ...`). Without these a
   * malformed line — or an entire unreadable deck — is invisible to a caller,
   * which reads as "that card is not in any list".
   */
  warnings: string[]
}

/**
 * Build the cross-list physical-card index: one entry per copy, with deck
 * quantities expanded. A list that cannot be read is skipped rather than failing
 * the whole index (one bad file must not hide every other list), but never
 * silently: every skip and every unparseable line is reported in `warnings`.
 */
export async function loadPhysicalCards(lists: ListEntry[]): Promise<PhysicalCardLoad> {
  const cards: PhysicalCard[] = []
  const warnings: string[] = []
  /** Name a list the way a user would find it on disk: `<dir>/<file>`. */
  const label = (filePath: string): string =>
    `${path.basename(path.dirname(filePath))}/${path.basename(filePath)}`

  for (const listEntry of lists) {
    if (listEntry.ref.type === 'deck') {
      const deckData = await importFromTextFile(listEntry.filePath).catch(() => null)
      if (!deckData) {
        warnings.push(t('cli.move.listUnreadable', { file: label(listEntry.filePath) }))
        continue
      }
      for (const section of deckData.sections) {
        for (const card of section.cards) {
          // Expand deck cards to individual copies
          for (let i = 0; i < card.quantity; i++) {
            const key = `${listEntry.filePath}:${card.cardId ?? card.name}:${i}`
            cards.push({
              key,
              name: card.name,
              set: card.set,
              collectorNumber: card.collectorNumber,
              finish: card.finish,
              condition: card.condition,
              language: card.language,
              labels: card.labels,
              tags: card.tags,
              note: card.note,
              cardId: card.cardId,
              copyIndex: i,
              listEntry,
            })
          }
        }
      }
    } else if (listEntry.ref.type === 'collection') {
      const content = await fs.readFile(listEntry.filePath, 'utf-8').catch(() => null)
      if (content === null) {
        warnings.push(t('cli.move.listUnreadable', { file: label(listEntry.filePath) }))
        continue
      }
      const parsed = parseCollectionFile(content)
      for (const warning of parsed.warnings) {
        warnings.push(t('cli.move.listWarning', { file: label(listEntry.filePath), warning }))
      }
      for (const entry of parsed.entries) {
        const key = `${listEntry.filePath}:${entry.cardId ?? entry.name}:0`
        cards.push({
          key,
          name: entry.name,
          set: entry.set,
          collectorNumber: entry.collectorNumber,
          finish: entry.finish,
          condition: entry.condition,
          language: entry.language,
          labels: entry.labels,
          tags: entry.tags,
          note: entry.note,
          cardId: entry.cardId,
          listEntry,
        })
      }
    } else {
      const content = await fs.readFile(listEntry.filePath, 'utf-8').catch(() => null)
      if (content === null) {
        warnings.push(t('cli.move.listUnreadable', { file: label(listEntry.filePath) }))
        continue
      }
      const parsed = parseWantedListFile(content)
      for (const warning of parsed.warnings) {
        warnings.push(t('cli.move.listWarning', { file: label(listEntry.filePath), warning }))
      }
      for (const entry of parsed.entries) {
        const key = `${listEntry.filePath}:${entry.cardId ?? entry.name}:0`
        cards.push({
          key,
          name: entry.name,
          set: entry.set,
          collectorNumber: entry.collectorNumber,
          finish: entry.finish,
          language: entry.language,
          tags: entry.tags,
          note: entry.note,
          cardId: entry.cardId,
          listEntry,
        })
      }
    }
  }

  return { cards, warnings }
}

export function buildVirtualState(physicalCards: PhysicalCard[]): Map<string, VirtualCard> {
  const state = new Map<string, VirtualCard>()
  for (const card of physicalCards) {
    state.set(card.key, {
      physicalKey: card.key,
      card,
      currentList: card.listEntry,
      pendingMove: null,
    })
  }
  return state
}

// ── Virtual state management ──────────────────────────────────────────────────

/** Optional per-move settings for {@link applyVirtualMove}. */
export type VirtualMoveOptions = {
  /** Destination deck section (exact name; created when missing). */
  section?: string
}

export function applyVirtualMove(
  state: Map<string, VirtualCard>,
  physicalKey: string,
  destList: ListEntry,
  options?: VirtualMoveOptions,
): boolean {
  const vc = state.get(physicalKey)
  if (!vc) return false

  if (vc.pendingMove === null) {
    // First move: record original location
    vc.pendingMove = { originalList: vc.currentList }
  }
  // Update current (chain: keep originalList, just update currentList). The
  // destination section always tracks the latest retarget — a chained move
  // without a section clears any previously requested one.
  vc.currentList = destList
  vc.destSection = options?.section
  return true
}

export function getPendingMoves(state: Map<string, VirtualCard>): CommittedVirtualCard[] {
  return Array.from(state.values()).filter(
    (vc): vc is CommittedVirtualCard => vc.pendingMove !== null,
  )
}

/** Mark a virtual card for deletion from its source list. Returns false if unknown. */
export function applyVirtualRemove(state: Map<string, VirtualCard>, physicalKey: string): boolean {
  const vc = state.get(physicalKey)
  if (!vc) return false
  vc.pendingRemove = true
  return true
}

function getPendingRemoves(state: Map<string, VirtualCard>): VirtualCard[] {
  return Array.from(state.values()).filter((vc) => vc.pendingRemove === true)
}
// ── Commit (file I/O delegated to move-staging.ts) ─────────────────────────────────

type PerFileChanges = {
  listEntry: ListEntry
  removes: VirtualCard[]
  adds: VirtualCard[]
}

// ── Custom art ────────────────────────────────────────────────────────────────

/**
 * One list's pending `<list>.art.json` edits, keyed by the ids its sidecar uses.
 *
 * Custom art is filed under a card line's `&N`, and a move frees that id on the
 * source side while allocating a fresh one on the destination side — so the art
 * has to be re-filed, or the source's next added card inherits it.
 */
export type ArtReconcile = CardArtReconcileInput & {
  removed: Set<number>
  added: Map<number, CardArtRef>
}

export function artReconcileFor(byFile: Map<string, ArtReconcile>, filePath: string): ArtReconcile {
  let entry = byFile.get(filePath)
  if (!entry) {
    entry = { removed: new Set(), added: new Map() }
    byFile.set(filePath, entry)
  }
  return entry
}

/** What committing a batch's art reconciles produced. */
export type ArtCommitResult = {
  /** Every sidecar and cover path written, deduplicated, for a caller staging them. */
  writtenFiles: string[]
  /** The sidecars that could not be reconciled; their art is left exactly as it was. */
  failures: CardArtReconcileFailure[]
}

/**
 * Write every reconciled art sidecar and cover image. A sidecar Ritual cannot
 * read keeps its own art and is reported as a failure rather than rewritten
 * from a partial read — see {@link reconcileListRefs}.
 */
export async function commitArtReconciles(
  byFile: Map<string, ArtReconcile>,
): Promise<ArtCommitResult> {
  const written: string[] = []
  const failures: CardArtReconcileFailure[] = []
  for (const [filePath, entry] of byFile) {
    const reconciled = await reconcileListRefs(filePath, entry)
    if (!reconciled.art.ok) failures.push(reconciled.art)
    written.push(...reconciled.writtenFiles)
  }
  return { writtenFiles: [...new Set(written)], failures }
}

/**
 * Which `&N` each source file still carried once the batch's removals had been
 * applied and **before** its additions were.
 *
 * Snapshotting between the two phases is what makes "the id is free" answerable
 * at all: the additions allocate from the same pool the removals just fed, so a
 * swap (A→B while B→A) hands the departed card's id straight to the arriving
 * one. Read after the additions, the id looks alive and the departed card's art
 * would stay filed under it — on a different card.
 */
function snapshotSurvivingIds(
  bySource: Map<string, PerFileChanges>,
  staged: Map<string, StagedFile>,
): Map<string, Set<number>> {
  const surviving = new Map<string, Set<number>>()
  for (const { listEntry } of bySource.values()) {
    if (surviving.has(listEntry.filePath)) continue
    surviving.set(listEntry.filePath, stagedCardIds(staged.get(listEntry.filePath)!))
  }
  return surviving
}

/**
 * Plan the art sidecar edits a committed batch implies: drop each departed
 * card's entry from its source, and re-file it under the id its destination
 * line was given.
 *
 * `surviving` comes from {@link snapshotSurvivingIds} rather than from the
 * removal bookkeeping alone, because "the card left" and "the id is free" are
 * different facts: a deck line that still has copies keeps both its `&N` and its
 * art.
 */
async function planMovedArt(
  bySource: Map<string, PerFileChanges>,
  surviving: ReadonlyMap<string, Set<number>>,
  removedKeys: Set<string>,
  landed: Map<string, StagedAddResult>,
): Promise<Map<string, ArtReconcile>> {
  const byFile = new Map<string, ArtReconcile>()
  const cache = createCardArtCache()
  for (const { listEntry, removes } of bySource.values()) {
    const departed = removes.filter((vc) => removedKeys.has(vc.physicalKey))
    if (departed.length === 0) continue
    // An unreadable sidecar reads as no art and is left untouched rather than
    // rewritten from a partial read; every read path already reports it.
    const art = await cache.load(listEntry.filePath)
    const stillHeld = surviving.get(listEntry.filePath) ?? new Set<number>()
    for (const vc of departed) {
      const cardId = vc.card.cardId
      if (cardId === undefined) continue
      // A line that still has copies left keeps its id — and its art. Recorded
      // before the art lookup because the freed id is also what re-points the
      // list's cover image, and that is filed whether or not the line wore art.
      if (!stillHeld.has(cardId)) artReconcileFor(byFile, listEntry.filePath).removed.add(cardId)
      const ref = art.get(cardId)
      if (ref === undefined) continue
      const arrival = landed.get(vc.physicalKey)
      const adopted = arrival === undefined ? undefined : adoptedCardId(arrival)
      if (adopted !== undefined) {
        artReconcileFor(byFile, vc.currentList.filePath).added.set(adopted, ref)
      }
    }
  }
  return byFile
}

export type CommitMovesResult = {
  /** Number of cards actually moved. */
  moved: number
  /**
   * Every file written this commit (list markdown + hash sidecars + changelogs),
   * deduplicated, so callers can stage exactly these paths for an auto-commit.
   */
  writtenFiles: string[]
  /**
   * Notes discarded by deck quantity-merges (the incoming note differed from the
   * existing line's). Only reported for moves whose removal succeeded.
   */
  droppedNotes: DroppedNote[]
}

/**
 * Commit all pending moves to disk atomically and write changelog entries.
 *
 * All files are pre-loaded into memory before any mutations. Removals are applied
 * first; additions are only applied for cards that were successfully removed.
 * All modified files are written to disk in a single pass at the end, ensuring
 * no card can be permanently lost if a later step fails.
 *
 * Returns the number of cards moved plus the set of files written (for git staging).
 */
export async function commitAllMoves(state: Map<string, VirtualCard>): Promise<CommitMovesResult> {
  const pending = getPendingMoves(state)
  if (pending.length === 0) return { moved: 0, writtenFiles: [], droppedNotes: [] }

  // Group by source file (for removals) and destination file (for additions)
  const bySource = new Map<string, PerFileChanges>()
  const byDest = new Map<string, PerFileChanges>()

  for (const vc of pending) {
    const srcPath = vc.card.listEntry.filePath
    const dstPath = vc.currentList.filePath

    if (!bySource.has(srcPath)) {
      bySource.set(srcPath, { listEntry: vc.card.listEntry, removes: [], adds: [] })
    }
    bySource.get(srcPath)!.removes.push(vc)

    if (!byDest.has(dstPath)) {
      byDest.set(dstPath, { listEntry: vc.currentList, removes: [], adds: [] })
    }
    byDest.get(dstPath)!.adds.push(vc)
  }

  // --- LOAD: Pre-read all files into memory ---
  // Destination files are loaded first so their absence aborts before any mutation.
  const staged = new Map<string, StagedFile>()

  for (const { listEntry } of byDest.values()) {
    if (staged.has(listEntry.filePath)) continue
    staged.set(
      listEntry.filePath,
      await loadStagedOrThrow(listEntry, {
        missingKey: 'cli.move.abortDestinationMissing',
        abortKey: 'cli.move.abortMove',
      }),
    )
  }

  for (const { listEntry } of bySource.values()) {
    if (staged.has(listEntry.filePath)) continue
    staged.set(
      listEntry.filePath,
      await loadStagedOrThrow(listEntry, {
        missingKey: 'cli.move.abortSourceUnreadable',
        abortKey: 'cli.move.abortMove',
      }),
    )
  }

  // --- APPLY: Removals in memory ---
  const removedKeys = new Set<string>()

  for (const { listEntry, removes } of bySource.values()) {
    const stagedFile = staged.get(listEntry.filePath)!
    for (const vc of removes) {
      const removed = applyRemoveFromStaged(stagedFile, vc.card)
      if (removed) removedKeys.add(vc.physicalKey)
    }
  }

  // Snapshot the source id space between the removals and the additions: the
  // additions allocate from the pool the removals just fed, so an id read after
  // them looks alive even when the line that held it is gone.
  const survivingBySource = snapshotSurvivingIds(bySource, staged)

  // --- APPLY: Additions in memory (only for successfully removed cards) ---
  const droppedNotes: DroppedNote[] = []
  /** Where each moved card landed, so its custom art can follow it. */
  const landed = new Map<string, StagedAddResult>()
  for (const { listEntry, adds } of byDest.values()) {
    const stagedFile = staged.get(listEntry.filePath)!
    for (const vc of adds) {
      if (!removedKeys.has(vc.physicalKey)) continue
      const added = applyAddToStaged(stagedFile, vc.card, listEntry.ref.type, vc.destSection)
      landed.set(vc.physicalKey, added)
      if (added.droppedNote) droppedNotes.push(added.droppedNote)
    }
  }

  // --- APPLY: Custom art follows the cards (sidecars, written below) ---
  const artByFile = await planMovedArt(bySource, survivingBySource, removedKeys, landed)

  // --- WRITE: All modified files to disk in a single pass ---
  const writtenFiles = await writeStagedFiles(staged)

  // --- CHANGELOG: Write entries only for successfully moved cards ---
  for (const { listEntry, removes } of bySource.values()) {
    const changes = removes
      .filter((vc) => removedKeys.has(vc.physicalKey))
      .map((vc) =>
        createMoveFromChange(vc.card.name, {
          ...printingOptionsFrom(vc.card),
          tags: vc.card.tags,
          to: vc.currentList.ref,
        }),
      )
    if (changes.length > 0) {
      writtenFiles.push(await appendChangelog(listEntry.filePath, listEntry.ref.name, changes))
    }
  }

  for (const { listEntry, adds } of byDest.values()) {
    // `cardId` is the DESTINATION line the copy landed on (merged-onto or
    // fresh); the source line it left is `sourceCardId` — `MoveToChange`'s
    // contract, the same one the editor saves' mirror follows.
    const changes = adds
      .filter((vc) => removedKeys.has(vc.physicalKey))
      .map((vc) =>
        createMoveToChange(vc.card.name, {
          ...printingOptionsFrom(vc.card),
          tags: vc.card.tags,
          cardId: landed.get(vc.physicalKey)?.cardId,
          from: vc.card.listEntry.ref,
          sourceCardId: vc.card.cardId,
        }),
      )
    if (changes.length > 0) {
      writtenFiles.push(await appendChangelog(listEntry.filePath, listEntry.ref.name, changes))
    }
  }

  // --- ART: re-file the sidecars planned above (card lines are already written) ---
  // Failures are not surfaced here: a sidecar this cannot read keeps its own
  // art untouched, and every read path already reports it — the moves
  // themselves are complete either way.
  writtenFiles.push(...(await commitArtReconciles(artByFile)).writtenFiles)

  return { moved: removedKeys.size, writtenFiles: [...new Set(writtenFiles)], droppedNotes }
}

export type CommitRemovalsResult = {
  /** Number of cards actually removed. */
  removed: number
  /** Every file written this commit (list markdown + hash sidecars + changelogs), deduplicated. */
  writtenFiles: string[]
}

/**
 * Commit all pending removals to disk atomically and write changelog entries.
 *
 * Mirrors {@link commitAllMoves} but only does the source-side removal: all source
 * files are pre-loaded, removals applied in memory, every modified file written in
 * one pass, then a `remove` changelog entry is appended per successfully removed
 * card. Used by the cross-list bulk "Remove all selected" admin action.
 */
export async function commitAllRemovals(
  state: Map<string, VirtualCard>,
): Promise<CommitRemovalsResult> {
  const pending = getPendingRemoves(state)
  if (pending.length === 0) return { removed: 0, writtenFiles: [] }

  // Group by source file.
  const bySource = new Map<string, PerFileChanges>()
  for (const vc of pending) {
    const srcPath = vc.card.listEntry.filePath
    if (!bySource.has(srcPath)) {
      bySource.set(srcPath, { listEntry: vc.card.listEntry, removes: [], adds: [] })
    }
    bySource.get(srcPath)!.removes.push(vc)
  }

  // --- LOAD: Pre-read all source files into memory (absence aborts before mutation) ---
  const staged = new Map<string, StagedFile>()
  for (const { listEntry } of bySource.values()) {
    if (staged.has(listEntry.filePath)) continue
    staged.set(
      listEntry.filePath,
      await loadStagedOrThrow(listEntry, {
        missingKey: 'cli.move.abortRemoveSourceUnreadable',
        abortKey: 'cli.move.abortRemove',
      }),
    )
  }

  // --- APPLY: Removals in memory ---
  const removedKeys = new Set<string>()
  for (const { listEntry, removes } of bySource.values()) {
    const stagedFile = staged.get(listEntry.filePath)!
    for (const vc of removes) {
      if (applyRemoveFromStaged(stagedFile, vc.card)) removedKeys.add(vc.physicalKey)
    }
  }

  // --- APPLY: A removed card's custom art goes with it (no destination here) ---
  // Nothing is added on this path, so the post-removal snapshot is the final
  // id space — taken through the same helper so both engines agree on when an
  // `&N` counts as free.
  const artByFile = await planMovedArt(
    bySource,
    snapshotSurvivingIds(bySource, staged),
    removedKeys,
    new Map(),
  )

  // --- WRITE: All modified files to disk in a single pass ---
  const writtenFiles = await writeStagedFiles(staged)

  // --- CHANGELOG: One `remove` entry per successfully removed card ---
  for (const { listEntry, removes } of bySource.values()) {
    const changes = removes
      .filter((vc) => removedKeys.has(vc.physicalKey))
      .map((vc) => createRemoveChange(vc.card.name, printingOptionsFrom(vc.card)))
    if (changes.length > 0) {
      writtenFiles.push(await appendChangelog(listEntry.filePath, listEntry.ref.name, changes))
    }
  }

  // --- ART: drop the departed cards' sidecar entries (failures as above) ---
  writtenFiles.push(...(await commitArtReconciles(artByFile)).writtenFiles)

  return { removed: removedKeys.size, writtenFiles: [...new Set(writtenFiles)] }
}
