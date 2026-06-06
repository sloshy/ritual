import { describe, it, expect } from 'bun:test'
import type { DeckData } from '../../src/types'
import { deckToExportText } from '../../src/deck-text'

const deck = (sections: DeckData['sections']): DeckData => ({ name: 'Test', sections })

describe('deckToExportText', () => {
  it('renders commander first, then the main section', () => {
    const text = deckToExportText(
      deck([
        { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring' },
            { quantity: 1, name: 'Arcane Signet' },
          ],
        },
      ]),
    )
    expect(text).toBe('## Commander\n1 Atraxa\n\n## Main\n1 Sol Ring\n1 Arcane Signet')
  })

  it('includes other sections when there is no explicit Main, excluding extras', () => {
    const text = deckToExportText(
      deck([
        { name: 'Creatures', cards: [{ quantity: 4, name: 'Llanowar Elves' }] },
        { name: 'Sideboard', cards: [{ quantity: 2, name: 'Naturalize' }] },
        { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Worldspine Wurm' }] },
        { name: 'Tokens', cards: [{ quantity: 1, name: 'Treasure' }] },
      ]),
    )
    expect(text).toContain('## Creatures\n4 Llanowar Elves')
    expect(text).not.toContain('Sideboard')
    expect(text).not.toContain('Maybeboard')
    expect(text).not.toContain('Tokens')
  })

  it('treats Mainboard as the main section', () => {
    const text = deckToExportText(
      deck([{ name: 'Mainboard', cards: [{ quantity: 2, name: 'Forest' }] }]),
    )
    expect(text).toBe('## Mainboard\n2 Forest')
  })
})
