import { describe, expect, test } from 'bun:test'
import { clampQuantity, stepQuantity } from '../../src/ui/quantity'

describe('clampQuantity', () => {
  test('clamps into min..max and rounds fractional input', () => {
    expect(clampQuantity(0)).toBe(1)
    expect(clampQuantity(7, 1, 4)).toBe(4)
    expect(clampQuantity(2.6)).toBe(3)
  })

  test('non-finite input resolves to min rather than propagating', () => {
    // An emptied number field yields NaN; a bad caller can pass Infinity.
    expect(clampQuantity(NaN)).toBe(1)
    expect(clampQuantity(Infinity, 2, 9)).toBe(9)
    expect(clampQuantity(-Infinity, 2)).toBe(2)
  })
})

describe('stepQuantity', () => {
  test('steps by delta and stops at both bounds', () => {
    expect(stepQuantity(1, 1)).toBe(2)
    expect(stepQuantity(1, -1)).toBe(1)
    expect(stepQuantity(3, 1, 1, 3)).toBe(3)
  })
})
