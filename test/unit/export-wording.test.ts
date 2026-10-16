import { describe, expect, test } from 'bun:test'
import {
  exportProblem,
  exportWarning,
  type ExportProblemCode,
  type ExportProblemOf,
  type ExportWarningCode,
  type ExportWarningOf,
} from '../../src/export/text'
import {
  exportProblemMessage,
  exportWarningMessage,
  renderExportWarning,
} from '../../src/export-wording/message'
import { exportColumnLabel } from '../../src/export-wording/columns'
import { EXPORT_DIALECTS, EXPORT_PROPERTIES, exportColumnHeader } from '../../src/export/render'
import { syncMessage, syncText } from '../../src/sync/message'
import { keyedMessage } from '../helpers/api-message'
import {
  expectLocaleInForce,
  foreignLocales,
  pseudoCatalog,
  withSyntheticLocale,
} from '../helpers/sync-text'

/**
 * The export engine returns codes; this is where they become words. Pinned
 * here: every code has a key and renders completely, its English is byte for
 * byte what the engine wrote before its text became codes, and a reader in
 * another language gets the sentence in that language while the messages an
 * API, MCP or `--output json` carry stay English plus the key.
 */

const COLUMN_IDS =
  'name, quantity, set, collectorNumber, edition, scryfallId, edhrecRank, finish, isFoil, ' +
  'condition, language, labels, tags, categories, primaryCategory, note, section, listName, listType'

const CONDITIONS = 'NM, LP, MP, HP, DMG, none'

const LABELS = 'sale, trade, keep, proxy, none'

/**
 * One problem per code, with its full English — a missing row, or a row whose
 * problem has another code, is a compile error, so no code goes unrendered or
 * unpinned.
 */
const PROBLEMS: { [C in ExportProblemCode]: [ExportProblemOf<C>, string] } = {
  'columns-empty': [
    exportProblem('columns-empty'),
    `No columns given. Available columns: ${COLUMN_IDS}`,
  ],
  'column-unknown': [
    exportProblem('column-unknown', { column: 'price' }),
    `Unknown column 'price'. Available columns: ${COLUMN_IDS}`,
  ],
  'column-duplicate': [
    exportProblem('column-duplicate', { column: 'name' }),
    "Duplicate column 'name'.",
  ],
  'conditions-empty': [
    exportProblem('conditions-empty'),
    `No conditions given. Use one of: ${CONDITIONS}.`,
  ],
  'condition-invalid': [
    exportProblem('condition-invalid', { value: 'OK' }),
    `Invalid condition 'OK'. Use one of: ${CONDITIONS}.`,
  ],
  'labels-empty': [exportProblem('labels-empty'), `No labels given. Use one of: ${LABELS}.`],
  'label-invalid': [
    exportProblem('label-invalid', { value: 'sell' }),
    `Invalid label 'sell'. Use one of: ${LABELS}.`,
  ],
  'presets-not-object': [
    exportProblem('presets-not-object'),
    '"exportPresets" must be an object mapping preset names to presets',
  ],
  'preset-not-object': [
    exportProblem('preset-not-object', { name: 'p' }),
    'exportPresets["p"] must be an object',
  ],
  'preset-format-invalid': [
    exportProblem('preset-format-invalid', { name: 'p' }),
    'exportPresets["p"].format must be one of: csv, json, text, md',
  ],
  'preset-columns-not-array': [
    exportProblem('preset-columns-not-array', { name: 'p' }),
    'exportPresets["p"].columns must be an array of property names',
  ],
  'preset-columns-invalid': [
    exportProblem('preset-columns-invalid', {
      name: 'p',
      reason: exportProblem('column-duplicate', { column: 'name' }),
    }),
    'exportPresets["p"].columns: Duplicate column \'name\'.',
  ],
  'preset-field-not-boolean': [
    exportProblem('preset-field-not-boolean', { name: 'p', field: 'quoteAll' }),
    'exportPresets["p"].quoteAll must be a boolean',
  ],
  'preset-dialect-invalid': [
    exportProblem('preset-dialect-invalid', { name: 'p' }),
    'exportPresets["p"].dialect must be one of: ritual, archidekt, arena, moxfield',
  ],
  'file-name-exhausted': [
    exportProblem('file-name-exhausted', { attempts: 100, dir: '/ws/exports' }),
    'Could not find a free export file name after 100 attempts in /ws/exports.',
  ],
  'file-name-not-basename': [
    exportProblem('file-name-not-basename', { name: 'a/b.csv' }),
    "Refusing to write export under a non-basename name 'a/b.csv'.",
  ],
}

/** One warning per code, with its full English. */
const WARNINGS: { [C in ExportWarningCode]: [ExportWarningOf<C>, string] } = {
  'list-warning': [
    exportWarning('list-warning', {
      list: 'Binder',
      // The parser's own message, keyed, nests whole.
      warning: syncMessage('domain.import.text.malformedLine', { line: 'junk' }),
    }),
    'Binder: Skipped malformed line: junk',
  ],
  'cards-unmatched': [
    exportWarning('cards-unmatched', { terms: 'black lotus' }),
    "No cards matched 'black lotus'",
  ],
  'scryfall-id-unpinned': [
    exportWarning('scryfall-id-unpinned', { name: 'Brainstorm' }),
    'No Scryfall ID for Brainstorm: the entry has no set and collector number.',
  ],
  'scryfall-id-uncached': [
    exportWarning('scryfall-id-uncached', { name: 'Lightning Bolt', printing: 'LEA:161' }),
    'No Scryfall ID for Lightning Bolt (LEA:161): the printing is not in the Scryfall cache.',
  ],
  'edhrec-rank-uncached': [
    exportWarning('edhrec-rank-uncached', { name: 'Sol Ring' }),
    'No EDHREC rank for Sol Ring: the card is not in the Scryfall cache.',
  ],
  'extras-omitted': [
    exportWarning('extras-omitted', {
      sections: [
        { section: 'Maybeboard', quantity: 5 },
        { section: 'Tokens', quantity: 1 },
      ],
    }),
    'Omitted cards a decklist has no board for: Maybeboard (5), Tokens (1). Maybeboard and ' +
      'token sections are deck-building extras rather than part of a decklist, so neither ' +
      'Arena nor Moxfield writes them.',
  ],
  'categories-unwritable': [
    exportWarning('categories-unwritable', { categories: ['Board Wipes', '!Combo'] }),
    'Categories not written as Moxfield tags: Board Wipes, !Combo. Moxfield’s bulk-edit format ' +
      'documents only single-word tags, so a category holding a space (or starting with "!") ' +
      'has no spelling it is known to read, and one holding a character a Ritual tag cannot ' +
      '("#", "&", brackets and the like) would not import back.',
  ],
}

describe('every export problem code', () => {
  test.each(Object.entries(PROBLEMS))(
    '%s renders its English, keyed',
    (code, [problem, english]) => {
      // The row is the code it is filed under, so a copy-pasted row cannot pin
      // one code's English under another's name.
      expect<string>(problem.code).toBe(code)
      expect(keyedMessage(exportProblemMessage(problem))).toBe(english)
    },
  )

  test('file-name-exhausted renders its one-attempt branch', () => {
    const problem = exportProblem('file-name-exhausted', { attempts: 1, dir: '/ws/exports' })
    expect(keyedMessage(exportProblemMessage(problem))).toBe(
      'Could not find a free export file name after 1 attempt in /ws/exports.',
    )
  })

  test.each(foreignLocales())(
    'every problem stays English on the wire under $tag',
    ({ tag, catalog }) => {
      withSyntheticLocale(tag, catalog, (locale) => {
        expectLocaleInForce(locale)
        for (const [problem, english] of Object.values(PROBLEMS)) {
          expect(exportProblemMessage(problem).message).toBe(english)
        }
        expectLocaleInForce(locale)
      })
    },
  )
})

describe('every export warning code', () => {
  test.each(Object.entries(WARNINGS))(
    '%s renders its English, keyed',
    (code, [warning, english]) => {
      expect<string>(warning.code).toBe(code)
      expect(keyedMessage(exportWarningMessage(warning))).toBe(english)
    },
  )

  test.each(foreignLocales())(
    'every warning stays English on the wire under $tag',
    ({ tag, catalog }) => {
      withSyntheticLocale(tag, catalog, (locale) => {
        expectLocaleInForce(locale)
        for (const [warning, english] of Object.values(WARNINGS)) {
          expect(exportWarningMessage(warning).message).toBe(english)
        }
        expectLocaleInForce(locale)
      })
    },
  )
})

describe('a list’s own warning', () => {
  test('nests as the parser’s message, its key kept', () => {
    const [warning] = WARNINGS['list-warning']
    expect(exportWarningMessage(warning).messageParams?.warning).toMatchObject({
      messageKey: 'domain.import.text.malformedLine',
      messageParams: { line: 'junk' },
    })
  })

  test('renders whole in the reader’s language, the list name and the line untouched', () => {
    const [warning, english] = WARNINGS['list-warning']
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      const rendered = renderExportWarning(warning)
      expect(rendered).not.toBe(english)
      // The nested sentence is translated too, not carried as English.
      expect(rendered).not.toContain('Skipped malformed line')
      expect(rendered).toContain('Binder')
      expect(rendered).toContain('junk')
    })
  })

  test('a message no catalog entry words is carried as its text', () => {
    const warning = exportWarning('list-warning', {
      list: 'Binder',
      warning: syncText('a reader’s own words'),
    })
    expect(exportWarningMessage(warning)).toEqual({
      message: 'Binder: a reader’s own words',
      messageKey: 'domain.export.warning.inList',
      messageParams: { list: 'Binder', warning: 'a reader’s own words' },
    })
  })
})

describe('the reader’s language', () => {
  test('an omitted-sections warning translates its frame and keeps the section names', () => {
    const [warning, english] = WARNINGS['extras-omitted']
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      const rendered = renderExportWarning(warning)
      expect(rendered).not.toBe(english)
      expect(rendered).not.toContain('Omitted cards')
      // Section names are the deck file's own.
      expect(rendered).toContain('Maybeboard')
      expect(rendered).toContain('Tokens')
    })
  })
})

describe('column labels and header cells', () => {
  // The picker mirrors the header table's dialect overrides: a column a dialect
  // heads its own way is the column the user picks by that name.
  test('a dialect relabels exactly the columns it re-heads', () => {
    for (const dialect of EXPORT_DIALECTS) {
      for (const property of EXPORT_PROPERTIES) {
        expect({ dialect, property, label: exportColumnLabel(property, dialect) }).toEqual({
          dialect,
          property,
          label: exportColumnHeader(property, dialect),
        })
      }
    }
  })

  test('picker labels follow the UI language', () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      for (const property of EXPORT_PROPERTIES) {
        expect(exportColumnLabel(property)).not.toBe(exportColumnHeader(property))
      }
      expect(exportColumnLabel('finish', 'archidekt')).not.toBe('Variant')
    })
  })
})
