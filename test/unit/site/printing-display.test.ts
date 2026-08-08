import { describe, expect, test } from 'bun:test'
import { finishChipName, finishName, rarityName } from '../../../src/site/printing-display'
import { t } from '../../../src/i18n/t'
import type { Finish } from '../../../src/types'

// These replaced `capitalize(token)` on the site's card surfaces, which left the
// visible text with no string a translator could reach. What matters here is
// that every token in the vocabulary resolves to a real message (a missing key
// would render the key itself) and that an unknown token still degrades to the
// old behaviour rather than leaking a key into the UI.

describe('finishName', () => {
  const cases: [Finish, string][] = [
    ['nonfoil', 'Nonfoil'],
    ['foil', 'Foil'],
    ['etched', 'Etched'],
  ]

  for (const [finish, expected] of cases) {
    test(`${finish} renders as ${expected}`, () => {
      expect(finishName(t, finish)).toBe(expected)
    })
  }

  test('an unknown token falls back to its capitalized self, never a message key', () => {
    expect(finishName(t, 'glossy')).toBe('Glossy')
  })
})

describe('finishChipName', () => {
  test('renders the lower-case chip form used by the trade printing picker', () => {
    expect(finishChipName(t, 'foil')).toBe('foil')
    expect(finishChipName(t, 'etched')).toBe('etched')
    expect(finishChipName(t, 'nonfoil')).toBe('nonfoil')
  })
})

describe('rarityName', () => {
  const cases: [string, string][] = [
    ['common', 'Common'],
    ['uncommon', 'Uncommon'],
    ['rare', 'Rare'],
    ['mythic', 'Mythic'],
    ['special', 'Special'],
    ['bonus', 'Bonus'],
  ]

  for (const [rarity, expected] of cases) {
    test(`${rarity} renders as ${expected}`, () => {
      expect(rarityName(t, rarity)).toBe(expected)
    })
  }

  // `ScryfallCard.rarity` is a bare string: the cache is data we do not control.
  test('an unrecognized rarity degrades to the raw token, capitalized', () => {
    expect(rarityName(t, 'timeshifted')).toBe('Timeshifted')
  })
})
