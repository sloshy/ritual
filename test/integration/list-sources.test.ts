import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveDeckSources, resolveListSources } from '../../src/site/list-sources'

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

  test('include names that match nothing are ignored', async () => {
    expect(await resolveDeckSources(dir, ['Mono Red Aggro'], [])).toEqual([])
  })

  test('exclude drops a deck from a wildcard include', async () => {
    const sources = await resolveDeckSources(dir, ['*'], ['Black Panther'])
    expect(sources.sort()).toEqual(['atraxa', 'izzet-storm'])
  })

  test('exclude wins over an explicit include of the same deck', async () => {
    const sources = await resolveDeckSources(
      dir,
      ['Izzet Storm', 'Black Panther'],
      ['Black Panther'],
    )
    expect(sources).toEqual(['izzet-storm'])
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

  test('an empty selection includes no lists', async () => {
    expect(await resolveListSources(dir, [], [])).toEqual([])
  })

  test('exclude drops a list from a wildcard include by H1 title', async () => {
    const sources = await resolveListSources(dir, ['*'], ['Red Binder'])
    expect(sources.sort()).toEqual(['ecl', 'untitled'])
  })
})
