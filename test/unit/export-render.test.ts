import { describe, expect, test } from 'bun:test'
import { csvCell } from '../../src/csv'
import type { ExportEntry } from '../../src/export/entries'
import {
  DEFAULT_EXPORT_COLUMNS,
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
      'Name,Set,Collector Number,Finish,Condition,Quantity\nLightning Bolt,LEA,161,foil,NM,1',
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
})
