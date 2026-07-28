import { describe, test, expect } from 'bun:test'
import { defaultPrintingFinish, printingFinishes } from '../../src/finish-condition'
import { makeScryfallCard } from '../test-utils'

describe('printingFinishes', () => {
  test('returns the valid finishes of a printing', () => {
    expect(printingFinishes(makeScryfallCard({ finishes: ['nonfoil', 'foil'] }))).toEqual([
      'nonfoil',
      'foil',
    ])
  })

  test('filters out unknown finish strings', () => {
    expect(printingFinishes(makeScryfallCard({ finishes: ['nonfoil', 'glossy'] }))).toEqual([
      'nonfoil',
    ])
  })

  test('falls back to nonfoil when no usable finish data exists', () => {
    expect(printingFinishes(makeScryfallCard({ finishes: [] }))).toEqual(['nonfoil'])
  })
})

describe('defaultPrintingFinish', () => {
  test('prefers nonfoil wherever it appears in the list', () => {
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: ['nonfoil', 'foil'] }))).toBe(
      'nonfoil',
    )
    // Order-independence is the whole point of the rule: taking the first finish
    // would answer 'foil' here.
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: ['foil', 'nonfoil'] }))).toBe(
      'nonfoil',
    )
  })

  test('falls back to the first finish for foil-only and etched-only printings', () => {
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: ['foil'] }))).toBe('foil')
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: ['etched', 'foil'] }))).toBe('etched')
  })

  test('falls back to nonfoil when the printing lists no usable finishes', () => {
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: [] }))).toBe('nonfoil')
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: ['glossy'] }))).toBe('nonfoil')
  })
})
