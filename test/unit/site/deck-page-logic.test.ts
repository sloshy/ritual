import { describe, test, expect } from 'bun:test'
import { deckPrimerHash, partitionDeckCards } from '../../../src/site/deck-page-logic'

type TestCard = { name: string; section: string }
const card = (name: string, section: string): TestCard => ({ name, section })

describe('partitionDeckCards', () => {
  test('splits by section into the four display buckets', () => {
    const result = partitionDeckCards([
      card('Atraxa', 'Commander'),
      card('Sol Ring', 'Main'),
      card('Duress', 'Sideboard'),
      card('Treasure', 'Tokens'),
      card('Mox', 'Maybeboard'),
    ])
    expect(result.commanderCards.map((c) => c.name)).toEqual(['Atraxa'])
    expect(result.sideboardCards.map((c) => c.name)).toEqual(['Duress'])
    expect(result.extraCards.map((c) => c.name)).toEqual(['Treasure', 'Mox'])
    expect(result.mainboardCards.map((c) => c.name)).toEqual(['Sol Ring'])
  })

  test('section matching is substring and case-insensitive', () => {
    const result = partitionDeckCards([
      card('a', 'my COMMANDER zone'),
      card('b', 'Extra Sideboard'),
      card('c', 'TOKEN pile'),
    ])
    expect(result.commanderCards.map((c) => c.name)).toEqual(['a'])
    expect(result.sideboardCards.map((c) => c.name)).toEqual(['b'])
    expect(result.extraCards.map((c) => c.name)).toEqual(['c'])
  })

  test('commander wins over sideboard when a section name matches both', () => {
    const result = partitionDeckCards([card('a', 'Commander Sideboard')])
    expect(result.commanderCards.map((c) => c.name)).toEqual(['a'])
    expect(result.sideboardCards).toEqual([])
  })

  // The other half of the precedence chain. A "Sideboard Tokens" pile is
  // sideboard, and the difference is money: the sideboard counts toward the
  // deck's total, extras do not.
  test('sideboard wins over extras when a section name matches both', () => {
    const result = partitionDeckCards([card('a', 'Sideboard Tokens')])
    expect(result.sideboardCards.map((c) => c.name)).toEqual(['a'])
    expect(result.extraCards).toEqual([])
  })

  // Exhaustive and disjoint: every card lands in exactly one bucket, so nothing
  // can be counted twice or quietly dropped out of the deck's price.
  test('the four buckets partition the input exactly', () => {
    const cards = [
      card('a', 'Commander'),
      card('b', 'Main'),
      card('c', 'Sideboard'),
      card('d', 'Tokens'),
      card('e', 'Maybeboard'),
      card('f', 'Commander Sideboard'),
      card('g', 'Oathbreaker'),
    ]
    const result = partitionDeckCards(cards)
    const bucketed = [
      ...result.commanderCards,
      ...result.sideboardCards,
      ...result.extraCards,
      ...result.mainboardCards,
    ]
    expect(bucketed).toHaveLength(cards.length)
    expect(new Set(bucketed).size).toBe(cards.length)
  })

  test('an empty deck partitions into four empty buckets', () => {
    expect(partitionDeckCards([])).toEqual({
      commanderCards: [],
      sideboardCards: [],
      extraCards: [],
      mainboardCards: [],
    })
  })

  test('an oathbreaker section is mainboard here — the page has no oathbreaker branch', () => {
    const result = partitionDeckCards([
      card('Teferi', 'Oathbreaker'),
      card('Time Warp', 'Signature Spell'),
    ])
    expect(result.mainboardCards.map((c) => c.name)).toEqual(['Teferi', 'Time Warp'])
    expect(result.commanderCards).toEqual([])
  })

  test('preserves input order within each bucket', () => {
    const result = partitionDeckCards([card('a', 'Main'), card('b', 'Main'), card('c', 'Main')])
    expect(result.mainboardCards.map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })
})

describe('deckPrimerHash', () => {
  test('appends /primer when opening and drops it when closing', () => {
    expect(deckPrimerHash('my-deck', true, '#/deck/my-deck')).toBe('#/deck/my-deck/primer')
    expect(deckPrimerHash('my-deck', false, '#/deck/my-deck/primer')).toBe('#/deck/my-deck')
  })

  test('preserves the shareable list-view query string across the toggle', () => {
    expect(deckPrimerHash('my-deck', true, '#/deck/my-deck?group=type&view=list')).toBe(
      '#/deck/my-deck/primer?group=type&view=list',
    )
  })

  test('a hash with no query string yields no trailing question mark', () => {
    expect(deckPrimerHash('my-deck', false, '')).toBe('#/deck/my-deck')
  })

  // The closing direction matters as much as the opening one: the toolbar state
  // a shared link carries must survive collapsing the primer, not just expanding it.
  test('preserves the query string when closing the primer too', () => {
    expect(deckPrimerHash('my-deck', false, '#/deck/my-deck/primer?group=type&view=list')).toBe(
      '#/deck/my-deck?group=type&view=list',
    )
  })
})
