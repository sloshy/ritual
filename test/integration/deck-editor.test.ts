import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureDeckFile } from '../../src/list/ensure-list-file'
import {
  loadDeck,
  writeDeck,
  findDeckCard,
  deckSectionNames,
  listExistingDecks,
} from '../../src/list/deck-io'
import { applyChangeToDeck } from '../../src/changes/deck-changes'
import { assignMissingDeckCardIds } from '../../src/card/card-id'
import { createAddChange } from '../../src/changes/change-event'
import type { DeckData } from '../../src/list/deck'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import prompts from 'prompts'
import { createDeckStrategy } from '../../src/commands/session/deck-strategy'
import { buildInitialSessionConfig } from '../../src/commands/session/config'
import { createCardSessionContext } from '../../src/commands/session/strategy'
import { loadCardCategories, saveCardCategories } from '../../src/list/card-categories-sidecar'
import { categoriesOf, categoriesRecord } from '../helpers/card-categories'
import { stubTty } from '../test-utils'

let ws: BoundWorkspace
let dir: string

beforeEach(async () => {
  ws = await bindWorkspace()
  dir = ws.dir
})

afterEach(async () => {
  await ws.dispose()
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
  test('ensureDeckFile names the file as the deck is named', async () => {
    const filePath = await ensureDeckFile('My Cool Deck', 'commander')
    expect(filePath).toBe(path.join(dir, 'decks', 'My Cool Deck.md'))
    const { deck, frontMatter } = await loadDeck(filePath)
    expect(deck.name).toBe('My Cool Deck')
    expect(frontMatter.format).toBe('commander')
  })

  test('ensureDeckFile is idempotent and does not clobber an existing deck', async () => {
    const filePath = await ensureDeckFile('Keeper', 'commander')
    const { deck, frontMatter } = await loadDeck(filePath)
    await addCardToDeck(filePath, deck, frontMatter, 'Sol Ring', 'Main', {
      set: 'ltc',
      collectorNumber: '284',
    })
    // A second ensureDeckFile must reuse the file, leaving the added card intact.
    const again = await ensureDeckFile('Keeper', 'commander')
    expect(again).toBe(filePath)
    const reloaded = await loadDeck(filePath)
    expect(reloaded.deck.sections.flatMap((s) => s.cards).map((c) => c.name)).toContain('Sol Ring')
  })

  test('adds a card to a named section, creating the section and assigning an ID', async () => {
    const filePath = await ensureDeckFile('Lands Deck', 'commander')
    const { deck, frontMatter } = await loadDeck(filePath)
    await addCardToDeck(filePath, deck, frontMatter, 'Lightning Bolt', 'Burn', {
      set: 'lea',
      collectorNumber: '161',
    })

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('## Burn')
    // Set codes are uppercased on write; the first card in a fresh deck gets ID 1.
    expect(content).toMatch(/^- 1 Lightning Bolt \(LEA:161\) &1$/m)

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
    const filePath = await ensureDeckFile('Aggro', 'commander')
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

  test('listExistingDecks reports H1 display names, sorted by name', async () => {
    await ensureDeckFile('Zephyr Tempo', 'commander')
    // A file whose name differs from its H1 display name (as any deck renamed
    // by hand, or created before the naming rule, would be).
    await fs.writeFile(
      path.join(dir, 'decks', 'atraxa-superfriends.md'),
      '# Atraxa Superfriends\n\n## Main\n',
    )
    // A deck file with no `# Title` H1 falls back to its file base name.
    await fs.writeFile(path.join(dir, 'decks', 'orphan-deck.md'), '## Main\n')

    const decks = await listExistingDecks()
    expect(decks.map((d) => d.name)).toEqual(['Atraxa Superfriends', 'orphan-deck', 'Zephyr Tempo'])
    // The display name is reported, but the paired path is the file's real one.
    const atraxa = decks.find((d) => d.name === 'Atraxa Superfriends')
    expect(atraxa?.file).toBe(path.join(dir, 'decks', 'atraxa-superfriends.md'))
  })

  test('a different printing of the same card is kept as its own entry', async () => {
    const filePath = await ensureDeckFile('Reprints', 'commander')
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

/**
 * The deck session's own categories wiring: `persist` must commit the staged
 * edits and build its surviving-name set from EVERY section. The flat-list twin
 * lives in `flat-list-session.test.ts`; without this one, a deck `persist` that
 * forgot the commit — or that read one section — would drop every category edit
 * silently.
 */
describe('deck session categories', () => {
  stubTty({ stdin: true })

  test('persist writes the staged edit and prunes only names the deck no longer holds', async () => {
    const filePath = await ensureDeckFile('Categorized', 'commander')
    const deck: DeckData = {
      name: 'Categorized',
      sections: [
        { name: 'Commanders', cards: [{ quantity: 1, name: 'Atraxa', cardId: 1 }] },
        { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 2 }] },
      ],
    }
    const { frontMatter } = await loadDeck(filePath)
    await writeDeck(filePath, deck, frontMatter)
    // 'Ponder' is not in the deck, so the save prunes it; 'Atraxa' is in the
    // OTHER section and must survive.
    await saveCardCategories(
      filePath,
      categoriesRecord(['Ramp', 'Draw'], { Atraxa: ['Ramp'], Ponder: ['Draw'] }),
    )

    const strategy = createDeckStrategy({
      deckFile: filePath,
      deckName: 'Categorized',
      initialDeck: deck,
      frontMatter,
      sessionConfig: buildInitialSessionConfig({}, undefined),
      excludeDigitalOnly: true,
    })

    prompts.inject(['categories', 'Ramp, Artifacts'])
    await strategy.editEntry(createCardSessionContext(), 2)
    await strategy.persist()

    const saved = await loadCardCategories(filePath)
    expect(saved.ok && categoriesOf(saved.categories)).toEqual({
      Atraxa: ['Ramp'],
      'Sol Ring': ['Ramp', 'Artifacts'],
    })
  })
})
