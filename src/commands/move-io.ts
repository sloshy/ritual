import * as fs from 'node:fs/promises'
import { writeFileWithHash } from '../content-hash'
import { findOrCreateSection, resolveDefaultAddSection } from '../deck-format'
import { loadDeckFile } from '../importers/text-file'
import { formatCollectionLine } from './collection-helpers'
import { formatWantedListLine } from './wanted-helpers'
import { serializeDeckToMarkdown, parseDeckFrontMatter } from '../deck-file'
import {
  allocateId,
  allocateNextIdFromContent,
  collectDeckCardIds,
  createIdPool,
  parseCardIdsFromContent,
} from '../card-id'
import {
  endsInsideOpenFence,
  markFencedLines,
  unreadableContentMessage,
  unreadableLines,
} from '../markdown-fence'
import type { DeckData } from '../types'
import type { ListRef } from '../change-event'
import { t } from '../i18n/t'
import type { PhysicalCard } from './move-helpers'
import {
  normalizedOverride,
  sameCardLabels,
  supportedLabelsFor,
  type CardLabel,
} from '../card-labels'
import type { ListType } from '../list-type'

/**
 * The part of a moved card's label override the destination type can carry, or
 * `undefined` when nothing of it survives. A move never *invents* a label and
 * never writes one the destination grammar cannot express.
 */
function labelsForDestination(
  type: ListType,
  labels: readonly CardLabel[] | undefined,
): CardLabel[] | undefined {
  if (!labels || labels.length === 0) return undefined
  return normalizedOverride(supportedLabelsFor(type, labels))
}

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
    return {
      ok: false,
      reason: 'unreadable-file',
      message: t('cli.move.cannotReadDeck', { file: filePath }),
    }
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
    return {
      ok: false,
      reason: 'unreadable-file',
      message: t('cli.move.cannotReadFile', { file: filePath }),
    }
  }
  return { ok: true, file: { kind: 'text', content } }
}

/**
 * Every `&N` the staged file still carries.
 *
 * What a caller reconciling the list's art sidecar checks against: a deck
 * removal decrements a line's quantity and only deletes the line at zero, so
 * "the card was removed" and "the id is gone" are different questions, and only
 * the second one releases the id to the reuse pool.
 *
 * Flat lists are scanned with `parseCardIdsFromContent`, the same reader
 * `allocateNextIdFromContent` allocates against — so this answer and the
 * allocator's cannot disagree about whether an id inside front matter or a
 * fenced example is taken.
 */
export function stagedCardIds(staged: StagedFile): Set<number> {
  if (staged.kind === 'deck') return new Set(collectDeckCardIds(staged.data.deck))
  return new Set(parseCardIdsFromContent(staged.content))
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
 * What one staged addition did, beyond mutating the file.
 *
 * `cardId` is the whole reason this is a record rather than a bare dropped
 * note: the destination allocates a fresh `&N`, and a caller carrying per-card
 * sidecar data across the move (custom art) has no other way to learn it.
 */
export type StagedAddResult = {
  /**
   * The `&N` the card's line carries in the destination. Absent only when the
   * copy merged onto a deck line that has no id of its own — a hand edit the
   * backfill has not been through yet, whose id the write assigns.
   */
  cardId?: number
  /** True when the copy landed on a line the destination already had. */
  merged: boolean
  /** Set when a deck quantity-merge discarded the incoming card's note. */
  droppedNote?: DroppedNote
}

/**
 * The destination `&N` a moved card's per-line sidecar data (its custom art)
 * should follow onto, or `undefined` when nothing should follow.
 *
 * A quantity merge lands on a line that already stands for the card and may
 * carry art of its own; only a line this move created adopts the incoming
 * reference. Written once here, beside the result it interrogates, so the two
 * move engines cannot state the rule in opposite polarities and drift.
 */
export function adoptedCardId(added: StagedAddResult): number | undefined {
  return added.merged ? undefined : added.cardId
}

/**
 * Apply an in-memory addition to a staged file.
 * For collection destinations, throws if the card lacks set/collectorNumber.
 *
 * `section` (deck destinations only) targets the named deck section by exact
 * name match, creating it when missing; when omitted, the default section is
 * used (first non-commander/sideboard section, creating `Main` if none).
 */
export function applyAddToStaged(
  staged: StagedFile,
  card: PhysicalCard,
  listType: ListRef['type'],
  section?: string,
): StagedAddResult {
  if (staged.kind === 'deck') {
    return applyAddToDeck(staged, card, section)
  }
  if (listType === 'collection') {
    if (!card.set || !card.collectorNumber) {
      throw new Error(t('cli.move.collectionNeedsPrinting', { name: card.name }))
    }
    const added = applyAddCollectionLine(staged.content, card)
    staged.content = added.content
    return { cardId: added.cardId, merged: false }
  }
  const added = applyAddWantedLine(staged.content, card)
  staged.content = added.content
  return { cardId: added.cardId, merged: false }
}

function applyAddToDeck(
  staged: StagedDeckFile,
  card: PhysicalCard,
  section?: string,
): StagedAddResult {
  const { deck } = staged.data
  const targetSection =
    section !== undefined
      ? findOrCreateSection(deck.sections, section)
      : resolveDefaultAddSection(deck.sections)

  // What the moved card's override becomes here, which is what a merge target
  // must match: a `sale` copy arriving from a collection carries no override
  // into a deck, so it belongs on the plain line, not beside it.
  const labels = labelsForDestination('deck', card.labels)
  const existing = targetSection.cards.find(
    (c) =>
      c.name === card.name &&
      c.set?.toLowerCase() === card.set?.toLowerCase() &&
      c.collectorNumber === card.collectorNumber &&
      // Language distinguishes variants like the printing does: a `[ja]` copy
      // must never merge onto (or absorb) an English line.
      (c.language ?? 'en') === (card.language ?? 'en') &&
      // Labels distinguish them the same way: merging a proxy into the line
      // holding real copies would either lose the `[proxy]` or spread it.
      sameCardLabels(c.labels, labels),
  )

  if (existing) {
    // Quantity merge into an existing line: multiple copies share a single line
    // and a single note slot, so the destination line's existing note wins. An
    // incoming note not already on the line is discarded — reported so callers
    // can surface the loss.
    existing.quantity += 1
    const droppedNote: DroppedNote | undefined =
      card.note && card.note !== existing.note
        ? { cardName: card.name, cardId: card.cardId, note: card.note }
        : undefined
    return { cardId: existing.cardId, merged: true, droppedNote }
  }
  // Allocate from a pool seeded by the deck's existing IDs so released IDs (gaps)
  // are reused, matching the collection/wanted add paths instead of always taking
  // the next-highest number.
  const pool = createIdPool(collectDeckCardIds(deck))
  const cardId = allocateId(pool)
  targetSection.cards.push({
    quantity: 1,
    name: card.name,
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
    language: card.language,
    // Only what a deck line can express survives the move: a `proxy` copy
    // stays a proxy, a `sale` override is dropped rather than written into a
    // grammar that has no room for it.
    labels,
    note: card.note,
    cardId,
  })
  return { cardId, merged: false }
}

/**
 * Refuse to append when the file ends inside an unclosed fence: the appended
 * card line would land in the opaque region, so it would be written, reported,
 * and logged — and then be invisible to every subsequent parse.
 */
function assertAppendable(content: string, cardName: string): void {
  if (endsInsideOpenFence(content)) {
    throw new Error(t('cli.move.appendIntoOpenFence', { name: cardName }))
  }
}

/** A flat-list line appended, with the `&N` it was given. */
type AppendedLine = { content: string; cardId: number }

function applyAddCollectionLine(content: string, card: PhysicalCard): AppendedLine {
  assertAppendable(content, card.name)
  const { nextId: cardId } = allocateNextIdFromContent(content)
  const line = formatCollectionLine({
    cardName: card.name,
    set: card.set!,
    collectorNumber: card.collectorNumber!,
    finish: card.finish ?? 'nonfoil',
    condition: card.condition,
    language: card.language,
    labels: labelsForDestination('collection', card.labels),
    note: card.note,
    cardId,
  })
  return { content: content.trimEnd() + '\n' + line, cardId }
}

function applyAddWantedLine(content: string, card: PhysicalCard): AppendedLine {
  assertAppendable(content, card.name)
  const { nextId: cardId } = allocateNextIdFromContent(content)
  const printing =
    card.set && card.collectorNumber
      ? { set: card.set, collectorNumber: card.collectorNumber }
      : undefined
  const line = formatWantedListLine({
    name: card.name,
    printing,
    finish: card.finish,
    language: card.language,
    note: card.note,
    cardId,
  })
  return { content: content.trimEnd() + '\n' + line, cardId }
}
