import { describe, expect, test } from 'bun:test'
import {
  type ScryfallTag,
  attachTags,
  buildTagIndex,
  getIllustrationIds,
  parseTagBulk,
  parseTagIndex,
} from '../../../src/scryfall/tags'
import { mapScryfallCard } from '../../../src/scryfall/card-utils'
import type { ScryfallCard } from '../../../src/types'

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'card-id',
    name: 'Test Card',
    cmc: 0,
    type_line: 'Artifact',
    prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    finishes: ['nonfoil'],
    games: ['paper'],
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    rarity: 'common',
    color_identity: [],
    ...overrides,
  }
}

const oracleTag = (slug: string, oracleIds: string[]): ScryfallTag => ({
  object: 'tag',
  id: `oracle-${slug}`,
  label: slug,
  slug,
  type: 'oracle',
  taggings: oracleIds.map((oracle_id) => ({ oracle_id, weight: 'strong' })),
})

const artTag = (slug: string, illustrationIds: string[]): ScryfallTag => ({
  object: 'tag',
  id: `art-${slug}`,
  label: slug,
  slug,
  type: 'illustration',
  taggings: illustrationIds.map((illustration_id) => ({ illustration_id, weight: 'median' })),
})

describe('parseTagBulk', () => {
  test('returns the parsed tags for a well-formed array', () => {
    const result = parseTagBulk([oracleTag('ramp', ['o1'])])
    expect(Array.isArray(result)).toBeTrue()
    expect((result as ScryfallTag[])[0]!.slug).toBe('ramp')
  })

  test('returns an error string when payload is not an array', () => {
    expect(parseTagBulk({ data: [] })).toContain('expected a JSON array')
  })

  test('returns an error string when an entry is missing a slug', () => {
    const result = parseTagBulk([{ object: 'tag', id: 'x', label: 'X', type: 'oracle' }])
    expect(typeof result).toBe('string')
    expect(result as string).toContain('missing a string slug')
  })

  test('returns an error string for an unexpected tag type', () => {
    const result = parseTagBulk([
      { object: 'tag', id: 'x', label: 'Foo', slug: 'foo', type: 'keyword' },
    ])
    expect(result as string).toContain("unexpected type 'keyword'")
  })

  test('returns an error string when required id/label fields are missing', () => {
    expect(parseTagBulk([{ object: 'tag', slug: 'foo', type: 'oracle' }]) as string).toContain(
      'missing a string id',
    )
    expect(
      parseTagBulk([{ object: 'tag', id: 'x', slug: 'foo', type: 'oracle' }]) as string,
    ).toContain('missing a string label')
  })
})

describe('parseTagIndex', () => {
  test('returns the index for a well-formed object', () => {
    const index = { updatedAt: 5, oracle: { o1: ['ramp'] }, illustration: {} }
    expect(parseTagIndex(index)).toEqual(index)
  })

  test('rejects non-objects and missing maps', () => {
    expect(parseTagIndex(null) as string).toContain('expected an object')
    expect(parseTagIndex({ oracle: {}, illustration: {} }) as string).toContain('updatedAt')
    expect(parseTagIndex({ updatedAt: 1, illustration: {} }) as string).toContain('oracle map')
    expect(parseTagIndex({ updatedAt: 1, oracle: {} }) as string).toContain('illustration map')
  })
})

describe('buildTagIndex', () => {
  test('inverts taggings into id-keyed, sorted, deduped slug lists', () => {
    const index = buildTagIndex(
      [oracleTag('ramp', ['o1']), oracleTag('artifact', ['o1', 'o2'])],
      [artTag('machine', ['i1'])],
      123,
    )
    expect(index.updatedAt).toBe(123)
    expect(index.oracle['o1']).toEqual(['artifact', 'ramp'])
    expect(index.oracle['o2']).toEqual(['artifact'])
    expect(index.illustration['i1']).toEqual(['machine'])
  })

  test('dedupes a slug repeated across taggings for the same id', () => {
    const index = buildTagIndex([oracleTag('ramp', ['o1', 'o1'])], [], 0)
    expect(index.oracle['o1']).toEqual(['ramp'])
  })

  test('keeps oracle and illustration maps separate', () => {
    const index = buildTagIndex([oracleTag('ramp', ['o1'])], [artTag('ramp', ['i1'])], 0)
    expect(index.oracle['i1']).toBeUndefined()
    expect(index.illustration['o1']).toBeUndefined()
  })
})

describe('getIllustrationIds', () => {
  test('returns the top-level illustration id for single-faced cards', () => {
    expect(getIllustrationIds(makeCard({ illustration_id: 'i1' }))).toEqual(['i1'])
  })

  test('collects every face illustration id for double-faced cards', () => {
    const dfc = makeCard({
      card_faces: [
        { name: 'Front', mana_cost: '', type_line: '', oracle_text: '', illustration_id: 'if1' },
        { name: 'Back', mana_cost: '', type_line: '', oracle_text: '', illustration_id: 'if2' },
      ],
    })
    expect(getIllustrationIds(dfc)).toEqual(['if1', 'if2'])
  })

  test('unions top-level and per-face illustration ids, deduped', () => {
    const card = makeCard({
      illustration_id: 'i-top',
      card_faces: [
        { name: 'Front', mana_cost: '', type_line: '', oracle_text: '', illustration_id: 'if1' },
        { name: 'Back', mana_cost: '', type_line: '', oracle_text: '', illustration_id: 'i-top' },
      ],
    })
    // Top-level id appears first; a face repeating it is collapsed by attachTags' Set,
    // but getIllustrationIds returns the raw collected ids.
    expect(getIllustrationIds(card)).toEqual(['i-top', 'if1', 'i-top'])
  })

  test('returns an empty array when no illustration ids are present', () => {
    expect(getIllustrationIds(makeCard())).toEqual([])
  })
})

describe('mapScryfallCard tag round-trip', () => {
  test('preserves already-attached oracleTags and artTags', () => {
    const enriched = makeCard({ oracleTags: ['ramp'], artTags: ['machine'] })
    const mapped = mapScryfallCard(enriched)
    expect(mapped.oracleTags).toEqual(['ramp'])
    expect(mapped.artTags).toEqual(['machine'])
  })

  test('leaves tag fields undefined for raw cards without tags', () => {
    const mapped = mapScryfallCard(makeCard())
    expect(mapped.oracleTags).toBeUndefined()
    expect(mapped.artTags).toBeUndefined()
  })
})

describe('attachTags', () => {
  const index = buildTagIndex(
    [oracleTag('ramp', ['o1']), oracleTag('artifact', ['o1']), oracleTag('card-draw', ['o2'])],
    [artTag('machine', ['i1']), artTag('wizard', ['if1']), artTag('insect', ['if2'])],
    0,
  )

  test('attaches oracle and art tags to a single-faced card', () => {
    const card = makeCard({ oracle_id: 'o1', illustration_id: 'i1' })
    attachTags(card, index)
    expect(card.oracleTags).toEqual(['artifact', 'ramp'])
    expect(card.artTags).toEqual(['machine'])
  })

  test('unions art tags across all faces of a double-faced card', () => {
    const card = makeCard({
      oracle_id: 'o2',
      card_faces: [
        { name: 'Front', mana_cost: '', type_line: '', oracle_text: '', illustration_id: 'if1' },
        { name: 'Back', mana_cost: '', type_line: '', oracle_text: '', illustration_id: 'if2' },
      ],
    })
    attachTags(card, index)
    expect(card.oracleTags).toEqual(['card-draw'])
    expect(card.artTags).toEqual(['insect', 'wizard'])
  })

  test('leaves tag fields unset when there are no matches', () => {
    const card = makeCard({ oracle_id: 'unknown', illustration_id: 'unknown' })
    attachTags(card, index)
    expect(card.oracleTags).toBeUndefined()
    expect(card.artTags).toBeUndefined()
  })

  test('clears stale tags when re-attached against an index with no matches', () => {
    const card = makeCard({
      oracle_id: 'gone',
      illustration_id: 'gone',
      oracleTags: ['stale'],
      artTags: ['stale'],
    })
    attachTags(card, index)
    expect(card.oracleTags).toBeUndefined()
    expect(card.artTags).toBeUndefined()
  })
})
