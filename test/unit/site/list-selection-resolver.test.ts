import { describe, expect, test } from 'bun:test'
import {
  selectConfiguredSources,
  selectNamedSources,
  type ListSourceEntry,
} from '../../../src/site-build/list-sources'

/**
 * The one resolver both selection mechanisms use. Flags used to match file base
 * names while `site.include*` matched display names, so a deck the config could
 * publish was not selectable by `--decks` under the name the docs use.
 */
const entries: ListSourceEntry[] = [
  { basename: 'test-unset-commander', displayName: 'Test Unset Commander' },
  { basename: 'emberwild-aggro', displayName: 'Emberwild Aggro' },
  { basename: 'atraxa', displayName: 'atraxa' },
  // Mixed-case, separator-punctuated base name whose display name differs: the
  // only entry that can exercise the base-name folding tier on its own.
  { basename: 'Winota-Stax', displayName: 'Winota, Joiner of Forces' },
  // Diacritics, to pin that folding is `normalizeListName`'s, not `toLowerCase`.
  { basename: 'cafe-tron', displayName: 'Café Tron' },
]

describe('selectNamedSources', () => {
  test('matches an explicit name on its display name', () => {
    const { sources, missing } = selectNamedSources(entries, ['Test Unset Commander'])
    expect(sources.map((s) => s.basename)).toEqual(['test-unset-commander'])
    expect(missing).toEqual([])
  })

  test('falls back to the file base name, with or without .md', () => {
    expect(selectNamedSources(entries, ['emberwild-aggro']).sources[0]?.basename).toBe(
      'emberwild-aggro',
    )
    expect(selectNamedSources(entries, ['emberwild-aggro.md']).sources[0]?.basename).toBe(
      'emberwild-aggro',
    )
  })

  test('matching folds case, separators and diacritics like every other command', () => {
    const resolves = (name: string): string | undefined =>
      selectNamedSources(entries, [name]).sources[0]?.basename
    expect(resolves('test unset commander')).toBe('test-unset-commander')
    // Base name only — no display name folds to this.
    expect(resolves('winota stax')).toBe('Winota-Stax')
    expect(resolves('WINOTA_STAX')).toBe('Winota-Stax')
    expect(resolves('cafe tron')).toBe('cafe-tron')
  })

  test('an exact hit beats a folded one, so a tie is not invented', () => {
    // `Emberwild Aggro` is exactly one entry's display name and folds to the
    // same key as its own base name; the exact tier must settle it alone.
    const { sources, ambiguous } = selectNamedSources(entries, ['Emberwild Aggro'])
    expect(sources.map((s) => s.basename)).toEqual(['emberwild-aggro'])
    expect(ambiguous).toEqual([])
  })

  test('two lists answering to one name are reported, not silently disambiguated', () => {
    // Two decks can carry the same `name:` front matter; picking the first would
    // build a list the user did not ask for and say nothing.
    const duplicates: ListSourceEntry[] = [
      { basename: 'burn-a', displayName: 'Burn' },
      { basename: 'burn-b', displayName: 'Burn' },
    ]
    const { sources, missing, ambiguous } = selectNamedSources(duplicates, ['Burn'])
    expect(sources).toEqual([])
    expect(missing).toEqual([])
    expect(ambiguous).toEqual([{ name: 'Burn', matches: ['Burn', 'Burn'] }])
  })

  test('an unmatched name is reported rather than silently dropped', () => {
    const { sources, missing } = selectNamedSources(entries, ['Nonexistent Deck', 'atraxa'])
    expect(sources.map((s) => s.basename)).toEqual(['atraxa'])
    expect(missing).toEqual(['Nonexistent Deck'])
  })

  test('an unreadable file is still selectable, carrying its reason', () => {
    // Discovery keeps it so the caller can say *why* it failed rather than
    // "no deck named that" about a file sitting right there.
    const withBroken: ListSourceEntry[] = [
      { basename: 'broken', displayName: 'broken', readError: 'bad front matter' },
    ]
    const { sources, missing } = selectNamedSources(withBroken, ['broken'])
    expect(missing).toEqual([])
    expect(sources[0]?.readError).toBe('bad front matter')
  })

  test('the same list named twice is built once', () => {
    const { sources } = selectNamedSources(entries, ['atraxa', 'atraxa.md'])
    expect(sources).toHaveLength(1)
  })
})

describe('selectConfiguredSources', () => {
  test('a wildcard include keeps everything and reports nothing unmatched', () => {
    const result = selectConfiguredSources(entries, ['*'], [])
    expect(result.sources).toHaveLength(entries.length)
    expect(result.unmatchedIncludes).toEqual([])
  })

  test('config matches display names exactly, unlike the flags', () => {
    // Deliberate: a config file is written once and on purpose, so a drifted
    // name is reported rather than resolved to a near neighbour.
    const result = selectConfiguredSources(entries, ['emberwild aggro'], [])
    expect(result.sources).toEqual([])
    expect(result.unmatchedIncludes).toEqual(['emberwild aggro'])
  })

  test('an include entry matching no list is reported (config drifts on rename)', () => {
    const result = selectConfiguredSources(entries, ['Emberwild Aggro', 'Old Name'], [])
    expect(result.sources.map((s) => s.basename)).toEqual(['emberwild-aggro'])
    expect(result.unmatchedIncludes).toEqual(['Old Name'])
  })

  test('exclusion wins over a wildcard include and is not an unmatched include', () => {
    const result = selectConfiguredSources(entries, ['*'], ['atraxa'])
    expect(result.sources.map((s) => s.basename)).not.toContain('atraxa')
    expect(result.unmatchedIncludes).toEqual([])
  })
})
