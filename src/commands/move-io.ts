import * as fs from 'node:fs/promises'
import { writeFileWithHash } from '../content-hash'
import { findOrCreateSection, resolveDefaultAddSection } from '../deck-format'
import { loadDeckFile } from '../importers/text-file'
import { formatCollectionLine } from './collection-helpers'
import { formatWantedListLine } from './wanted-helpers'
import { serializeDeckToMarkdown, parseDeckFrontMatter } from '../deck-file'
import { allocateId, collectDeckCardIds, createIdPool, allocateNextIdFromContent } from '../card-id'
import {
  endsInsideOpenFence,
  markFencedLines,
  unreadableContentMessage,
  unreadableLines,
} from '../markdown-fence'
import type { DeckData } from '../types'
import type { ListRef } from '../change-event'
import type { PhysicalCard } from './move-helpers'

export type DeckWithFrontMatter = {
  deck: DeckData
  frontMatter: Record<string, unknown>
}

type StagedDeckFile = { kind: 'deck'; data: DeckWithFrontMatter }
type StagedTextFile = { kind: 'text'; content: string }
export type StagedFile = StagedDeckFile | StagedTextFile

/**
 * The outcome of staging a file for a move: the staged state, or the reason the
 * move must not touch this file at all.
 */
export type LoadStagedResult =
  | { ok: true; file: StagedFile }
  | { ok: false; reason: 'unreadable-file' | 'unreadable-lines'; message: string }

export async function readDeckAndFrontMatter(
  filePath: string,
): Promise<DeckWithFrontMatter | null> {
  const result = await loadStagedDeck(filePath)
  return result.ok && result.file.kind === 'deck' ? result.file.data : null
}

async function loadStagedDeck(filePath: string): Promise<LoadStagedResult> {
  const fm = await parseDeckFrontMatter(filePath).catch(() => null)
  const parsed = await loadDeckFile(filePath).catch(() => null)
  if (fm === null || parsed === null) {
    return { ok: false, reason: 'unreadable-file', message: `Cannot read deck file: ${filePath}` }
  }
  // A deck side of a move is written back by re-serializing the whole file, so
  // anything the parse could not carry — a skipped line, a fenced code block —
  // would be deleted by the write. Refuse the move instead.
  const lost = unreadableLines(parsed)
  if (lost.length > 0) {
    return {
      ok: false,
      reason: 'unreadable-lines',
      message: unreadableContentMessage(filePath, lost, 'moving'),
    }
  }
  return { ok: true, file: { kind: 'deck', data: { deck: parsed.deck, frontMatter: fm } } }
}

/** Load a file into staged in-memory state. */
export async function loadStagedFile(
  filePath: string,
  type: ListRef['type'],
): Promise<LoadStagedResult> {
  if (type === 'deck') return loadStagedDeck(filePath)
  const content = await fs.readFile(filePath, 'utf-8').catch(() => null)
  if (content === null) {
    return { ok: false, reason: 'unreadable-file', message: `Cannot read file: ${filePath}` }
  }
  return { ok: true, file: { kind: 'text', content } }
}

/** Write a staged file back to disk. */
export async function writeStagedFile(filePath: string, staged: StagedFile): Promise<void> {
  if (staged.kind === 'deck') {
    const content = serializeDeckToMarkdown(staged.data.deck, staged.data.frontMatter)
    await writeFileWithHash(filePath, content)
  } else {
    await writeFileWithHash(filePath, staged.content)
  }
}

/**
 * Apply an in-memory removal to a staged file.
 * Returns true if the card was found and removed.
 *
 * For text files, also matches set/collectorNumber in the name-based fallback
 * to avoid removing the wrong card when duplicate names exist.
 */
export function applyRemoveFromStaged(staged: StagedFile, card: PhysicalCard): boolean {
  if (staged.kind === 'deck') {
    return applyRemoveFromDeck(staged, card)
  }
  return applyRemoveFromText(staged, card)
}

function applyRemoveFromDeck(staged: StagedDeckFile, card: PhysicalCard): boolean {
  const { deck } = staged.data
  for (const section of deck.sections) {
    const idx =
      card.cardId !== undefined
        ? section.cards.findIndex((c) => c.cardId === card.cardId)
        : section.cards.findIndex(
            (c) =>
              c.name === card.name &&
              (card.set === undefined || c.set?.toLowerCase() === card.set.toLowerCase()) &&
              (card.collectorNumber === undefined || c.collectorNumber === card.collectorNumber),
          )
    if (idx !== -1) {
      const c = section.cards[idx]!
      c.quantity -= 1
      if (c.quantity <= 0) section.cards.splice(idx, 1)
      deck.sections = deck.sections.filter((s) => s.cards.length > 0)
      return true
    }
  }
  return false
}

function applyRemoveFromText(staged: StagedTextFile, card: PhysicalCard): boolean {
  const lines = staged.content.split('\n')
  // A bullet inside a fenced code block is the user's prose example, never a
  // card a move may take out of the file.
  const fenced = markFencedLines(lines)
  const targetIdx = lines.findIndex((line, idx) => {
    if (fenced[idx]) return false
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) return false
    // An ID is authoritative (mirrors the deck removal path): falling through
    // to the name match on an ID miss could remove a sibling line that shares
    // the printing but differs in finish or condition.
    if (card.cardId !== undefined) {
      return new RegExp(`&${card.cardId}\\s*$`).test(trimmed)
    }
    // Fallback: match by name, also using set/collectorNumber when available
    const nameMatch = trimmed.match(/^- (.+?)(?:\s[([{&]|$)/)
    if (nameMatch?.[1] !== card.name) return false
    if (card.set !== undefined && card.collectorNumber !== undefined) {
      const setMatch = trimmed.match(/\(([^:]+):([^)]+)\)/)
      if (setMatch) {
        return (
          setMatch[1]?.toLowerCase() === card.set.toLowerCase() &&
          setMatch[2] === card.collectorNumber
        )
      }
    }
    return true
  })
  if (targetIdx === -1) return false
  lines.splice(targetIdx, 1)
  staged.content = collapseBlankRuns(lines)
  return true
}

/**
 * Join lines back into content, collapsing runs of blank lines left behind by
 * the removal — but only outside fenced code blocks, whose blank lines are the
 * user's snippet and must survive byte-for-byte.
 */
function collapseBlankRuns(lines: readonly string[]): string {
  const fenced = markFencedLines(lines)
  // Split into runs of same-fencedness, collapse only within the unfenced ones,
  // then rejoin — the run boundaries reproduce the original newlines exactly.
  const chunks: string[] = []
  let i = 0
  while (i < lines.length) {
    const isFenced = fenced[i]!
    const start = i
    while (i < lines.length && fenced[i] === isFenced) i++
    const text = lines.slice(start, i).join('\n')
    chunks.push(isFenced ? text : text.replace(/\n{3,}/g, '\n\n'))
  }
  const joined = chunks.join('\n')
  return joined.endsWith('\n') ? joined : joined + '\n'
}

/**
 * A note discarded by a deck quantity-merge: the incoming card carried a note,
 * but it merged onto an existing line whose single note slot already holds a
 * different value (or none). Reported rather than merged — merging would
 * fabricate text and could not round-trip through changelogs.
 */
export type DroppedNote = {
  cardName: string
  /** The incoming card's ID in its source list, when it has one. */
  cardId?: number
  note: string
}

/**
 * Apply an in-memory addition to a staged file.
 * For collection destinations, throws if the card lacks set/collectorNumber.
 *
 * `section` (deck destinations only) targets the named deck section by exact
 * name match, creating it when missing; when omitted, the default section is
 * used (first non-commander/sideboard section, creating `Main` if none).
 *
 * Returns a {@link DroppedNote} when a deck quantity-merge discarded the
 * incoming card's note, undefined otherwise.
 */
export function applyAddToStaged(
  staged: StagedFile,
  card: PhysicalCard,
  listType: ListRef['type'],
  section?: string,
): DroppedNote | undefined {
  if (staged.kind === 'deck') {
    return applyAddToDeck(staged, card, section)
  }
  if (listType === 'collection') {
    if (!card.set || !card.collectorNumber) {
      throw new Error(`Cannot add "${card.name}" to a collection without set and collector number`)
    }
    staged.content = applyAddCollectionLine(staged.content, card)
  } else {
    staged.content = applyAddWantedLine(staged.content, card)
  }
  return undefined
}

function applyAddToDeck(
  staged: StagedDeckFile,
  card: PhysicalCard,
  section?: string,
): DroppedNote | undefined {
  const { deck } = staged.data
  const targetSection =
    section !== undefined
      ? findOrCreateSection(deck.sections, section)
      : resolveDefaultAddSection(deck.sections)

  const existing = targetSection.cards.find(
    (c) =>
      c.name === card.name &&
      c.set?.toLowerCase() === card.set?.toLowerCase() &&
      c.collectorNumber === card.collectorNumber,
  )

  if (existing) {
    // Quantity merge into an existing line: multiple copies share a single line
    // and a single note slot, so the destination line's existing note wins. An
    // incoming note not already on the line is discarded — reported so callers
    // can surface the loss.
    existing.quantity += 1
    if (card.note && card.note !== existing.note) {
      return { cardName: card.name, cardId: card.cardId, note: card.note }
    }
  } else {
    // Allocate from a pool seeded by the deck's existing IDs so released IDs (gaps)
    // are reused, matching the collection/wanted add paths instead of always taking
    // the next-highest number.
    const pool = createIdPool(collectDeckCardIds(deck))
    targetSection.cards.push({
      quantity: 1,
      name: card.name,
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: card.finish,
      condition: card.condition,
      note: card.note,
      cardId: allocateId(pool),
    })
  }
  return undefined
}

/**
 * Refuse to append when the file ends inside an unclosed fence: the appended
 * card line would land in the opaque region, so it would be written, reported,
 * and logged — and then be invisible to every subsequent parse.
 */
function assertAppendable(content: string, cardName: string): void {
  if (endsInsideOpenFence(content)) {
    throw new Error(
      `Cannot add "${cardName}": the destination file ends inside an unclosed code fence, ` +
        `so the new card line would be read as prose. Close the fence first.`,
    )
  }
}

function applyAddCollectionLine(content: string, card: PhysicalCard): string {
  assertAppendable(content, card.name)
  const { nextId: cardId } = allocateNextIdFromContent(content)
  const line = formatCollectionLine(
    card.name,
    card.set!,
    card.collectorNumber!,
    card.finish ?? 'nonfoil',
    card.condition,
    card.labels,
    card.note,
    cardId,
  )
  return content.trimEnd() + '\n' + line
}

function applyAddWantedLine(content: string, card: PhysicalCard): string {
  assertAppendable(content, card.name)
  const { nextId: cardId } = allocateNextIdFromContent(content)
  const printing =
    card.set && card.collectorNumber
      ? { set: card.set, collectorNumber: card.collectorNumber }
      : undefined
  const line = formatWantedListLine(card.name, printing, card.finish, card.note, cardId)
  return content.trimEnd() + '\n' + line
}
