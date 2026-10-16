import { describe, expect, test } from 'bun:test'
import {
  CARD_LINE_HINT_CODES,
  CARD_LINE_TEXT_CODES,
  lineText,
  type CardLineHint,
  type CardLineText,
  type CardLineTextCode,
} from '../../src/card/card-line-text'
import {
  cardLineDiagnosticMessage,
  cardLineTextRef,
  renderCardLineDiagnostic,
} from '../../src/card/card-line-message'
import {
  parseCardLine,
  TOKEN_KINDS,
  type CardLineDiagnostic,
  type LineTokens,
} from '../../src/card/card-line-grammar'
import { formatCanonicalCardLine, type DeckCardLineFields } from '../../src/card/card-line-tail'
import { formatCardLabels, formatLabelOverride, type CardLabel } from '../../src/card/card-labels'
import { formatCardTagsToken } from '../../src/card/card-tags'
import { DEFAULT_CARD_CATEGORIES } from '../../src/card/card-categories'
import { languageDisplayName, CARD_LANGUAGES } from '../../src/card/card-language'
import {
  emptyCardCategoriesRecord,
  serializeCardCategoriesSidecar,
} from '../../src/list/card-categories-record'
import { createLineDiagnostics } from '../../src/list/line-diagnostics'
import { compareData } from '../../src/i18n/collate'
import { DEFAULT_LOCALE } from '../../src/i18n/runtime'
import { toSyncMessage } from '../../src/sync/message'
import type { ListType } from '../../src/list/list-type'
import { keyedMessage } from '../helpers/api-message'
import { jpDiagnosticAt, jpDiagnosticEnglish, parsedCardLine } from '../helpers/card-line'
import {
  expectLocaleInForce,
  foreignLocales,
  pseudoCatalog,
  withSyntheticLocale,
} from '../helpers/sync-text'

/**
 * The card-line grammar returns codes; this is where they become words. Pinned
 * here: every code has a key and renders completely, its English is byte for
 * byte what the grammar wrote before its diagnostics became codes, and a reader
 * in another language gets the sentence in that language while the parsers'
 * string channels (and so the API and MCP) keep English plus the key. The last
 * block pins the other half of the fence: the line format itself — every token
 * kind, and the label, tag and category values written beside it — is the same
 * bytes in every UI language.
 */

/** A piece of card-line text and the English it renders to. */
type Sample = [text: CardLineText, english: string]

const TAG_RULE =
  "a tag is non-empty plain text that cannot contain '#', ',', '&', '*', double quotes, brackets, braces or parentheses"

/**
 * One text per code, with its full English — a missing row is a compile error,
 * so no code goes unrendered or unpinned. Every string is the bytes the grammar
 * wrote before its diagnostics became codes.
 */
const SAMPLES: Record<CardLineTextCode, Sample> = {
  'blank-line': [lineText('blank-line'), 'Blank line.'],
  'not-a-card-line': [lineText('not-a-card-line', { line: '## Main' }), 'Not a card line: ## Main'],
  'zero-quantity': [lineText('zero-quantity'), 'A card line must name at least one copy.'],
  'quantity-too-large': [
    lineText('quantity-too-large', { token: '99999999999999999999x' }),
    'Quantity 99999999999999999999x is too large to read exactly.',
  ],
  'quantity-expanded-collection': [
    lineText('quantity-expanded-collection', { count: 3 }),
    'Read 3 copies: a collection holds one line per copy, so this line becomes 3 lines on the next save.',
  ],
  'quantity-expanded-wanted': [
    lineText('quantity-expanded-wanted', { count: 2 }),
    'Read 2 copies: a wanted list holds one line per copy, so this line becomes 2 lines on the next save.',
  ],
  'token-not-allowed': [
    lineText('token-not-allowed', { token: '[NM]', listType: 'wanted' }),
    '[NM] is not a wanted list token.',
  ],
  'wanted-condition': [
    lineText('wanted-condition', { token: '[LP]' }),
    '[LP] is not a wanted list token — wanted lists never carry a condition.',
  ],
  'wanted-labels': [
    lineText('wanted-labels', { token: '[keep]' }),
    '[keep] is not a wanted list token — wanted lists never carry labels.',
  ],
  'duplicate-token': [
    lineText('duplicate-token', { token: '[foil]', kind: 'finish' }),
    'Duplicate finish token [foil].',
  ],
  'labels-exclusive': [
    lineText('labels-exclusive', { token: '[keep,sale]', label: 'keep' }),
    'Conflicting labels [keep,sale] — [keep] cannot be combined with any other label.',
  ],
  'labels-contradictory': [
    lineText('labels-contradictory', { token: '[proxy,no-proxy]', label: 'proxy' }),
    'Conflicting labels [proxy,no-proxy] — [proxy] cannot be both set and negated.',
  ],
  'unknown-token': [lineText('unknown-token', { token: '[jp]' }), 'Unrecognized token [jp].'],
  'malformed-tag': [
    lineText('malformed-tag', { token: '#R&D' }),
    `Malformed tag token #R&D: ${TAG_RULE}.`,
  ],
  'unclosed-note': [
    lineText('unclosed-note'),
    'Unclosed note: a {note} must end with a closing brace.',
  ],
  'empty-name': [
    lineText('empty-name', { line: '- (LEA:161) &4' }),
    'No card name: - (LEA:161) &4',
  ],
  'unseparated-token': [
    lineText('unseparated-token', { token: '&2' }),
    "&2 runs into the text beside it: a card line's tokens are separated by whitespace.",
  ],
  'misplaced-token': [
    lineText('misplaced-token', { token: '&4' }),
    "&4 is inside the card name: a card line's tokens all follow the name.",
  ],
  'missing-printing': [
    lineText('missing-printing', { line: '- Sol Ring', listType: 'collection' }),
    'A collection line must name a printing, e.g. (LEA:161): - Sol Ring',
  ],
  'export-finish-marker': [
    lineText('export-finish-marker', { token: '*F*', finish: 'foil' }),
    'Read the export finish marker *F* as [foil].',
  ],
  'export-printing': [
    lineText('export-printing', { token: '(M10) 146', printing: 'M10:146' }),
    'Read the export printing (M10) 146 as (M10:146).',
  ],
  'export-printing-finish': [
    lineText('export-printing-finish', {
      token: '(2XM) *F* 270',
      printing: '2XM:270',
      finish: 'foil',
    }),
    'Read the export printing (2XM) *F* 270 as (2XM:270) [foil].',
  ],
  'suspect-printing-in-name': [
    lineText('suspect-printing-in-name', { line: '4 Lightning Bolt (M10) 146 *A*' }),
    "Card name still contains a printing token, so the line's format was not recognized: 4 Lightning Bolt (M10) 146 *A*",
  ],
  'suspect-quantity-in-name': [
    lineText('suspect-quantity-in-name', {
      name: '1234 Sol Ring',
      count: 1234,
      fix: '1234x Sol Ring',
    }),
    'Read as one copy of "1234 Sol Ring". If the line means 1234 copies, write it as 1234x Sol Ring;' +
      ' if "1234 Sol Ring" really is the card\'s name, write it as - 1 1234 Sol Ring.',
  ],
  'did-you-mean': [lineText('did-you-mean', { language: 'ja' }), 'did you mean [ja]?'],
  'insert-space': [
    lineText('insert-space', { token: '(LEA:270)', side: 'after' }),
    'insert a space after (LEA:270)',
  ],
  'id-last': [lineText('id-last'), 'the &N id must be the last token on the line'],
  'move-after-name': [
    lineText('move-after-name', { token: '[foil]' }),
    'move [foil] after the name',
  ],
}

/** Whether a sample is a hint (worded on its own) rather than a diagnostic's detail. */
function isHint(text: CardLineText): text is CardLineHint {
  return (CARD_LINE_HINT_CODES as readonly string[]).includes(text.code)
}

/** The diagnostic a line raises: its refusal, or its only advisory. */
function diagnosticOf(type: ListType, line: string): CardLineDiagnostic {
  const parsed = parseCardLine(type, line)
  if (!parsed.ok) return parsed
  const [advisory] = parsed.advisories
  if (advisory === undefined) throw new Error(`"${line}" raised no diagnostic`)
  return advisory
}

describe('every card-line text code', () => {
  test.each(Object.entries(SAMPLES))('%s renders its English, keyed', (code, [text, english]) => {
    // The row is the code it is filed under, so a copy-pasted row cannot pin
    // one code's English under another's name.
    expect<string>(text.code).toBe(code)
    expect(keyedMessage(toSyncMessage(cardLineTextRef(text)))).toBe(english)
  })

  // The sample above renders the `other` branch; a leading `0001` is the one
  // run that reaches `one`.
  test('suspect-quantity-in-name renders its one-copy branch', () => {
    const text = lineText('suspect-quantity-in-name', {
      name: '0001 Sol Ring',
      count: 1,
      fix: '1 Sol Ring',
    })
    expect(keyedMessage(toSyncMessage(cardLineTextRef(text)))).toBe(
      'Read as one copy of "0001 Sol Ring". If the line means 1 copy, write it as 1 Sol Ring;' +
        ' if "0001 Sol Ring" really is the card\'s name, write it as - 1 0001 Sol Ring.',
    )
  })

  /**
   * Every code worded the way the parsers record it — as a diagnostic, or (for
   * a hint) as the text it is — with another language in force: the English an
   * API, MCP or a list file's `warnings` carries never follows the process's
   * UI language.
   */
  test.each(foreignLocales())(
    'every code stays English on the wire under $tag',
    ({ tag, catalog }) => {
      withSyntheticLocale(tag, catalog, (locale) => {
        expectLocaleInForce(locale)
        for (const [text, english] of Object.values(SAMPLES)) {
          const message = isHint(text)
            ? toSyncMessage(cardLineTextRef(text))
            : cardLineDiagnosticMessage({
                severity: 'advisory',
                kind: 'dialect-rewritten',
                detail: text,
              })
          expect(message.message).toBe(english)
        }
        expectLocaleInForce(locale)
      })
    },
  )

  test('the table covers every code', () => {
    expect(Object.keys(SAMPLES).sort(compareData)).toEqual(
      [...CARD_LINE_TEXT_CODES].sort(compareData),
    )
  })

  test('the selects cover every branch the grammar can raise', () => {
    for (const kind of TOKEN_KINDS) {
      const ref = cardLineTextRef(lineText('duplicate-token', { token: 'X', kind }))
      expect(keyedMessage(toSyncMessage(ref))).toBe(`Duplicate ${kind} token X.`)
    }
    for (const listType of ['deck', 'collection', 'wanted'] as const) {
      const noun = listType === 'wanted' ? 'wanted list' : listType
      expect(
        keyedMessage(
          toSyncMessage(cardLineTextRef(lineText('token-not-allowed', { token: 'X', listType }))),
        ),
      ).toBe(`X is not a ${noun} token.`)
      expect(
        keyedMessage(
          toSyncMessage(cardLineTextRef(lineText('missing-printing', { line: 'L', listType }))),
        ),
      ).toBe(`A ${noun} line must name a printing, e.g. (LEA:161): L`)
    }
    expect(
      keyedMessage(
        toSyncMessage(cardLineTextRef(lineText('insert-space', { token: '&5', side: 'before' }))),
      ),
    ).toBe('insert a space before &5')
  })
})

describe('a located diagnostic', () => {
  test('prefixes with the file when there is one', () => {
    const error = diagnosticOf('wanted', '- Bolt (LEA:161) [LP]')
    expect(
      keyedMessage(cardLineDiagnosticMessage(error, { file: 'wanted/cube.md', line: 12 })),
    ).toBe(
      'wanted/cube.md:12: [LP] is not a wanted list token — wanted lists never carry a condition.',
    )
  })

  test('falls back to the line number for pasted text, its hint in parentheses', () => {
    const error = diagnosticOf('deck', '1 Sol Ring [jp]')
    const message = cardLineDiagnosticMessage(error, { line: 3 })
    expect(keyedMessage(message)).toBe('line 3: Unrecognized token [jp]. (did you mean [ja]?)')
    // The diagnostic nests, its hint nested beside it: one tree a reader in
    // another language renders whole.
    expect(message.messageParams).toEqual({
      line: 3,
      text: {
        messageKey: 'domain.card.line.withHint',
        messageParams: {
          text: { messageKey: 'domain.card.line.unknownToken', messageParams: { token: '[jp]' } },
          hint: {
            messageKey: 'domain.card.line.hint.didYouMean',
            messageParams: { language: 'ja' },
          },
        },
      },
    })
    // …which is the tree the wire tests share (`test/helpers/card-line.ts`).
    expect(message).toEqual({ message: jpDiagnosticEnglish(3), ...jpDiagnosticAt(3) })
  })

  test('renders an advisory too, and an unlocated one is the bare sentence', () => {
    const advisory = diagnosticOf('deck', '4 Lightning Bolt (M10) 146')
    expect(
      keyedMessage(cardLineDiagnosticMessage(advisory, { file: 'decks/burn.md', line: 4 })),
    ).toBe('decks/burn.md:4: Read the export printing (M10) 146 as (M10:146).')
    expect(keyedMessage(cardLineDiagnosticMessage(advisory))).toBe(
      'Read the export printing (M10) 146 as (M10:146).',
    )
  })
})

describe('the reader’s language', () => {
  test('the CLI renders a diagnostic in its language; the string channels stay English', () => {
    const error = diagnosticOf('deck', '1 Sol Ring [jp]')
    const english = 'line 3: Unrecognized token [jp]. (did you mean [ja]?)'
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      const rendered = renderCardLineDiagnostic(error, { line: 3 })
      expect(rendered).not.toBe(english)
      expect(rendered).not.toContain('Unrecognized token')
      expect(rendered).not.toContain('did you mean')
      // The token and the suggested code are the file's own bytes in any language.
      expect(rendered).toContain('[jp]')
      expect(rendered).toContain('[ja]')
      // What the parsers record — and so what the API and MCP send — is English.
      const report = createLineDiagnostics()
      report.record(error, 3)
      expect(report.warnings).toEqual([english])
      expect(report.notices[0]?.message.message).toBe(english)
      expect(renderCardLineDiagnostic(error, { line: 3 }, DEFAULT_LOCALE)).toBe(english)
      expectLocaleInForce(locale)
    })
  })
})

describe('the line format never localizes', () => {
  /** One line per token kind, and one carrying them all, with what it reads back to. */
  const LINES: readonly [type: ListType, fields: DeckCardLineFields, english: string][] = [
    ['deck', { name: 'Sol Ring', quantity: 2 }, '- 2 Sol Ring'],
    [
      'collection',
      { name: 'Sol Ring', printing: { set: 'lea', collectorNumber: '270' } },
      '- Sol Ring (LEA:270)',
    ],
    [
      'collection',
      { name: 'Shock', printing: { set: 'm21', collectorNumber: '159' }, finish: 'etched' },
      '- Shock (M21:159) [etched]',
    ],
    [
      'collection',
      { name: 'Shock', printing: { set: 'm21', collectorNumber: '159' }, condition: 'LP' },
      '- Shock (M21:159) [LP]',
    ],
    ['wanted', { name: 'Shock', language: 'zhs' }, '- Shock [zhs]'],
    [
      'collection',
      {
        name: 'Shock',
        printing: { set: 'm21', collectorNumber: '159' },
        labels: ['trade', 'no-sale'],
      },
      '- Shock (M21:159) [trade,no-sale]',
    ],
    ['deck', { name: 'Shock', labels: ['no-proxy'] }, '- 1 Shock [no-proxy]'],
    ['wanted', { name: 'Shock', tags: ['Ramp', 'Card Draw'] }, '- Shock #Card Draw, Ramp'],
    ['wanted', { name: 'Shock', note: 'from a friend' }, '- Shock {from a friend}'],
    ['wanted', { name: 'Shock', cardId: 12 }, '- Shock &12'],
    // Digits a locale would group (`1.234` in German) are written as the file
    // spells them, never grouped: a bare quantity up to the cap, and an
    // `x`-marked one past it — the only form a deck reads back as a quantity.
    ['deck', { name: 'Sol Ring', quantity: 999, cardId: 1234 }, '- 999 Sol Ring &1234'],
    ['deck', { name: 'Sol Ring', quantity: 1234, cardId: 1234 }, '- 1234x Sol Ring &1234'],
    // Every token at its default writes nothing: a bare line.
    [
      'collection',
      {
        name: 'Shock',
        printing: { set: 'm21', collectorNumber: '159' },
        finish: 'nonfoil',
        condition: 'NM',
        language: 'en',
      },
      '- Shock (M21:159)',
    ],
    [
      'collection',
      {
        name: 'Lightning Bolt',
        printing: { set: 'lea', collectorNumber: '161' },
        finish: 'foil',
        condition: 'HP',
        language: 'ja',
        labels: ['sale', 'trade'],
        tags: ['Burn'],
        note: 'signed',
        cardId: 4,
      },
      '- Lightning Bolt (LEA:161) [foil] [HP] [ja] [sale,trade] #Burn {signed} &4',
    ],
  ]

  /** Write one line of `type`: a deck line carries its quantity, a flat line never does. */
  function writeLine(type: ListType, fields: DeckCardLineFields): string {
    if (type === 'deck') return formatCanonicalCardLine('deck', fields)
    const { quantity: _copies, ...flat } = fields
    return formatCanonicalCardLine(type, flat)
  }

  /** Every line written, and each read back to its tokens. */
  type LineRun = { lines: string[]; tokens: LineTokens[] }

  function writeAndRead(): LineRun {
    const lines = LINES.map(([type, fields]) => writeLine(type, fields))
    const tokens = lines.map((line, index) => parsedCardLine(LINES[index]![0], line))
    return { lines, tokens }
  }

  const english = writeAndRead()

  test('every token kind writes its canonical English bytes and reads back', () => {
    expect(english.lines).toEqual(LINES.map(([, , line]) => line))
    // Written and read again, a line is byte-identical: the format round-trips.
    english.lines.forEach((line, index) => {
      expect(writeLine(LINES[index]![0], english.tokens[index]!)).toBe(line)
    })
  })

  /** The label, tag and category values a list stores beside its lines. */
  function storedValues(): string[] {
    const record = emptyCardCategoriesRecord()
    record.order.push(...DEFAULT_CARD_CATEGORIES)
    record.cards.set('sol ring', { name: 'Sol Ring', categories: ['Board Wipes', 'Ramp'] })
    return [
      formatCardLabels(['trade', 'sale'] satisfies CardLabel[]),
      formatLabelOverride(['keep', 'no-sale']),
      formatCardTagsToken(['Ramp', 'Card Draw']),
      serializeCardCategoriesSidecar(record),
      // The language names a changelog line persists and re-parses.
      ...CARD_LANGUAGES.map(languageDisplayName),
    ]
  }

  const englishValues = storedValues()

  /**
   * Under `de` the real checks are the language names (`Intl.DisplayNames`
   * would answer `Japanisch`) and the numbers (`Intl.NumberFormat` would write
   * `1.234`); under the pseudo-locale, any catalog text that leaked into a line.
   * For the token literals themselves this is a tripwire — nothing in the
   * writers reads the locale today, and this is what fails if one starts to.
   */
  test.each(foreignLocales())(
    'lines, numbers, language names and label, tag and category values are the same bytes under $tag',
    ({ tag, catalog }) => {
      withSyntheticLocale(tag, catalog, (locale) => {
        expectLocaleInForce(locale)
        expect(writeAndRead()).toEqual(english)
        expect(storedValues()).toEqual(englishValues)
        expectLocaleInForce(locale)
      })
    },
  )
})
