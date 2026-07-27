import { describe, test, expect } from 'bun:test'
import {
  ARCHIDEKT_BULK_BATCH_SIZE,
  ARCHIDEKT_CSV_CHUNK_SIZE,
  ARCHIDEKT_CSV_MAX_COLUMNS,
  ARCHIDEKT_GAME_PAPER,
  ARCHIDEKT_LANGUAGE_ENGLISH,
  archidektConditionId,
  archidektCsvCondition,
  archidektModifier,
  parseArchidektCondition,
  parseArchidektModifier,
  validateArchidektCsvColumns,
  type ArchidektCsvColumn,
} from '../../../src/importers/archidekt-collection'
import type { ArchidektCardModifier } from '../../../src/importers/archidekt-types'
import type { Condition, Finish } from '../../../src/types'

describe('Archidekt collection enums', () => {
  test.each<[number, Condition]>([
    [1, 'NM'],
    [2, 'LP'],
    [3, 'MP'],
    [4, 'HP'],
    [5, 'DMG'],
  ])('parses Archidekt condition id %i as %s', (id, condition) => {
    expect(parseArchidektCondition(id)).toEqual({ ok: true, value: condition })
  })

  // The forward direction is what actually reaches the wire, and is pinned
  // against literals rather than against the reverse map it is inverted from —
  // a wrong id in the source table would round-trip cleanly but sync wrongly.
  test.each<[Condition, number]>([
    ['NM', 1],
    ['LP', 2],
    ['MP', 3],
    ['HP', 4],
    ['DMG', 5],
  ])('sends %s to Archidekt as condition id %i', (condition, id) => {
    expect(archidektConditionId(condition)).toBe(id)
  })

  test('reports an error for a condition id outside 1-5', () => {
    for (const bad of [0, 6, -1, 1.5, Number.NaN]) {
      const result = parseArchidektCondition(bad)
      expect(result.ok).toBe(false)
      expect(result.ok ? '' : result.message).toContain(`Unknown Archidekt condition id '${bad}'`)
    }
  })

  test.each<[string, Finish]>([
    ['Normal', 'nonfoil'],
    ['Foil', 'foil'],
    ['Etched', 'etched'],
    [' etched ', 'etched'],
    ['FOIL', 'foil'],
  ])('parses the Archidekt modifier %p as %s', (modifier, finish) => {
    expect(parseArchidektModifier(modifier)).toEqual({ ok: true, value: finish })
  })

  test.each<[Finish, ArchidektCardModifier]>([
    ['nonfoil', 'Normal'],
    ['foil', 'Foil'],
    ['etched', 'Etched'],
  ])('sends %s to Archidekt as the modifier %s', (finish, modifier) => {
    expect(archidektModifier(finish)).toBe(modifier)
  })

  test('reports an error for an unknown modifier', () => {
    for (const bad of ['', 'Glossy', 'foil-etched']) {
      const result = parseArchidektModifier(bad)
      expect(result.ok).toBe(false)
      expect(result.ok ? '' : result.message).toContain(`Unknown Archidekt modifier '${bad}'`)
    }
  })

  // The CSV importer takes short codes, not the numeric ids the JSON API does,
  // and spells Damaged differently from Ritual — the one real divergence.
  test.each<[Condition, string]>([
    ['NM', 'NM'],
    ['LP', 'LP'],
    ['MP', 'MP'],
    ['HP', 'HP'],
    ['DMG', 'D'],
  ])('writes %s in a CSV cell as %s', (condition, code) => {
    expect(archidektCsvCondition(condition)).toBe(code)
  })

  // A deliberate tripwire: these are Archidekt's own values, so changing one
  // means re-verifying it against the live API (see research/).
  test('pins the Archidekt constants the sync depends on', () => {
    expect(ARCHIDEKT_LANGUAGE_ENGLISH).toBe(1)
    expect(ARCHIDEKT_GAME_PAPER).toBe(1)
    expect(ARCHIDEKT_BULK_BATCH_SIZE).toBe(25)
    expect(ARCHIDEKT_CSV_CHUNK_SIZE).toBe(2000)
    expect(ARCHIDEKT_CSV_MAX_COLUMNS).toBe(20)
  })
})

describe('validateArchidektCsvColumns', () => {
  test('accepts a uid-keyed mapping, whatever else it carries', () => {
    // The mapping the sync actually uploads is derived from the export preset and
    // pinned there (`COLLECTION_CSV_UPLOAD` in collection-sync/csv.test.ts).
    expect(
      validateArchidektCsvColumns(['uid', 'quantity', 'modifier', 'condition']),
    ).toBeUndefined()
    expect(validateArchidektCsvColumns(['ignore', 'uid'])).toBeUndefined()
  })

  test('accepts name + collector number + either edition column', () => {
    expect(
      validateArchidektCsvColumns(['oracleCard__name', 'collectorNumber', 'edition__editioncode']),
    ).toBeUndefined()
    expect(
      validateArchidektCsvColumns(['oracleCard__name', 'collectorNumber', 'edition__editionname']),
    ).toBeUndefined()
  })

  test.each<[string, ArchidektCsvColumn[], string]>([
    ['nothing at all', [], 'needs at least one column'],
    ['quantity alone', ['quantity'], "must include 'uid'"],
    // A name with an edition but no collector number cannot pin a printing.
    [
      'a name without a collector number',
      ['oracleCard__name', 'edition__editioncode'],
      "must include 'uid'",
    ],
  ])('rejects %s', (_label, columns, message) => {
    expect(validateArchidektCsvColumns(columns)).toContain(message)
  })

  test('rejects more columns than Archidekt accepts', () => {
    const columns: ArchidektCsvColumn[] = [
      'uid',
      ...Array.from({ length: ARCHIDEKT_CSV_MAX_COLUMNS }, (): ArchidektCsvColumn => 'ignore'),
    ]
    expect(validateArchidektCsvColumns(columns)).toContain(
      `at most ${ARCHIDEKT_CSV_MAX_COLUMNS} columns, got ${columns.length}`,
    )
  })
})
