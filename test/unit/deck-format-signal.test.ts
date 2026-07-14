import { describe, expect, test } from 'bun:test'
import {
  DECK_FORMAT_KEYS,
  deckFormatKeysForSignal,
  detectDeckFormatSignal,
  formatHasCommandZone,
} from '../../src/deck-format'
import type { Card, DeckData, DeckSection } from '../../src/types'

function island(quantity: number): Card {
  return { quantity, name: 'Island' }
}

function deck(sections: DeckSection[]): DeckData {
  return { name: 'Test', sections }
}

/** The formats whose decks have a command zone, spelled out as the expected oracle. */
const COMMAND_ZONE_KEYS = [
  'commander',
  'oathbreaker',
  'brawl',
  'historic-brawl',
  'duel-commander',
  'pauper-commander',
  'pre-dh',
] as const

describe('formatHasCommandZone', () => {
  test('flags exactly the command-zone formats', () => {
    expect(DECK_FORMAT_KEYS.filter(formatHasCommandZone)).toEqual([...COMMAND_ZONE_KEYS])
  })
})

describe('detectDeckFormatSignal', () => {
  test('a commander section wins regardless of size', () => {
    const signal = detectDeckFormatSignal(
      deck([
        { name: 'Commander', cards: [island(1)] },
        { name: 'Main', cards: [island(99)] },
      ]),
    )
    expect(signal).toEqual({ kind: 'command-zone', mainDeckSize: 100 })
    // ...including a deck too small for any size-based signal.
    const tiny = detectDeckFormatSignal(
      deck([
        { name: 'Commander', cards: [island(1)] },
        { name: 'Main', cards: [island(1)] },
      ]),
    )
    expect(tiny.kind).toBe('command-zone')
  })

  test('a signature spell section also counts as a command zone', () => {
    const signal = detectDeckFormatSignal(
      deck([
        { name: 'Signature Spell', cards: [island(1)] },
        { name: 'Main', cards: [island(59)] },
      ]),
    )
    expect(signal.kind).toBe('command-zone')
  })

  test('60+ cards with no command zone reads as 60-card constructed', () => {
    const signal = detectDeckFormatSignal(deck([{ name: 'Main', cards: [island(60)] }]))
    expect(signal).toEqual({ kind: 'constructed-60', mainDeckSize: 60 })
  })

  test('40–59 cards with no command zone reads as limited', () => {
    expect(detectDeckFormatSignal(deck([{ name: 'Main', cards: [island(40)] }])).kind).toBe(
      'limited',
    )
    expect(detectDeckFormatSignal(deck([{ name: 'Main', cards: [island(59)] }])).kind).toBe(
      'limited',
    )
  })

  test('sideboard cards do not count toward the size', () => {
    const signal = detectDeckFormatSignal(
      deck([
        { name: 'Main', cards: [island(40)] },
        { name: 'Sideboard', cards: [island(25)] },
      ]),
    )
    expect(signal).toEqual({ kind: 'limited', mainDeckSize: 40 })
  })

  test('fewer than 40 cards gives no signal', () => {
    expect(detectDeckFormatSignal(deck([{ name: 'Main', cards: [island(39)] }])).kind).toBe('none')
  })
})

describe('deckFormatKeysForSignal', () => {
  test('always offers every format exactly once', () => {
    for (const kind of ['command-zone', 'constructed-60', 'limited', 'none'] as const) {
      expect([...deckFormatKeysForSignal(kind)].sort()).toEqual([...DECK_FORMAT_KEYS].sort())
    }
  })

  test('command-zone puts every command-zone format first', () => {
    const keys = deckFormatKeysForSignal('command-zone')
    expect(keys.slice(0, COMMAND_ZONE_KEYS.length)).toEqual([...COMMAND_ZONE_KEYS])
  })

  test('constructed-60 puts commander-less constructed formats first, limited last', () => {
    const keys = deckFormatKeysForSignal('constructed-60')
    expect(keys[0]).toBe('standard')
    expect(keys.indexOf('standard')).toBeLessThan(keys.indexOf('commander'))
    expect(keys.indexOf('modern')).toBeLessThan(keys.indexOf('limited'))
  })

  test('limited puts Limited first', () => {
    expect(deckFormatKeysForSignal('limited')[0]).toBe('limited')
  })

  test('none keeps declaration order', () => {
    expect(deckFormatKeysForSignal('none')).toEqual([...DECK_FORMAT_KEYS])
  })
})
