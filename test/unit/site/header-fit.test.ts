import { describe, expect, test } from 'bun:test'
import {
  decideHeaderFold,
  HEADER_FOLDS,
  requiredHeaderWidth,
  UNFOLD_SLACK,
  type HeaderFitWidths,
} from '../../../src/site/header-fit'

/**
 * The public homepage's header as measured in Chromium at English: logo + nav
 * 432px, the quick switch 175px (30px as an icon), Prices 155, Edit 78, Theme
 * 98 (a single-locale site, so no language picker), a 16px gap, the ⚙ toggle
 * 32px, in the 1216px row of a 1280px window.
 */
function widths(overrides: Partial<HeaderFitWidths> = {}): HeaderFitWidths {
  return {
    available: 1216,
    gap: 16,
    left: 432,
    quickSwitchFull: 175,
    quickSwitchIcon: 30,
    utilities: [155, 78, 98],
    extras: [],
    toggle: 32,
    ...overrides,
  }
}

describe('requiredHeaderWidth', () => {
  test('full: the centered quick switch doubles the wider side', () => {
    // Left (432) is wider than the right (155+78+98 + 2 gaps = 363).
    expect(requiredHeaderWidth('full', widths())).toBe(2 * 432 + 175 + 2 * 16)
    // A selection button makes the right side (505) the wider one.
    expect(requiredHeaderWidth('full', widths({ extras: [126] }))).toBe(2 * 505 + 175 + 2 * 16)
  })

  test('folded and icon lay the row out in flow', () => {
    const w = widths({ extras: [126] })
    expect(requiredHeaderWidth('folded', w)).toBe(432 + 16 + 175 + 16 + (126 + 16 + 32))
    expect(requiredHeaderWidth('icon', w)).toBe(432 + 16 + 30 + 16 + (126 + 16 + 32))
  })

  test('folded levels leave the utilities out', () => {
    expect(requiredHeaderWidth('folded', widths({ utilities: [999] }))).toBe(
      requiredHeaderWidth('folded', widths()),
    )
  })

  test('the measured homepage needs 1071px unfolded, 813 folded and 668 as an icon', () => {
    expect(requiredHeaderWidth('full', widths())).toBe(1071)
    expect(requiredHeaderWidth('folded', widths({ extras: [126] }))).toBe(813)
    expect(requiredHeaderWidth('icon', widths({ extras: [126] }))).toBe(668)
  })

  test('the folded row counts no gap for an absent extra or toggle', () => {
    expect(requiredHeaderWidth('folded', widths({ extras: [0], toggle: 0 }))).toBe(
      432 + 16 + 175 + 16,
    )
  })

  test('an unfolded row with nothing on the right still centers the quick switch', () => {
    expect(requiredHeaderWidth('full', widths({ utilities: [], extras: [] }))).toBe(
      2 * 432 + 175 + 2 * 16,
    )
  })

  test('zero-width items take no gap', () => {
    expect(requiredHeaderWidth('full', widths({ left: 100, utilities: [155, 0, 98] }))).toBe(
      2 * (155 + 98 + 16) + 175 + 2 * 16,
    )
  })
})

describe('decideHeaderFold', () => {
  test('picks the least folded level that fits', () => {
    expect(decideHeaderFold(widths(), 'full')).toBe('full')
    expect(decideHeaderFold(widths({ extras: [126] }), 'full')).toBe('folded')
    expect(decideHeaderFold(widths({ available: 704, extras: [126] }), 'full')).toBe('icon')
  })

  test('folds from folded to icon with no slack', () => {
    const folded = requiredHeaderWidth('folded', widths())
    expect(decideHeaderFold(widths({ available: folded - 1 }), 'folded')).toBe('icon')
  })

  test('from the icon, unfolds only as far as the slack allows', () => {
    const full = requiredHeaderWidth('full', widths())
    expect(decideHeaderFold(widths({ available: full }), 'icon')).toBe('folded')
  })

  test('falls back to the most folded level when nothing fits', () => {
    expect(decideHeaderFold(widths({ available: 300 }), 'full')).toBe('icon')
  })

  test('folds as soon as a level stops fitting, with no slack', () => {
    const full = requiredHeaderWidth('full', widths())
    expect(decideHeaderFold(widths({ available: full }), 'full')).toBe('full')
    expect(decideHeaderFold(widths({ available: full - 1 }), 'full')).toBe('folded')
  })

  test('unfolds only with UNFOLD_SLACK to spare, so a boundary width never flaps', () => {
    const full = requiredHeaderWidth('full', widths())
    expect(decideHeaderFold(widths({ available: full }), 'folded')).toBe('folded')
    expect(decideHeaderFold(widths({ available: full + UNFOLD_SLACK - 1 }), 'folded')).toBe(
      'folded',
    )
    expect(decideHeaderFold(widths({ available: full + UNFOLD_SLACK }), 'folded')).toBe('full')

    // Straight from the icon to the full row when there is room for it.
    expect(decideHeaderFold(widths({ available: full + UNFOLD_SLACK }), 'icon')).toBe('full')

    const folded = requiredHeaderWidth('folded', widths())
    // Staying at a level never asks for the slack.
    expect(decideHeaderFold(widths({ available: folded }), 'folded')).toBe('folded')
    expect(decideHeaderFold(widths({ available: folded + UNFOLD_SLACK - 1 }), 'icon')).toBe('icon')
    expect(decideHeaderFold(widths({ available: folded + UNFOLD_SLACK }), 'icon')).toBe('folded')
  })
})

describe('decideHeaderFold stability', () => {
  const scenarios: HeaderFitWidths[] = [
    widths(),
    widths({ extras: [126] }),
    widths({ utilities: [155, 259, 78, 98] }),
  ]

  test('a decision is a fixed point: deciding again from it changes nothing', () => {
    for (const scenario of scenarios) {
      for (let available = 500; available <= 1700; available += 7) {
        const w = { ...scenario, available }
        for (const current of HEADER_FOLDS) {
          const decided = decideHeaderFold(w, current)
          expect(decideHeaderFold(w, decided)).toBe(decided)
        }
      }
    }
  })

  test('losing up to a scrollbar’s width of room never unfolds', () => {
    for (const scenario of scenarios) {
      for (let available = 500; available <= 1700; available += 7) {
        const decided = decideHeaderFold({ ...scenario, available }, 'full')
        for (let k = 1; k <= 17; k++) {
          const shrunk = decideHeaderFold({ ...scenario, available: available - k }, decided)
          expect(HEADER_FOLDS.indexOf(shrunk)).toBeGreaterThanOrEqual(HEADER_FOLDS.indexOf(decided))
        }
      }
    }
  })
})
