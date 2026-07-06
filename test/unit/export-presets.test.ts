import { describe, expect, test } from 'bun:test'
import {
  parseExportPresets,
  resolveExportSettings,
  type ExportPreset,
} from '../../src/export/presets'
import { DEFAULT_EXPORT_COLUMNS } from '../../src/export/render'

describe('parseExportPresets', () => {
  test('returns an empty map when absent', () => {
    expect(parseExportPresets(undefined)).toEqual({})
  })

  test('parses a valid preset map', () => {
    const result = parseExportPresets({
      deckbox: { format: 'csv', columns: ['name', 'quantity'], header: false, quoteAll: true },
      dump: { format: 'json', columns: ['name', 'set', 'listName'] },
    })
    expect(result).toEqual({
      deckbox: { format: 'csv', columns: ['name', 'quantity'], header: false, quoteAll: true },
      dump: { format: 'json', columns: ['name', 'set', 'listName'] },
    })
  })

  test.each([
    ['not an object', ['a'], '"exportPresets" must be an object'],
    ['non-object preset', { p: 'csv' }, 'exportPresets["p"] must be an object'],
    ['bad format', { p: { format: 'xml', columns: ['name'] } }, '.format must be one of'],
    ['non-array columns', { p: { format: 'csv', columns: 'name' } }, '.columns must be an array'],
    ['empty columns', { p: { format: 'csv', columns: [] } }, '.columns: No columns given'],
    [
      'unknown column',
      { p: { format: 'csv', columns: ['price'] } },
      ".columns: Unknown column 'price'",
    ],
    [
      'duplicate column',
      { p: { format: 'csv', columns: ['name', 'name'] } },
      ".columns: Duplicate column 'name'",
    ],
    [
      'non-boolean header',
      { p: { format: 'csv', columns: ['name'], header: 'yes' } },
      '.header must be a boolean',
    ],
    [
      'non-boolean quoteAll',
      { p: { format: 'csv', columns: ['name'], quoteAll: 1 } },
      '.quoteAll must be a boolean',
    ],
  ])('rejects %s with an error string', (_label, value, expected) => {
    const result = parseExportPresets(value)
    expect(typeof result).toBe('string')
    expect(result).toContain(expected)
  })
})

describe('resolveExportSettings', () => {
  const preset: ExportPreset = {
    format: 'json',
    columns: ['name', 'listName'],
    header: false,
    quoteAll: true,
  }

  test('falls back to defaults with no preset and no flags', () => {
    expect(resolveExportSettings(undefined, {})).toEqual({
      format: 'csv',
      columns: DEFAULT_EXPORT_COLUMNS,
      header: true,
      quoteAll: false,
    })
  })

  test('a preset overrides the defaults', () => {
    expect(resolveExportSettings(preset, {})).toEqual({
      format: 'json',
      columns: ['name', 'listName'],
      header: false,
      quoteAll: true,
    })
  })

  test('explicit flags override the preset, including boolean negations', () => {
    expect(resolveExportSettings(preset, { format: 'csv', header: true, quoteAll: false })).toEqual(
      {
        format: 'csv',
        columns: ['name', 'listName'],
        header: true,
        quoteAll: false,
      },
    )
  })

  test('a --no-header flag overrides a preset with header on', () => {
    const headerOn: ExportPreset = { format: 'csv', columns: ['name'], header: true }
    expect(resolveExportSettings(headerOn, { header: false }).header).toBe(false)
  })
})
