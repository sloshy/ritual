import { describe, expect, test } from 'bun:test'
import {
  CARD_LANGUAGES,
  DEFAULT_CARD_LANGUAGE,
  LANGUAGE_TOKEN_PATTERN,
  displayLanguage,
  formatLanguageList,
  invalidLanguageMessage,
  isCardLanguage,
  languageBadge,
  languageDisplayName,
  languageToken,
  malformedLanguageTokenHint,
  normalizeLanguageValue,
  scryfallCardLanguage,
  sortLanguages,
  storedLanguage,
} from '../../src/card/card-language'
import { makeScryfallCard } from '../test-utils'

describe('card language vocabulary', () => {
  test('holds exactly the 17 Scryfall codes', () => {
    expect(CARD_LANGUAGES).toEqual([
      'en',
      'es',
      'fr',
      'de',
      'it',
      'pt',
      'ja',
      'ko',
      'ru',
      'zhs',
      'zht',
      'he',
      'la',
      'grc',
      'ar',
      'sa',
      'ph',
    ])
  })

  test('the default language is en', () => {
    expect(DEFAULT_CARD_LANGUAGE).toBe('en')
  })

  test('isCardLanguage accepts every code and rejects non-codes', () => {
    for (const code of CARD_LANGUAGES) expect(isCardLanguage(code)).toBe(true)
    expect(isCardLanguage('jp')).toBe(false) // alias, not a code
    expect(isCardLanguage('EN')).toBe(false) // codes are lowercase
    expect(isCardLanguage('zh')).toBe(false) // Scryfall splits zhs/zht
    expect(isCardLanguage('')).toBe(false)
  })
})

describe('normalizeLanguageValue', () => {
  test('accepts the codes themselves, case-insensitively', () => {
    expect(normalizeLanguageValue('ja')).toBe('ja')
    expect(normalizeLanguageValue('JA')).toBe('ja')
    expect(normalizeLanguageValue('ZHS')).toBe('zhs')
    expect(normalizeLanguageValue(' en ')).toBe('en')
  })

  test('maps the printed-code aliases', () => {
    expect(normalizeLanguageValue('jp')).toBe('ja')
    expect(normalizeLanguageValue('kr')).toBe('ko')
    expect(normalizeLanguageValue('sp')).toBe('es')
    expect(normalizeLanguageValue('cs')).toBe('zhs')
    expect(normalizeLanguageValue('ct')).toBe('zht')
  })

  test('accepts every Archidekt CSV code', () => {
    const archidekt = ['EN', 'CT', 'DE', 'FR', 'IT', 'JP', 'KR', 'PT', 'RU', 'CS', 'SP']
    expect(archidekt.map(normalizeLanguageValue)).toEqual([
      'en',
      'zht',
      'de',
      'fr',
      'it',
      'ja',
      'ko',
      'pt',
      'ru',
      'zhs',
      'es',
    ])
  })

  test('accepts full English names, case-insensitively', () => {
    expect(normalizeLanguageValue('Japanese')).toBe('ja')
    expect(normalizeLanguageValue('simplified chinese')).toBe('zhs')
    expect(normalizeLanguageValue('Ancient Greek')).toBe('grc')
    expect(normalizeLanguageValue('PHYREXIAN')).toBe('ph')
  })

  test('returns null for values naming no language', () => {
    expect(normalizeLanguageValue('')).toBeNull()
    expect(normalizeLanguageValue('klingon')).toBeNull()
    expect(normalizeLanguageValue('zh')).toBeNull()
  })
})

describe('languageDisplayName', () => {
  test('names every code', () => {
    expect(languageDisplayName('en')).toBe('English')
    expect(languageDisplayName('ja')).toBe('Japanese')
    expect(languageDisplayName('zhs')).toBe('Simplified Chinese')
    expect(languageDisplayName('zht')).toBe('Traditional Chinese')
    expect(languageDisplayName('grc')).toBe('Ancient Greek')
    expect(languageDisplayName('ph')).toBe('Phyrexian')
    for (const code of CARD_LANGUAGES) expect(languageDisplayName(code)).not.toBe('')
  })
})

describe('displayLanguage', () => {
  test('resolves a missing value to en and keeps explicit values', () => {
    expect(displayLanguage(undefined)).toBe('en')
    expect(displayLanguage('en')).toBe('en')
    expect(displayLanguage('ja')).toBe('ja')
  })
})

describe('LANGUAGE_TOKEN_PATTERN', () => {
  test('matches every code exactly, as an anchored alternation', () => {
    const re = new RegExp(`^(?:${LANGUAGE_TOKEN_PATTERN})$`)
    for (const code of CARD_LANGUAGES) expect(re.test(code)).toBe(true)
    expect(re.test('jp')).toBe(false)
    expect(re.test('JA')).toBe(false)
    expect(re.test('foil')).toBe(false)
    expect(re.test('NM')).toBe(false)
    expect(re.test('keep')).toBe(false)
  })
})

describe('languageToken', () => {
  test('writes the leading-space bracket token for a non-English language', () => {
    expect(languageToken('ja')).toBe(' [ja]')
    expect(languageToken('zhs')).toBe(' [zhs]')
  })

  test('writes nothing for en or an absent value (a bare line means English)', () => {
    expect(languageToken('en')).toBe('')
    expect(languageToken(undefined)).toBe('')
  })
})

describe('storedLanguage', () => {
  test('folds en to undefined — the inverse of displayLanguage', () => {
    expect(storedLanguage('en')).toBeUndefined()
    expect(storedLanguage(undefined)).toBeUndefined()
    expect(storedLanguage('ja')).toBe('ja')
    // Round trip: display then store lands back on the stored shape.
    expect(storedLanguage(displayLanguage(undefined))).toBeUndefined()
  })
})

describe('languageBadge', () => {
  test('uppercases a non-English code and is null for en/absent', () => {
    expect(languageBadge('ja')).toBe('JA')
    expect(languageBadge('zht')).toBe('ZHT')
    expect(languageBadge('en')).toBeNull()
    expect(languageBadge(undefined)).toBeNull()
  })
})

describe('sortLanguages', () => {
  test('orders known codes canonically (en first) and unknown codes last, alphabetically', () => {
    expect(sortLanguages(['ja', 'en', 'de'])).toEqual(['en', 'de', 'ja'])
    expect(sortLanguages(new Set(['zz', 'ja', 'aa', 'en']))).toEqual(['en', 'ja', 'aa', 'zz'])
  })
})

describe('formatLanguageList', () => {
  test('renders display names with codes, comma-separated', () => {
    expect(formatLanguageList(['ja', 'ko'])).toBe('Japanese (ja), Korean (ko)')
    expect(formatLanguageList(['en'])).toBe('English (en)')
  })

  test('passes unknown codes through as-is', () => {
    expect(formatLanguageList(['ja', 'xx'])).toBe('Japanese (ja), xx')
  })
})

describe('invalidLanguageMessage', () => {
  test('quotes the offender, splices the hint, and ends with the joined code list', () => {
    const message = invalidLanguageMessage('klingon', 'for --language')
    expect(message).toBe(
      `Invalid language "klingon" for --language. Valid languages: ${CARD_LANGUAGES.join(', ')}`,
    )
  })

  test('shows non-string offenders as data and works without a hint', () => {
    expect(invalidLanguageMessage(7)).toBe(
      `Invalid language 7. Valid languages: ${CARD_LANGUAGES.join(', ')}`,
    )
    expect(invalidLanguageMessage(undefined)).toContain('Invalid language undefined.')
  })
})

describe('malformedLanguageTokenHint', () => {
  test('names the canonical spelling for a recognizable-but-wrong token', () => {
    expect(malformedLanguageTokenHint('- Shock (M21:159) [JA]')).toBe(' (did you mean [ja]?)')
    expect(malformedLanguageTokenHint('1 Shock [jp]')).toBe(' (did you mean [ja]?)')
    expect(malformedLanguageTokenHint('- Shock [Japanese]')).toBe(' (did you mean [ja]?)')
  })

  test('stays silent for canonical tokens, unknown tokens, and token-free lines', () => {
    // A canonical lowercase code means the line failed for some other reason.
    expect(malformedLanguageTokenHint('- Shock (M21:159 [ja]')).toBe('')
    expect(malformedLanguageTokenHint('- Shock [klingon]')).toBe('')
    expect(malformedLanguageTokenHint('- Shock [foil] [NM]')).toBe('')
    expect(malformedLanguageTokenHint('just prose')).toBe('')
  })
})

describe('scryfallCardLanguage', () => {
  test('reads lang, folding absent or unrecognized values to en', () => {
    const en = makeScryfallCard({ id: 'a', name: 'Bolt', set: 'lea', collector_number: '161' })
    const ja = makeScryfallCard({
      id: 'b',
      name: 'Bolt',
      set: 'sta',
      collector_number: '42',
      lang: 'ja',
    })
    const junk = makeScryfallCard({
      id: 'c',
      name: 'Bolt',
      set: 'lea',
      collector_number: '162',
      lang: 'qqq',
    })
    expect(scryfallCardLanguage(en)).toBe('en')
    expect(scryfallCardLanguage(ja)).toBe('ja')
    expect(scryfallCardLanguage(junk)).toBe('en')
  })
})
