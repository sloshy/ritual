import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import {
  createWorkspace,
  removeWorkspace,
  seedCardCache,
  seedCardTargetWorkspace,
  snapshotTree,
  writeBulkProvenance,
} from './helpers/workspace'
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

  describe('finish validation without a printing change', () => {
    // The 2XM:157 entry (&3) is nonfoil/foil; LEA:161 (&2) is nonfoil only.
    test('rejects an unavailable finish on the finish-only branch', async () => {
      await seedCardCache(dir, { 'Lightning Bolt': LIGHTNING_BOLT_PRINTINGS })
      const result = await runCli(
        ['set-card', '--deck', 'test', '--card-id', '3', '--finish', 'etched', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as ErrorJson
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('not available in etched')
      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).not.toContain('[etched]')
    })

    test('rejects an unavailable finish on the condition+finish branch too', async () => {
      await seedCardCache(dir, { 'Lightning Bolt': LIGHTNING_BOLT_PRINTINGS })
      const result = await runCli(
        [
          'set-card',
          '--deck',
          'test',
          '--card-id',
          '3',
          '--condition',
          'LP',
          '--finish',
          'etched',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as ErrorJson
      expect(err.error.message).toContain('not available in etched')
      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).not.toContain('[LP]')
    })

    test("accepts a finish the entry's own printing offers", async () => {
      await seedCardCache(dir, { 'Lightning Bolt': LIGHTNING_BOLT_PRINTINGS })
      const result = await runCli(
        ['set-card', '--deck', 'test', '--card-id', '3', '--finish', 'foil'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).toContain('1 Lightning Bolt (2XM:157) [foil] &3')
    })

    test('skips validation with a note when the cache cannot vouch for the printing', async () => {
      // No card cache at all: no complete printing list, so no rejection may be
      // fabricated — the edit proceeds and says why it was not checked.
      const result = await runCli(
        ['set-card', '--deck', 'test', '--card-id', '3', '--finish', 'etched'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('could not verify finish')
      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).toContain('1 Lightning Bolt (2XM:157) [etched] &3')
    })

    test('names the unknown printing when that, not the cache, is why the check was skipped', async () => {
      // The cache knows Sol Ring completely; it just does not know C21:240, so
      // preloading would never enable this check and must not be suggested.
      await seedCardCache(dir, {
        'Sol Ring': [makeScryfallCard({ name: 'Sol Ring', set: 'lea', collector_number: '270' })],
      })
      const result = await runCli(
        ['set-card', '--collection', 'main', '--card-id', '1', '--finish', 'etched'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('C21:240 is not a known printing')
      expect(result.stderr).not.toContain('preload-all')
    })

    test('a printing-less deck line is not finish-validated at all', async () => {
      await seedCardCache(dir, { 'Lightning Bolt': LIGHTNING_BOLT_PRINTINGS })
      const result = await runCli(
        ['set-card', '--deck', 'test', 'Sol', 'Ring', '--finish', 'etched'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).toContain('2 Sol Ring [etched] &1')
    })
  })

  describe('finish validation on a printing change', () => {
    test("refuses a repin whose new printing lacks the entry's carried-over finish", async () => {
      await seedCardCache(dir, { 'Lightning Bolt': LIGHTNING_BOLT_PRINTINGS })
      // &2 is LEA:161 recorded as [foil]; 2XM:157 has foil, LEA:161 does not.
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
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as ErrorJson
      expect(err.error.message).toContain('not available in foil')
      expect(err.error.message).toContain('--finish')
      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).toContain('1 Lightning Bolt (LEA:161) [foil] &2')
    })

    test('an explicit --finish the new printing offers repins normally', async () => {
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
          'nonfoil',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).toContain('1 Lightning Bolt (LEA:161) &2')
    })
  })

  describe('--condition NONE', () => {
    test('clears a recorded grade', async () => {
      await runCli(['set-card', '--collection', 'main', '--card-id', '1', '--condition', 'LP'], dir)
      const result = await runCli(
        [
          'set-card',
          '--collection',
          'main',
          '--card-id',
          '1',
          '--condition',
          'NONE',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as SetCardJson
      expect(json.applied).toEqual(['condition → none (grade cleared)'])
      const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
      expect(content).toContain('- Sol Ring (C21:240) &1')
      expect(content).not.toContain('[LP]')
    })

    test('reports NM as the ungraded default rather than a recorded grade', async () => {
      // Starts from a graded entry: setting NM must *clear* the recorded LP, so
      // a regression that wrote `[NM]` through would fail on the file too.
      await runCli(['set-card', '--collection', 'main', '--card-id', '1', '--condition', 'LP'], dir)
      const result = await runCli(
        [
          'set-card',
          '--collection',
          'main',
          '--card-id',
          '1',
          '--condition',
          'NM',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as SetCardJson
      expect(json.applied[0]).toContain('NM is the default')
      const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
      expect(content).toContain('- Sol Ring (C21:240) &1')
      expect(content).not.toContain('[NM]')
      expect(content).not.toContain('[LP]')
    })

    test('rejects an unknown condition value at parse time, naming NONE', async () => {
      const result = await runCli(
        ['set-card', '--collection', 'main', '--card-id', '1', '--condition', 'MINT'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('NONE')
    })
  })

  test('--dry-run reports the change and writes nothing', async () => {
    const before = await snapshotTree(dir)
    const result = await runCli(
      [
        'set-card',
        '--deck',
        'test',
        'Sol',
        'Ring',
        '--section',
        'Sideboard',
        '-n',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson & { dryRun?: boolean }
    expect(json.dryRun).toBe(true)
    expect(json.applied).toEqual(['section → Sideboard'])
    expect(await snapshotTree(dir)).toEqual(before)
  })

  test('a --card-id that disagrees with the card name is a usage error', async () => {
    const result = await runCli(
      [
        'set-card',
        '--deck',
        'test',
        'Sol',
        'Ring',
        '--card-id',
        '3',
        '--finish',
        'foil',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain("--card-id 3 is 'Lightning Bolt'")
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).not.toContain('(2XM:157) [foil]')
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

describe('set-card --language (Integration)', () => {
  /** Sol Ring's C21:240 printing in English plus a Japanese language object. */
  const SOL_RING_WITH_JA: ScryfallCard[] = [
    makeScryfallCard({ id: 'sol-c21-en', name: 'Sol Ring', set: 'c21', collector_number: '240' }),
    makeScryfallCard({
      id: 'sol-c21-ja',
      name: 'Sol Ring',
      set: 'c21',
      collector_number: '240',
      lang: 'ja',
    }),
  ]

  test('writes the [ja] token and the changelog line when the cache holds the ja object', async () => {
    await seedCardCache(dir, { 'Sol Ring': SOL_RING_WITH_JA })
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--language', 'ja', '--output', 'json'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['language → ja (Japanese)'])

    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C21:240) [ja] &1')

    const changelog = await fs.readFile(path.join(dir, 'collections', 'main.changes.md'), 'utf-8')
    expect(changelog).toContain('- Set language of "Sol Ring" to Japanese &1')
  })

  test('--language en clears the token — a bare line means English', async () => {
    await seedCardCache(dir, { 'Sol Ring': SOL_RING_WITH_JA })
    await runCli(['set-card', '--collection', 'main', 'Sol Ring', '--language', 'ja'], dir)
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--language', 'en', '--output', 'json'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['language → en (token cleared — a bare line means English)'])

    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C21:240) &1')
    expect(content).not.toContain('[ja]')

    const changelog = await fs.readFile(path.join(dir, 'collections', 'main.changes.md'), 'utf-8')
    expect(changelog).toContain('- Set language of "Sol Ring" to English &1')
  })

  test('accepts the jp alias and records ja', async () => {
    await seedCardCache(dir, { 'Sol Ring': SOL_RING_WITH_JA })
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--language', 'jp'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C21:240) [ja] &1')
  })

  test('rejects an unknown language code at parse time', async () => {
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--language', 'xx'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Invalid language "xx"')
  })

  test('refuses a language an all_cards-backed cache proves the printing lacks', async () => {
    // Complete cache, all_cards provenance, only an en object: the absence of a
    // ja object is a fact, refused without any network verification.
    await seedCardCache(dir, {
      'Sol Ring': [
        makeScryfallCard({
          id: 'sol-c21-en',
          name: 'Sol Ring',
          set: 'c21',
          collector_number: '240',
        }),
      ],
    })
    await writeBulkProvenance(dir, 'all_cards')
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--language', 'ja', '--output', 'json'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('not available in Japanese')
    expect(err.error.message).toContain('Available languages: English (en)')

    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).not.toContain('[ja]')
  })

  test('proceeds with a warning when the on-demand verification cannot reach Scryfall', async () => {
    // A default_cards cache cannot prove a ja object does not exist, so the CLI
    // tries the on-demand GET — unreachable here (offline env), which must skip
    // the check with a note rather than fabricate a refusal or fail the edit.
    // The proxied fetch only fails at the Scryfall client's own 15s timeout,
    // hence the generous test timeout.
    await seedCardCache(dir, {
      'Sol Ring': [
        makeScryfallCard({
          id: 'sol-c21-en',
          name: 'Sol Ring',
          set: 'c21',
          collector_number: '240',
        }),
      ],
    })
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--language', 'ja'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('could not verify')
    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C21:240) [ja] &1')
  }, 30000)

  test('rides alongside a printing change as its own event, validated against the new pin', async () => {
    await seedCardCache(dir, {
      'Lightning Bolt': [
        ...LIGHTNING_BOLT_PRINTINGS,
        makeScryfallCard({
          id: 'bolt-2xm-ja',
          name: 'Lightning Bolt',
          set: '2xm',
          collector_number: '157',
          finishes: ['nonfoil', 'foil'],
          lang: 'ja',
        }),
      ],
    })
    // &2 is LEA:161 [foil]; repin to 2XM:157 (which has foil and a ja object).
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
        '--language',
        'ja',
        '--output',
        'json',
      ],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['printing → 2XM:157', 'language → ja (Japanese)'])

    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('1 Lightning Bolt (2XM:157) [foil] [ja] &2')

    const changelog = await fs.readFile(path.join(dir, 'decks', 'test.changes.md'), 'utf-8')
    expect(changelog).toContain('- Set language of "Lightning Bolt" to Japanese &2')
  })

  test('a wanted list entry takes a language token too', async () => {
    // Underground Sea LEB:286 with a ja object; wanted grammar carries [lang].
    await seedCardCache(dir, {
      'Underground Sea': [
        makeScryfallCard({
          id: 'sea-leb-en',
          name: 'Underground Sea',
          set: 'leb',
          collector_number: '286',
        }),
        makeScryfallCard({
          id: 'sea-leb-ja',
          name: 'Underground Sea',
          set: 'leb',
          collector_number: '286',
          lang: 'ja',
        }),
      ],
    })
    const result = await runCli(
      ['set-card', '--wanted', 'needs', 'Underground Sea', '--language', 'ja'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
    expect(content).toContain('- Underground Sea (LEB:286) [ja] &2')
  })

  test('--dry-run validates the language but writes nothing', async () => {
    await seedCardCache(dir, { 'Sol Ring': SOL_RING_WITH_JA })
    const before = await snapshotTree(dir)
    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Sol Ring',
        '--language',
        'ja',
        '-n',
        '--output',
        'json',
      ],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson & { dryRun?: boolean }
    expect(json.dryRun).toBe(true)
    expect(await snapshotTree(dir)).toEqual(before)
  })
})

describe('set-card --label (Integration)', () => {
  test('sets a normalized label token and logs the changelog line', async () => {
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--label', 'trade,sale', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['label → sale, trade'])

    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C21:240) [sale,trade] &1')

    const changelog = await fs.readFile(path.join(dir, 'collections', 'main.changes.md'), 'utf-8')
    expect(changelog).toContain('- Set labels on "Sol Ring" &1 to [sale,trade]')
  })

  test('--label none clears the override and logs the clear', async () => {
    await runCli(['set-card', '--collection', 'main', 'Sol Ring', '--label', 'keep'], dir)
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--label', 'none', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['label → none (list default)'])

    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C21:240) &1')
    expect(content).not.toContain('[keep]')

    const changelog = await fs.readFile(path.join(dir, 'collections', 'main.changes.md'), 'utf-8')
    expect(changelog).toContain('- Cleared labels on "Sol Ring" &1')
  })

  test('rejects --label on a deck target', async () => {
    const result = await runCli(
      ['set-card', '--deck', 'test', '--card-id', '3', '--label', 'sale', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('--label only applies to collections')
  })

  test('rejects an illegal combination at parse time', async () => {
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--label', 'keep,sale'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("'keep' cannot be combined")
  })
})
