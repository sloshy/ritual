import { describe, expect, test } from 'bun:test'
import {
  buildDeckSetBody,
  buildFlatListSetBody,
  type DeckArrayValues,
} from '../../src/commands/metadata'
import { mergeArrayValues, splitCommaTokens } from '../../src/config-fields'
import { dumpFrontMatterBlock, readFrontMatterMapping } from '../../src/front-matter-write'

describe('mergeArrayValues', () => {
  test('replace dedupes the new values', () => {
    expect(mergeArrayValues(['a'], ['b', 'c', 'b'], 'replace')).toEqual(['b', 'c'])
  })

  test('add unions with the current values, first-seen order', () => {
    expect(mergeArrayValues(['a', 'b'], ['b', 'c'], 'add')).toEqual(['a', 'b', 'c'])
  })

  test('remove drops the given values and keeps the rest in order', () => {
    expect(mergeArrayValues(['a', 'b', 'c'], ['b', 'x'], 'remove')).toEqual(['a', 'c'])
  })
})

describe('splitCommaTokens', () => {
  test('splits comma-joined and separate values alike, dropping empty tokens', () => {
    expect(splitCommaTokens(['a, b', 'c', ' , ,d'])).toEqual(['a', 'b', 'c', 'd'])
    expect(splitCommaTokens([''])).toEqual([])
  })
})

describe('buildDeckSetBody', () => {
  const none: DeckArrayValues = { tags: [], labels: [] }

  test('description joins its values with spaces', () => {
    expect(buildDeckSetBody('description', ['A', 'budget', 'list'], none, 'replace')).toEqual({
      description: 'A budget list',
    })
  })

  test('tags treat each value as one tag and honor the array mode', () => {
    expect(buildDeckSetBody('tags', ['budget'], { tags: ['aggro'], labels: [] }, 'add')).toEqual({
      tags: ['aggro', 'budget'],
    })
  })

  test('tags tokenize commas inside a single argument too', () => {
    expect(buildDeckSetBody('tags', ['a,b', 'c'], none, 'replace')).toEqual({
      tags: ['a', 'b', 'c'],
    })
  })

  test('single-value keys refuse multiple values', () => {
    expect(buildDeckSetBody('format', ['modern', 'legacy'], none, 'replace')).toContain(
      'exactly one value',
    )
  })

  test('--add on a non-array key is an error', () => {
    expect(buildDeckSetBody('description', ['x'], none, 'add')).toContain('--add/--remove')
  })

  test('labels accept the deck vocabulary and honor the array mode', () => {
    expect(buildDeckSetBody('labels', ['Proxy'], none, 'replace')).toEqual({ labels: ['proxy'] })
    expect(
      buildDeckSetBody('labels', ['proxy'], { tags: [], labels: ['proxy'] }, 'remove'),
    ).toEqual({ labels: [] })
  })

  test('a label a deck cannot carry is refused, naming the deck vocabulary', () => {
    const message = buildDeckSetBody('labels', ['sale'], none, 'replace')
    expect(message).toContain("Invalid label 'sale'")
    expect(message).toContain('proxy')
  })
})

describe('buildFlatListSetBody', () => {
  test('labels accept separate and comma-joined values alike, case-insensitively', () => {
    expect(buildFlatListSetBody('collection', 'labels', ['sale,trade'], [], 'replace')).toEqual({
      labels: ['sale', 'trade'],
    })
    expect(buildFlatListSetBody('collection', 'labels', ['Sale', 'TRADE'], [], 'replace')).toEqual({
      labels: ['sale', 'trade'],
    })
  })

  test('a token outside the vocabulary errors even under --remove', () => {
    expect(buildFlatListSetBody('collection', 'labels', ['bogus'], ['sale'], 'remove')).toContain(
      "Invalid label 'bogus'",
    )
  })

  test('remove can empty the set (the parser then clears the key)', () => {
    expect(buildFlatListSetBody('collection', 'labels', ['sale'], ['sale'], 'remove')).toEqual({
      labels: [],
    })
  })

  test('an empty replace is refused — clearing is unset, not an accidental empty set', () => {
    expect(buildFlatListSetBody('collection', 'labels', [''], [], 'replace')).toContain(
      'No labels given',
    )
  })

  test('description joins its values with spaces, on either flat list type', () => {
    expect(
      buildFlatListSetBody('wanted', 'description', ['Cards', 'I', 'need'], [], 'replace'),
    ).toEqual({ description: 'Cards I need' })
    expect(
      buildFlatListSetBody('collection', 'description', ['My', 'binder'], [], 'replace'),
    ).toEqual({ description: 'My binder' })
  })

  test('--add on a non-array key is an error', () => {
    expect(buildFlatListSetBody('collection', 'description', ['x'], [], 'add')).toContain(
      '--add/--remove',
    )
    expect(buildFlatListSetBody('wanted', 'description', ['x'], [], 'add')).toContain(
      'a wanted list has none',
    )
  })
})

describe('dumpFrontMatterBlock', () => {
  test('an empty mapping dumps no block at all', () => {
    expect(dumpFrontMatterBlock({})).toBeUndefined()
  })

  test('round-trips through readFrontMatterMapping with a single trailing newline', () => {
    const raw = dumpFrontMatterBlock({ labels: ['sale', 'trade'], owner: 'me' })
    expect(raw).toBeDefined()
    expect(raw!.endsWith('---\n')).toBeTrue()
    const mapping = readFrontMatterMapping(raw!)
    if (!mapping.ok) throw new Error('expected a readable block')
    expect(mapping.data).toEqual({ labels: ['sale', 'trade'], owner: 'me' })
  })
})
