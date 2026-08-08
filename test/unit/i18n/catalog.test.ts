import { describe, expect, test } from 'bun:test'
import { isCatalogEntryError, parseCatalogEntry } from '../../../src/i18n/catalog'
import {
  checkCatalogs,
  messagePlaceholders,
  validateBraces,
  type CatalogIssue,
  type CatalogReport,
  type IssueKind,
  type TranslationInput,
} from '../../../scripts/check-locales'
import { pseudoForm, pseudoLocalize, PSEUDO_LOCALE } from '../../../scripts/generate-locales'
import { en } from '../../../src/i18n/messages/en'
import { enMeta } from '../../../src/i18n/messages/en.meta'
import type { MessageCatalogShape, MessageMetaShape } from '../../../src/i18n/types'

// The validator is pure, so every case here is a synthetic catalog — never the
// shipped one, except for the two regression tests at the bottom that assert
// the shipped catalog and the generated pseudo-locale both validate clean.

const ENGLISH: MessageCatalogShape = {
  'cli.menu.saveAndExit': 'Save and exit',
  'cli.addCard.added': {
    $plural: 'count',
    one: 'Added {count} copy of {name}.',
    other: 'Added {count} copies of {name}.',
  },
  'domain.listType.title': {
    $select: 'listType',
    deck: 'Deck',
    other: 'List',
  },
}

const META: MessageMetaShape = {
  'cli.menu.saveAndExit': { description: 'Menu row: save and leave.', maxLen: 24 },
  'cli.addCard.added': { description: 'Confirmation after adding copies.' },
  'domain.listType.title': { description: 'Singular name of a list type.' },
}

/** A well-formed German translation of {@link ENGLISH}. */
const GOOD_DE: TranslationInput = {
  locale: 'de',
  origin: 'locales/de.json',
  catalog: {
    'cli.menu.saveAndExit': 'Speichern',
    'cli.addCard.added': {
      $plural: 'count',
      one: '{count} Exemplar von {name} hinzugefügt.',
      other: '{count} Exemplare von {name} hinzugefügt.',
    },
    'domain.listType.title': { $select: 'listType', deck: 'Deck', other: 'Liste' },
  },
}

function check(translations: readonly TranslationInput[]): CatalogReport {
  return checkCatalogs({ english: ENGLISH, meta: META, translations })
}

function kinds(report: CatalogReport): IssueKind[] {
  return report.issues.map((issue) => issue.kind)
}

function issuesOfKind(report: CatalogReport, kind: IssueKind): CatalogIssue[] {
  return report.issues.filter((issue) => issue.kind === kind)
}

/** One translation of {@link ENGLISH} with a single key replaced. */
function withKey(locale: string, key: string, value: unknown): TranslationInput {
  const base = GOOD_DE.catalog as Record<string, unknown>
  return { locale, origin: `locales/${locale}.json`, catalog: { ...base, [key]: value } }
}

describe('checkCatalogs', () => {
  test('a complete, well-formed translation is clean', () => {
    const report = check([GOOD_DE])
    expect(report.issues).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.coverage).toEqual([
      { locale: 'de', translated: 3, missing: 0, total: 3, percent: 100 },
    ])
  })

  test('1. a missing key warns and lowers coverage, but does not fail', () => {
    const report = check([
      { locale: 'de', origin: 'locales/de.json', catalog: { 'cli.menu.saveAndExit': 'Speichern' } },
    ])
    expect(kinds(report)).toEqual(['missing-key', 'missing-key'])
    expect(report.ok).toBe(true)
    expect(report.coverage[0]).toEqual({
      locale: 'de',
      translated: 1,
      missing: 2,
      total: 3,
      percent: 33,
    })
  })

  test('2. a key English does not have is a hard failure', () => {
    const report = check([withKey('de', 'cli.menu.retired', 'Veraltet')])
    expect(issuesOfKind(report, 'extra-key')).toHaveLength(1)
    expect(report.ok).toBe(false)
  })

  test('3. a placeholder-set mismatch fails and names both sets', () => {
    const report = check([
      withKey('de', 'cli.addCard.added', {
        $plural: 'count',
        one: '{count} Exemplar von {karte} hinzugefügt.',
        other: '{count} Exemplare von {karte} hinzugefügt.',
      }),
    ])
    const [issue] = issuesOfKind(report, 'placeholder-mismatch')
    expect(issue?.message).toContain('count, name')
    expect(issue?.message).toContain('count, karte')
    expect(report.ok).toBe(false)
  })

  test('4. plural categories must match the locale exactly', () => {
    // Russian needs one/few/many/other; a two-form catalog is wrong for 2–4.
    const russian = check([
      {
        locale: 'ru',
        origin: 'locales/ru.json',
        catalog: {
          ...(GOOD_DE.catalog as Record<string, unknown>),
          'cli.addCard.added': { $plural: 'count', one: '{count} {name}', other: '{count} {name}' },
        },
      },
    ])
    const [missingFew] = issuesOfKind(russian, 'plural-category')
    expect(missingFew?.message).toContain('few')
    expect(russian.ok).toBe(false)

    // Japanese has only `other`; a spurious `one` is equally wrong.
    const japanese = check([
      {
        locale: 'ja',
        origin: 'locales/ja.json',
        catalog: {
          ...(GOOD_DE.catalog as Record<string, unknown>),
          'cli.addCard.added': { $plural: 'count', one: '{count} {name}', other: '{count} {name}' },
        },
      },
    ])
    expect(issuesOfKind(japanese, 'plural-category')).toHaveLength(1)
    expect(japanese.ok).toBe(false)
  })

  test('5. $select branches and the selector parameter must match English', () => {
    const branches = check([
      withKey('de', 'domain.listType.title', {
        $select: 'listType',
        deck: 'Deck',
        collection: 'Sammlung',
        other: 'Liste',
      }),
    ])
    expect(issuesOfKind(branches, 'select-branch')).toHaveLength(1)
    expect(branches.ok).toBe(false)

    const selector = check([
      withKey('de', 'domain.listType.title', { $select: 'kind', deck: 'Deck', other: 'Liste' }),
    ])
    expect(issuesOfKind(selector, 'select-branch')[0]?.message).toContain('listType')
  })

  test('6. unbalanced and literal braces fail', () => {
    const unclosed = check([withKey('de', 'cli.menu.saveAndExit', 'Speichern {')])
    expect(issuesOfKind(unclosed, 'brace')).toHaveLength(1)
    expect(unclosed.ok).toBe(false)

    const stray = check([withKey('de', 'cli.menu.saveAndExit', 'Speichern }')])
    expect(issuesOfKind(stray, 'brace')).toHaveLength(1)

    const nested = check([withKey('de', 'cli.menu.saveAndExit', 'Speichern {a{b}}')])
    expect(issuesOfKind(nested, 'brace').length).toBeGreaterThan(0)
  })

  test('7. an invalid BCP-47 tag fails without validating the file', () => {
    const report = check([{ ...GOOD_DE, locale: 'not a tag' }])
    expect(kinds(report)).toEqual(['invalid-tag'])
    expect(report.ok).toBe(false)
  })

  test('8. a maxLen overrun fails, measured in display columns', () => {
    const report = check([
      withKey('de', 'cli.menu.saveAndExit', 'Speichern und die Sitzung beenden'),
    ])
    expect(issuesOfKind(report, 'max-len')).toHaveLength(1)
    expect(report.ok).toBe(false)

    // CJK counts two columns per character, so a short string can still bust.
    const cjk = check([withKey('de', 'cli.menu.saveAndExit', '保存して終了保存して終了保存')])
    expect(issuesOfKind(cjk, 'max-len')).toHaveLength(1)
  })

  test('9. dead keys fail by default and are downgraded by --allow-dead-keys', () => {
    // `check-locales.ts` passes `deadKeySeverity: 'error'` unless `--allow-dead-keys`
    // is given, so error is the production default; `checkCatalogs`'s own default
    // stays `'warn'` because a caller driving it with a partial `referencedKeys`
    // set (or none) has not established that a key is dead.
    const lenient = checkCatalogs({
      english: ENGLISH,
      meta: META,
      referencedKeys: new Set(['cli.menu.saveAndExit']),
    })
    expect(issuesOfKind(lenient, 'dead-key')).toHaveLength(2)
    expect(lenient.ok).toBe(true)

    const strict = checkCatalogs({
      english: ENGLISH,
      meta: META,
      referencedKeys: new Set(['cli.menu.saveAndExit']),
      deadKeySeverity: 'error',
    })
    expect(strict.ok).toBe(false)
  })

  test('10. a namespace-boundary violation fails', () => {
    const report = checkCatalogs({
      english: ENGLISH,
      meta: META,
      namespaceViolations: [
        { file: 'src/site/Toolbar.tsx', line: 12, detail: 'uses the "cli" namespace key cli.x.y' },
      ],
    })
    expect(issuesOfKind(report, 'namespace-boundary')).toHaveLength(1)
    expect(report.issues[0]?.message).toContain('src/site/Toolbar.tsx:12')
    expect(report.ok).toBe(false)
  })

  test('unparseable and non-object catalogs fail as invalid JSON', () => {
    const broken = check([
      { locale: 'de', origin: 'locales/de.json', catalog: null, parseError: 'Unexpected token }' },
    ])
    expect(kinds(broken)).toEqual(['invalid-json'])

    const array = check([{ locale: 'de', origin: 'locales/de.json', catalog: ['nope'] }])
    expect(kinds(array)).toEqual(['invalid-json'])
  })

  test('a nested plural-in-select is rejected as a value-shape error', () => {
    const report = check([
      withKey('de', 'domain.listType.title', {
        $select: 'listType',
        deck: { $plural: 'count', one: 'Deck', other: 'Decks' },
        other: 'Liste',
      }),
    ])
    expect(issuesOfKind(report, 'value-shape')).toHaveLength(1)
    expect(report.ok).toBe(false)
  })

  test('an English key outside the namespace scheme fails', () => {
    const report = checkCatalogs({ english: { 'nope.key': 'Text' }, meta: {} })
    expect(kinds(report)).toEqual(['invalid-key'])
  })

  test('an English key with no meta entry fails', () => {
    const report = checkCatalogs({
      english: ENGLISH,
      meta: { 'cli.menu.saveAndExit': { description: 'Menu row.' } },
    })
    expect(issuesOfKind(report, 'value-shape')).toHaveLength(2)
  })
})

describe('catalog helpers', () => {
  test('placeholders are collected across every branch and sorted', () => {
    expect(messagePlaceholders(ENGLISH['cli.addCard.added'] as never)).toEqual(['count', 'name'])
    expect(messagePlaceholders('no params')).toEqual([])
  })

  test('validateBraces names the specific defect', () => {
    expect(validateBraces('Added {count} copies')).toBeNull()
    expect(validateBraces('Added {')).toContain('unclosed')
    expect(validateBraces('Added }')).toContain('unmatched')
    expect(validateBraces('Added {}')).toContain('empty')
    expect(validateBraces('Added {card name}')).toContain('invalid placeholder name')
  })

  // The shared shape parser (`src/i18n/catalog.ts`) is what the validator, the
  // browser's dictionary fetch and `build-site --locale-file` all narrow untyped
  // JSON with, so its refusals are pinned here rather than three times over.
  test('parseCatalogEntry reports why a value is not a message', () => {
    const why = (raw: unknown): string => {
      const parsed = parseCatalogEntry(raw)
      return isCatalogEntryError(parsed) ? parsed.error : `unexpectedly accepted: ${String(raw)}`
    }
    expect(parseCatalogEntry('text')).toBe('text')
    expect(why(42)).toContain('must be a string')
    expect(why({ one: 'a', other: 'b' })).toContain('discriminator')
    // The case that used to crash `t()`: `selectForm` falls through to `other`,
    // which a table without one does not have, and `interpolate` then calls
    // `matchAll` on `undefined`.
    expect(why({ $plural: 'count', one: 'a' })).toContain('"other" form')
    expect(why({ $plural: 'count', $select: 'x', other: 'a' })).toContain('cannot be both')
    expect(why({ $select: 'kind', deck: { $plural: 'count', other: 'x' } })).toContain(
      'split the key',
    )
  })

  // A structured error, not a bare string: `MessageValue` already includes
  // `string`, so a `MessageValue | string` union could not tell a successfully
  // parsed plain message from an explanation of why parsing failed.
  test('a successfully parsed string is not mistaken for an error', () => {
    expect(isCatalogEntryError(parseCatalogEntry('value must be a string'))).toBe(false)
  })
})

describe('the shipped catalog and its generated pseudo-locale', () => {
  test('English validates clean', () => {
    const report = checkCatalogs({ english: en, meta: enMeta })
    expect(report.issues).toEqual([])
  })

  test('the generated en-XA pseudo-locale validates clean against English', () => {
    const report = checkCatalogs({
      english: en,
      meta: enMeta,
      translations: [
        {
          locale: PSEUDO_LOCALE,
          origin: `locales/${PSEUDO_LOCALE}.json`,
          catalog: pseudoLocalize(en, enMeta),
        },
      ],
    })
    expect(report.issues).toEqual([])
    expect(report.coverage[0]?.percent).toBe(100)
  })

  test('pseudo-localization accents text, pads it, and leaves placeholders alone', () => {
    const rendered = pseudoForm('Added {count} copies of {name}.')
    expect(rendered.startsWith('[')).toBe(true)
    expect(rendered.endsWith(']')).toBe(true)
    expect(rendered).toContain('{count}')
    expect(rendered).toContain('{name}')
    expect(rendered).not.toContain('Added')
    expect(rendered.length).toBeGreaterThan('Added {count} copies of {name}.'.length)
  })

  test('a maxLen budget clamps the padding rather than busting the budget', () => {
    expect(pseudoForm('Save and exit', 24).length).toBeLessThanOrEqual(24)
    // Not even the brackets fit: the accents survive, the decoration does not.
    expect(pseudoForm('Save and exit', 13)).toBe('Şȧṽḗ ȧƞḋ ḗẋīŧ')
  })
})
