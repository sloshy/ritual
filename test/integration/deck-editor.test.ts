import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setBaseDir } from '../../src/base-dir'
import { resetRitualConfigCache } from '../../src/ritual-config'
import {
  ensureDeckFile,
  loadDeck,
  writeDeck,
  findDeckCard,
  deckSectionNames,
  listExistingDecks,
} from '../../src/commands/deck-helpers'
import { applyChangeToDeck } from '../../src/editor/deck-changes'
import { assignMissingDeckCardIds } from '../../src/card-id'
import { createAddChange } from '../../src/change-event'
import type { DeckData } from '../../src/types'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-deck-editor-'))
  await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
  await fs.writeFile(path.join(dir, 'ritual.config.json'), JSON.stringify({ decksDir: './decks' }))
  setBaseDir(dir)
  resetRitualConfigCache()
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** Reproduces the command's per-card mutation: apply an add, reassign IDs, persist. */
async function addCardToDeck(
  filePath: string,
  deck: DeckData,
  frontMatter: Record<string, unknown>,
  name: string,
  section: string,
  printing?: { set: string; collectorNumber: string },
): Promise<DeckData> {
  const next = assignMissingDeckCardIds(
    applyChangeToDeck(deck, createAddChange(name, { ...printing, section })),
  )
  await writeDeck(filePath, next, frontMatter)
  return next
}

describe('deck editor helpers (Integration)', () => {
  test('ensureDeckFile creates a slugged file with display name front matter', async () => {
    const filePath = await ensureDeckFile('My Cool Deck')
    expect(filePath).toBe(path.join(dir, 'decks', 'my-cool-deck.md'))
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('name: "My Cool Deck"')
  })

  test('ensureDeckFile is idempotent and does not clobber an existing deck', async () => {
    const filePath = await ensureDeckFile('Keeper')
    const { deck, frontMatter } = await loadDeck(filePath)
    await addCardToDeck(filePath, deck, frontMatter, 'Sol Ring', 'Main', {
      set: 'ltc',
      collectorNumber: '284',
    })
    // A second ensureDeckFile must reuse the file, leaving the added card intact.
    const again = await ensureDeckFile('Keeper')
    expect(again).toBe(filePath)
    const reloaded = await loadDeck(filePath)
    expect(reloaded.deck.sections.flatMap((s) => s.cards).map((c) => c.name)).toContain('Sol Ring')
  })

  test('adds a card to a named section, creating the section and assigning an ID', async () => {
    const filePath = await ensureDeckFile('Lands Deck')
    const { deck, frontMatter } = await loadDeck(filePath)
    await addCardToDeck(filePath, deck, frontMatter, 'Lightning Bolt', 'Burn', {
      set: 'lea',
      collectorNumber: '161',
    })

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('## Burn')
    // Set codes are uppercased on write; the first card in a fresh deck gets ID 1.
    expect(content).toMatch(/^1 Lightning Bolt \(LEA:161\) &1$/m)

    const reloaded = await loadDeck(filePath)
    expect(deckSectionNames(reloaded.deck)).toContain('Burn')
    const located = findDeckCard(reloaded.deck, 'Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
    })
    expect(located?.section).toBe('Burn')
    expect(located?.cardId).toBeGreaterThan(0)
  })

  test('a second copy of the same printing increments quantity, keeping one line and its ID', async () => {
    const filePath = await ensureDeckFile('Aggro')
    const { deck: loadedDeck, frontMatter } = await loadDeck(filePath)
    const deck = await addCardToDeck(filePath, loadedDeck, frontMatter, 'Goblin Guide', 'Main', {
      set: 'zen',
      collectorNumber: '120',
    })
    const firstId = findDeckCard(deck, 'Goblin Guide', {
      set: 'zen',
      collectorNumber: '120',
    })?.cardId
    // Guard the precondition so the ID-preservation assertion below can't pass trivially
    // (a null lookup would make both sides undefined).
    expect(firstId).toBeGreaterThan(0)

    await addCardToDeck(filePath, deck, frontMatter, 'Goblin Guide', 'Main', {
      set: 'zen',
      collectorNumber: '120',
    })

    const reloaded = await loadDeck(filePath)
    const goblins = reloaded.deck.sections
      .flatMap((s) => s.cards)
      .filter((c) => c.name === 'Goblin Guide')
    expect(goblins).toHaveLength(1)
    expect(goblins[0]?.quantity).toBe(2)
    // Incrementing quantity preserves the original card ID rather than allocating a new one.
    expect(goblins[0]?.cardId).toBe(firstId)
  })

  test('re-adding the same printing merges into the existing entry regardless of target section', async () => {
    const filePath = await ensureDeckFile('Toolbox')
    const { deck: loadedDeck, frontMatter } = await loadDeck(filePath)
    const deck = await addCardToDeck(
      filePath,
      loadedDeck,
      frontMatter,
      'Swords to Plowshares',
      'Main',
      {
        set: 'lea',
        collectorNumber: '37',
      },
    )
    // Targeting a different section with the same printing increments the existing
    // entry (the deck reducer merges by name+printing, matching the admin editor).
    await addCardToDeck(filePath, deck, frontMatter, 'Swords to Plowshares', 'Sideboard', {
      set: 'lea',
      collectorNumber: '37',
    })

    const reloaded = await loadDeck(filePath)
    const swords = reloaded.deck.sections
      .flatMap((s) => s.cards)
      .filter((c) => c.name === 'Swords to Plowshares')
    expect(swords).toHaveLength(1)
    expect(swords[0]?.quantity).toBe(2)
  })

  test('listExistingDecks reports display names (not file slugs), sorted by name', async () => {
    // Slugged file names diverge from their front-matter display names.
    await ensureDeckFile('Zephyr Tempo')
    await ensureDeckFile('Atraxa Superfriends')
    // A deck file with no `name:` front matter falls back to its file base name.
    await fs.writeFile(path.join(dir, 'decks', 'orphan-deck.md'), '## Main\n')

    const decks = await listExistingDecks()
    expect(decks.map((d) => d.name)).toEqual(['Atraxa Superfriends', 'orphan-deck', 'Zephyr Tempo'])
    // The paired file path resolves to the slugged file, not the display name.
    const atraxa = decks.find((d) => d.name === 'Atraxa Superfriends')
    expect(atraxa?.file).toBe(path.join(dir, 'decks', 'atraxa-superfriends.md'))
  })

  test('a different printing of the same card is kept as its own entry', async () => {
    const filePath = await ensureDeckFile('Reprints')
    const { deck: loadedDeck, frontMatter } = await loadDeck(filePath)
    const deck = await addCardToDeck(filePath, loadedDeck, frontMatter, 'Counterspell', 'Main', {
      set: 'lea',
      collectorNumber: '54',
    })
    await addCardToDeck(filePath, deck, frontMatter, 'Counterspell', 'Main', {
      set: 'mh2',
      collectorNumber: '267',
    })

    const reloaded = await loadDeck(filePath)
    const counters = reloaded.deck.sections
      .flatMap((s) => s.cards)
      .filter((c) => c.name === 'Counterspell')
    // Distinct printings are independent entries with distinct IDs.
    expect(counters).toHaveLength(2)
    expect(new Set(counters.map((c) => c.cardId)).size).toBe(2)
  })
})
