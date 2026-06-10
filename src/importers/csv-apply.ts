import * as fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { BOARDS, type Board, type Card, type DeckData, type DeckSection } from '../types'
import type { ListType } from '../list-type'
import type { DeckFormatKey } from '../deck-format'
import type { CsvCardEntry } from './csv'
import { parseDeckText } from './text-file'
import { serializeDeckToMarkdown } from '../deck-file'
import { parseCollectionFile, type CollectionEntry } from '../commands/price-collection'
import { parseWantedListFile, type WantedListEntry } from '../commands/wanted-helpers'
import { formatCollectionLine, formatWantedListLine } from '../card-line'
import { parseTitleFromContent, serializeSectionedList } from '../section-format'
import {
  allocateId,
  collectDeckCardIds,
  collectExistingIds,
  createIdPool,
  type CardIdPool,
} from '../card-id'
import { writeFileWithHash } from '../content-hash'
import { createAddChange, isSamePrinting, type ChangeEvent } from '../change-event'
import { appendChangelog } from '../changelog-writer'
import {
  dirForType,
  formatResolveListError,
  isResolveListError,
  resolveList,
} from '../resolve-list'
import { sanitizeDeckFileName } from '../utils'

/**
 * Applies converted CSV entries to a list on disk: creating a new list file,
 * overwriting one, or appending to an existing one. Shared by the `import-csv`
 * CLI command and the admin `/api/import-csv` route (and through it the MCP
 * server), so every surface imports CSVs identically.
 */

export type CsvImportMode = 'create' | 'overwrite' | 'append'

export type CsvImportTarget = {
  listType: ListType
  /** List name: the new list's name for create/overwrite, an existing list for append. */
  name: string
  mode: CsvImportMode
  /** Deck format. Required when creating or overwriting a deck; unused otherwise. */
  format?: DeckFormatKey
}

export type CsvImportSuccess = {
  filePath: string
  /** Total copies imported (sum of row quantities). */
  cardCount: number
  mode: CsvImportMode
  /** The changelog written for an append; absent for create/overwrite. */
  changelogPath?: string
}

export type CsvImportError = { error: string }

export type CsvImportOutcome = CsvImportSuccess | CsvImportError

function totalCards(entries: CsvCardEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.quantity, 0)
}

// ── Create / overwrite ──────────────────────────────────────────────

function buildDeckMarkdown(name: string, format: DeckFormatKey, entries: CsvCardEntry[]): string {
  const sectionsByName = new Map<string, Card[]>()
  for (const entry of entries) {
    const card: Card = {
      quantity: entry.quantity,
      name: entry.name,
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
    }
    const cards = sectionsByName.get(entry.section)
    if (cards) cards.push(card)
    else sectionsByName.set(entry.section, [card])
  }
  const sections: DeckSection[] = [...sectionsByName.entries()].map(([sectionName, cards]) => ({
    name: sectionName,
    cards,
  }))
  const deck: DeckData = { name, format, sections }
  return serializeDeckToMarkdown(deck, {
    name,
    format,
    created: new Date().toISOString(),
    tags: [],
  })
}

/** The list types that store flat per-copy bullet lines (everything but decks). */
type FlatListType = Exclude<ListType, 'deck'>

type FlatCopy = CsvCardEntry & { cardId: number }

/** A pre-existing entry parsed from the target list during an append. */
type FlatEntry = (CollectionEntry | WantedListEntry) & { cardId?: number }

/** A re-serialized list body plus the change events describing what was added. */
type AppendResult = { content: string; changes: ChangeEvent[] }

/** Expand entries into per-copy lines (flat lists store one line per physical card). */
function expandCopies(entries: CsvCardEntry[], pool: CardIdPool): FlatCopy[] {
  const copies: FlatCopy[] = []
  for (const entry of entries) {
    for (let i = 0; i < entry.quantity; i++) {
      copies.push({ ...entry, quantity: 1, cardId: allocateId(pool) })
    }
  }
  return copies
}

function formatCopyLine(listType: FlatListType, copy: FlatCopy): string {
  if (listType === 'collection') {
    return formatCollectionLine(
      copy.name,
      copy.set ?? '',
      copy.collectorNumber ?? '',
      copy.finish ?? 'nonfoil',
      copy.condition,
      undefined,
      copy.cardId,
    )
  }
  return formatWantedListLine(
    copy.name,
    copy.set && copy.collectorNumber
      ? { set: copy.set, collectorNumber: copy.collectorNumber }
      : undefined,
    copy.finish,
    undefined,
    copy.cardId,
  )
}

function buildFlatListMarkdown(
  listType: FlatListType,
  name: string,
  entries: CsvCardEntry[],
): string {
  const copies = expandCopies(entries, createIdPool([]))
  const sectionOrder: string[] = []
  for (const copy of copies) {
    if (!sectionOrder.includes(copy.section)) sectionOrder.push(copy.section)
  }
  return serializeSectionedList(name, copies, sectionOrder, (copy) =>
    formatCopyLine(listType, copy),
  )
}

async function createList(
  target: CsvImportTarget,
  entries: CsvCardEntry[],
): Promise<CsvImportOutcome> {
  const safeName = sanitizeDeckFileName(target.name)
  if (safeName === '') {
    return { error: `List name '${target.name}' contains no usable filename characters` }
  }
  const targetDir = dirForType(target.listType)
  const filePath = path.join(targetDir, `${safeName}.md`)

  if (target.mode === 'create' && (await Bun.file(filePath).exists())) {
    return {
      error: `File already exists: ${filePath}. Use overwrite or append mode to change it.`,
    }
  }

  let content: string
  if (target.listType === 'deck') {
    if (target.format === undefined) {
      return { error: 'Creating a deck from CSV requires a format' }
    }
    content = buildDeckMarkdown(target.name, target.format, entries)
  } else {
    content = buildFlatListMarkdown(target.listType, target.name, entries)
  }

  await fs.mkdir(targetDir, { recursive: true })
  await writeFileWithHash(filePath, content)
  return { filePath, cardCount: totalCards(entries), mode: target.mode }
}

// ── Append ──────────────────────────────────────────────────────────

/** The Board value for a section name, when it is one of the canonical boards. */
function boardForSection(section: string): Board | undefined {
  return BOARDS.find((board) => board === section)
}

function appendToDeck(
  content: string,
  fallbackName: string,
  entries: CsvCardEntry[],
): AppendResult {
  const deck = parseDeckText(content, fallbackName)
  const frontMatter = matter(content).data
  const pool = createIdPool(collectDeckCardIds(deck))
  const changes: ChangeEvent[] = []

  for (const entry of entries) {
    let section = deck.sections.find((s) => s.name === entry.section)
    if (!section) {
      section = { name: entry.section, cards: [] }
      deck.sections.push(section)
    }
    const existing = section.cards.find(
      (card) => card.name.toLowerCase() === entry.name.toLowerCase() && isSamePrinting(card, entry),
    )
    let cardId: number | undefined
    if (existing) {
      existing.quantity += entry.quantity
      cardId = existing.cardId
    } else {
      cardId = allocateId(pool)
      section.cards.push({
        quantity: entry.quantity,
        name: entry.name,
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        condition: entry.condition,
        cardId,
      })
    }
    // One change per row (quantities merge into a single deck line).
    changes.push(
      createAddChange(entry.name, {
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        condition: entry.condition,
        section: entry.section,
        board: boardForSection(entry.section),
        cardId,
      }),
    )
  }

  return { content: serializeDeckToMarkdown(deck, frontMatter), changes }
}

function appendToFlatList(
  listType: FlatListType,
  content: string,
  fallbackTitle: string,
  entries: CsvCardEntry[],
): AppendResult {
  let existing: FlatEntry[]
  let sectionOrder: string[]
  if (listType === 'collection') {
    const parsed = parseCollectionFile(content)
    existing = parsed.entries
    sectionOrder = parsed.sectionOrder
  } else {
    const parsed = parseWantedListFile(content)
    existing = parsed.entries
    sectionOrder = parsed.sectionOrder
  }

  const pool = createIdPool(collectExistingIds(existing))
  const copies = expandCopies(entries, pool)
  const changes: ChangeEvent[] = copies.map((copy) =>
    createAddChange(copy.name, {
      set: copy.set,
      collectorNumber: copy.collectorNumber,
      finish: copy.finish,
      condition: listType === 'collection' ? copy.condition : undefined,
      section: copy.section,
      cardId: copy.cardId,
    }),
  )

  const title = parseTitleFromContent(content) ?? fallbackTitle
  const formatLine = (entry: FlatEntry | FlatCopy): string => {
    // CSV entries carry no note; only pre-existing parsed entries can have one.
    const note = 'note' in entry ? entry.note : undefined
    if (listType === 'collection') {
      return formatCollectionLine(
        entry.name,
        entry.set ?? '',
        entry.collectorNumber ?? '',
        entry.finish ?? 'nonfoil',
        'condition' in entry ? entry.condition : undefined,
        note,
        entry.cardId,
      )
    }
    return formatWantedListLine(
      entry.name,
      entry.set && entry.collectorNumber
        ? { set: entry.set, collectorNumber: entry.collectorNumber }
        : undefined,
      entry.finish,
      note,
      entry.cardId,
    )
  }
  const all: (FlatEntry | FlatCopy)[] = [...existing, ...copies]
  return { content: serializeSectionedList(title, all, sectionOrder, formatLine), changes }
}

async function appendToList(
  target: CsvImportTarget,
  entries: CsvCardEntry[],
): Promise<CsvImportOutcome> {
  const location = await resolveList(target.name, target.listType)
  if (isResolveListError(location)) {
    return { error: formatResolveListError(location) }
  }

  const content = await Bun.file(location.filePath).text()
  const result =
    target.listType === 'deck'
      ? appendToDeck(content, location.name, entries)
      : appendToFlatList(target.listType, content, location.name, entries)

  await writeFileWithHash(location.filePath, result.content)
  const changelogPath = await appendChangelog(location.filePath, location.name, result.changes)

  return {
    filePath: location.filePath,
    cardCount: totalCards(entries),
    mode: 'append',
    changelogPath,
  }
}

/**
 * Apply converted CSV entries to the target list. Create mode refuses to
 * replace an existing file; overwrite replaces it; append requires an existing
 * list (resolved like every other list-name lookup) and records the added
 * cards in the list's changelog.
 */
export async function applyCsvImport(
  target: CsvImportTarget,
  entries: CsvCardEntry[],
): Promise<CsvImportOutcome> {
  if (target.mode === 'append') {
    return appendToList(target, entries)
  }
  return createList(target, entries)
}
