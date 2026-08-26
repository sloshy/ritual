/**
 * Deck file I/O for the interactive sessions: load (with id assignment), write,
 * locate a line, list the decks on disk.
 *
 * Not on the card-line i18n fence: `loadDeck` prints its skipped-line warnings
 * through `t()` and `listExistingDecks` sorts with `compareData` (an `i18n`
 * import either way). Parity with `flat-list-read.ts` would mean returning the
 * warnings and sorting at the caller.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { compareData } from '../i18n/collate'
import { t } from '../i18n/t'
import type { Card } from '../card/card'
import type { DeckData, DeckSection } from './deck'
import { isSamePrinting, type PrintingTuple } from '../changes/change-event'
import { getDecksDir } from '../config/ritual-config'
import { writeFileWithHash } from '../changes/content-hash'
import { parseDeckFrontMatter, serializeDeckToMarkdown, type DeckFrontMatter } from './deck-file'
import { listDeckFiles, loadDeckFile, readDeckName } from '../importers/text-file'
import { assignMissingDeckCardIds } from '../card/card-id'
import { unreadableLines } from './markdown-fence'

/**
 * Deck file I/O for the interactive sessions and the commands that share them:
 * locating a deck by name, loading it with missing card ids assigned, writing
 * it back with a fresh hash, and finding cards within it.
 */

/** A loaded deck file: its parsed structure plus the front matter needed to round-trip it. */
export type LoadedDeck = {
  deck: DeckData
  frontMatter: DeckFrontMatter
}

/** Load a deck file into structured data plus its front matter for later re-serialization. */
export async function loadDeck(filePath: string): Promise<LoadedDeck> {
  const parseResult = await loadDeckFile(filePath)
  const { deck: parsed } = parseResult
  // Parity with the flat-list sessions: a session save re-serializes the whole
  // file, so any line the parser skipped — and any fenced code block, which the
  // canonical serializer cannot emit — would be dropped by that save. Warn up
  // front rather than losing them silently.
  for (const warning of unreadableLines(parseResult)) {
    console.warn(t('cli.edit.fileWarning', { file: path.basename(filePath), warning }))
  }
  const deck = assignMissingDeckCardIds(parsed)
  const frontMatter = await parseDeckFrontMatter(filePath)
  return { deck, frontMatter }
}

/**
 * Serialize a deck (assigning any missing card IDs) and write it back to disk
 * with a fresh hash, creating the decks directory when the deck is a new one
 * whose file has never existed.
 */
export async function writeDeck(
  filePath: string,
  deck: DeckData,
  frontMatter: DeckFrontMatter,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await writeFileWithHash(filePath, serializeDeckToMarkdown(deck, frontMatter))
}

/** List the section names currently present in a deck, in file order. */
export function deckSectionNames(deck: DeckData): string[] {
  return deck.sections.map((s) => s.name)
}

/** A located deck card: the section it lives in and its assigned ID (if any). */
export type LocatedDeckCard = { section: string; cardId?: number }

/**
 * Locate a card in a deck by name and printing, preferring `preferredSection`.
 * Used to recover the card's assigned ID after applying an add/edit so it can be
 * recorded in the changelog and tracked as the "last added" card.
 */
export function findDeckCard(
  deck: DeckData,
  name: string,
  printing: PrintingTuple,
  preferredSection?: string,
): LocatedDeckCard | null {
  const sections = preferredSection
    ? [...deck.sections].sort((a, b) =>
        a.name === preferredSection ? -1 : b.name === preferredSection ? 1 : 0,
      )
    : deck.sections
  for (const section of sections) {
    const card = section.cards.find((c) => c.name === name && isSamePrinting(c, printing))
    if (card) return { section: section.name, cardId: card.cardId }
  }
  return null
}

/** A located deck card together with the section it lives in. */
export type DeckCardLocation = { section: DeckSection; card: Card }

/** Locate a deck card (with its quantity) by its card ID, across all sections. */
export function findCardById(deck: DeckData, cardId: number): DeckCardLocation | null {
  for (const section of deck.sections) {
    const card = section.cards.find((c) => c.cardId === cardId)
    if (card) return { section, card }
  }
  return null
}

/** An existing deck on disk: its display name (from front matter) and absolute file path. */
export type ExistingDeck = { name: string; file: string }

/**
 * List existing decks for the selection prompt. Each entry pairs the deck's
 * display name (the `name:` front matter field, not the file slug) with its file
 * path, sorted by display name. Mirrors how the collection/wanted pickers present
 * lists by their human-facing name.
 */
export async function listExistingDecks(): Promise<ExistingDeck[]> {
  const decksDir = getDecksDir()
  await fs.mkdir(decksDir, { recursive: true })
  const files = await listDeckFiles(decksDir)
  const decks: ExistingDeck[] = await Promise.all(
    files.map(async (f) => {
      const file = path.join(decksDir, f)
      return { name: await readDeckName(file), file }
    }),
  )
  // Pinned English rather than `compareDisplay`: the deck picker's order is what
  // the CLI integration tests assert on, and a developer with a non-English host
  // locale must see the same ordering CI does.
  return decks.sort((a, b) => compareData(a.name, b.name))
}
