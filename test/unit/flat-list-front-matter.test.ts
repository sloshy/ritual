import { describe, expect, test } from 'bun:test'
import { parseFlatListFrontMatter } from '../../src/list/flat-list-front-matter'
import { collectionToMarkdown, wantedToMarkdown, withFrontMatter } from '../../src/list/list-export'
import { parseCollectionFile } from '../../src/list/collection-file'
import { parseWantedListFile } from '../../src/list/wanted-file'
import type { CollectionCardEntry, WantedListCardEntry } from '../../src/list/site-data'
import { makeCollectionEntry } from '../test-utils'

describe('parseFlatListFrontMatter', () => {
  test('no block: bodyStart 0, nothing captured', () => {
    const result = parseFlatListFrontMatter(['# Title', ''], { validateLabels: true })
    expect(result).toEqual({ bodyStart: 0, advisories: [] })
  })

  test('captures the block verbatim and parses its mapping', () => {
    const lines = ['---', 'labels: [sale]', 'owner: me', '---', '', '# Title']
    const result = parseFlatListFrontMatter(lines, { validateLabels: true })
    expect(result.bodyStart).toBe(4)
    expect(result.frontMatter?.raw).toBe('---\nlabels: [sale]\nowner: me\n---\n')
    expect(result.frontMatter?.data).toEqual({ labels: ['sale'], owner: 'me' })
    expect(result.labels).toEqual(['sale'])
    expect(result.advisories).toEqual([])
  })

  test('validateLabels: false carries a labels key without interpreting it', () => {
    const lines = ['---', 'labels: [sale, keep]', '---', '# Title']
    const result = parseFlatListFrontMatter(lines, { validateLabels: false })
    expect(result.labels).toBeUndefined()
    expect(result.advisories).toEqual([])
    expect(result.frontMatter?.data.labels).toEqual(['sale', 'keep'])
  })

  test('non-mapping YAML degrades to an advisory with the raw preserved', () => {
    const lines = ['---', '42', '---', '# Title']
    const result = parseFlatListFrontMatter(lines, { validateLabels: true })
    expect(result.frontMatter?.raw).toBe('---\n42\n---\n')
    expect(result.frontMatter?.data).toEqual({})
    expect(result.advisories.some((a) => a.includes('not a key/value mapping'))).toBe(true)
  })
})

const entry = (overrides: Partial<CollectionCardEntry> = {}): CollectionCardEntry =>
  makeCollectionEntry({
    name: 'Sol Ring',
    set: 'c21',
    collectorNumber: '263',
    cardId: 1,
    ...overrides,
  })

describe('front-matter round trips through the whole-file serializers', () => {
  test('collectionToMarkdown re-emits the block byte for byte with one blank line', () => {
    const original =
      '---\n# hand-written comment\nlabels: [sale, trade]\n---\n\n# Binder\n\n## Main\n- Sol Ring (C21:263) &1\n'
    const parsed = parseCollectionFile(original)
    const out = collectionToMarkdown(
      'Binder',
      parsed.entries.map((e, i) =>
        entry({
          name: e.name,
          set: e.set,
          collectorNumber: e.collectorNumber,
          finish: e.finish ?? 'nonfoil',
          condition: e.condition ?? 'NM',
          labels: e.labels,
          note: e.note,
          cardId: e.cardId,
          section: e.section,
          fileOrder: i,
        }),
      ),
      parsed.sectionOrder,
      parsed.frontMatter,
    )
    expect(out).toBe(original)
  })

  test('a labeled override survives the round trip in canonical order', () => {
    const out = collectionToMarkdown('Binder', [entry({ labels: ['trade', 'sale'] })], [])
    expect(out).toContain('- Sol Ring (C21:263) [sale,trade] &1\n')
    const reparsed = parseCollectionFile(out)
    expect(reparsed.entries[0]!.labels).toEqual(['sale', 'trade'])
  })

  test('wantedToMarkdown preserves a front-matter block it never interprets', () => {
    const original = '---\nowner: me\n---\n\n# Wants\n\n## Main\n- Mana Crypt &1\n'
    const parsed = parseWantedListFile(original)
    const entries: WantedListCardEntry[] = parsed.entries.map((e, i) => ({
      name: e.name,
      set: e.set,
      collectorNumber: e.collectorNumber,
      finish: e.finish,
      price: 0,
      fileOrder: i,
      section: e.section,
      note: e.note,
      state: 'name-only',
      cardId: e.cardId,
    }))
    const out = wantedToMarkdown('Wants', entries, parsed.sectionOrder, parsed.frontMatter)
    expect(out).toBe(original)
  })

  test('withFrontMatter is a no-op without a block', () => {
    expect(withFrontMatter(undefined, '# Binder\n')).toBe('# Binder\n')
  })
})
