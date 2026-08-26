import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { createWorkspace, removeWorkspace } from './helpers/workspace'
import type { ScryfallCard } from '../../src/scryfall/types'
import type { CachedItem, CacheSchema } from '../../src/cache/file-cache'

// End-to-end proof that a fenced code block in a list file is prose: the
// line-preserving commands mutate the real card lines around it and never the
// card-looking lines inside it, and the commands that cannot preserve it (the
// whole-file rewrites) refuse rather than delete it.
//
// The per-parser semantics are pinned in the unit suites (markdown-fence,
// text-file, line-mutate, ensure-card-ids); this covers the wiring — the CLI
// path from resolve through apply and back out to the file on disk.

const SOL_RING: ScryfallCard = {
  id: 'it-fenced-sol-ring',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  prices: { usd: '1.00', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'c21',
  set_name: 'Commander 2021',
  collector_number: '263',
  rarity: 'rare',
  color_identity: [],
  released_at: '2021-01-01',
}

/** A one-card synthetic Scryfall cache, stamped fresh so no refresh prompt fires. */
async function writeCardCache(dir: string): Promise<void> {
  const now = Date.now()
  const cards: Record<string, CachedItem<ScryfallCard[]>> = {
    'Sol Ring': { timestamp: now, data: [SOL_RING], lowercaseName: 'sol ring' },
  }
  const schema: CacheSchema = {
    prices: {},
    cards,
    cardNameIndex: { 'sol ring': 'Sol Ring' },
    metadata: { cards: { lastRefreshedAt: now } },
  }
  await fs.mkdir(path.join(dir, 'cache'), { recursive: true })
  await fs.writeFile(path.join(dir, 'cache', 'cache.json'), JSON.stringify(schema))
}

// Every card line inside the fence is textually distinct from anything a
// command below could legitimately write, so no assertion can be satisfied by
// the fenced copy of a line it meant to find in the real body. `Mox Pearl`
// carries no `&N`: the id backfill must leave it that way.
const FENCED_BLOCK = [
  '```',
  '## Fake Section',
  '9 Sol Ring &7',
  '1 Black Lotus (LEA:232) &8',
  '1 Mox Pearl',
  '```',
].join('\n')

const DECK = [
  '---',
  'name: Fenced Deck',
  '---',
  '',
  '## Main',
  '1 Sol Ring &1',
  '',
  FENCED_BLOCK,
  '',
  '## Sideboard',
  '1 Pyroblast &2',
  '',
].join('\n')

let dir: string
let deckPath: string

beforeEach(async () => {
  dir = await createWorkspace()
  await writeCardCache(dir)
  deckPath = path.join(dir, 'decks', 'Fenced Deck.md')
  await fs.writeFile(deckPath, DECK)
})

afterEach(async () => {
  await removeWorkspace(dir)
})

async function readDeck(): Promise<string> {
  return fs.readFile(deckPath, 'utf-8')
}

describe('fenced code blocks in list files (Integration)', () => {
  test('a deck add merges onto the real line and leaves the fenced block untouched', async () => {
    const result = await runCli(
      ['add-card', '--deck', 'Fenced Deck', 'Sol', 'Ring', '--exact', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as { cardId: number; section: string }
    // The copy landed on the real line's id, in the real `## Main` section.
    expect(json.cardId).toBe(1)
    expect(json.section).toBe('Main')

    const content = await readDeck()
    // add-card backfills ids, so this run also proves the fenced `1 Mox Pearl`
    // is left without one.
    expect(content).toContain(FENCED_BLOCK)
    expect(content.split('\n')).toContain('2 Sol Ring &1')
  })

  test('a card that exists only inside the fence is not found', async () => {
    const result = await runCli(
      ['remove-card', '--deck', 'Fenced Deck', 'Black', 'Lotus', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).not.toBe(0)
    expect(await readDeck()).toBe(DECK)
  })

  test('remove-card takes out the real line and leaves the fenced block byte-identical', async () => {
    const result = await runCli(
      ['remove-card', '--deck', 'Fenced Deck', 'Sol', 'Ring', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)

    const content = await readDeck()
    expect(content).toContain(FENCED_BLOCK)
    expect(content.split('\n')).not.toContain('1 Sol Ring &1')
  })

  test("the deck's card count excludes fenced lines", async () => {
    const result = await runCli(['list-all-cards', '--output', 'json'], dir)
    expect(result.exitCode).toBe(0)
    const cards = JSON.parse(result.stdout) as { name: string }[]
    const names = cards.map((card) => card.name).sort()
    expect(names).toEqual(['Pyroblast', 'Sol Ring'])
  })
})

// ── Whole-file rewrites refuse rather than delete ───────────────────

describe('fenced code blocks block whole-file rewrites (Integration)', () => {
  test('cleanup reports the block and leaves the file alone', async () => {
    const result = await runCli(['cleanup', '--check', '--no-input'], dir)
    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('Fenced code block content')
    expect(await readDeck()).toBe(DECK)
  })

  test('a move out of a fenced deck refuses and writes nothing', async () => {
    const wantedPath = path.join(dir, 'wanted', 'Wants.md')
    const wanted = '# Wants\n\n## Main\n- Force of Will &1\n'
    await fs.writeFile(wantedPath, wanted)

    const result = await runCli(
      ['move', 'Pyroblast', '--from', 'deck:Fenced Deck', '--to', 'wanted:Wants', '--no-input'],
      dir,
    )
    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('cannot re-emit')
    expect(await readDeck()).toBe(DECK)
    expect(await fs.readFile(wantedPath, 'utf-8')).toBe(wanted)
  })

  test('import --append refuses when the target holds a fenced block', async () => {
    const collectionPath = path.join(dir, 'collections', 'Binder.md')
    const collection = [
      '# Binder',
      '',
      '## Main',
      '- Sol Ring (C21:263) &1',
      '',
      '```',
      '- Example Card (LEA:1) &9',
      '```',
      '',
    ].join('\n')
    await fs.writeFile(collectionPath, collection)
    await fs.writeFile(path.join(dir, 'in.csv'), 'name,set,number\nSol Ring,c21,263\n')

    const result = await runCli(
      [
        'import',
        'in.csv',
        '-t',
        'collection',
        '--name',
        'Binder',
        '--append',
        '-c',
        'name=1,set=2,collector-number=3',
        '--no-input',
      ],
      dir,
    )
    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('cannot re-emit')
    expect(await fs.readFile(collectionPath, 'utf-8')).toBe(collection)
  })
})

// ── Line-preserving edits around a fence ────────────────────────────

describe('fenced code blocks and the list lifecycle (Integration)', () => {
  test('a move takes the real bullet, never the fenced one of the same name', async () => {
    const sourcePath = path.join(dir, 'collections', 'Source.md')
    const source = [
      '# Source',
      '',
      '## Main',
      '```',
      '- Sol Ring (C21:263) &7',
      '```',
      '- Sol Ring (C21:263) &1',
      '',
    ].join('\n')
    await fs.writeFile(sourcePath, source)
    const destPath = path.join(dir, 'wanted', 'Wants.md')
    await fs.writeFile(destPath, '# Wants\n\n## Main\n- Force of Will &1\n')

    const result = await runCli(
      [
        'move',
        'Sol Ring',
        '--from',
        'collection:Source',
        '--to',
        'wanted:Wants',
        '--set',
        'c21',
        '--collector-number',
        '263',
        '--no-input',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)

    const after = await fs.readFile(sourcePath, 'utf-8')
    // The fenced bullet is byte-identical; the real one is gone.
    expect(after).toContain('```\n- Sol Ring (C21:263) &7\n```')
    expect(after.split('\n')).not.toContain('- Sol Ring (C21:263) &1')
    expect(await fs.readFile(destPath, 'utf-8')).toContain('- Sol Ring (C21:263)')
  })

  test('rename rewrites the real H1, not a fenced one', async () => {
    const listPath = path.join(dir, 'collections', 'Binder.md')
    await fs.writeFile(
      listPath,
      ['```', '# Binder', '```', '', '# Binder', '', '- Sol Ring (C21:263) &1', ''].join('\n'),
    )

    const result = await runCli(['rename', 'Binder', 'Vault', '--collection', '--no-input'], dir)
    expect(result.exitCode).toBe(0)

    const after = await fs.readFile(path.join(dir, 'collections', 'Vault.md'), 'utf-8')
    expect(after).toContain('```\n# Binder\n```')
    expect(after.split('\n')).toContain('# Vault')
  })

  test('an add refuses when the file ends inside an unclosed fence', async () => {
    const collectionPath = path.join(dir, 'collections', 'Open.md')
    const open = [
      '# Open',
      '',
      '## Main',
      '- Sol Ring (C21:263) &1',
      '',
      '```',
      '- Example',
      '',
    ].join('\n')
    await fs.writeFile(collectionPath, open)

    const result = await runCli(
      [
        'add-card',
        '--collection',
        'Open',
        'Sol',
        'Ring',
        '--exact',
        '--set',
        'c21',
        '--collector-number',
        '263',
        '--condition',
        'NONE',
        '--no-input',
      ],
      dir,
    )
    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('unclosed code fence')
    expect(await fs.readFile(collectionPath, 'utf-8')).toBe(open)
  })
})
