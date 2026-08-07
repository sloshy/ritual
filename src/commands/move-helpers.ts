import * as fs from 'node:fs/promises'
import path from 'node:path'
import { hashPath } from '../content-hash'
import { appendChangelog } from '../changelog-writer'
import {
  createMoveFromChange,
  createMoveToChange,
  createRemoveChange,
  listRefLabel,
  type ListRef,
} from '../change-event'
import type { Finish, Condition } from '../types'
import type { CardLabel } from '../card-labels'
import { languageToken, type CardLanguage } from '../card-language'
import { listDeckFiles, importFromTextFile } from '../importers/text-file'
import { parseCollectionFile } from '../collection-file'
import { parseWantedListFile } from './wanted-helpers'
import { listDisplayName } from '../list-lifecycle'
import {
  loadStagedFile,
  applyRemoveFromStaged,
  applyAddToStaged,
  writeStagedFile,
  type DroppedNote,
  type StagedFile,
} from './move-io'
import { getCollectionsDir, getDecksDir, getWantedDir } from '../ritual-config'
import { isListMarkdownFile } from '../list-file-name'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ListEntry = {
  ref: ListRef
  filePath: string
}

/**
 * A single movable card. For deck entries with quantity > 1, multiple PhysicalCards
 * are created (one per copy), keyed by `filePath:cardId:copyIndex`.
 */
export type PhysicalCard = {
  /** Stable unique key within the session (used to look up VirtualCard). */
  key: string
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The line's `[ja]`-style language token. Absent means `en`; rides every move. */
  language?: CardLanguage
  /**
   * Label override — collection entries only. A `ritual move`
   * collection→collection move carries it (like the note); moves to a deck or
   * wanted list drop it, since those grammars have no labels token. The editor
   * sessions' move events do not carry it at all — an editor move drops the
   * override even between collections, matching the notes precedent.
   */
  labels?: CardLabel[]
  note?: string
  cardId?: number
  listEntry: ListEntry
  /** Only set for deck cards: the copy index when quantity > 1. */
  copyIndex?: number
}

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

export async function loadAllLists(): Promise<ListEntry[]> {
  const lists: ListEntry[] = []

  const decksDir = getDecksDir()
  try {
    const deckFiles = await listDeckFiles(decksDir)
    for (const fileName of deckFiles) {
      const filePath = path.join(decksDir, fileName)
      // Per-file tolerance: an unparsable deck still appears, named by its slug.
      const name = await listDisplayName('deck', filePath).catch(() =>
        path.basename(fileName, '.md'),
      )
      lists.push({ ref: { type: 'deck', name }, filePath })
    }
  } catch {
    // decks directory may not exist
  }

  const collectionsDir = getCollectionsDir()
  try {
    const files = await fs.readdir(collectionsDir)
    for (const fileName of files.filter(isListMarkdownFile)) {
      const filePath = path.join(collectionsDir, fileName)
      const name = await listDisplayName('collection', filePath)
      lists.push({ ref: { type: 'collection', name }, filePath })
    }
  } catch {
    // collections directory may not exist
  }

  const wantedDir = getWantedDir()
  try {
    const files = await fs.readdir(wantedDir)
    for (const fileName of files.filter(isListMarkdownFile)) {
      const filePath = path.join(wantedDir, fileName)
      const name = await listDisplayName('wanted', filePath)
      lists.push({ ref: { type: 'wanted', name }, filePath })
    }
  } catch {
    // wanted directory may not exist
  }

  return lists
}

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
        warnings.push(
          `${label(listEntry.filePath)}: could not be read or parsed; its cards are missing from the index.`,
        )
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
        warnings.push(
          `${label(listEntry.filePath)}: could not be read or parsed; its cards are missing from the index.`,
        )
        continue
      }
      const parsed = parseCollectionFile(content)
      for (const warning of parsed.warnings) {
        warnings.push(`${label(listEntry.filePath)}: ${warning}`)
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
          note: entry.note,
          cardId: entry.cardId,
          listEntry,
        })
      }
    } else {
      const content = await fs.readFile(listEntry.filePath, 'utf-8').catch(() => null)
      if (content === null) {
        warnings.push(
          `${label(listEntry.filePath)}: could not be read or parsed; its cards are missing from the index.`,
        )
        continue
      }
      const parsed = parseWantedListFile(content)
      for (const warning of parsed.warnings) {
        warnings.push(`${label(listEntry.filePath)}: ${warning}`)
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

// ── UI helpers ─────────────────────────────────────────────────────────────────

/** Truncate a string to at most maxLen characters, appending "…" if truncated. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '…'
}

const FINISH_LABEL: Record<Finish, string> = {
  nonfoil: '',
  foil: ' [Foil]',
  etched: ' [Etched]',
}

/**
 * Human-readable label for a card's finish, shown only when the printing is not a
 * normal non-foil one. Returns e.g. ` [Foil]` / ` [Etched]`, or '' for nonfoil/unknown.
 */
export function finishLabel(finish: Finish | undefined): string {
  return finish ? FINISH_LABEL[finish] : ''
}

export type CardSearchChoice = {
  title: string
  value: string
}

export function buildCardSearchChoices(
  state: Map<string, VirtualCard>,
  enabledSources: Set<string>,
): CardSearchChoice[] {
  const choices: CardSearchChoice[] = []

  for (const vc of state.values()) {
    if (!enabledSources.has(vc.currentList.filePath)) continue
    if (vc.pendingMove !== null) continue // already moved this session

    const card = vc.card
    const listLabel = listRefLabel(vc.currentList.ref)

    let printingPart = ''
    if (card.set && card.collectorNumber) {
      printingPart = ` (${card.set.toUpperCase()}:${card.collectorNumber})`
    }
    const finishPart = finishLabel(card.finish) + languageToken(card.language)
    const idPart = card.cardId !== undefined ? ` &${card.cardId}` : ''

    let notePart = ''
    if (card.note) {
      // Truncate note to keep lines short (~80 chars)
      const noteMax = Math.max(
        20,
        80 - card.name.length - printingPart.length - finishPart.length - 20,
      )
      notePart = ` | ${truncate(card.note, noteMax)}`
    }

    const title = `${card.name}${printingPart}${finishPart}${idPart} — ${listLabel}${notePart}`
    choices.push({ title, value: vc.physicalKey })
  }

  // Sort alphabetically by card name for consistent display
  choices.sort((a, b) => a.title.localeCompare(b.title))
  return choices
}

// ── Toggle state helpers ───────────────────────────────────────────────────────

export function toggleSetAll(target: Set<string>, filePaths: string[], on: boolean): void {
  for (const fp of filePaths) {
    if (on) {
      target.add(fp)
    } else {
      target.delete(fp)
    }
  }
}

export type ToggleState = 'all' | 'some' | 'none'

export function getToggleState(filePaths: string[], enabled: Set<string>): ToggleState {
  const count = filePaths.filter((fp) => enabled.has(fp)).length
  if (count === 0) return 'none'
  if (count === filePaths.length) return 'all'
  return 'some'
}

export function toggleStateChar(state: ToggleState): string {
  if (state === 'all') return 'X'
  if (state === 'some') return '~'
  return ' '
}

// ── Commit (file I/O delegated to move-io.ts) ─────────────────────────────────

type PerFileChanges = {
  listEntry: ListEntry
  removes: VirtualCard[]
  adds: VirtualCard[]
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
    const loaded = await loadStagedFile(listEntry.filePath, listEntry.ref.type)
    if (!loaded.ok) {
      throw new Error(
        loaded.reason === 'unreadable-file'
          ? `Destination file not found, aborting move: ${listEntry.filePath}`
          : `Aborting move: ${loaded.message}`,
      )
    }
    staged.set(listEntry.filePath, loaded.file)
  }

  for (const { listEntry } of bySource.values()) {
    if (staged.has(listEntry.filePath)) continue
    const loaded = await loadStagedFile(listEntry.filePath, listEntry.ref.type)
    if (!loaded.ok) {
      throw new Error(
        loaded.reason === 'unreadable-file'
          ? `Source file not readable, aborting move: ${listEntry.filePath}`
          : `Aborting move: ${loaded.message}`,
      )
    }
    staged.set(listEntry.filePath, loaded.file)
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

  // --- APPLY: Additions in memory (only for successfully removed cards) ---
  const droppedNotes: DroppedNote[] = []
  for (const { listEntry, adds } of byDest.values()) {
    const stagedFile = staged.get(listEntry.filePath)!
    for (const vc of adds) {
      if (!removedKeys.has(vc.physicalKey)) continue
      const dropped = applyAddToStaged(stagedFile, vc.card, listEntry.ref.type, vc.destSection)
      if (dropped) droppedNotes.push(dropped)
    }
  }

  // --- WRITE: All modified files to disk in a single pass ---
  const writtenFiles: string[] = []
  for (const [filePath, stagedFile] of staged.entries()) {
    await writeStagedFile(filePath, stagedFile)
    writtenFiles.push(filePath, hashPath(filePath))
  }

  // --- CHANGELOG: Write entries only for successfully moved cards ---
  for (const { listEntry, removes } of bySource.values()) {
    const changes = removes
      .filter((vc) => removedKeys.has(vc.physicalKey))
      .map((vc) =>
        createMoveFromChange(vc.card.name, {
          set: vc.card.set,
          collectorNumber: vc.card.collectorNumber,
          finish: vc.card.finish,
          condition: vc.card.condition,
          language: vc.card.language,
          cardId: vc.card.cardId,
          to: vc.currentList.ref,
        }),
      )
    if (changes.length > 0) {
      writtenFiles.push(await appendChangelog(listEntry.filePath, listEntry.ref.name, changes))
    }
  }

  for (const { listEntry, adds } of byDest.values()) {
    const changes = adds
      .filter((vc) => removedKeys.has(vc.physicalKey))
      .map((vc) =>
        createMoveToChange(vc.card.name, {
          set: vc.card.set,
          collectorNumber: vc.card.collectorNumber,
          finish: vc.card.finish,
          condition: vc.card.condition,
          language: vc.card.language,
          cardId: vc.card.cardId,
          from: vc.card.listEntry.ref,
        }),
      )
    if (changes.length > 0) {
      writtenFiles.push(await appendChangelog(listEntry.filePath, listEntry.ref.name, changes))
    }
  }

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
    const loaded = await loadStagedFile(listEntry.filePath, listEntry.ref.type)
    if (!loaded.ok) {
      throw new Error(
        loaded.reason === 'unreadable-file'
          ? `Source file not readable, aborting remove: ${listEntry.filePath}`
          : `Aborting remove: ${loaded.message}`,
      )
    }
    staged.set(listEntry.filePath, loaded.file)
  }

  // --- APPLY: Removals in memory ---
  const removedKeys = new Set<string>()
  for (const { listEntry, removes } of bySource.values()) {
    const stagedFile = staged.get(listEntry.filePath)!
    for (const vc of removes) {
      if (applyRemoveFromStaged(stagedFile, vc.card)) removedKeys.add(vc.physicalKey)
    }
  }

  // --- WRITE: All modified files to disk in a single pass ---
  const writtenFiles: string[] = []
  for (const [filePath, stagedFile] of staged.entries()) {
    await writeStagedFile(filePath, stagedFile)
    writtenFiles.push(filePath, hashPath(filePath))
  }

  // --- CHANGELOG: One `remove` entry per successfully removed card ---
  for (const { listEntry, removes } of bySource.values()) {
    const changes = removes
      .filter((vc) => removedKeys.has(vc.physicalKey))
      .map((vc) =>
        createRemoveChange(vc.card.name, {
          set: vc.card.set,
          collectorNumber: vc.card.collectorNumber,
          finish: vc.card.finish,
          condition: vc.card.condition,
          language: vc.card.language,
          cardId: vc.card.cardId,
        }),
      )
    if (changes.length > 0) {
      writtenFiles.push(await appendChangelog(listEntry.filePath, listEntry.ref.name, changes))
    }
  }

  return { removed: removedKeys.size, writtenFiles: [...new Set(writtenFiles)] }
}
