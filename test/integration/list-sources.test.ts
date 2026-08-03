import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  discoverListSources,
  resolveDeckSources,
  resolveListSources,
} from '../../src/site/list-sources'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ritual-sources-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const write = (name: string, content: string) => writeFile(path.join(dir, name), content)

describe('resolveDeckSources', () => {
  // Deck display name comes from `name:` frontmatter, falling back to file name.
  beforeEach(async () => {
    await write('izzet-storm.md', '---\nname: Izzet Storm\n---\n## Main\n4 Lightning Bolt\n')
    await write('panther.md', '---\nname: Black Panther\n---\n## Main\n1 Sol Ring\n')
    await write('atraxa.md', '## Commander\n1 Atraxa, Praetors Voice\n') // no name → file base name
    await write('izzet-storm.primer.md', '# Primer') // must be ignored
    await write('izzet-storm.changes.md', '# Changes') // must be ignored
  })

  test('wildcard includes every deck', async () => {
    const sources = await resolveDeckSources(dir, ['*'], [])
    expect(sources.sort()).toEqual(['atraxa', 'izzet-storm', 'panther'])
  })

  test('filters by frontmatter display name', async () => {
    const sources = await resolveDeckSources(dir, ['Izzet Storm', 'Black Panther'], [])
    expect(sources.sort()).toEqual(['izzet-storm', 'panther'])
  })

  test('falls back to file base name when no frontmatter name', async () => {
    const sources = await resolveDeckSources(dir, ['atraxa'], [])
    expect(sources).toEqual(['atraxa'])
  })

  test('an empty selection includes no decks', async () => {
    expect(await resolveDeckSources(dir, [], [])).toEqual([])
  })

  test('exclude drops a deck from a wildcard include', async () => {
    const sources = await resolveDeckSources(dir, ['*'], ['Black Panther'])
    expect(sources.sort()).toEqual(['atraxa', 'izzet-storm'])
  })
})

describe('resolveListSources', () => {
  // Collection/wanted display name comes from the `# Title`, falling back to file name.
  beforeEach(async () => {
    await write('red.md', '# Red Binder\n- Lightning Bolt (LEA:161)\n')
    await write('ecl.md', '# ECL\n- Sol Ring (C19:221)\n')
    await write('untitled.md', '- Llanowar Elves (M19:314)\n') // no H1 → file base name
    await write('red.changes.md', '# Changes') // must be ignored
  })

  test('wildcard includes every list', async () => {
    const sources = await resolveListSources(dir, ['*'], [])
    expect(sources.sort()).toEqual(['ecl', 'red', 'untitled'])
  })

  test('filters by H1 title', async () => {
    expect(await resolveListSources(dir, ['Red Binder'], [])).toEqual(['red'])
  })

  test('falls back to file base name when no H1 title', async () => {
    expect(await resolveListSources(dir, ['untitled'], [])).toEqual(['untitled'])
  })

  test('exclude drops a list from a wildcard include by H1 title', async () => {
    const sources = await resolveListSources(dir, ['*'], ['Red Binder'])
    expect(sources.sort()).toEqual(['ecl', 'untitled'])
  })
})

describe('discoverListSources', () => {
  // The missing-directory invariant: a workspace with no `decks/` yet is a first
  // run, not a failure. It used to be the one list type that raised a raw ENOENT.
  test.each([['deck'], ['flat']] as const)(
    'a missing %s directory is an empty set',
    async (kind) => {
      expect(await discoverListSources(kind, path.join(dir, 'not-there'))).toEqual([])
    },
  )

  test('an unreadable file is kept, named after itself, carrying its reason', async () => {
    // Dropped instead, it became invisible: nothing downstream could report it,
    // so a default build published without it and exited 0.
    await write('broken.md', '---\nname: [broken\n---\n')
    await write('fine.md', '---\nname: Fine Deck\n---\n## Main\n1 Sol Ring\n')

    const entries = await discoverListSources('deck', dir)

    const broken = entries.find((e) => e.basename === 'broken')
    expect(broken?.displayName).toBe('broken')
    expect(broken?.readError).toContain('flow collection')
    expect(entries.find((e) => e.basename === 'fine')?.readError).toBeUndefined()
  })

  test('an unreadable list is not offered as a servable source', async () => {
    // `resolveDeckSources` feeds `serve --api`'s live index, which has no
    // channel to report a reason — so it must not list one it cannot load.
    await write('broken.md', '---\nname: [broken\n---\n')
    await write('fine.md', '---\nname: Fine Deck\n---\n## Main\n1 Sol Ring\n')

    expect(await resolveDeckSources(dir, ['*'], [])).toEqual(['fine'])
  })
})
