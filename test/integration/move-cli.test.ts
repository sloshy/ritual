import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import {
  createWorkspace,
  removeWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
} from './helpers/workspace'
import { makeScryfallCard } from '../test-utils'
import type { ScryfallCard } from '../../src/types'

/**
 * Seed the workspace's on-disk Scryfall card cache with synthetic printings so
 * printing validation runs fully offline. A truly absent entry would make the
 * CLI attempt a live Scryfall lookup (upstream `getCardPrintings` behavior),
 * which is nondeterministic in tests; an empty array pins the "card has no
 * known printings" path.
 */
async function seedCardCache(
  workspace: string,
  cards: Record<string, ScryfallCard[]>,
): Promise<void> {
  type CacheEntry = { timestamp: number; data: ScryfallCard[] }
  const entries: Record<string, CacheEntry> = Object.fromEntries(
    Object.entries(cards).map(([name, data]) => [name, { timestamp: Date.now(), data }]),
  )
  await fs.mkdir(path.join(workspace, 'cache'), { recursive: true })
  await fs.writeFile(
    path.join(workspace, 'cache', 'cache.json'),
    JSON.stringify({ prices: {}, cards: entries }),
  )
}

const DEMONIC_TUTOR_PRINTINGS: ScryfallCard[] = [
  makeScryfallCard({
    name: 'Demonic Tutor',
    set: 'sta',
    set_name: 'Strixhaven Mystical Archive',
    collector_number: '90',
    finishes: ['nonfoil', 'foil'],
  }),
]

type MoveErrorPayload = {
  error: { code: string; message: string; details?: { matches?: unknown[] } }
}

type MoveSuccessPayload = {
  moved: number
  card: { name: string; set?: string; collectorNumber?: string; cardId?: number }
  from: { type: string; name: string }
  to: { type: string; name: string }
  droppedNotes: { cardName: string; cardId?: number; note: string }[]
}

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
  await writeDeckFile(dir, 'source', {
    frontMatter: { name: 'Source Deck' },
    cards: [{ quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
  })
  await writeDeckFile(dir, 'target', {
    frontMatter: { name: 'Target Deck' },
    cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
  })
  await writeCollectionFile(dir, 'binder', {
    entries: [{ name: 'Mana Crypt', set: '2xm', collectorNumber: '1', cardId: 1 }],
  })
  await writeWantedFile(dir, 'needs', {
    entries: [
      { name: 'Demonic Tutor', cardId: 1 },
      { name: 'Zzz Fake Test Card', cardId: 2 },
    ],
  })
})

afterEach(async () => {
  await removeWorkspace(dir)
})

describe('move CLI headless mode (Integration)', () => {
  test('moves a printed card deck → deck and writes both changelogs', async () => {
    const result = await runCli(
      [
        'move',
        'Lightning',
        'Bolt',
        '--from',
        'deck:source',
        '--to',
        'deck:target',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as MoveSuccessPayload
    expect(json.moved).toBe(1)
    expect(json.card.name).toBe('Lightning Bolt')
    expect(json.card.set).toBe('lea')
    expect(json.from).toEqual({ type: 'deck', name: 'Source Deck' })
    expect(json.to).toEqual({ type: 'deck', name: 'Target Deck' })

    const source = await fs.readFile(path.join(dir, 'decks', 'source.md'), 'utf-8')
    expect(source).toContain('1 Lightning Bolt (LEA:161) &1')
    const target = await fs.readFile(path.join(dir, 'decks', 'target.md'), 'utf-8')
    expect(target).toContain('1 Lightning Bolt (LEA:161)')

    const sourceLog = await fs.readFile(path.join(dir, 'decks', 'source.changes.md'), 'utf-8')
    expect(sourceLog).toContain("to Deck 'Target Deck'")
    const targetLog = await fs.readFile(path.join(dir, 'decks', 'target.changes.md'), 'utf-8')
    expect(targetLog).toContain("from Deck 'Source Deck'")
  })

  test('moves a name-only wanted card into a deck without needing a printing', async () => {
    const result = await runCli(
      ['move', 'Demonic', 'Tutor', '--from', 'wanted:needs', '--to', 'deck:target'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      "Moved 1 x Demonic Tutor from Wanted list 'needs' to Deck 'Target Deck'",
    )

    const wanted = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
    expect(wanted).not.toContain('Demonic Tutor')
    const target = await fs.readFile(path.join(dir, 'decks', 'target.md'), 'utf-8')
    expect(target).toContain('1 Demonic Tutor')
  })

  test('wanted → collection purchase flow assigns the printing from --set/--collector-number', async () => {
    // The pin is validated against the card cache, so the pinned printing must exist there.
    await seedCardCache(dir, { 'Demonic Tutor': DEMONIC_TUTOR_PRINTINGS })
    const result = await runCli(
      [
        'move',
        'Demonic',
        'Tutor',
        '--from',
        'wanted:needs',
        '--to',
        'collection:binder',
        '--set',
        'sta',
        '--collector-number',
        '90',
        '--output',
        'json',
      ],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as MoveSuccessPayload
    expect(json.moved).toBe(1)
    expect(json.card.set).toBe('sta')
    expect(json.card.collectorNumber).toBe('90')

    const collection = await fs.readFile(path.join(dir, 'collections', 'binder.md'), 'utf-8')
    expect(collection).toContain('- Demonic Tutor (STA:90)')
    const wanted = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
    expect(wanted).not.toContain('Demonic Tutor')
  })

  test('wanted → collection with a pin the card was never printed as is a usage error listing printings', async () => {
    await seedCardCache(dir, { 'Demonic Tutor': DEMONIC_TUTOR_PRINTINGS })
    const result = await runCli(
      [
        'move',
        'Demonic',
        'Tutor',
        '--from',
        'wanted:needs',
        '--to',
        'collection:binder',
        '--set',
        '3ed',
        '--collector-number',
        '999',
        '--output',
        'json',
      ],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('Available printings')
    expect(err.error.message).toContain('STA:90')

    // Nothing moved: the wanted entry is untouched and the collection unchanged.
    const wanted = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
    expect(wanted).toContain('Demonic Tutor')
    const collection = await fs.readFile(path.join(dir, 'collections', 'binder.md'), 'utf-8')
    expect(collection).not.toContain('Demonic Tutor')
  })

  test('wanted → collection without printing flags and no cached printings fails cleanly', async () => {
    await seedCardCache(dir, { 'Zzz Fake Test Card': [] })
    const result = await runCli(
      [
        'move',
        'Zzz',
        'Fake',
        'Test',
        'Card',
        '--from',
        'wanted:needs',
        '--to',
        'collection:binder',
        '--output',
        'json',
      ],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('No printings')
    expect(err.error.message).toContain('--set')

    // Nothing moved: the wanted entry is untouched and the collection unchanged.
    const wanted = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
    expect(wanted).toContain('Zzz Fake Test Card')
    const collection = await fs.readFile(path.join(dir, 'collections', 'binder.md'), 'utf-8')
    expect(collection).not.toContain('Zzz Fake Test Card')
  })

  test('--card-id selects the card without a name argument', async () => {
    const result = await runCli(
      [
        'move',
        '--card-id',
        '2',
        '--from',
        'wanted:needs',
        '--to',
        'deck:target',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as MoveSuccessPayload
    expect(json.card.name).toBe('Zzz Fake Test Card')
    const target = await fs.readFile(path.join(dir, 'decks', 'target.md'), 'utf-8')
    expect(target).toContain('1 Zzz Fake Test Card')
  })

  test('a --card-id that matches nothing exits not_found', async () => {
    const result = await runCli(
      [
        'move',
        '--card-id',
        '99',
        '--from',
        'wanted:needs',
        '--to',
        'deck:target',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('not_found')
    expect(err.error.message).toContain('No card with id 99')
  })

  test('--to without --from is a usage error', async () => {
    const result = await runCli(
      ['move', 'Sol', 'Ring', '--to', 'deck:target', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('--to requires --from')
  })

  test('a card selector without --from/--to is a usage error', async () => {
    const result = await runCli(['move', 'Sol', 'Ring', '--output', 'json'], dir)
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('both --from and --to')
  })

  test('headless mode without a card name or --card-id is a usage error', async () => {
    const result = await runCli(
      ['move', '--from', 'deck:source', '--to', 'deck:target', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('card name or --card-id')
  })

  test('an unknown --from list exits not_found', async () => {
    const result = await runCli(
      [
        'move',
        'Sol',
        'Ring',
        '--from',
        'deck:nonexistent',
        '--to',
        'deck:target',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('not_found')
  })

  test('requesting more copies than exist exits not_found and moves nothing', async () => {
    const result = await runCli(
      [
        'move',
        'Lightning',
        'Bolt',
        '--from',
        'deck:source',
        '--to',
        'deck:target',
        '-q',
        '3',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('not_found')
    expect(err.error.message).toContain('Only 2')

    const source = await fs.readFile(path.join(dir, 'decks', 'source.md'), 'utf-8')
    expect(source).toContain('2 Lightning Bolt (LEA:161) &1')
  })

  test('a name matching multiple printings is a usage error listing the printings', async () => {
    await writeDeckFile(dir, 'multi', {
      frontMatter: { name: 'Multi' },
      cards: [
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
        { quantity: 1, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157', cardId: 2 },
      ],
    })
    const result = await runCli(
      [
        'move',
        'Lightning',
        'Bolt',
        '--from',
        'deck:multi',
        '--to',
        'deck:target',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('Multiple printings')
    expect(err.error.details?.matches).toHaveLength(2)
  })

  test('--set narrows an otherwise-ambiguous printing match', async () => {
    await writeDeckFile(dir, 'multi', {
      frontMatter: { name: 'Multi' },
      cards: [
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
        { quantity: 1, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157', cardId: 2 },
      ],
    })
    const result = await runCli(
      [
        'move',
        'Lightning',
        'Bolt',
        '--from',
        'deck:multi',
        '--to',
        'deck:target',
        '--set',
        'lea',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const multi = await fs.readFile(path.join(dir, 'decks', 'multi.md'), 'utf-8')
    expect(multi).not.toContain('LEA:161')
    expect(multi).toContain('1 Lightning Bolt (2XM:157) &2')
    const target = await fs.readFile(path.join(dir, 'decks', 'target.md'), 'utf-8')
    expect(target).toContain('1 Lightning Bolt (LEA:161)')
  })

  test('--finish narrows an otherwise-ambiguous finish match', async () => {
    await writeCollectionFile(dir, 'finishes', {
      entries: [
        { name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 },
        { name: 'Sol Ring', set: 'c19', collectorNumber: '221', finish: 'foil', cardId: 2 },
      ],
    })
    const result = await runCli(
      [
        'move',
        'Sol',
        'Ring',
        '--from',
        'collection:finishes',
        '--to',
        'deck:target',
        '--finish',
        'foil',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as MoveSuccessPayload
    expect(json.moved).toBe(1)
    expect(json.card.name).toBe('Sol Ring')

    // The foil copy moved; the nonfoil line stays behind.
    const collection = await fs.readFile(path.join(dir, 'collections', 'finishes.md'), 'utf-8')
    expect(collection).toContain('- Sol Ring (C19:221) &1')
    expect(collection).not.toContain('[foil]')
    const target = await fs.readFile(path.join(dir, 'decks', 'target.md'), 'utf-8')
    expect(target).toContain('Sol Ring (C19:221) [foil]')
  })

  test('--to-section places the card in the named deck section, creating it', async () => {
    const result = await runCli(
      [
        'move',
        'Lightning',
        'Bolt',
        '--from',
        'deck:source',
        '--to',
        'deck:target',
        '--to-section',
        'Sideboard',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const target = await fs.readFile(path.join(dir, 'decks', 'target.md'), 'utf-8')
    expect(target).toContain('## Sideboard')
    expect(target.indexOf('Lightning Bolt')).toBeGreaterThan(target.indexOf('## Sideboard'))
  })

  test('--to-section with a non-deck destination is a usage error', async () => {
    const result = await runCli(
      [
        'move',
        'Lightning',
        'Bolt',
        '--from',
        'deck:source',
        '--to',
        'collection:binder',
        '--to-section',
        'Sideboard',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('--to-section requires a deck destination')

    // Nothing moved.
    const source = await fs.readFile(path.join(dir, 'decks', 'source.md'), 'utf-8')
    expect(source).toContain('2 Lightning Bolt (LEA:161) &1')
  })

  test('a note dropped by a destination quantity-merge is warned on stderr and reported in JSON', async () => {
    await writeCollectionFile(dir, 'notes', {
      entries: [
        { name: 'Sol Ring', set: 'c19', collectorNumber: '221', note: 'trade pile', cardId: 1 },
      ],
    })
    await writeDeckFile(dir, 'ringdeck', {
      frontMatter: { name: 'Ring Deck' },
      cards: [{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }],
    })

    const result = await runCli(
      [
        'move',
        'Sol',
        'Ring',
        '--from',
        'collection:notes',
        '--to',
        'deck:ringdeck',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as MoveSuccessPayload
    expect(json.moved).toBe(1)
    expect(json.droppedNotes).toEqual([{ cardName: 'Sol Ring', cardId: 1, note: 'trade pile' }])
    // The warning goes to stderr, never stdout.
    expect(result.stderr).toContain('trade pile')

    const deck = await fs.readFile(path.join(dir, 'decks', 'ringdeck.md'), 'utf-8')
    expect(deck).toContain('2 Sol Ring (C19:221)')
  })

  test('a malformed --set value is a usage error', async () => {
    const result = await runCli(
      [
        'move',
        'Lightning',
        'Bolt',
        '--from',
        'deck:source',
        '--to',
        'deck:target',
        '--set',
        'le a!',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain("Invalid set code 'le a!'")
  })

  test('--set narrowing that matches no copies exits not_found and moves nothing', async () => {
    const result = await runCli(
      [
        'move',
        'Lightning',
        'Bolt',
        '--from',
        'deck:source',
        '--to',
        'deck:target',
        '--set',
        'm10',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as MoveErrorPayload
    expect(err.error.code).toBe('not_found')
    expect(err.error.message).toContain("No copies of 'Lightning Bolt' matching set M10")

    const source = await fs.readFile(path.join(dir, 'decks', 'source.md'), 'utf-8')
    expect(source).toContain('2 Lightning Bolt (LEA:161) &1')
  })
})
