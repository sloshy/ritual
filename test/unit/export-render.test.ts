import { describe, expect, test } from 'bun:test'
import { csvCell } from '../../src/changes/csv'
import type { ExportEntry } from '../../src/export/entries'
import { ARCHIDEKT_EXPORT_SETTINGS } from '../../src/export/presets'
import {
  DEFAULT_EXPORT_COLUMNS,
  exportPropertyLabel,
  parseColumnsFlag,
  renderCsvExport,
  renderJsonExport,
  renderMarkdownExport,
  renderTextExport,
} from '../../src/export/render'

function entry(overrides: Partial<ExportEntry> = {}): ExportEntry {
  return {
    listType: 'collection',
    listName: 'Binder',
    section: 'Main',
    name: 'Lightning Bolt',
    quantity: 1,
    set: 'lea',
    collectorNumber: '161',
    finish: 'foil',
    condition: 'NM',
    fileOrder: 0,
    ...overrides,
  }
}

/** Header-less, minimally quoted CSV in Archidekt's dialect — one cell per column. */
const csvOptions = { header: false, quoteAll: false, dialect: 'archidekt' } as const

describe('csvCell', () => {
  test('quotes only when needed by default', () => {
    expect(csvCell('Sol Ring')).toBe('Sol Ring')
    expect(csvCell('Borrowing 100,000 Arrows')).toBe('"Borrowing 100,000 Arrows"')
    expect(csvCell('Kongming, "Sleeping Dragon"')).toBe('"Kongming, ""Sleeping Dragon"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })

  test('quoteAll forces quotes around every value', () => {
    expect(csvCell('Sol Ring', true)).toBe('"Sol Ring"')
    expect(csvCell('', true)).toBe('""')
    expect(csvCell('say "hi"', true)).toBe('"say ""hi"""')
  })
})

describe('parseColumnsFlag', () => {
  test('parses a comma-separated list preserving order', () => {
    expect(parseColumnsFlag('quantity, name,set')).toEqual(['quantity', 'name', 'set'])
  })

  test('rejects unknown columns with the available list', () => {
    const result = parseColumnsFlag('name,price')
    expect(typeof result).toBe('string')
    expect(result).toContain("Unknown column 'price'")
    expect(result).toContain('name, quantity, set')
  })

  test('rejects duplicates and empty input', () => {
    expect(parseColumnsFlag('name,name')).toBe("Duplicate column 'name'.")
    expect(parseColumnsFlag(' , ')).toContain('No columns given')
  })
})

describe('renderJsonExport', () => {
  test('emits one object per entry with keys in column order, lowercase sets', () => {
    const json = renderJsonExport([entry()], ['set', 'name', 'quantity'])
    const parsed = JSON.parse(json) as Record<string, unknown>[]
    expect(parsed).toEqual([{ set: 'lea', name: 'Lightning Bolt', quantity: 1 }])
    expect(Object.keys(parsed[0]!)).toEqual(['set', 'name', 'quantity'])
  })

  test('omits absent properties instead of emitting null', () => {
    const json = renderJsonExport(
      [entry({ set: undefined, collectorNumber: undefined, note: undefined })],
      ['name', 'set', 'note'],
    )
    expect(JSON.parse(json)).toEqual([{ name: 'Lightning Bolt' }])
  })

  test('exports list identity properties', () => {
    const json = renderJsonExport([entry()], ['listName', 'listType', 'section'])
    expect(JSON.parse(json)).toEqual([
      { listName: 'Binder', listType: 'collection', section: 'Main' },
    ])
  })

  test('edition combines set and collector number, lowercase, omitted without a printing', () => {
    expect(JSON.parse(renderJsonExport([entry()], ['edition']))).toEqual([{ edition: 'lea:161' }])
    expect(JSON.parse(renderJsonExport([entry({ set: undefined })], ['name', 'edition']))).toEqual([
      { name: 'Lightning Bolt' },
    ])
  })

  test('isFoil is true for foil and etched, false otherwise, as a JSON boolean', () => {
    const json = renderJsonExport(
      [
        entry({ finish: 'foil' }),
        entry({ finish: 'etched' }),
        entry({ finish: 'nonfoil' }),
        entry({ finish: undefined }),
      ],
      ['isFoil'],
    )
    expect(JSON.parse(json)).toEqual([
      { isFoil: true },
      { isFoil: true },
      { isFoil: false },
      { isFoil: false },
    ])
  })
})

describe('renderTextExport', () => {
  test('aggregates identical variants across lists and sections, summing quantities in first-seen order', () => {
    const text = renderTextExport([
      entry({ listName: 'Burn', listType: 'deck', section: 'Main', quantity: 2 }),
      entry({ name: 'Fireblast', set: 'vis', collectorNumber: '78', fileOrder: 1 }),
      // Same variant as the first entry, from another list and section.
      entry({ listName: 'Binder', section: 'Trade', quantity: 1 }),
    ])
    expect(text).toBe('3 Lightning Bolt (LEA:161)\n1 Fireblast (VIS:78)')
  })

  test('distinct finish/condition variants stay separate lines even though neither prints', () => {
    const text = renderTextExport([
      entry({ finish: 'foil' }),
      entry({ finish: undefined, fileOrder: 1 }),
    ])
    expect(text).toBe('1 Lightning Bolt (LEA:161)\n1 Lightning Bolt (LEA:161)')
  })

  test('omits the printing suffix when the set or collector number is missing', () => {
    const text = renderTextExport([
      entry({ name: 'Price of Progress', set: undefined, collectorNumber: undefined }),
      entry({ name: 'Sol Ring', collectorNumber: undefined, fileOrder: 1 }),
    ])
    expect(text).toBe('1 Price of Progress\n1 Sol Ring')
  })

  test('uppercases the set code in the printing suffix', () => {
    expect(renderTextExport([entry({ set: 'lea' })])).toBe('1 Lightning Bolt (LEA:161)')
  })
})

describe('renderMarkdownExport', () => {
  test('groups lists under H1s and sections under H2s with per-type canonical lines', () => {
    const md = renderMarkdownExport([
      entry({
        listType: 'deck',
        listName: 'Burn',
        section: 'Main',
        quantity: 2,
        finish: undefined,
        // NM is the default and must be omitted from the canonical deck line.
        condition: 'NM',
      }),
      entry({
        listType: 'deck',
        listName: 'Burn',
        section: 'Main',
        name: 'Fireblast',
        set: 'vis',
        collectorNumber: '78',
        condition: undefined,
        fileOrder: 1,
      }),
      entry({
        listType: 'deck',
        listName: 'Burn',
        section: 'Maybeboard',
        name: 'Price of Progress',
        set: undefined,
        collectorNumber: undefined,
        finish: undefined,
        condition: undefined,
        fileOrder: 2,
      }),
      entry({
        listType: 'collection',
        listName: 'Binder',
        section: 'Main',
        name: 'Sol Ring',
        set: 'c21',
        collectorNumber: '263',
        condition: undefined,
      }),
      entry({
        listType: 'wanted',
        listName: 'Wishlist',
        section: 'Main',
        name: 'Brainstorm',
        set: undefined,
        collectorNumber: undefined,
        finish: undefined,
        condition: undefined,
      }),
    ])
    expect(md).toBe(
      '# Burn\n\n' +
        '## Main\n2 Lightning Bolt (LEA:161)\n1 Fireblast (VIS:78) [foil]\n\n' +
        '## Maybeboard\n1 Price of Progress\n\n' +
        '# Binder\n\n## Main\n- Sol Ring (C21:263) [foil]\n\n' +
        '# Wishlist\n\n## Main\n- Brainstorm',
    )
    expect(md).not.toContain('&')
    // The writer appends the single trailing newline; the renderer emits none.
    expect(md.endsWith('\n')).toBe(false)
  })

  test('collection and wanted lines carry condition, finish, and note tokens', () => {
    const md = renderMarkdownExport([
      entry({ listType: 'collection', listName: 'Binder', condition: 'LP', note: 'trade' }),
      entry({
        listType: 'wanted',
        listName: 'Wants',
        name: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        finish: 'etched',
        condition: undefined,
        note: 'gift',
      }),
    ])
    expect(md).toBe(
      '# Binder\n\n## Main\n- Lightning Bolt (LEA:161) [foil] [LP] {trade}\n\n' +
        '# Wants\n\n## Main\n- Sol Ring (LTC:284) [etched] {gift}',
    )
  })

  test('sections group by first-seen order even when entries interleave', () => {
    const md = renderMarkdownExport([
      entry({ listType: 'deck', listName: 'Burn', section: 'Main', finish: undefined }),
      entry({
        listType: 'deck',
        listName: 'Burn',
        section: 'Sideboard',
        name: 'Pyroblast',
        set: 'ice',
        collectorNumber: '213',
        finish: undefined,
        condition: undefined,
        fileOrder: 1,
      }),
      entry({
        listType: 'deck',
        listName: 'Burn',
        section: 'Main',
        name: 'Fireblast',
        set: 'vis',
        collectorNumber: '78',
        finish: undefined,
        condition: undefined,
        fileOrder: 2,
      }),
    ])
    expect(md).toBe(
      '# Burn\n\n' +
        '## Main\n1 Lightning Bolt (LEA:161)\n1 Fireblast (VIS:78)\n\n' +
        '## Sideboard\n1 Pyroblast (ICE:213)',
    )
  })
})

describe('renderCsvExport', () => {
  test('renders header labels and uppercased set codes in column order', () => {
    const csv = renderCsvExport([entry()], DEFAULT_EXPORT_COLUMNS, {
      header: true,
      quoteAll: false,
    })
    expect(csv).toBe(
      'Name,Set,Collector Number,Finish,Condition,Language,Quantity\nLightning Bolt,LEA,161,foil,NM,,1',
    )
  })

  test('renders missing values as empty cells and keeps explicit nonfoil', () => {
    const rows = renderCsvExport(
      [
        entry({
          set: undefined,
          collectorNumber: undefined,
          finish: 'nonfoil',
          condition: undefined,
        }),
      ],
      ['name', 'set', 'finish', 'condition'],
      { header: false, quoteAll: false },
    )
    expect(rows).toBe('Lightning Bolt,,nonfoil,')
  })

  test('quoteAll quotes every cell including the header', () => {
    const csv = renderCsvExport([entry()], ['name', 'quantity'], { header: true, quoteAll: true })
    expect(csv).toBe('"Name","Quantity"\n"Lightning Bolt","1"')
  })

  test('edition uppercases only the set code, keeping the collector number verbatim', () => {
    const csv = renderCsvExport(
      [entry({ collectorNumber: '161a' }), entry({ set: undefined, fileOrder: 1 })],
      ['name', 'edition', 'isFoil'],
      { header: true, quoteAll: false },
    )
    expect(csv).toBe('Name,Edition,Is Foil\nLightning Bolt,LEA:161a,true\nLightning Bolt,,true')
  })

  test('minimal quoting still protects commas in values', () => {
    const csv = renderCsvExport([entry({ note: 'keep, do not trade' })], ['name', 'note'], {
      header: false,
      quoteAll: false,
    })
    expect(csv).toBe('Lightning Bolt,"keep, do not trade"')
  })

  test('scryfallId renders the resolved id, empty when nothing resolved it', () => {
    const csv = renderCsvExport(
      [entry({ scryfallId: '1b59533a-3e38-495d-873e-2f89fbd08494' }), entry({ fileOrder: 1 })],
      ['name', 'scryfallId'],
      { header: true, quoteAll: false },
    )
    expect(csv).toBe(
      'Name,Scryfall ID\n' +
        'Lightning Bolt,1b59533a-3e38-495d-873e-2f89fbd08494\n' +
        'Lightning Bolt,',
    )
  })
})

describe('the archidekt dialect', () => {
  test.each<[ExportEntry['finish'], string]>([
    ['nonfoil', 'Normal'],
    ['foil', 'Foil'],
    ['etched', 'Etched'],
    // An unmarked line means nonfoil, and Archidekt's CSV has no "unmarked".
    [undefined, 'Normal'],
  ])('writes the finish %s as %s', (finish, expected) => {
    expect(renderCsvExport([entry({ finish })], ['finish'], csvOptions)).toBe(expected)
  })

  test.each<[ExportEntry['condition'], string]>([
    ['NM', 'NM'],
    ['LP', 'LP'],
    ['MP', 'MP'],
    ['HP', 'HP'],
    // Archidekt's CSV code for Damaged is D, not Ritual's DMG.
    ['DMG', 'D'],
    [undefined, 'NM'],
  ])('writes the condition %s as %s', (condition, expected) => {
    expect(renderCsvExport([entry({ condition })], ['condition'], csvOptions)).toBe(expected)
  })

  test('labels the finish column the way Archidekt names it', () => {
    expect(exportPropertyLabel('finish', 'archidekt')).toBe('Variant')
    expect(exportPropertyLabel('finish')).toBe('Finish')
    expect(exportPropertyLabel('condition', 'archidekt')).toBe('Condition')
  })

  test('reaches JSON values too, without renaming the keys', () => {
    const json = renderJsonExport(
      [entry({ finish: 'etched', condition: 'DMG' })],
      ['finish', 'condition'],
      'archidekt',
    )
    expect(JSON.parse(json)).toEqual([{ finish: 'Etched', condition: 'D' }])
  })

  test('leaves every other property alone', () => {
    const csv = renderCsvExport(
      [entry({ scryfallId: 'abc', note: 'trade' })],
      ['name', 'set', 'edition', 'scryfallId', 'isFoil', 'note', 'quantity'],
      csvOptions,
    )
    expect(csv).toBe('Lightning Bolt,LEA,LEA:161,abc,true,trade,1')
  })

  test('the archidekt preset renders exactly the documented upload format', () => {
    const csv = renderCsvExport(
      [
        entry({
          scryfallId: '1b59533a-3e38-495d-873e-2f89fbd08494',
          quantity: 2,
          finish: 'nonfoil',
        }),
        entry({
          scryfallId: '9f0a30cf-b9d6-4b7e-8a6b-2a8b1c3d4e5f',
          condition: 'DMG',
          fileOrder: 1,
        }),
      ],
      ARCHIDEKT_EXPORT_SETTINGS.columns,
      {
        header: ARCHIDEKT_EXPORT_SETTINGS.header,
        quoteAll: ARCHIDEKT_EXPORT_SETTINGS.quoteAll,
        dialect: ARCHIDEKT_EXPORT_SETTINGS.dialect,
      },
    )
    expect(csv).toBe(
      'Scryfall ID,Quantity,Variant,Condition,Language\n' +
        '1b59533a-3e38-495d-873e-2f89fbd08494,2,Normal,NM,EN\n' +
        '9f0a30cf-b9d6-4b7e-8a6b-2a8b1c3d4e5f,1,Foil,D,EN',
    )
  })

  test('renders the language as Archidekt’s CSV code, effective and never blank', () => {
    const csv = renderCsvExport(
      [
        entry({}),
        entry({ language: 'ja', fileOrder: 1 }),
        entry({ language: 'zht', fileOrder: 2 }),
        // No Archidekt code exists for Phyrexian; it degrades to EN, matching
        // how the record API pushes it.
        entry({ language: 'ph', fileOrder: 3 }),
      ],
      ['name', 'language'],
      { ...csvOptions, dialect: 'archidekt' },
    )
    expect(csv.split('\n')).toEqual([
      'Lightning Bolt,EN',
      'Lightning Bolt,JP',
      'Lightning Bolt,CT',
      'Lightning Bolt,EN',
    ])
  })

  test('the ritual dialect keeps the bare-for-English language spelling', () => {
    const csv = renderCsvExport(
      [entry({}), entry({ language: 'ja', fileOrder: 1 })],
      ['name', 'language'],
      { ...csvOptions, dialect: 'ritual' },
    )
    expect(csv.split('\n')).toEqual(['Lightning Bolt,', 'Lightning Bolt,ja'])
  })
})
