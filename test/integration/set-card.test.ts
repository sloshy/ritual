import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { createWorkspace, removeWorkspace, seedCardTargetWorkspace } from './helpers/workspace'
import { makeScryfallCard } from '../test-utils'
import type { ScryfallCard } from '../../src/types'

type SetCardJson = {
  type: string
  list: string
  cardName: string
  cardId?: number
  applied: string[]
}

type ErrorJson = {
  error: { code: string; message: string; details?: { matches?: unknown[] } }
}

/**
 * Seed the workspace's on-disk Scryfall card cache with synthetic printings so
 * `set-card`'s printing validation runs fully offline. The card cache never
 * expires, so the timestamp only needs to exist.
 */
async function seedCardCache(dir: string, cards: Record<string, ScryfallCard[]>): Promise<void> {
  type CacheEntry = { timestamp: number; data: ScryfallCard[] }
  const now = Date.now()
  const entries: Record<string, CacheEntry> = Object.fromEntries(
    Object.entries(cards).map(([name, data]) => [name, { timestamp: now, data }]),
  )
  await fs.mkdir(path.join(dir, 'cache'), { recursive: true })
  await fs.writeFile(
    path.join(dir, 'cache', 'cache.json'),
    // The metadata stamp is what a completed bulk download leaves behind, and
    // what makes a cached entry count as the card's *complete* printing list.
    JSON.stringify({ prices: {}, cards: entries, metadata: { cards: { lastRefreshedAt: now } } }),
  )
}

const LIGHTNING_BOLT_PRINTINGS: ScryfallCard[] = [
  makeScryfallCard({
    name: 'Lightning Bolt',
    set: 'lea',
    collector_number: '161',
    finishes: ['nonfoil'],
  }),
  makeScryfallCard({
    name: 'Lightning Bolt',
    set: '2xm',
    collector_number: '157',
    finishes: ['nonfoil', 'foil'],
  }),
]

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
  await seedCardTargetWorkspace(dir, { leaBoltFinish: 'foil' })
})

afterEach(async () => {
  await removeWorkspace(dir)
})

describe('set-card CLI (Integration)', () => {
  test('changes a deck card finish (no Scryfall lookup needed)', async () => {
    const result = await runCli(
      ['set-card', '--deck', 'test', '--card-id', '3', '--finish', 'foil', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.cardId).toBe(3)
    expect(json.applied).toEqual(['finish → foil'])

    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('1 Lightning Bolt (2XM:157) [foil] &3')

    const changelog = await fs.readFile(path.join(dir, 'decks', 'test.changes.md'), 'utf-8')
    expect(changelog).toContain('Set "Lightning Bolt" finish to foil &3')
  })

  test('changes printing and preserves the current finish when --finish is omitted', async () => {
    await seedCardCache(dir, { 'Lightning Bolt': LIGHTNING_BOLT_PRINTINGS })
    const result = await runCli(
      [
        'set-card',
        '--deck',
        'test',
        '--card-id',
        '2',
        '--set',
        '2xm',
        '--collector-number',
        '157',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['printing → 2XM:157'])
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    // The card was foil before the printing change; the finish must survive.
    expect(deckContent).toContain('1 Lightning Bolt (2XM:157) [foil] &2')
  })

  test('rejects a set/collector-number pair the card was never printed as', async () => {
    await seedCardCache(dir, { 'Lightning Bolt': LIGHTNING_BOLT_PRINTINGS })
    const result = await runCli(
      [
        'set-card',
        '--deck',
        'test',
        '--card-id',
        '2',
        '--set',
        '3ed',
        '--collector-number',
        '999',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('Available printings')
    expect(err.error.message).toContain('LEA:161')
  })

  test('rejects a finish the chosen printing does not offer', async () => {
    await seedCardCache(dir, { 'Lightning Bolt': LIGHTNING_BOLT_PRINTINGS })
    const result = await runCli(
      [
        'set-card',
        '--deck',
        'test',
        '--card-id',
        '2',
        '--set',
        'lea',
        '--collector-number',
        '161',
        '--finish',
        'etched',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('Available finishes: nonfoil')
  })

  test('treats a printing with no finish data as nonfoil-only', async () => {
    // Cache entries can carry an empty finishes array; the shared finish pin
    // treats them as plain nonfoil instead of rejecting every finish.
    await seedCardCache(dir, {
      'Lightning Bolt': [
        makeScryfallCard({
          name: 'Lightning Bolt',
          set: 'lea',
          collector_number: '161',
          finishes: [],
        }),
      ],
    })
    const result = await runCli(
      [
        'set-card',
        '--deck',
        'test',
        '--card-id',
        '2',
        '--set',
        'lea',
        '--collector-number',
        '161',
        '--finish',
        'nonfoil',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['printing → LEA:161', 'finish → nonfoil'])
  })

  test('fails as runtime_error when the printing lookup itself fails', async () => {
    // A local stub cache server that always 500s makes the card-cache read
    // throw, exercising the lookup-failure path without any network access.
    const stub = Bun.serve({
      port: 0,
      fetch: () => new Response('cache offline', { status: 500 }),
    })
    try {
      const result = await runCli(
        [
          'set-card',
          '--deck',
          'test',
          '--card-id',
          '2',
          '--set',
          '2xm',
          '--collector-number',
          '157',
          '--output',
          'json',
        ],
        dir,
        { RITUAL_CACHE_SERVER: `127.0.0.1:${stub.port}` },
      )
      expect(result.exitCode).toBe(1)
      const err = JSON.parse(result.stderr) as ErrorJson
      expect(err.error.code).toBe('runtime_error')
      // The lookup-failure branch specifically — not the pin-verification one,
      // whose message also names the card.
      expect(err.error.message).toContain('Failed to look up printings for')
    } finally {
      await stub.stop(true)
    }
  })

  test('rejects --set without --collector-number', async () => {
    const result = await runCli(
      ['set-card', '--deck', 'test', '--card-id', '2', '--set', '2xm', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('must be given together')
  })

  test('rejects an invocation with no mutation flags', async () => {
    const result = await runCli(
      ['set-card', '--deck', 'test', 'Sol', 'Ring', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('at least one change')
  })

  test('rejects --condition on a wanted list', async () => {
    const result = await runCli(
      ['set-card', '--wanted', 'needs', 'Demonic', '--condition', 'LP', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('condition')
  })

  test('sets condition on a collection entry without touching the printing', async () => {
    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Mana',
        'Crypt',
        '--condition',
        'lp',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['condition → LP'])
    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Mana Crypt (2XM:1) [foil] [LP] &2')
  })

  test('folds --finish and --condition into one update without a printing pair', async () => {
    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Mana',
        'Crypt',
        '--finish',
        'nonfoil',
        '--condition',
        'HP',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['condition → HP', 'finish → nonfoil'])
    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    // nonfoil renders without a finish annotation; HP appears as the condition.
    expect(content).toContain('- Mana Crypt (2XM:1) [HP] &2')
  })

  test('moves a deck card to a section, creating it when missing', async () => {
    const result = await runCli(
      ['set-card', '--deck', 'test', 'Sol', 'Ring', '--section', 'Sideboard', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('## Sideboard')
    expect(deckContent).toContain('2 Sol Ring &1')

    const changelog = await fs.readFile(path.join(dir, 'decks', 'test.changes.md'), 'utf-8')
    expect(changelog).toContain('Moved "Sol Ring" to section "Sideboard" &1')
  })

  test('preserves hand-written prose in the file — only the target line changes', async () => {
    // The audit's exact repro: prose under the front matter and inside a
    // section must survive a one-shot mutation byte-for-byte.
    const deckPath = path.join(dir, 'decks', 'prose.md')
    const before = [
      '---',
      'name: Prose Deck',
      '---',
      '',
      'Some prose the user wrote under the front matter.',
      '',
      '## Main',
      '1 Sol Ring &1',
      'a note between cards',
      '',
    ].join('\n')
    await fs.writeFile(deckPath, before)

    const result = await runCli(
      ['set-card', '--deck', 'prose', 'Sol', 'Ring', '--finish', 'foil'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const after = await fs.readFile(deckPath, 'utf-8')
    expect(after).toBe(before.replace('1 Sol Ring &1', '1 Sol Ring [foil] &1'))
  })

  test('rejects --section on a collection', async () => {
    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Sol',
        'Ring',
        '--section',
        'Binder',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('--section only applies to decks')
  })

  test('rejects --commander on a collection', async () => {
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol', 'Ring', '--commander', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('--commander/--no-commander only apply to decks')
  })

  test('--commander moves the card into a Commander section', async () => {
    const result = await runCli(
      ['set-card', '--deck', 'test', 'Sol', 'Ring', '--commander', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['commander'])
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    // The Commander section body (up to the next section) holds the card now.
    const commanderBody = deckContent.split('## Commander')[1]?.split('## ')[0] ?? ''
    expect(commanderBody).toContain('2 Sol Ring &1')
  })

  test('--no-commander moves the card back out of the Commander section', async () => {
    await runCli(['set-card', '--deck', 'test', 'Sol', 'Ring', '--commander'], dir)
    const result = await runCli(
      ['set-card', '--deck', 'test', 'Sol', 'Ring', '--no-commander', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['not commander'])
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    // The Commander section body (up to the next section) is empty again...
    const commanderBody = deckContent.split('## Commander')[1]?.split('## ')[0] ?? ''
    expect(commanderBody).not.toContain('Sol Ring')
    // ...and the card is back in the Main section.
    expect(deckContent).toMatch(/## Main[\s\S]*2 Sol Ring &1/)
  })

  test('fails with usage_error when the card name is ambiguous', async () => {
    // Shallow pin only — remove-card.test.ts holds the representative deep
    // assertion on the ambiguity payload (details.matches shape).
    const result = await runCli(
      ['set-card', '--deck', 'test', 'Lightning', 'Bolt', '--finish', 'foil', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Multiple cards match')
  })

  test('returns not_found for a card that is not in the list', async () => {
    const result = await runCli(
      ['set-card', '--deck', 'test', 'Black', 'Lotus', '--finish', 'foil', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('not_found')
  })

  test('rejects an invalid --finish value at parse time', async () => {
    const result = await runCli(
      ['set-card', '--deck', 'test', 'Sol', 'Ring', '--finish', 'glossy', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("Invalid finish 'glossy'")
  })
})
