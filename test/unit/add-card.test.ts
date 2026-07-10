import { describe, test, expect } from 'bun:test'
import { normalizeCardName } from '../../src/commands/add-card'

type NormalizeCase = [label: string, input: string, expected: string]

const cases: NormalizeCase[] = [
  ['strips punctuation', 'Ach! Hans, Run!', 'ach hans run'],
  ['handles apostrophes', "Frodo, Sauron's Bane", 'frodo saurons bane'],
  ['collapses whitespace', 'Sol   Ring', 'sol ring'],
  // The accented û folds to a plain u rather than being dropped, so an
  // accent-free query ("lim dul ...") still matches. This pins the
  // fold-before-punctuation-strip ordering that is normalizeCardName's own contract.
  [
    'strips hyphens and folds diacritics to base letters',
    'Lim-Dûl the Necromancer',
    'limdul the necromancer',
  ],
  ['handles empty string', '', ''],
  ['preserves numbers', '1996 World Champion', '1996 world champion'],
  [
    'handles double-faced card names',
    'Delver of Secrets // Insectile Aberration',
    'delver of secrets insectile aberration',
  ],
]

describe('normalizeCardName', () => {
  test.each(cases)('%s', (_label, input, expected) => {
    expect(normalizeCardName(input)).toBe(expected)
  })
})
