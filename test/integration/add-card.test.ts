import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import {
  createWorkspace,
  removeWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
} from './helpers/workspace'
import type { ScryfallCard } from '../../src/types'
import type { CachedItem, CacheSchema } from '../../src/cache/file-cache'

// ── Synthetic card cache ──────────────────────────────────────────────────────
// add-card resolves card names and printings from the local Scryfall cache, so
// the workspace gets a small synthetic cache.json: fake-but-well-formed cards,
// stamped freshly refreshed so no update prompt (or network call) can trigger.

type SeedPrinting = { set: string; setName: string; collectorNumber: string; finishes: string[] }

function seedPrintings(name: string, printings: SeedPrinting[]): ScryfallCard[] {
  return printings.map(
    (p, i): ScryfallCard => ({
      id: `it-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i}`,
      name,
      cmc: 1,
      type_line: 'Artifact',
      prices: {
        usd: '1.00',
        usd_foil: null,
        usd_etched: null,
        eur: null,
        eur_foil: null,
        tix: null,
      },
      finishes: p.finishes,
      games: ['paper'],
      set: p.set,
      set_name: p.setName,
      collector_number: p.collectorNumber,
      rarity: 'rare',
      color_identity: [],
      released_at: '2020-01-01',
    }),
  )
}

const SEED_CARDS: Record<string, ScryfallCard[]> = {
  'Sol Ring': seedPrintings('Sol Ring', [
    { set: 'lea', setName: 'Limited Edition Alpha', collectorNumber: '270', finishes: ['nonfoil'] },
    {
      set: 'c21',
      setName: 'Commander 2021',
      collectorNumber: '263',
      finishes: ['nonfoil', 'foil'],
    },
  ]),
  'Lightning Bolt': seedPrintings('Lightning Bolt', [
    { set: 'lea', setName: 'Limited Edition Alpha', collectorNumber: '161', finishes: ['nonfoil'] },
    {
      set: 'sta',
      setName: 'Strixhaven Mystical Archive',
      collectorNumber: '42',
      finishes: ['nonfoil', 'foil', 'etched'],
    },
  ]),
  'Demonic Tutor': seedPrintings('Demonic Tutor', [
    { set: 'lea', setName: 'Limited Edition Alpha', collectorNumber: '105', finishes: ['nonfoil'] },
  ]),
}

async function writeCardCache(dir: string): Promise<void> {
  const now = Date.now()
  const cards: Record<string, CachedItem<ScryfallCard[]>> = {}
  const cardNameIndex: Record<string, string> = {}
  for (const [name, printings] of Object.entries(SEED_CARDS)) {
    cards[name] = { timestamp: now, data: printings, lowercaseName: name.toLowerCase() }
    cardNameIndex[name.toLowerCase()] = name
  }
  const schema: CacheSchema = {
    prices: {},
    cards,
    cardNameIndex,
    metadata: { cards: { lastRefreshedAt: now } },
  }
  await fs.mkdir(path.join(dir, 'cache'), { recursive: true })
  await fs.writeFile(path.join(dir, 'cache', 'cache.json'), JSON.stringify(schema))
}

// ── Error payload shapes ──────────────────────────────────────────────────────

type CliErrorPayload = {
  error: { code: string; message: string; details?: Record<string, unknown> }
}

type AddCardPayload = {
  type: string
  list: string
  cardName: string
  set?: string
  collectorNumber?: string
  finish?: string
  condition?: string
  quantity?: number
  cardId: number
}

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
  await writeCardCache(dir)
  await writeDeckFile(dir, 'test', {
    frontMatter: { name: 'Test Deck' },
    cards: [{ quantity: 1, name: 'Demonic Tutor', cardId: 1 }],
  })
  await writeCollectionFile(dir, 'main', {
    entries: [{ name: 'Underground Sea', set: 'leb', collectorNumber: '286', cardId: 1 }],
  })
  await writeWantedFile(dir, 'needs', {
    entries: [{ name: 'Underground Sea', set: 'leb', collectorNumber: '286', cardId: 1 }],
  })
})

afterEach(async () => {
  await removeWorkspace(dir)
})

describe('add-card CLI (Integration)', () => {
  describe('flag validation', () => {
    test('rejects an invalid --finish at parse time', async () => {
      const result = await runCli(
        ['add-card', '--collection', 'main', 'Sol', 'Ring', '--finish', 'glossy'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Invalid finish')
      expect(result.stderr).toContain('nonfoil, foil, etched')
    })

    test('rejects an invalid --condition at parse time', async () => {
      const result = await runCli(
        ['add-card', '--collection', 'main', 'Sol', 'Ring', '--condition', 'MINT'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Invalid condition')
      expect(result.stderr).toContain('NONE')
    })

    test('rejects a non-positive --quantity at parse time', async () => {
      const result = await runCli(['add-card', '--deck', 'test', 'Sol', 'Ring', '-q', '0'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('positive integer')
    })

    test('rejects --quantity on a non-deck target', async () => {
      const result = await runCli(
        ['add-card', '--collection', 'main', 'Sol', 'Ring', '-q', '2'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--quantity applies only to deck targets')
    })

    test('rejects --name-only combined with --specific', async () => {
      const result = await runCli(
        ['add-card', '--wanted', 'needs', 'Sol', 'Ring', '--name-only', '--specific'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--name-only')
      expect(result.stderr).toContain('--specific')
    })

    test('rejects --set without --collector-number', async () => {
      const result = await runCli(
        ['add-card', '--deck', 'test', 'Sol', 'Ring', '--set', 'lea', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('together')
    })

    test('a type prefix on the target name overrides the type flag', async () => {
      // deck: prefix beats --wanted; the deck add path needs no printing prompt.
      const result = await runCli(
        ['add-card', '--wanted', 'deck:test', 'Sol', 'Ring', '--exact', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const payload = JSON.parse(result.stdout) as { type: string; list: string }
      expect(payload.type).toBe('deck')
    })

    test('rejects --name-only on a deck target', async () => {
      const result = await runCli(
        ['add-card', '--deck', 'test', 'Sol', 'Ring', '--name-only', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('wanted list targets')
    })

    test('rejects --condition on a wanted target', async () => {
      const result = await runCli(
        [
          'add-card',
          '--wanted',
          'needs',
          'Sol',
          'Ring',
          '--name-only',
          '--condition',
          'NM',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('collection targets')
    })

    test('wanted add without a specificity flag fails when stdin is not a terminal', async () => {
      const result = await runCli(
        ['add-card', '--wanted', 'needs', 'Sol', 'Ring', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('--name-only')
    })
  })

  describe('deck adds', () => {
    test('adds a card and records the allocated card ID in the changelog', async () => {
      const result = await runCli(
        ['add-card', '--deck', 'test', 'Sol', 'Ring', '--exact', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as AddCardPayload
      expect(json.type).toBe('deck')
      expect(json.cardName).toBe('Sol Ring')
      expect(json.quantity).toBe(1)
      expect(json.cardId).toBe(2)

      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).toContain('1 Sol Ring &2')

      const changelog = await fs.readFile(path.join(dir, 'decks', 'test.changes.md'), 'utf-8')
      expect(changelog).toContain('Sol Ring')
      expect(changelog).toContain('&2')
    })

    test('pins a printing onto the deck line with --set/--collector-number', async () => {
      const result = await runCli(
        [
          'add-card',
          '--deck',
          'test',
          'Sol',
          'Ring',
          '--exact',
          '-q',
          '3',
          '--set',
          'C21',
          '--collector-number',
          '263',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as AddCardPayload
      expect(json.set).toBe('c21')
      expect(json.collectorNumber).toBe('263')
      expect(json.quantity).toBe(3)

      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).toContain('3 Sol Ring (C21:263) &2')
    })

    test('rejects a nonexistent printing pin, listing available printings', async () => {
      const result = await runCli(
        [
          'add-card',
          '--deck',
          'test',
          'Lightning',
          'Bolt',
          '--exact',
          '--set',
          'lea',
          '--collector-number',
          '999',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('LEA:161')
      expect(err.error.message).toContain('STA:42')
      expect(err.error.details?.available).toEqual([
        { set: 'lea', collectorNumber: '161' },
        { set: 'sta', collectorNumber: '42' },
      ])
    })

    test('returns not_found when the deck does not exist', async () => {
      const result = await runCli(
        ['add-card', '--deck', 'nonexistent', 'Sol', 'Ring', '--exact', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(3)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('not_found')
    })
  })

  describe('collection adds', () => {
    test('adds a fully pinned card with finish and condition', async () => {
      const result = await runCli(
        [
          'add-card',
          '--collection',
          'main',
          'Lightning',
          'Bolt',
          '--exact',
          '--set',
          'sta',
          '--collector-number',
          '42',
          '--finish',
          'etched',
          '--condition',
          'LP',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as AddCardPayload
      expect(json).toMatchObject({
        type: 'collection',
        list: 'main',
        cardName: 'Lightning Bolt',
        set: 'sta',
        collectorNumber: '42',
        finish: 'etched',
        condition: 'LP',
        cardId: 2,
      })

      const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
      expect(content).toContain('- Lightning Bolt (STA:42) [etched] [LP] &2')
    })

    test('--condition NONE records no condition and skips the prompt', async () => {
      const result = await runCli(
        [
          'add-card',
          '--collection',
          'main',
          'Sol',
          'Ring',
          '--exact',
          '--set',
          'lea',
          '--collector-number',
          '270',
          '--condition',
          'NONE',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as AddCardPayload
      expect(json.condition).toBeUndefined()

      const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
      expect(content).toContain('- Sol Ring (LEA:270) &2')
    })

    test('without a pin, non-interactive adds only accept a single-printing card', async () => {
      const result = await runCli(
        [
          'add-card',
          '--collection',
          'main',
          'Demonic',
          'Tutor',
          '--exact',
          '--condition',
          'NONE',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
      expect(content).toContain('- Demonic Tutor (LEA:105) &2')
    })

    test('without a pin, a multi-printing card fails non-interactively instead of guessing', async () => {
      const result = await runCli(
        [
          'add-card',
          '--collection',
          'main',
          'Sol',
          'Ring',
          '--exact',
          '--condition',
          'NONE',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(1)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('runtime_error')
      expect(err.error.message).toContain('--set')
      const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
      expect(content).not.toContain('Sol Ring')
    })

    test('the printing picker is gated on --no-input too: a multi-printing card fails', async () => {
      const result = await runCli(
        [
          'add-card',
          '--collection',
          'main',
          'Sol',
          'Ring',
          '--exact',
          '--condition',
          'NONE',
          '--output',
          'json',
        ],
        dir,
        { RITUAL_NO_INPUT: '1' },
      )
      expect(result.exitCode).toBe(1)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('runtime_error')
      expect(err.error.message).toContain('--set')
      const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
      expect(content).not.toContain('Sol Ring')
    })

    test('a multi-finish pin without --finish fails instead of leaving the prompt unanswered', async () => {
      const result = await runCli(
        [
          'add-card',
          '--collection',
          'main',
          'Lightning',
          'Bolt',
          '--exact',
          '--set',
          'sta',
          '--collector-number',
          '42',
          '--condition',
          'NONE',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('--finish')
      const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
      expect(content).not.toContain('Lightning Bolt (STA:42)')
    })

    test('a missing --condition fails instead of leaving the prompt unanswered', async () => {
      const result = await runCli(
        [
          'add-card',
          '--collection',
          'main',
          'Sol',
          'Ring',
          '--exact',
          '--set',
          'lea',
          '--collector-number',
          '270',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('--condition')
      const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
      expect(content).not.toContain('Sol Ring')
    })

    test('rejects a valid --finish the printing is not offered in', async () => {
      const result = await runCli(
        [
          'add-card',
          '--collection',
          'main',
          'Sol',
          'Ring',
          '--exact',
          '--set',
          'lea',
          '--collector-number',
          '270',
          '--finish',
          'foil',
          '--condition',
          'NM',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('not available in foil')
      expect(err.error.details?.availableFinishes).toEqual(['nonfoil'])
    })
  })

  describe('wanted adds', () => {
    test('--name-only appends a name-only entry with a finish preference', async () => {
      const result = await runCli(
        [
          'add-card',
          '--wanted',
          'needs',
          'Sol',
          'Ring',
          '--exact',
          '--name-only',
          '--finish',
          'foil',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as AddCardPayload
      expect(json).toMatchObject({
        type: 'wanted',
        cardName: 'Sol Ring',
        finish: 'foil',
        cardId: 2,
      })
      expect(json.set).toBeUndefined()

      const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
      expect(content).toContain('- Sol Ring [foil] &2')
    })

    test('a printing pin implies the specific flow', async () => {
      const result = await runCli(
        [
          'add-card',
          '--wanted',
          'needs',
          'Lightning',
          'Bolt',
          '--exact',
          '--set',
          'sta',
          '--collector-number',
          '42',
          '--finish',
          'foil',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
      expect(content).toContain('- Lightning Bolt (STA:42) [foil] &2')
    })

    test('a wanted multi-finish pin without --finish fails instead of leaving the prompt unanswered', async () => {
      const result = await runCli(
        [
          'add-card',
          '--wanted',
          'needs',
          'Lightning',
          'Bolt',
          '--exact',
          '--set',
          'sta',
          '--collector-number',
          '42',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('--finish')
      const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
      expect(content).not.toContain('- Lightning Bolt (STA:42)')
    })

    test('--specific auto-accepts a single printing without prompting', async () => {
      const result = await runCli(
        [
          'add-card',
          '--wanted',
          'needs',
          'Demonic',
          'Tutor',
          '--exact',
          '--specific',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
      expect(content).toContain('- Demonic Tutor (LEA:105) &2')
    })

    test('--specific with multiple printings fails without a pin when non-interactive', async () => {
      const result = await runCli(
        [
          'add-card',
          '--wanted',
          'needs',
          'Sol',
          'Ring',
          '--exact',
          '--specific',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(1)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('runtime_error')
      expect(err.error.message).toContain('--set')
      // The specific flow must NOT degrade to a name-only entry.
      const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
      expect(content).not.toContain('- Sol Ring')
    })

    test('auto-creates a missing wanted list when the type flag pins it', async () => {
      const result = await runCli(
        [
          'add-card',
          '--wanted',
          'fresh',
          'Sol',
          'Ring',
          '--exact',
          '--name-only',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as AddCardPayload
      expect(json.list).toBe('fresh')
      expect(json.cardId).toBe(1)
      const content = await fs.readFile(path.join(dir, 'wanted', 'fresh.md'), 'utf-8')
      expect(content).toContain('- Sol Ring &1')
    })
  })

  describe('card name resolution', () => {
    test('--exact with no matching card returns not_found', async () => {
      const result = await runCli(
        ['add-card', '--deck', 'test', 'Blightsteel', '--exact', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(3)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('not_found')
      expect(err.error.message).toContain('No exact match')
    })

    test('a search matching no cached card returns not_found without --exact', async () => {
      const result = await runCli(['add-card', '--deck', 'test', 'Zzzzz', '--output', 'json'], dir)
      expect(result.exitCode).toBe(3)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('not_found')
      expect(err.error.message).toContain('No cards found')
    })

    test('a partial name without a terminal is rejected instead of auto-picking', async () => {
      const result = await runCli(['add-card', '--deck', 'test', 'Sol', '--output', 'json'], dir)
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('pass the full card name')
      // Nothing may have been written from a silent first-suggestion pick.
      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).not.toContain('Sol Ring')
    })

    test('a multi-term partial name counts as a match, not a miss', async () => {
      // "lig bol" is nowhere in "Lightning Bolt" contiguously — each term is
      // matched on its own, so the picker has something to offer and the run
      // fails for want of a terminal rather than for want of a card.
      const result = await runCli(
        ['add-card', '--deck', 'test', 'lig', 'bol', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as CliErrorPayload
      expect(err.error.message).toContain('pass the full card name')
    })

    test('a full card name without --exact still resolves when non-interactive', async () => {
      const result = await runCli(
        ['add-card', '--deck', 'test', 'Sol', 'Ring', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as AddCardPayload
      expect(json.cardName).toBe('Sol Ring')
    })
  })

  describe('output discipline', () => {
    test('json output keeps stdout to exactly the payload', async () => {
      const result = await runCli(
        ['add-card', '--deck', 'test', 'Sol', 'Ring', '--exact', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      // JSON.parse over the whole stream fails if any chatter leaks onto stdout.
      const json = JSON.parse(result.stdout) as AddCardPayload
      expect(json.cardName).toBe('Sol Ring')
      expect(result.stdout.trim().startsWith('{')).toBe(true)
    })

    test('--quiet suppresses all text output on success', async () => {
      const result = await runCli(
        ['add-card', '--deck', 'test', 'Sol', 'Ring', '--exact', '--quiet'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('')
      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).toContain('1 Sol Ring &2')
    })
  })
})
