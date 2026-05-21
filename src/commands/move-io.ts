import * as fs from 'node:fs/promises'
import { writeFileWithHash } from '../content-hash'
import { importFromTextFile } from '../importers/text-file'
import { formatCollectionLine } from './collection-helpers'
import { formatWantedListLine } from './wanted-helpers'
import { serializeDeckToMarkdown, parseDeckFrontMatter } from '../deck-file'
import { allocateId, collectDeckCardIds, createIdPool, allocateNextIdFromContent } from '../card-id'
import type { DeckSection, DeckData } from '../types'
import type { ListRef } from '../change-event'
import type { PhysicalCard } from './move-helpers'

export type DeckWithFrontMatter = {
  deck: DeckData
  frontMatter: Record<string, unknown>
}

type StagedDeckFile = { kind: 'deck'; data: DeckWithFrontMatter }
type StagedTextFile = { kind: 'text'; content: string }
export type StagedFile = StagedDeckFile | StagedTextFile

export async function readDeckAndFrontMatter(
  filePath: string,
): Promise<DeckWithFrontMatter | null> {
  const fm = await parseDeckFrontMatter(filePath).catch(() => null)
  if (fm === null) return null
  const deck = await importFromTextFile(filePath).catch(() => null)
  if (!deck) return null
  return { deck, frontMatter: fm }
}

/** Load a file into staged in-memory state. Returns null if the file cannot be read. */
export async function loadStagedFile(
  filePath: string,
  type: ListRef['type'],
): Promise<StagedFile | null> {
  if (type === 'deck') {
    const data = await readDeckAndFrontMatter(filePath)
    if (!data) return null
    return { kind: 'deck', data }
  }
  const content = await fs.readFile(filePath, 'utf-8').catch(() => null)
  if (content === null) return null
  return { kind: 'text', content }
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
  const targetIdx = lines.findIndex((line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) return false
    if (card.cardId !== undefined && trimmed.match(new RegExp(`&${card.cardId}\\s*$`))) return true
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
  const joined = lines.join('\n').replace(/\n{3,}/g, '\n\n')
  staged.content = joined.endsWith('\n') ? joined : joined + '\n'
  return true
}

/**
 * Apply an in-memory addition to a staged file.
 * For collection destinations, throws if the card lacks set/collectorNumber.
 */
export function applyAddToStaged(
  staged: StagedFile,
  card: PhysicalCard,
  listType: ListRef['type'],
): void {
  if (staged.kind === 'deck') {
    applyAddToDeck(staged, card)
  } else if (listType === 'collection') {
    if (!card.set || !card.collectorNumber) {
      throw new Error(`Cannot add "${card.name}" to a collection without set and collector number`)
    }
    staged.content = applyAddCollectionLine(staged.content, card)
  } else {
    staged.content = applyAddWantedLine(staged.content, card)
  }
}

function applyAddToDeck(staged: StagedDeckFile, card: PhysicalCard): void {
  const { deck } = staged.data
  const mainSection =
    deck.sections.find(
      (s) =>
        !s.name.toLowerCase().includes('commander') && !s.name.toLowerCase().includes('sideboard'),
    ) ??
    (() => {
      const s: DeckSection = { name: 'Main', cards: [] }
      deck.sections.push(s)
      return s
    })()

  const existing = mainSection.cards.find(
    (c) =>
      c.name === card.name &&
      c.set?.toLowerCase() === card.set?.toLowerCase() &&
      c.collectorNumber === card.collectorNumber,
  )

  if (existing) {
    // Quantity merge into an existing line: the incoming card's note (if any) is
    // dropped, since multiple copies share a single line and a single note slot.
    // The destination line's existing note wins.
    existing.quantity += 1
  } else {
    // Allocate from a pool seeded by the deck's existing IDs so released IDs (gaps)
    // are reused, matching the collection/wanted add paths instead of always taking
    // the next-highest number.
    const pool = createIdPool(collectDeckCardIds(deck))
    mainSection.cards.push({
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
}

function applyAddCollectionLine(content: string, card: PhysicalCard): string {
  const { nextId: cardId } = allocateNextIdFromContent(content)
  const line = formatCollectionLine(
    card.name,
    card.set!,
    card.collectorNumber!,
    card.finish ?? 'nonfoil',
    card.condition,
    card.note,
    cardId,
  )
  return content.trimEnd() + '\n' + line
}

function applyAddWantedLine(content: string, card: PhysicalCard): string {
  const { nextId: cardId } = allocateNextIdFromContent(content)
  const printing =
    card.set && card.collectorNumber
      ? { set: card.set, collectorNumber: card.collectorNumber }
      : undefined
  const line = formatWantedListLine(card.name, printing, card.finish, card.note, cardId)
  return content.trimEnd() + '\n' + line
}
