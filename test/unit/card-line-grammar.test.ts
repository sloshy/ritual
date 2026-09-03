import { describe, expect, test } from 'bun:test'
import {
  CARD_LINE_ADVISORY_KINDS,
  isCardLineError,
  CARD_LINE_ERROR_CODES,
  formatCardLineDiagnostic,
  GRAMMAR,
  parseCardLine,
  readAnyCardId,
  readCardId,
  TOKEN_KINDS,
  type CardLineError,
  type CardLineErrorCode,
  type TokenCardLineError,
  type LineTokens,
} from '../../src/card/card-line-grammar'
import type { ListType } from '../../src/list/list-type'

/**
 * The tokenizer suite. Every row of `research/list-format-review-2026-08-28.md`
 * §2.1 (the three-regex drift that silently corrupted card names) is pinned
 * here, alongside one case per error code and the read tolerances the grammar
 * promises: any token order, any whitespace run, an optional bullet, `Nx`
 * quantities, and the Arena/MTGO export dialect.
 *
 * Engine-layer by the Test Layering Policy: the parsers, the CLI and the admin
 * handlers all reach this one function, so semantics are asserted here and
 * nowhere else.
 */

/** Parse and assert success, returning the tokens. */
function parsed(type: ListType, line: string): LineTokens {
  const result = parseCardLine(type, line)
  if (!result.ok) throw new Error(`expected ${type} line to parse: ${line} — ${result.message}`)
  return result.tokens
}

/** Parse and assert failure, returning the error. */
function refused(type: ListType, line: string): CardLineError {
  const result = parseCardLine(type, line)
  if (result.ok) throw new Error(`expected ${type} line to be refused: ${line}`)
  return result
}

/** Parse and assert a refusal that names a token, returning it narrowed. */
function refusedToken(type: ListType, line: string): TokenCardLineError {
  const error = refused(type, line)
  if (!isTokenError(error)) throw new Error(`expected a token-level refusal: ${line}`)
  return error
}

/** The token half of the refusal union — the members carrying `token`/`column`. */
function isTokenError(error: CardLineError): error is TokenCardLineError {
  return 'token' in error
}

describe('the drift defects from review §2.1', () => {
  /** Each row: the input that used to corrupt a name, and what it must now read as. */
  const rows: readonly [string, ListType, string, Partial<LineTokens>][] = [
    [
      'a double space before the printing no longer lands in the name',
      'collection',
      '- Sol Ring  (LEA:270)',
      { name: 'Sol Ring', printing: { set: 'lea', collectorNumber: '270' } },
    ],
    [
      'a double space before a bracket token no longer swallows the printing',
      'collection',
      '- Sol Ring (LEA:270)  [foil]',
      { name: 'Sol Ring', printing: { set: 'lea', collectorNumber: '270' }, finish: 'foil' },
    ],
    [
      'an underscore set code is legal on a flat list',
      'collection',
      '- Sol Ring (PLST_X:270)',
      { name: 'Sol Ring', printing: { set: 'plst_x', collectorNumber: '270' } },
    ],
    [
      'condition before finish keeps the printing',
      'collection',
      '- Sol Ring (LEA:161) [LP] [foil]',
      {
        name: 'Sol Ring',
        printing: { set: 'lea', collectorNumber: '161' },
        finish: 'foil',
        condition: 'LP',
      },
    ],
    [
      'a deck line with out-of-order tokens no longer loses them silently',
      'deck',
      '2 Sol Ring [foil] (LEA:161) [NM]',
      {
        quantity: 2,
        name: 'Sol Ring',
        printing: { set: 'lea', collectorNumber: '161' },
        finish: 'foil',
        condition: 'NM',
      },
    ],
  ]

  for (const [title, type, line, expected] of rows) {
    test(title, () => {
      expect(parsed(type, line)).toMatchObject(expected)
    })
  }

  test('a condition on a wanted line names the token and the rule', () => {
    const error = refused('wanted', '- Bolt (LEA:161) [LP]')
    expect(error).toMatchObject({
      code: 'token-not-allowed',
      kind: 'condition',
      token: '[LP]',
      listType: 'wanted',
    })
    expect(error.message).toBe(
      '[LP] is not a wanted list token — wanted lists never carry a condition.',
    )
    expect(refusedToken('wanted', '- Bolt (LEA:161) [LP]').column).toBe('- Bolt (LEA:161) '.length)
  })
})

describe('the canonical form on every list type', () => {
  test('a full deck line', () => {
    expect(
      parsed('deck', '2 Lightning Bolt (2XM:157) [foil] [LP] [ja] [proxy] {my note} &5'),
    ).toEqual({
      quantity: 2,
      name: 'Lightning Bolt',
      printing: { set: '2xm', collectorNumber: '157' },
      finish: 'foil',
      condition: 'LP',
      language: 'ja',
      labels: ['proxy'],
      note: 'my note',
      cardId: 5,
    })
  })

  test('a full collection line', () => {
    expect(
      parsed('collection', '- Sol Ring (LTC:284) [etched] [MP] [de] [sale,trade] {shelf 2} &12'),
    ).toEqual({
      quantity: 1,
      name: 'Sol Ring',
      printing: { set: 'ltc', collectorNumber: '284' },
      finish: 'etched',
      condition: 'MP',
      language: 'de',
      labels: ['sale', 'trade'],
      note: 'shelf 2',
      cardId: 12,
    })
  })

  test('a full wanted line', () => {
    expect(parsed('wanted', '- Sol Ring (LEA:270) [foil] [ja] {for the cube} &3')).toEqual({
      quantity: 1,
      name: 'Sol Ring',
      printing: { set: 'lea', collectorNumber: '270' },
      finish: 'foil',
      language: 'ja',
      note: 'for the cube',
      cardId: 3,
    })
  })

  test('a name-only entry carries nothing but its name', () => {
    expect(parsed('wanted', '- Sol Ring')).toEqual({ quantity: 1, name: 'Sol Ring' })
  })

  test('set codes are lowercased in memory', () => {
    expect(parsed('deck', '1 Sol Ring (LeA:161A)').printing).toEqual({
      set: 'lea',
      // The collector number keeps its case: `161a` and `161A` are the same
      // printing to Scryfall, but the number is not a code to fold.
      collectorNumber: '161A',
    })
  })
})

describe('token order', () => {
  const permutations: readonly string[][] = [
    ['[foil]', '[LP]', '[ja]', '[keep]'],
    ['[LP]', '[foil]', '[keep]', '[ja]'],
    ['[ja]', '[keep]', '[LP]', '[foil]'],
    ['[keep]', '[ja]', '[foil]', '[LP]'],
    ['[LP]', '[ja]', '[foil]', '[keep]'],
  ]

  for (const order of permutations) {
    test(`reads the same tokens from ${order.join(' ')}`, () => {
      expect(parsed('collection', `- Sol Ring (LEA:270) ${order.join(' ')} &4`)).toEqual({
        quantity: 1,
        name: 'Sol Ring',
        printing: { set: 'lea', collectorNumber: '270' },
        finish: 'foil',
        condition: 'LP',
        language: 'ja',
        labels: ['keep'],
        cardId: 4,
      })
    })
  }

  test('the printing may come after the bracket tokens', () => {
    expect(parsed('collection', '- Sol Ring [foil] [ja] (LEA:270)')).toMatchObject({
      name: 'Sol Ring',
      printing: { set: 'lea', collectorNumber: '270' },
      finish: 'foil',
      language: 'ja',
    })
  })
})

describe('whitespace and bullets', () => {
  const equivalent: readonly string[] = [
    '- Sol Ring (LEA:270) [foil] &7',
    '-   Sol Ring   (LEA:270)   [foil]   &7',
    '-\tSol Ring\t(LEA:270)\t[foil]\t&7',
    '   - Sol Ring (LEA:270) [foil] &7   ',
    // The bullet is optional on read; the writer always emits one.
    'Sol Ring (LEA:270) [foil] &7',
  ]

  for (const line of equivalent) {
    test(`reads ${JSON.stringify(line)} identically`, () => {
      expect(parsed('collection', line)).toEqual({
        quantity: 1,
        name: 'Sol Ring',
        printing: { set: 'lea', collectorNumber: '270' },
        finish: 'foil',
        cardId: 7,
      })
    })
  }

  test('a deck line may carry a bullet', () => {
    expect(parsed('deck', '- 2 Sol Ring (LEA:270)')).toMatchObject({
      quantity: 2,
      name: 'Sol Ring',
    })
  })
})

describe('quantities', () => {
  const rows: readonly [string, ListType, string, number, string][] = [
    ['a bare deck quantity', 'deck', '2 Sol Ring', 2, 'Sol Ring'],
    ['a lowercase x', 'deck', '4x Sol Ring', 4, 'Sol Ring'],
    ['an uppercase X', 'deck', '4X Sol Ring', 4, 'Sol Ring'],
    ['a three-digit quantity', 'deck', '100 Mountain', 100, 'Mountain'],
    ['an absent deck quantity means one copy', 'deck', 'Sol Ring', 1, 'Sol Ring'],
    ['a pasted quantity on a flat list', 'wanted', '- 3 Sol Ring', 3, 'Sol Ring'],
    ['an explicit x lifts the digit cap', 'deck', '1996x Sol Ring', 1996, 'Sol Ring'],
  ]

  for (const [title, type, line, quantity, name] of rows) {
    test(title, () => {
      expect(parsed(type, line)).toMatchObject({ quantity, name })
    })
  }

  test('a four-digit run is a card name, not a quantity', () => {
    expect(parsed('deck', '1996 World Champion')).toEqual({
      quantity: 1,
      name: '1996 World Champion',
    })
    expect(parsed('collection', '- 1996 World Champion (PCEL:1)')).toMatchObject({
      quantity: 1,
      name: '1996 World Champion',
    })
  })

  test('zero copies is a refusal that names the quantity', () => {
    expect(refused('deck', '0 Sol Ring')).toMatchObject({
      code: 'bad-quantity',
      kind: 'quantity',
      token: '0',
      column: 0,
    })
  })
})

describe('read tolerance for the export dialects', () => {
  test('lifts an Arena `(SET) CN` printing and says so', () => {
    const result = parseCardLine('deck', '4 Lightning Bolt (M10) 146')
    expect(result).toMatchObject({
      ok: true,
      tokens: {
        quantity: 4,
        name: 'Lightning Bolt',
        printing: { set: 'm10', collectorNumber: '146' },
      },
    })
    expect(result.ok && result.advisories).toEqual([
      {
        severity: 'advisory',
        kind: 'dialect-rewritten',
        token: '(M10) 146',
        message: 'Read the export printing (M10) 146 as (M10:146).',
      },
    ])
  })

  test('reads a trailing *F* / *E* finish marker', () => {
    const foil = parseCardLine('deck', '1 Sol Ring (LTC) 284 *F*')
    expect(foil).toMatchObject({
      ok: true,
      tokens: {
        name: 'Sol Ring',
        finish: 'foil',
        printing: { set: 'ltc', collectorNumber: '284' },
      },
    })
    // Both advisories share a kind, so the tokens are what tell the marker
    // apart from the printing.
    expect(foil.ok && foil.advisories.map((a) => a.token)).toEqual(['*F*', '(LTC) 284'])
    expect(parsed('deck', '1 Sol Ring *E*')).toMatchObject({
      name: 'Sol Ring',
      finish: 'etched',
    })
  })

  // Moxfield's documented bulk-edit grammar puts the finish marker *between*
  // the set and the collector number, and that is the form `ritual export
  // --format text --dialect moxfield` writes — so reading it back here is what
  // makes a Ritual moxfield export round-trip through `ritual import`.
  test("reads Moxfield's `(SET) *F* CN` form, lifting both the printing and the finish", () => {
    const result = parseCardLine('deck', '1 Mana Crypt (2XM) *F* 270')
    expect(result).toMatchObject({
      ok: true,
      tokens: {
        quantity: 1,
        name: 'Mana Crypt',
        finish: 'foil',
        printing: { set: '2xm', collectorNumber: '270' },
      },
    })
    // One advisory, not two: the marker is part of the printing suffix here
    // rather than a token of its own.
    expect(result.ok && result.advisories).toEqual([
      {
        severity: 'advisory',
        kind: 'dialect-rewritten',
        token: '(2XM) *F* 270',
        message: 'Read the export printing (2XM) *F* 270 as (2XM:270) [foil].',
      },
    ])
    expect(parsed('deck', '1 Sol Ring (CMM) *e* 410')).toMatchObject({
      name: 'Sol Ring',
      finish: 'etched',
      printing: { set: 'cmm', collectorNumber: '410' },
    })
  })

  test('a parenthesized card name is never lifted into a printing', () => {
    // The collector number is required precisely so these survive.
    for (const name of [
      'Very Cryptic Command (Untap)',
      'Hazmat Suit (Used)',
      'Ineffable Blessing (Cardboard)',
    ]) {
      const result = parseCardLine('deck', `1 ${name}`)
      expect(result).toMatchObject({ ok: true, tokens: { name } })
      expect(result.ok && result.tokens.printing).toBeUndefined()
      expect(result.ok && result.advisories.map((a) => a.kind)).toEqual([
        'suspect-printing-in-name',
      ])
    }
  })

  test('a canonical printing is read as itself, never as a dialect', () => {
    // Both halves matter: no advisory, *and* the printing actually lifted out
    // of the name. Neither dialect regex matches a `SET:CN` body, so asserting
    // only the empty advisory list would still pass if the printing scan broke
    // and the line became a card named `Sol Ring (LEA:161)`.
    const result = parseCardLine('deck', '1 Sol Ring (LEA:161)')
    expect(result.ok && result.advisories).toEqual([])
    expect(result.ok && result.tokens).toEqual({
      quantity: 1,
      name: 'Sol Ring',
      printing: { set: 'lea', collectorNumber: '161' },
    })
  })
})

describe('advisories', () => {
  test('a pasted quantity on a flat list announces the expansion', () => {
    const result = parseCardLine('wanted', '- 3 Sol Ring')
    expect(result.ok && result.tokens).toEqual({ quantity: 3, name: 'Sol Ring' })
    expect(result.ok && result.advisories).toEqual([
      {
        severity: 'advisory',
        kind: 'quantity-expanded',
        token: '3',
        message:
          'Read 3 copies: a wanted list holds one line per copy, ' +
          'so this line becomes 3 lines on the next save.',
      },
    ])
  })

  test('a deck quantity is canonical and says nothing', () => {
    const result = parseCardLine('deck', '3 Sol Ring')
    expect(result.ok && result.advisories).toEqual([])
  })

  test('every advisory kind is produced by some line', () => {
    const lines: readonly [ListType, string][] = [
      ['deck', '4 Lightning Bolt (M10) 146'],
      ['wanted', '- 3 Sol Ring'],
      ['deck', '1 Very Cryptic Command (Untap)'],
    ]
    const kinds = lines.flatMap(([type, line]) => {
      const result = parseCardLine(type, line)
      return result.ok ? result.advisories.map((advisory) => advisory.kind) : []
    })
    expect([...new Set(kinds)].sort()).toEqual([...CARD_LINE_ADVISORY_KINDS].sort())
  })

  test('a suspect printing on a collection still refuses for the missing printing', () => {
    // The advisory is not a substitute for the refusal: the line names no
    // printing a collection can store.
    expect(refused('collection', '- Very Cryptic Command (Untap)').code).toBe('missing-printing')
  })
})

describe('names the tokenizer must not eat', () => {
  const names: readonly string[] = [
    'Dandân',
    "Lim-Dûl's Vault",
    'Bebop & Rocksteady',
    'Circle of Protection: Art',
    "Look at Me, I'm the DCI",
    'Ratonhnhaké:ton',
    'Who//What//When//Where//Why',
  ]

  for (const name of names) {
    test(`keeps ${name} intact`, () => {
      expect(parsed('collection', `- ${name} (LEA:161) &2`)).toMatchObject({ name, cardId: 2 })
    })
  }

  test('a run of spaces inside a name is preserved, only the ends are trimmed', () => {
    // Trimmed, never collapsed: `Sol   Ring` is not the same card as `Sol Ring`,
    // and inventing a normalization here would corrupt a name the user wrote.
    expect(parsed('deck', '2   Sol   Ring  ').name).toBe('Sol   Ring')
  })

  test('a labels token tolerates whitespace around its commas', () => {
    // `[sale, trade]` is what a person types, and §3.1 promises whitespace runs
    // everywhere else in the grammar.
    expect(parsed('collection', '- Sol Ring (LEA:161) [sale, trade]').labels).toEqual([
      'sale',
      'trade',
    ])
    expect(parsed('collection', '- Sol Ring (LEA:161) [ sale ,trade ]').labels).toEqual([
      'sale',
      'trade',
    ])
  })

  test('an empty note folds to absent, like the writer that drops it', () => {
    expect(parsed('collection', '- Sol Ring (LEA:161) {}').note).toBeUndefined()
  })

  test('an explicit [en] folds to absent, like a bare line', () => {
    const tokens = parsed('collection', '- Sol Ring (LEA:161) [en]')
    expect(tokens.language).toBeUndefined()
  })

  test('an ampersand in a name is not an id', () => {
    expect(parsed('deck', '1 Bebop & Rocksteady')).toEqual({
      quantity: 1,
      name: 'Bebop & Rocksteady',
    })
  })
})

describe('notes', () => {
  test('a note runs to the last closing brace', () => {
    expect(parsed('collection', '- Sol Ring (LEA:161) {note with } brace}').note).toBe(
      'note with } brace',
    )
  })

  test('a note may contain a hash and an id-shaped token', () => {
    const tokens = parsed('collection', '- Sol Ring (LEA:161) {see #4 and &5}')
    expect(tokens.note).toBe('see #4 and &5')
    expect(tokens.cardId).toBeUndefined()
  })

  test('a real id after a note is still read', () => {
    expect(parsed('collection', '- Sol Ring (LEA:161) {see &5} &7')).toMatchObject({
      note: 'see &5',
      cardId: 7,
    })
  })

  test('an unclosed note is refused, not swallowed into the name', () => {
    expect(refused('collection', '- Sol Ring (LEA:161) {oops')).toMatchObject({
      code: 'malformed-note',
      kind: 'note',
      token: '{oops',
      column: '- Sol Ring (LEA:161) '.length,
    })
  })
})

describe('tags', () => {
  test('reads the comma-separated tag token on every list type, canonicalized', () => {
    for (const type of ['deck', 'collection', 'wanted'] as const) {
      const head = type === 'deck' ? '- 1 Sol Ring (LTC:284)' : '- Sol Ring (LTC:284)'
      const result = parseCardLine(
        type,
        `${head} [foil] #Zebra,  Card Draw ,binder/trade, Zebra {note} &12`,
      )
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.tokens.tags).toEqual(['binder/trade', 'Card Draw', 'Zebra'])
      expect(result.tokens.note).toBe('note')
      expect(result.tokens.cardId).toBe(12)
    }
  })

  test('a line with no tag tokens has no tags key at all', () => {
    const result = parseCardLine('deck', '1 Sol Ring (LTC:284) &1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('tags' in result.tokens).toBe(false)
  })

  test('tags are the one repeatable kind: one sigil per tag also reads, mixed with other tokens', () => {
    const result = parseCardLine('collection', '- Sol Ring #ramp (LTC:284) #staple [LP] #edh &3')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens.tags).toEqual(['edh', 'ramp', 'staple'])
    expect(result.tokens.condition).toBe('LP')
    expect(result.tokens.name).toBe('Sol Ring')
  })

  test('the tag probe still sees a digit-ending tag once the id is peeled, and the id has to be last', () => {
    const ok = parseCardLine('deck', '1 Sol Ring #tier1 &4')
    expect(ok.ok && ok.tokens.tags).toEqual(['tier1'])
    expect(ok.ok && ok.tokens.cardId).toBe(4)
    const misplaced = parseCardLine('deck', '1 Sol Ring &4 #ramp')
    expect(misplaced.ok).toBe(false)
    if (misplaced.ok) return
    expect(misplaced.code).toBe('misplaced-token')
    expect(misplaced.hint).toBe('the &N id must be the last token on the line')
  })

  test('a tag token runs from its sigil to the end of the tail, spaces included', () => {
    // No card name contains `#`, so the sigil is unambiguous: everything from
    // it to the next delimited token is the tag list, spaces and all.
    const result = parseCardLine('deck', '1 Sol Ring #Card Draw, Ramp (LTC:284)')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens.name).toBe('Sol Ring')
    expect(result.tokens.tags).toEqual(['Card Draw', 'Ramp'])
    expect(result.tokens.printing).toEqual({ set: 'ltc', collectorNumber: '284' })
  })

  test('a # glued to the word before it is an unseparated token, not a tag', () => {
    const result = parseCardLine('deck', '1 Sol#ramp Ring (LTC:284)')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unseparated-token')
    // The stranded token runs to the end of the name: a tag body may hold spaces.
    expect('token' in result && result.token).toBe('#ramp Ring')
  })

  test('an unclosed note after the tags is a malformed note, not a malformed tag', () => {
    const result = parseCardLine('collection', '- Sol Ring (LTC:284) #Ramp {half a note')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('malformed-note')
  })

  test('a tag glued to the note after it is blamed on itself, not on the printing', () => {
    const result = parseCardLine('collection', '- Sol Ring (LTC:284) #Ramp{note} &7')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unseparated-token')
    expect('token' in result && result.token).toBe('#Ramp')
  })

  test("a Moxfield-style paste's tags import for free", () => {
    const result = parseCardLine('deck', '1 Sol Ring (C21) 263 #ramp')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens.printing).toEqual({ set: 'c21', collectorNumber: '263' })
    expect(result.tokens.tags).toEqual(['ramp'])
  })

  test('a note ending in a #word is prose, never a malformed tag', () => {
    // The delimiter branches run before the tag probe: `#upgrade}` closes the
    // note, so the line reads exactly as its serializer wrote it.
    for (const line of [
      '- Lightning Bolt (LEA:161) {needs #upgrade}',
      '- Lightning Bolt (LEA:161) #ramp {needs #upgrade} &4',
      '- Sol Ring (LTC:284) {see #4 and &5} &8',
    ]) {
      const result = parseCardLine('collection', line)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.tokens.name).toBe(line.startsWith('- Sol') ? 'Sol Ring' : 'Lightning Bolt')
      expect(result.tokens.note?.includes('#')).toBe(true)
    }
    const tagged = parseCardLine(
      'collection',
      '- Lightning Bolt (LEA:161) #ramp {needs #upgrade} &4',
    )
    expect(tagged.ok && tagged.tokens.tags).toEqual(['ramp'])
    expect(tagged.ok && tagged.tokens.cardId).toBe(4)
  })
})

describe('every error code', () => {
  const rows: readonly [CardLineErrorCode, ListType, string, Partial<CardLineError>][] = [
    ['not-a-card-line', 'deck', '', { message: 'Blank line.' }],
    ['not-a-card-line', 'collection', '## Main', { message: 'Not a card line: ## Main' }],
    ['not-a-card-line', 'collection', '# My Collection', {}],
    ['not-a-card-line', 'deck', '// a comment', {}],
    ['not-a-card-line', 'deck', '```', {}],
    ['not-a-card-line', 'deck', '~~~ts', {}],
    // A horizontal rule, and the delimiter a caller's front-matter reader leaves
    // behind — never a card named `---`.
    ['not-a-card-line', 'collection', '---', {}],
    ['empty-name', 'deck', '- (LEA:161) &4', { message: 'No card name: - (LEA:161) &4' }],
    ['empty-name', 'collection', '- &4', {}],
    [
      'unknown-token',
      'deck',
      '1 Sol Ring [jp]',
      {
        token: '[jp]',
        hint: 'did you mean [ja]?',
        column: '1 Sol Ring '.length,
        message: 'Unrecognized token [jp].',
      },
    ],
    // Case matters: the bracket vocabularies are written lowercase (finish,
    // language, labels) or uppercase (condition), and nothing folds them.
    ['unknown-token', 'deck', '1 Sol Ring [Foil]', { token: '[Foil]' }],
    ['unknown-token', 'collection', '- Sol Ring (LEA:1) [mint]', { token: '[mint]' }],
    [
      'token-not-allowed',
      'wanted',
      '- Sol Ring (LEA:1) [keep]',
      {
        token: '[keep]',
        kind: 'labels',
        column: '- Sol Ring (LEA:1) '.length,
        message: '[keep] is not a wanted list token — wanted lists never carry labels.',
      },
    ],
    [
      'malformed-tag',
      'deck',
      '1 Sol Ring #R&D',
      {
        token: '#R&D',
        kind: 'tags',
        column: '1 Sol Ring '.length,
        message:
          "Malformed tag token #R&D: a tag is non-empty plain text that cannot contain '#', ',', '&', '*', double quotes, brackets, braces or parentheses.",
      },
    ],
    ['malformed-tag', 'collection', '- Sol Ring (LEA:1) #', { token: '#' }],
    ['malformed-tag', 'wanted', '- Sol Ring # , ,', { token: '# , ,' }],
    [
      'duplicate-token',
      'deck',
      '1 Sol Ring [foil] [etched]',
      {
        token: '[foil]',
        kind: 'finish',
        column: '1 Sol Ring '.length,
        message: 'Duplicate finish token [foil].',
      },
    ],
    [
      'duplicate-token',
      'deck',
      '1 Sol Ring (LEA:1) (2XM:2)',
      { token: '(LEA:1)', kind: 'printing', message: 'Duplicate printing token (LEA:1).' },
    ],
    [
      'bad-quantity',
      'deck',
      '0x Sol Ring',
      {
        token: '0x',
        kind: 'quantity',
        column: 0,
        message: 'A card line must name at least one copy.',
      },
    ],
    ['bad-quantity', 'collection', '- 0 Sol Ring (LEA:1)', { token: '0', column: 2 }],
    [
      'missing-printing',
      'collection',
      '- Sol Ring',
      {
        kind: 'printing',
        message: 'A collection line must name a printing, e.g. (LEA:161): - Sol Ring',
      },
    ],
    [
      'malformed-note',
      'deck',
      '1 Sol Ring (LEA:1) {oops',
      {
        kind: 'note',
        token: '{oops',
        message: 'Unclosed note: a {note} must end with a closing brace.',
      },
    ],
    [
      'misplaced-token',
      'deck',
      '1 Sol Ring (LEA:161) &4 [foil]',
      {
        token: '&4',
        kind: 'id',
        column: '1 Sol Ring (LEA:161) '.length,
        message: "&4 is inside the card name: a card line's tokens all follow the name.",
        hint: 'the &N id must be the last token on the line',
      },
    ],
    [
      // The same line on a collection used to report `missing-printing` — on a
      // line that plainly names one.
      'misplaced-token',
      'collection',
      '- Sol Ring (LEA:161) &4 [foil]',
      { token: '&4', kind: 'id' },
    ],
    [
      'misplaced-token',
      'deck',
      '1 Sol Ring [foil] and some prose',
      { token: '[foil]', kind: 'finish', hint: 'move [foil] after the name' },
    ],
    [
      // The shape that used to blame a *missing* printing on a collection line
      // that plainly names one, and to pass silently everywhere else.
      'unseparated-token',
      'collection',
      '- Sol Ring (LEA:270)&2',
      {
        token: '&2',
        kind: 'id',
        column: '- Sol Ring (LEA:270)'.length,
        message:
          "&2 runs into the text beside it: a card line's tokens are separated by whitespace.",
        hint: 'insert a space before &2',
      },
    ],
    [
      'conflicting-labels',
      'collection',
      '- Sol Ring (LEA:1) [keep,sale]',
      {
        token: '[keep,sale]',
        kind: 'labels',
        column: '- Sol Ring (LEA:1) '.length,
        // English by construction, like every other message this type carries —
        // the exclusivity *rule* still comes from `parseCardLabelsToken`.
        message: 'Conflicting labels [keep,sale] — [keep] cannot be combined with any other label.',
      },
    ],
  ]

  for (const [code, type, line, expected] of rows) {
    test(`${code} for ${JSON.stringify(line)} on a ${type}`, () => {
      expect(refused(type, line)).toMatchObject({ ...expected, code, listType: type, line })
    })
  }

  test('every code in the union is covered by a row', () => {
    // `CARD_LINE_ERROR_CODES` is built from a full `Record<CardLineErrorCode, …>`,
    // so a new code fails to compile until it is listed there and then fails
    // here until a row exercises it.
    expect([...new Set(rows.map(([code]) => code))].sort()).toEqual(
      [...CARD_LINE_ERROR_CODES].sort(),
    )
  })
})

describe('the ALLOWED table', () => {
  test('decks and collections take every token kind', () => {
    expect([...GRAMMAR.deck.allowed].sort()).toEqual([...TOKEN_KINDS].sort())
    expect([...GRAMMAR.collection.allowed].sort()).toEqual([...TOKEN_KINDS].sort())
  })

  test('wanted lists take neither a condition nor labels', () => {
    expect(GRAMMAR.wanted.allowed.has('condition')).toBe(false)
    expect(GRAMMAR.wanted.allowed.has('labels')).toBe(false)
  })

  test('only a collection requires a printing', () => {
    expect([...GRAMMAR.collection.required]).toEqual(['printing'])
    expect([...GRAMMAR.deck.required]).toEqual([])
    expect([...GRAMMAR.wanted.required]).toEqual([])
  })

  test('a deck keeps a labels token its vocabulary does not cover', () => {
    // `[sale]` on a deck is a *value* refusal the callers make (keeping the
    // card, dropping the labels), not a grammar refusal that costs the line.
    expect(parsed('deck', '1 Sol Ring [sale]').labels).toEqual(['sale'])
  })
})

describe('a token stranded inside the name is named, never absorbed', () => {
  test('a misplaced printing is reported when no id is out of place', () => {
    expect(refused('deck', '1 Sol Ring (LEA:161) extra words')).toMatchObject({
      code: 'misplaced-token',
      kind: 'printing',
      token: '(LEA:161)',
    })
  })

  test('the id is preferred over any other misplaced token', () => {
    // A stranded `&N` is nearly always the actual cause, and its fix is the
    // most specific thing the parser can say.
    expect(refusedToken('collection', '- Sol Ring (LEA:161) &4 [foil]').token).toBe('&4')
  })

  const untouched: readonly [ListType, string][] = [
    // A real card name's parenthesis names no set:cn, so nothing was lost.
    ['deck', '1 Very Cryptic Command (Untap) is a card'],
    // An unrecognized bracket is text, not a token the line failed to carry.
    ['deck', '1 Sol Ring [whatever] words'],
    // Split cards keep their slashes and their printing.
    ['deck', '1 Fire // Ice (APC:128)'],
  ]

  for (const [type, line] of untouched) {
    test(`${line} still parses`, () => {
      expect(parseCardLine(type, line).ok).toBe(true)
    })
  }
})

describe('a glued token is a missing space, never a silent name', () => {
  // Whitespace between the name and its tokens is mandatory in the grammar, so
  // a glued token is not read as one. Absorbing it into the name instead is the
  // silent failure — a card named `Sol Ring(LEA:270)` that misses the cache,
  // Scryfall, pricing and every sync join — so the line is refused and the
  // missing separator is what the refusal names.
  const glued: readonly [ListType, string, string][] = [
    ['deck', '1 Sol Ring(LEA:270)', '(LEA:270)'],
    ['deck', '1 Sol Ring[foil]', '[foil]'],
    ['deck', '1 Sol Ring{note}', '{note}'],
    ['deck', '1 Sol Ring&5', '&5'],
    // A token glued to the token before it, rather than to the name.
    ['collection', '- Sol Ring (LEA:270)[foil]', '(LEA:270)'],
  ]

  for (const [type, line, token] of glued) {
    test(`${line} names ${token} as the token that needs a space`, () => {
      expect(refused(type, line)).toMatchObject({ code: 'unseparated-token', token })
    })
  }

  test('the hint names the side the space belongs on', () => {
    // `(LEA:270)` has its leading space and lacks its trailing one; `&2` is the
    // other way round, and telling its author to move an id that is already
    // last would help nobody.
    expect(refused('collection', '- Sol Ring (LEA:270)[foil]').hint).toBe(
      'insert a space after (LEA:270)',
    )
    expect(refused('deck', '1 Sol Ring&5').hint).toBe('insert a space before &5')
  })

  test('text that is not token-shaped stays part of the name', () => {
    // The rule is about *tokens*, not about parentheses: an unrecognized
    // bracket and a real card name's parenthesis lose nothing by staying.
    expect(parsed('deck', '1 Sol Ring[whatever]')).toEqual({
      quantity: 1,
      name: 'Sol Ring[whatever]',
    })
    expect(parsed('deck', '1 Very Cryptic Command(Untap)')).toEqual({
      quantity: 1,
      name: 'Very Cryptic Command(Untap)',
    })
  })

  test('a token that opens the line is still a token', () => {
    expect(refused('deck', '(LEA:161)').code).toBe('empty-name')
  })
})

describe('readCardId agrees with the tokenizer', () => {
  // Two readers of one token: `readCardId` seeds the id pool from raw file
  // bytes while `parseCardLine` reads the entries. An id one sees and the other
  // does not is an id handed to a second card.
  const corpus: readonly string[] = [
    '- Sol Ring (LEA:161) &12',
    '- Sol Ring (LEA:161) &12   ',
    '- Sol Ring (LEA:161)',
    '- Bebop & Rocksteady (LEA:161)',
    '- Sol Ring (LEA:161) {see &5}',
    '- Sol Ring&5 (LEA:161)',
    '- Sol Ring (LEA:161)&5',
    '- Sol Ring (LEA:161) &4 [foil]',
  ]

  for (const line of corpus) {
    test(`${JSON.stringify(line)} reads the same id both ways`, () => {
      const result = parseCardLine('collection', line)
      expect(readCardId(line)).toBe(result.ok ? result.tokens.cardId : undefined)
    })
  }
})

describe('readAnyCardId is the wider pool seeder', () => {
  // The asymmetry is deliberate (see `card-line-id.ts`): the entry parser skips
  // a glued `&N`, but the id pool must still treat it as spoken for, or the
  // next backfill hands a live id to a second card.
  const glued = '1 Sol Ring&2'

  test('the entry reader skips a glued id, and the parser refuses the line', () => {
    expect(readCardId(glued)).toBeUndefined()
    expect(refused('deck', glued)).toMatchObject({ code: 'unseparated-token', token: '&2' })
  })

  test('the pool reader still reserves it', () => {
    expect(readAnyCardId(glued)).toBe(2)
    // The shape that motivates the rule: a glued id on a real flat-list line.
    expect(readAnyCardId('- Sol Ring (LEA:2)&2')).toBe(2)
  })

  test('a tag written after the id is refused by the parser but still reserves the id', () => {
    const trailing = '- Sol Ring (LEA:2) &2 #ramp'
    expect(refused('collection', trailing)).toMatchObject({ code: 'misplaced-token', token: '&2' })
    expect(readCardId(trailing)).toBeUndefined()
    expect(readAnyCardId(trailing)).toBe(2)
    expect(readAnyCardId('- Sol Ring (LEA:2) &2 #Card Draw, staple')).toBe(2)
    // Even glued — the seeder is deliberately wider than the entry parser.
    expect(readAnyCardId('- Sol Ring (LEA:2)&2#Ramp')).toBe(2)
    // …but never past a later `&N`: an `&12` inside a note is not the id.
    expect(readAnyCardId('- Sol Ring (LEA:2) {trade w/ Bob &12 #trade} &7')).toBe(7)
  })

  test('both readers agree on a canonical line', () => {
    expect(readAnyCardId('- Sol Ring (LEA:2) &2')).toBe(2)
    expect(readCardId('- Sol Ring (LEA:2) &2')).toBe(2)
  })

  test('neither invents an id from a name', () => {
    expect(readAnyCardId('- Bebop & Rocksteady')).toBeUndefined()
    expect(readCardId('- Bebop & Rocksteady')).toBeUndefined()
  })
})

describe('readCardId', () => {
  const rows: readonly [string, number | undefined][] = [
    ['1 Sol Ring &5', 5],
    ['- Sol Ring (LEA:161) &12', 12],
    ['- Sol Ring (LEA:161) &12   ', 12],
    ['- Sol Ring', undefined],
    ['- Bebop & Rocksteady', undefined],
    ['- Sol Ring (LEA:161) {see &5}', undefined],
    ['- Sol Ring&5', undefined],
    ['## Main', undefined],
  ]

  for (const [line, id] of rows) {
    test(`reads ${JSON.stringify(line)} as ${String(id)}`, () => {
      expect(readCardId(line)).toBe(id)
    })
  }
})

describe('isCardLineError', () => {
  // The two halves of the diagnostic channel both have a `kind`, and the two
  // kinds mean different things — so the guard reads the `severity`
  // discriminant, not the shape. P2 wires this into every save gate.
  test('separates a refusal from an advisory', () => {
    const error = refused('wanted', '- Bolt (LEA:161) [LP]')
    const parse = parseCardLine('deck', '4 Lightning Bolt (M10) 146')
    const advisory = parse.ok ? parse.advisories[0] : undefined
    expect(advisory).toBeDefined()
    expect(isCardLineError(error)).toBe(true)
    expect(advisory && isCardLineError(advisory)).toBe(false)
  })
})

describe('formatCardLineDiagnostic', () => {
  test('prefixes with the file when there is one', () => {
    const error = refused('wanted', '- Bolt (LEA:161) [LP]')
    expect(formatCardLineDiagnostic(error, { file: 'wanted/cube.md', line: 12 })).toBe(
      'wanted/cube.md:12: [LP] is not a wanted list token — wanted lists never carry a condition.',
    )
  })

  test('falls back to the line number for pasted text', () => {
    const error = refused('deck', '1 Sol Ring [jp]')
    expect(formatCardLineDiagnostic(error, { line: 3 })).toBe(
      'line 3: Unrecognized token [jp]. (did you mean [ja]?)',
    )
  })

  test('renders an advisory too', () => {
    const result = parseCardLine('deck', '4 Lightning Bolt (M10) 146')
    const advisory = result.ok ? result.advisories[0] : undefined
    expect(advisory && formatCardLineDiagnostic(advisory, { file: 'decks/burn.md', line: 4 })).toBe(
      'decks/burn.md:4: Read the export printing (M10) 146 as (M10:146).',
    )
  })
})
