import * as fs from 'node:fs/promises'
import path from 'node:path'
import { appendChangelog } from '../changelog-writer'
import {
  createMoveFromChange,
  createMoveToChange,
  listRefLabel,
  type ListRef,
} from '../change-event'
import type { Finish, Condition } from '../types'
import { listDeckFiles, importFromTextFile } from '../importers/text-file'
import { parseCollectionFile } from './price-collection'
import { parseWantedListFile } from './wanted-helpers'
import { parseDeckFrontMatter } from '../deck-file'
import { extractMarkdownTitle } from '../markdown-utils'
import {
  loadStagedFile,
  applyRemoveFromStaged,
  applyAddToStaged,
  writeStagedFile,
  type StagedFile,
} from './move-io'
import { getCollectionsDir, getDecksDir, getWantedDir } from '../ritual-config'

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
  pendingMove: PendingMove | null
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
      const fm = await parseDeckFrontMatter(filePath).catch((): Record<string, unknown> => ({}))
      const name = typeof fm.name === 'string' ? fm.name : path.basename(fileName, '.md')
      lists.push({ ref: { type: 'deck', name }, filePath })
    }
  } catch {
    // decks directory may not exist
  }

  const collectionsDir = getCollectionsDir()
  try {
    const files = await fs.readdir(collectionsDir)
    for (const fileName of files.filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))) {
      const filePath = path.join(collectionsDir, fileName)
      const content = await fs.readFile(filePath, 'utf-8')
      const name = extractMarkdownTitle(content) ?? path.basename(fileName, '.md')
      lists.push({ ref: { type: 'collection', name }, filePath })
    }
  } catch {
    // collections directory may not exist
  }

  const wantedDir = getWantedDir()
  try {
    const files = await fs.readdir(wantedDir)
    for (const fileName of files.filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))) {
      const filePath = path.join(wantedDir, fileName)
      const content = await fs.readFile(filePath, 'utf-8')
      const name = extractMarkdownTitle(content) ?? path.basename(fileName, '.md')
      lists.push({ ref: { type: 'wanted', name }, filePath })
    }
  } catch {
    // wanted directory may not exist
  }

  return lists
}

export async function loadPhysicalCards(lists: ListEntry[]): Promise<PhysicalCard[]> {
  const cards: PhysicalCard[] = []

  for (const listEntry of lists) {
    if (listEntry.ref.type === 'deck') {
      const deckData = await importFromTextFile(listEntry.filePath).catch(() => null)
      if (!deckData) continue
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
              cardId: card.cardId,
              copyIndex: i,
              listEntry,
            })
          }
        }
      }
    } else if (listEntry.ref.type === 'collection') {
      const content = await fs.readFile(listEntry.filePath, 'utf-8').catch(() => '')
      const { entries } = parseCollectionFile(content)
      for (const entry of entries) {
        const key = `${listEntry.filePath}:${entry.cardId ?? entry.name}:0`
        cards.push({
          key,
          name: entry.name,
          set: entry.set,
          collectorNumber: entry.collectorNumber,
          finish: entry.finish,
          condition: entry.condition,
          note: entry.note,
          cardId: entry.cardId,
          listEntry,
        })
      }
    } else {
      const content = await fs.readFile(listEntry.filePath, 'utf-8').catch(() => '')
      const { entries } = parseWantedListFile(content)
      for (const entry of entries) {
        const key = `${listEntry.filePath}:${entry.cardId ?? entry.name}:0`
        cards.push({
          key,
          name: entry.name,
          set: entry.set,
          collectorNumber: entry.collectorNumber,
          finish: entry.finish,
          note: entry.note,
          cardId: entry.cardId,
          listEntry,
        })
      }
    }
  }

  return cards
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

export function applyVirtualMove(
  state: Map<string, VirtualCard>,
  physicalKey: string,
  destList: ListEntry,
): boolean {
  const vc = state.get(physicalKey)
  if (!vc) return false

  if (vc.pendingMove === null) {
    // First move: record original location
    vc.pendingMove = { originalList: vc.currentList }
  }
  // Update current (chain: keep originalList, just update currentList)
  vc.currentList = destList
  return true
}

export function getPendingMoves(state: Map<string, VirtualCard>): CommittedVirtualCard[] {
  return Array.from(state.values()).filter(
    (vc): vc is CommittedVirtualCard => vc.pendingMove !== null,
  )
}

// ── UI helpers ─────────────────────────────────────────────────────────────────

/** Truncate a string to at most maxLen characters, appending "…" if truncated. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '…'
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
    const idPart = card.cardId !== undefined ? ` &${card.cardId}` : ''

    let notePart = ''
    if (card.note) {
      // Truncate note to keep lines short (~80 chars)
      const noteMax = Math.max(20, 80 - card.name.length - printingPart.length - 20)
      notePart = ` | ${truncate(card.note, noteMax)}`
    }

    const title = `${card.name}${printingPart}${idPart} — ${listLabel}${notePart}`
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

/**
 * Commit all pending moves to disk atomically and write changelog entries.
 *
 * All files are pre-loaded into memory before any mutations. Removals are applied
 * first; additions are only applied for cards that were successfully removed.
 * All modified files are written to disk in a single pass at the end, ensuring
 * no card can be permanently lost if a later step fails.
 *
 * Returns the number of cards actually moved.
 */
export async function commitAllMoves(state: Map<string, VirtualCard>): Promise<number> {
  const pending = getPendingMoves(state)
  if (pending.length === 0) return 0

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
    const file = await loadStagedFile(listEntry.filePath, listEntry.ref.type)
    if (!file) throw new Error(`Destination file not found, aborting move: ${listEntry.filePath}`)
    staged.set(listEntry.filePath, file)
  }

  for (const { listEntry } of bySource.values()) {
    if (staged.has(listEntry.filePath)) continue
    const file = await loadStagedFile(listEntry.filePath, listEntry.ref.type)
    if (!file) throw new Error(`Source file not readable, aborting move: ${listEntry.filePath}`)
    staged.set(listEntry.filePath, file)
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
  for (const { listEntry, adds } of byDest.values()) {
    const stagedFile = staged.get(listEntry.filePath)!
    for (const vc of adds) {
      if (!removedKeys.has(vc.physicalKey)) continue
      applyAddToStaged(stagedFile, vc.card, listEntry.ref.type)
    }
  }

  // --- WRITE: All modified files to disk in a single pass ---
  for (const [filePath, stagedFile] of staged.entries()) {
    await writeStagedFile(filePath, stagedFile)
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
          cardId: vc.card.cardId,
          to: vc.currentList.ref,
        }),
      )
    if (changes.length > 0) await appendChangelog(listEntry.filePath, listEntry.ref.name, changes)
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
          cardId: vc.card.cardId,
          from: vc.card.listEntry.ref,
        }),
      )
    if (changes.length > 0) await appendChangelog(listEntry.filePath, listEntry.ref.name, changes)
  }

  return removedKeys.size
}
