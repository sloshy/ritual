import { describe, it, expect } from 'bun:test'
import type { ChangeEvent } from '../../src/change-event'
import {
  buildChangeBundle,
  serializeChangeBundle,
  parseChangeBundle,
  bundleChangeCount,
  countLabel,
  type ChangeBundle,
} from '../../src/editor/change-bundle'

const sampleChanges: ChangeEvent[] = [
  { id: 'a1', timestamp: 1000, action: 'add', cardName: 'Sol Ring', cardId: 5 },
  { id: 'r1', timestamp: 1001, action: 'remove', cardName: 'Llanowar Elves', cardId: 9 },
]

const buildBundle = (): ChangeBundle =>
  buildChangeBundle({
    lists: [
      { kind: 'deck', slug: 'my-deck', name: 'My Deck', changes: sampleChanges },
      {
        kind: 'collection',
        slug: 'binder',
        name: 'Binder',
        baseContentHash: 'hash456',
        changes: [sampleChanges[0]!],
      },
    ],
    exportedAt: '2026-06-04T00:00:00.000Z',
  })

describe('change-bundle round trip', () => {
  it('serializes and parses back to an equivalent bundle', () => {
    const parsed = parseChangeBundle(serializeChangeBundle(buildBundle()))
    expect(typeof parsed).not.toBe('string')
    expect(parsed).toEqual(buildBundle())
  })

  it('omits baseContentHash when not provided', () => {
    const parsed = parseChangeBundle(serializeChangeBundle(buildBundle()))
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.lists[0]?.baseContentHash).toBeUndefined()
    expect(parsed.lists[1]?.baseContentHash).toBe('hash456')
  })

  it('counts changes across every list', () => {
    expect(bundleChangeCount(buildBundle())).toBe(3)
    expect(bundleChangeCount(buildChangeBundle({ lists: [], exportedAt: 'x' }))).toBe(0)
  })
})

describe('parseChangeBundle validation', () => {
  it('rejects non-JSON', () => {
    expect(parseChangeBundle('not json{')).toContain('JSON')
  })

  it('rejects a non-object payload', () => {
    expect(parseChangeBundle('42')).toContain('object')
  })

  it('rejects a missing format marker', () => {
    expect(parseChangeBundle(JSON.stringify({ version: 1, lists: [] }))).toContain(
      'ritual change bundle',
    )
  })

  it('rejects an unsupported version', () => {
    const text = JSON.stringify({ ...buildBundle(), version: 2 })
    expect(parseChangeBundle(text)).toContain('version')
  })

  it('rejects a non-array lists field', () => {
    const text = JSON.stringify({ ...buildBundle(), lists: 'nope' })
    expect(parseChangeBundle(text)).toContain('lists')
  })

  it('reports which list entry is invalid', () => {
    const bundle = buildBundle()
    const text = JSON.stringify({
      ...bundle,
      lists: [bundle.lists[0], { ...bundle.lists[1], kind: 'sideboard' }],
    })
    const result = parseChangeBundle(text)
    expect(result).toContain('List #2')
    expect(result).toContain('kind')
  })

  it('reports an invalid change inside a list entry', () => {
    const bundle = buildBundle()
    const text = JSON.stringify({
      ...bundle,
      lists: [{ ...bundle.lists[0], changes: [{ action: 'teleport' }] }],
    })
    const result = parseChangeBundle(text)
    expect(result).toContain('List #1')
    expect(result).toContain('unknown action')
  })

  it('rejects a non-string set on a change', () => {
    const bundle = buildBundle()
    const text = JSON.stringify({
      ...bundle,
      lists: [
        {
          ...bundle.lists[0],
          changes: [{ id: 'a1', timestamp: 1, action: 'add', cardName: 'Sol Ring', set: 42 }],
        },
      ],
    })
    expect(parseChangeBundle(text)).toContain('invalid "set"')
  })

  it('normalizes set codes to lowercase (externally-authored files may uppercase them)', () => {
    const bundle = buildBundle()
    const text = JSON.stringify({
      ...bundle,
      lists: [
        {
          ...bundle.lists[0],
          changes: [
            { id: 'a1', timestamp: 1, action: 'add', cardName: 'Sol Ring', set: 'C19' },
            { id: 'p1', timestamp: 2, action: 'set-printing', cardName: 'Sol Ring', set: 'MKM' },
          ],
        },
      ],
    })
    const parsed = parseChangeBundle(text)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.lists[0]?.changes.map((c) => ('set' in c ? c.set : undefined))).toEqual([
      'c19',
      'mkm',
    ])
  })

  it('validates labels on set-label and add changes, normalizing the order', () => {
    const bundle = buildBundle()
    // Against the bundle's *collection* list: which labels are legal depends on
    // the list type the changes land in.
    const withChanges = (changes: unknown[]): string =>
      JSON.stringify({ ...bundle, lists: [{ ...bundle.lists[1], changes }] })

    const parsed = parseChangeBundle(
      withChanges([
        {
          id: 'l1',
          timestamp: 1,
          action: 'set-label',
          cardName: 'Sol Ring',
          labels: ['trade', 'sale'],
        },
        { id: 'a1', timestamp: 2, action: 'add', cardName: 'Mox Ruby', labels: ['trade', 'sale'] },
      ]),
    )
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.lists[0]?.changes.map((c) => ('labels' in c ? c.labels : undefined))).toEqual([
      ['sale', 'trade'],
      ['sale', 'trade'],
    ])

    // A keep conflict is refused on both actions; an add without labels is fine.
    expect(
      parseChangeBundle(
        withChanges([
          {
            id: 'l1',
            timestamp: 1,
            action: 'set-label',
            cardName: 'Sol Ring',
            labels: ['keep', 'sale'],
          },
        ]),
      ),
    ).toContain("'keep' cannot be combined")
    expect(
      parseChangeBundle(
        withChanges([
          { id: 'a1', timestamp: 1, action: 'add', cardName: 'Sol Ring', labels: ['bogus'] },
        ]),
      ),
    ).toContain('Change #1')
  })

  it('refuses labels the target list type does not carry', () => {
    const bundle = buildBundle()
    const deckChanges = (changes: unknown[]): string =>
      JSON.stringify({ ...bundle, lists: [{ ...bundle.lists[0], changes }] })

    expect(
      parseChangeBundle(
        deckChanges([
          { id: 'l1', timestamp: 1, action: 'set-label', cardName: 'Sol Ring', labels: ['sale'] },
        ]),
      ),
    ).toContain('labels [sale] are not supported on a deck')

    // `proxy` is exactly what a deck does carry, so it parses.
    const parsed = parseChangeBundle(
      deckChanges([
        { id: 'l1', timestamp: 1, action: 'set-label', cardName: 'Sol Ring', labels: ['proxy'] },
      ]),
    )
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.lists[0]?.changes[0]).toMatchObject({ labels: ['proxy'] })
  })

  it('validates languages: normalizes case, rejects unknown codes, requires one on set-language', () => {
    const bundle = buildBundle()
    const withChanges = (changes: unknown[]): string =>
      JSON.stringify({ ...bundle, lists: [{ ...bundle.lists[0], changes }] })

    // Round-trip: a set-language and a language-carrying add survive, lowercased.
    const parsed = parseChangeBundle(
      withChanges([
        { id: 'l1', timestamp: 1, action: 'set-language', cardName: 'Sol Ring', language: 'JA' },
        { id: 'a1', timestamp: 2, action: 'add', cardName: 'Sol Ring', language: 'ja' },
      ]),
    )
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.lists[0]?.changes.map((c) => ('language' in c ? c.language : undefined))).toEqual(
      ['ja', 'ja'],
    )

    // An unknown code is rejected the way a bad action is.
    expect(
      parseChangeBundle(
        withChanges([
          { id: 'l1', timestamp: 1, action: 'set-language', cardName: 'Sol Ring', language: 'xx' },
        ]),
      ),
    ).toContain('unknown language')
    expect(
      parseChangeBundle(
        withChanges([
          { id: 'a1', timestamp: 1, action: 'add', cardName: 'Sol Ring', language: 42 },
        ]),
      ),
    ).toContain('unknown language')

    // set-language without the field is malformed.
    expect(
      parseChangeBundle(
        withChanges([{ id: 'l1', timestamp: 1, action: 'set-language', cardName: 'Sol Ring' }]),
      ),
    ).toContain('missing its "language"')
  })

  it('accepts section-structural changes', () => {
    const bundle = buildBundle()
    const text = JSON.stringify({
      ...bundle,
      lists: [
        {
          ...bundle.lists[0],
          changes: [{ id: 's1', timestamp: 1, action: 'add-section', section: 'Lands' }],
        },
      ],
    })
    expect(typeof parseChangeBundle(text)).not.toBe('string')
  })
})

describe('countLabel', () => {
  it('pluralizes with a trailing s except for exactly one', () => {
    expect(countLabel(0, 'change')).toBe('0 changes')
    expect(countLabel(1, 'change')).toBe('1 change')
    expect(countLabel(2, 'list')).toBe('2 lists')
  })
})
