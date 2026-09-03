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
} from '../helpers/workspace'
import { makeScryfallCard } from '../test-utils'
import type { ScryfallCard } from '../../src/scryfall/types'

type SetCardJson = {
  type: string
  list: string
  cardName: string
  cardId?: number
  applied: string[]
  writtenFiles: string[]
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

  test('accepts the same finish when the call pins a printing alongside it', async () => {
    await seedCardCache(dir, {
      'Sol Ring': [
        makeScryfallCard({
          name: 'Sol Ring',
          set: 'c19',
          collector_number: '221',
          finishes: ['nonfoil', 'foil'],
        }),
      ],
    })
    const result = await runCli(
      [
        'set-card',
        '--deck',
        'test',
        '--card-id',
        '1',
        '--set',
        'c19',
        '--collector-number',
        '221',
        '--finish',
        'foil',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['printing → C19:221', 'finish → foil'])

    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('2 Sol Ring (C19:221) [foil] &1')
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

    // A language edit rather than a finish one: this line pins no printing, and
    // a finish belongs to a printing.
    const result = await runCli(
      ['set-card', '--deck', 'prose', 'Sol', 'Ring', '--language', 'ja'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const after = await fs.readFile(deckPath, 'utf-8')
    expect(after).toBe(before.replace('1 Sol Ring &1', '- 1 Sol Ring [ja] &1'))
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

    test('adding --condition does not smuggle the finish past the same refusal', async () => {
      // `--condition` without `--set` is encoded as a set-printing carrying the
      // entry's current printing plus the new finish — which writes the same
      // token by another route, so the same rule has to hold there.
      await seedCardCache(dir, { 'Lightning Bolt': LIGHTNING_BOLT_PRINTINGS })
      const deckPath = path.join(dir, 'decks', 'test.md')
      const before = await fs.readFile(deckPath, 'utf-8')
      const result = await runCli(
        [
          'set-card',
          '--deck',
          'test',
          '--card-id',
          '1',
          '--finish',
          'foil',
          '--condition',
          'LP',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as ErrorJson
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('names no printing')
      expect(await fs.readFile(deckPath, 'utf-8')).toBe(before)
    })

    test('a dry run previews the refusal rather than a change the real run rejects', async () => {
      await seedCardCache(dir, { 'Lightning Bolt': LIGHTNING_BOLT_PRINTINGS })
      const result = await runCli(
        ['set-card', '--deck', 'test', '--card-id', '1', '--finish', 'foil', '--dry-run'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('names no printing')
      // Still a dry run: the refusal comes from an in-memory apply.
      expect(await fs.exists(path.join(dir, 'decks', 'test.changes.md'))).toBe(false)
    })

    test('a printing-less deck line is refused a finish outright', async () => {
      await seedCardCache(dir, { 'Lightning Bolt': LIGHTNING_BOLT_PRINTINGS })
      const deckPath = path.join(dir, 'decks', 'test.md')
      const before = await fs.readFile(deckPath, 'utf-8')
      // There is nothing to validate the finish *against* — and nothing for the
      // token to describe either, so the edit is rejected rather than skipped.
      const result = await runCli(
        ['set-card', '--deck', 'test', 'Sol', 'Ring', '--finish', 'etched', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as ErrorJson
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('names no printing')
      // Refused before the write: the file and its changelog are untouched.
      expect(await fs.readFile(deckPath, 'utf-8')).toBe(before)
      expect(await fs.exists(path.join(dir, 'decks', 'test.changes.md'))).toBe(false)
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

  test('labels a deck card proxy, keeping &N last, and logs the changelog line', async () => {
    const result = await runCli(
      ['set-card', '--deck', 'test', '--card-id', '3', '--label', 'proxy', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['label → proxy'])

    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('1 Lightning Bolt (2XM:157) [proxy] &3')

    const changelog = await fs.readFile(path.join(dir, 'decks', 'test.changes.md'), 'utf-8')
    expect(changelog).toContain('- Set labels on "Lightning Bolt" &3 to [proxy]')
  })

  test('rejects a collection-only label on a deck target', async () => {
    const result = await runCli(
      ['set-card', '--deck', 'test', '--card-id', '3', '--label', 'sale', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('Decks only carry these labels: proxy')
  })

  test('rejects --label on a wanted list, which carries no labels at all', async () => {
    const result = await runCli(
      ['set-card', '--wanted', 'needs', 'Underground Sea', '--label', 'proxy', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.message).toContain('Wanted list entries do not carry labels')
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

describe('set-card --tag / --untag (Integration)', () => {
  test('--tag adds a canonical tag token and logs one changelog line per tag', async () => {
    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Sol Ring',
        '--tag',
        'Staple, Card Draw',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['tags added → Card Draw, Staple'])

    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C21:240) #Card Draw, Staple &1')

    const changelog = await fs.readFile(path.join(dir, 'collections', 'main.changes.md'), 'utf-8')
    expect(changelog).toContain('- Added tag "Card Draw" to "Sol Ring" &1')
    expect(changelog).toContain('- Added tag "Staple" to "Sol Ring" &1')
  })

  test('--untag removes only the named tags; a tag already present is not re-logged', async () => {
    const seed = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--tag', 'ramp, staple'],
      dir,
    )
    expect(seed.exitCode).toBe(0)
    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Sol Ring',
        '--untag',
        'ramp',
        '--tag',
        'staple',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual([
      'tags unchanged (staple already on the line)',
      'tags removed → ramp',
    ])

    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C21:240) #staple &1')

    const changelog = await fs.readFile(path.join(dir, 'collections', 'main.changes.md'), 'utf-8')
    expect(changelog).toContain('- Removed tag "ramp" from "Sol Ring" &1')
    expect(changelog.match(/Added tag "staple"/g)).toHaveLength(1)
  })

  test('tags land on deck and wanted lines too, before the id', async () => {
    const deck = await runCli(
      ['set-card', '--deck', 'test', '--card-id', '3', '--tag', 'edh', '--output', 'json'],
      dir,
    )
    expect(deck.exitCode).toBe(0)
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('1 Lightning Bolt (2XM:157) #edh &3')

    const wanted = await runCli(
      ['set-card', '--wanted', 'needs', 'Underground Sea', '--tag', 'dual', '--output', 'json'],
      dir,
    )
    expect(wanted.exitCode).toBe(0)
    const wantedContent = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
    expect(wantedContent).toContain('- Underground Sea (LEB:286) #dual &2')
  })

  test('a run whose every tag is already in its requested state writes nothing', async () => {
    const seed = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--tag', 'ramp'],
      dir,
    )
    expect(seed.exitCode).toBe(0)
    const before = await snapshotTree(dir)

    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Sol Ring',
        '--tag',
        'ramp',
        '--untag',
        'nope',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual([
      'tags unchanged (ramp already on the line)',
      'tags unchanged (nope not on the line)',
    ])
    // No list rewrite, no changelog entry, no sidecar touch for a no-op.
    expect(await snapshotTree(dir)).toEqual(before)
  })

  test('repeating --tag accumulates', async () => {
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--tag', 'ramp', '--tag', 'staple'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C21:240) #ramp, staple &1')
  })

  test('--dry-run previews the tag change and writes nothing', async () => {
    const before = await snapshotTree(dir)
    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Sol Ring',
        '--tag',
        'ramp',
        '--dry-run',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson & { dryRun?: boolean }
    expect(json.dryRun).toBe(true)
    expect(json.applied).toEqual(['tags added → ramp'])
    expect(await snapshotTree(dir)).toEqual(before)
  })

  test('the same tag to both --tag and --untag is a usage error', async () => {
    const before = await snapshotTree(dir)
    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Sol Ring',
        '--tag',
        'ramp',
        '--untag',
        'ramp',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('--untag: ramp')
    expect(await snapshotTree(dir)).toEqual(before)
  })

  test('a malformed tag is rejected at parse time', async () => {
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--tag', 'ramp, R&D'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Invalid tag "R&D"')
    expect(result.stderr).toContain('--tag')
  })
})

describe('set-card --art (Integration)', () => {
  /** The `.art.json` sidecar as JSON.parse yields it: card id → file/url ref. */
  type ArtSidecar = Record<string, { file?: string; url?: string }>

  const ART_URL = 'https://example.com/art/bolt.png'

  /** Place an image under the workspace's default art directory (`./art`). */
  async function seedArtFile(relPath: string): Promise<void> {
    const full = path.join(dir, 'art', relPath)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, 'not really a png')
  }

  async function readSidecar(relPath: string): Promise<ArtSidecar> {
    return JSON.parse(await fs.readFile(path.join(dir, relPath), 'utf-8')) as ArtSidecar
  }

  test('records a local art file and leaves the list and changelog untouched', async () => {
    await seedArtFile('proxies/bolt.png')
    const before = await snapshotTree(dir)
    const result = await runCli(
      [
        'set-card',
        '--deck',
        'test',
        '--card-id',
        '3',
        '--art',
        'proxies/bolt.png',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['custom art → proxies/bolt.png'])

    expect(await readSidecar('decks/test.art.json')).toEqual({ '3': { file: 'proxies/bolt.png' } })
    // The sidecar rides the `writtenFiles` machine contract, so an auto-commit
    // stages it — and nothing else is claimed.
    expect(json.writtenFiles).toEqual([path.join(dir, 'decks', 'test.art.json')])
    // Art is list metadata: the sidecar is the only file the run may touch.
    const after = await snapshotTree(dir)
    delete after['decks/test.art.json']
    expect(after).toEqual(before)
  })

  test('stores an http(s) URL verbatim on a collection entry', async () => {
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--art', ART_URL, '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual([`custom art → ${ART_URL}`])
    expect(await readSidecar('collections/main.art.json')).toEqual({ '1': { url: ART_URL } })
  })

  test('sets art on a wanted list entry', async () => {
    const result = await runCli(
      ['set-card', '--wanted', 'needs', 'Underground Sea', '--art', ART_URL, '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    expect(await readSidecar('wanted/needs.art.json')).toEqual({ '2': { url: ART_URL } })
  })

  test('--art none clears the entry, removing the sidecar with the last one', async () => {
    await runCli(['set-card', '--collection', 'main', 'Sol Ring', '--art', ART_URL], dir)
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--art', 'none', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['custom art → none (cleared)'])
    expect(await Bun.file(path.join(dir, 'collections', 'main.art.json')).exists()).toBe(false)
  })

  test('keeps other cards art when one is cleared', async () => {
    await runCli(['set-card', '--collection', 'main', 'Sol Ring', '--art', ART_URL], dir)
    await runCli(['set-card', '--collection', 'main', 'Mana Crypt', '--art', ART_URL], dir)
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--art', 'none'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    expect(await readSidecar('collections/main.art.json')).toEqual({ '2': { url: ART_URL } })
  })

  test('applies art alongside a line change in one run', async () => {
    const result = await runCli(
      [
        'set-card',
        '--deck',
        'test',
        '--card-id',
        '3',
        '--label',
        'proxy',
        '--art',
        ART_URL,
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['label → proxy', `custom art → ${ART_URL}`])

    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('1 Lightning Bolt (2XM:157) [proxy] &3')
    expect(await readSidecar('decks/test.art.json')).toEqual({ '3': { url: ART_URL } })

    const changelog = await fs.readFile(path.join(dir, 'decks', 'test.changes.md'), 'utf-8')
    expect(changelog).toContain('- Set labels on "Lightning Bolt" &3 to [proxy]')
    // The sidecar write is metadata — it must not reach the changelog.
    expect(changelog).not.toContain(ART_URL)
  })

  test('rejects a path with no image behind it, naming the path it checked', async () => {
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--art', 'missing.png', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('not_found')
    expect(err.error.message).toContain(path.join('art', 'missing.png'))
    expect(await Bun.file(path.join(dir, 'collections', 'main.art.json')).exists()).toBe(false)
  })

  test('rejects a file that is not an image, before it can be deployed and 404', async () => {
    await seedArtFile('notes.txt')
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--art', 'notes.txt'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('not an image file')
    expect(await Bun.file(path.join(dir, 'collections', 'main.art.json')).exists()).toBe(false)
  })

  test('rejects a path escaping the art directory at parse time', async () => {
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--art', '../secrets.png'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('escapes the art directory')
  })

  test('rejects art for a card the list does not have', async () => {
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Black Lotus', '--art', ART_URL, '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('not_found')
    expect(await Bun.file(path.join(dir, 'collections', 'main.art.json')).exists()).toBe(false)
  })

  test('--dry-run reports the art change and writes nothing', async () => {
    await seedArtFile('proxies/bolt.png')
    const before = await snapshotTree(dir)
    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Sol Ring',
        '--art',
        'proxies/bolt.png',
        '-n',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson & { dryRun?: boolean }
    expect(json.dryRun).toBe(true)
    expect(json.applied).toEqual(['custom art → proxies/bolt.png'])
    expect(await snapshotTree(dir)).toEqual(before)
  })
})

describe('set-card --categories / --no-categories (Integration)', () => {
  const listFile = (): string => path.join(dir, 'collections', 'main.md')
  const sidecar = (): string => path.join(dir, 'collections', 'main.categories.json')

  test('writes the sidecar and its hash, reports both, and leaves the card line alone', async () => {
    const lineBefore = await fs.readFile(listFile(), 'utf-8')
    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Sol Ring',
        '--categories',
        'Ramp, Artifacts',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['categories → Ramp, Artifacts'])

    // The item-(b) assertion: the `line-mutate` categories seam reports the
    // sidecar AND its hash among the run's written files, alongside the
    // changelog. The list `.md` is NOT there — a categories-only batch leaves
    // every card line as it was, so rewriting it (and re-stamping its hash)
    // would both misreport the run and launder a hand edit past
    // `detect-changes`.
    expect(json.writtenFiles).toEqual([
      path.join(dir, 'collections', 'main.changes.md'),
      sidecar(),
      `${sidecar()}.sha256`,
    ])

    expect(JSON.parse(await fs.readFile(sidecar(), 'utf-8'))).toEqual({
      order: ['Ramp', 'Artifacts'],
      cards: { 'Sol Ring': ['Ramp', 'Artifacts'] },
    })
    // Categories are never on the line: the list file's card lines are unchanged.
    expect(await fs.readFile(listFile(), 'utf-8')).toBe(lineBefore)

    const changelog = await fs.readFile(path.join(dir, 'collections', 'main.changes.md'), 'utf-8')
    expect(changelog).toContain('- Set categories of "Sol Ring" to Ramp, Artifacts')
  })

  test("--no-categories clears the card's categories, keeping the list's vocabulary", async () => {
    const seed = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--categories', 'Ramp'],
      dir,
    )
    expect(seed.exitCode).toBe(0)

    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--no-categories', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson
    expect(json.applied).toEqual(['categories cleared'])
    expect(json.writtenFiles).toContain(sidecar())
    expect(json.writtenFiles).toContain(`${sidecar()}.sha256`)
    // The card's entry goes; the list's declared vocabulary is not the card's
    // to delete, so the sidecar stays.
    expect(JSON.parse(await fs.readFile(sidecar(), 'utf-8'))).toEqual({
      order: ['Ramp'],
      cards: {},
    })

    const changelog = await fs.readFile(path.join(dir, 'collections', 'main.changes.md'), 'utf-8')
    expect(changelog).toContain('- Cleared categories of "Sol Ring"')
  })

  test('an empty --categories value is a usage error, not a clear', async () => {
    const result = await runCli(
      ['set-card', '--collection', 'main', 'Sol Ring', '--categories', ''],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--no-categories')
  })

  test('--dry-run writes nothing and reports no written files', async () => {
    const before = await snapshotTree(dir)
    const result = await runCli(
      [
        'set-card',
        '--collection',
        'main',
        'Sol Ring',
        '--categories',
        'Ramp',
        '-n',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as SetCardJson & { dryRun?: boolean }
    expect(json.dryRun).toBe(true)
    expect(json.writtenFiles).toEqual([])
    expect(await snapshotTree(dir)).toEqual(before)
  })
})
