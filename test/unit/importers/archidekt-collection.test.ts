import { describe, test, expect } from 'bun:test'
import {
  ARCHIDEKT_BULK_BATCH_SIZE,
  ARCHIDEKT_CSV_CHUNK_SIZE,
  ARCHIDEKT_CSV_MAX_COLUMNS,
  ARCHIDEKT_GAME_PAPER,
  ARCHIDEKT_LANGUAGE_ENGLISH,
  ARCHIDEKT_LANGUAGE_PAIRS,
  archidektConditionId,
  archidektCsvCondition,
  archidektCsvLanguage,
  archidektLanguageId,
  archidektModifier,
  parseArchidektCondition,
  parseArchidektLanguage,
  parseArchidektModifier,
  validateArchidektCsvColumns,
  type ArchidektCsvColumn,
} from '../../../src/importers/archidekt-collection'
import type { ArchidektCardModifier } from '../../../src/importers/archidekt-types'
import {
  CARD_LANGUAGES,
  normalizeLanguageValue,
  type CardLanguage,
} from '../../../src/card/card-language'
import type { Condition, Finish } from '../../../src/card/finish-condition'

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

describe('Archidekt language mapping', () => {
  // The full documented id table (research/archidekt-collection-api.md),
  // pinned in both directions.
  test.each<[number, CardLanguage]>([
    [1, 'en'],
    [2, 'zht'],
    [3, 'de'],
    [4, 'fr'],
    [5, 'it'],
    [6, 'ja'],
    [7, 'ko'],
    [8, 'pt'],
    [9, 'ru'],
    [10, 'zhs'],
    [11, 'es'],
  ])('maps Archidekt language id %i to %s and back', (id, language) => {
    expect(parseArchidektLanguage(id)).toBe(language)
    expect(archidektLanguageId(language)).toBe(id)
  })

  test('an id outside the documented range parses to null', () => {
    expect(parseArchidektLanguage(0)).toBeNull()
    expect(parseArchidektLanguage(12)).toBeNull()
    expect(parseArchidektLanguage(-1)).toBeNull()
  })

  test('a missing language resolves to the English id', () => {
    expect(archidektLanguageId(undefined)).toBe(ARCHIDEKT_LANGUAGE_ENGLISH)
  })

  test.each<CardLanguage>(['ph', 'la', 'grc', 'he', 'ar', 'sa'])(
    'Archidekt cannot represent %s (no id, no CSV code)',
    (language) => {
      expect(archidektLanguageId(language)).toBeNull()
      expect(archidektCsvLanguage(language)).toBeNull()
    },
  )

  test.each<[CardLanguage | undefined, string]>([
    [undefined, 'EN'],
    ['en', 'EN'],
    ['zht', 'CT'],
    ['de', 'DE'],
    ['fr', 'FR'],
    ['it', 'IT'],
    ['ja', 'JP'],
    ['ko', 'KR'],
    ['pt', 'PT'],
    ['ru', 'RU'],
    ['zhs', 'CS'],
    ['es', 'SP'],
  ])('CSV language code for %s is %s', (language, code) => {
    expect(archidektCsvLanguage(language)).toBe(code)
  })

  test('every CSV code normalizes back to the language it was written for', () => {
    // Alias-drift guard: the CSV codes are the reverse of
    // `normalizeLanguageValue`'s alias table (JP→ja, CS→zhs, …). If either
    // table changes without the other, a pushed CSV would re-import as a
    // different language.
    for (const language of CARD_LANGUAGES) {
      const code = archidektCsvLanguage(language)
      if (code === null) continue
      expect(normalizeLanguageValue(code)).toBe(language)
    }
  })

  test('every id-mapped language has a CSV code, and only those', () => {
    for (const language of CARD_LANGUAGES) {
      const hasId = archidektLanguageId(language) !== null
      const hasCode = archidektCsvLanguage(language) !== null
      expect(hasCode).toBe(hasId)
    }
    // Eleven ids, per the documented enum.
    expect(ARCHIDEKT_LANGUAGE_PAIRS).toHaveLength(11)
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
