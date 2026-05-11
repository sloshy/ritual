import { describe, test, expect } from 'bun:test'
import { formatOklch, parseColor } from '../../../src/site/oklch-color'

describe('parseColor', () => {
  test('parses a basic oklch() string', () => {
    expect(parseColor('oklch(20% 0.02 260)')).toEqual({ l: 20, c: 0.02, h: 260, a: 1 })
  })

  test('parses oklch with alpha', () => {
    expect(parseColor('oklch(50% 0.1 145 / 0.5)')).toEqual({ l: 50, c: 0.1, h: 145, a: 0.5 })
  })

  test('parses oklch with percentage alpha', () => {
    expect(parseColor('oklch(50% 0.1 145 / 25%)')).toEqual({ l: 50, c: 0.1, h: 145, a: 0.25 })
  })

  test('parses rgba into approximate oklch', () => {
    const result = parseColor('rgba(0, 0, 0, 0.5)')
    expect(result).not.toBeNull()
    expect(result!.l).toBeCloseTo(0, 1)
    expect(result!.a).toBeCloseTo(0.5, 2)
  })

  test('parses hex colors', () => {
    const black = parseColor('#000000')
    expect(black).not.toBeNull()
    expect(black!.l).toBeCloseTo(0, 1)
    const white = parseColor('#fff')
    expect(white).not.toBeNull()
    expect(white!.l).toBeCloseTo(100, 0)
  })

  test('returns null for unrecognized values', () => {
    expect(parseColor('blue')).toBeNull()
    expect(parseColor('9px')).toBeNull()
    expect(parseColor('')).toBeNull()
  })
})

describe('formatOklch', () => {
  test('omits alpha when fully opaque', () => {
    expect(formatOklch({ l: 20, c: 0.02, h: 260, a: 1 })).toBe('oklch(20% 0.02 260)')
  })

  test('includes alpha when partial', () => {
    expect(formatOklch({ l: 50, c: 0.1, h: 145, a: 0.5 })).toBe('oklch(50% 0.1 145 / 0.5)')
  })

  test('wraps hue into 0..360 range', () => {
    expect(formatOklch({ l: 50, c: 0.1, h: 360, a: 1 })).toBe('oklch(50% 0.1 0)')
    expect(formatOklch({ l: 50, c: 0.1, h: -10, a: 1 })).toBe('oklch(50% 0.1 350)')
  })

  test('round-trips parse → format for known oklch values', () => {
    const parsed = parseColor('oklch(45.5% 0.123 30 / 0.75)')
    expect(parsed).not.toBeNull()
    const reformatted = formatOklch(parsed!)
    expect(reformatted).toContain('45.5%')
    expect(reformatted).toContain('0.123')
    expect(reformatted).toContain('30')
    expect(reformatted).toContain('/ 0.75')
  })
})
