import { describe, expect, test } from 'bun:test'
import { type HeaderScrollState, nextHeaderScroll } from '../../../src/site/useHideOnScroll'

const HEADER = 60

/** Feed a run of scroll positions through the rule, starting shown at the top. */
function scrollThrough(positions: number[]): HeaderScrollState {
  return positions.reduce<HeaderScrollState>((state, y) => nextHeaderScroll(state, y, HEADER), {
    hidden: false,
    lastY: 0,
  })
}

describe('nextHeaderScroll', () => {
  test('hides after scrolling down past the header, shows again after scrolling up', () => {
    expect(scrollThrough([100]).hidden).toBe(true)
    expect(scrollThrough([100, 300, 250]).hidden).toBe(false)
  })

  test('stays shown while the header would still be in view', () => {
    expect(scrollThrough([20, 40, HEADER]).hidden).toBe(false)
    // Back within the header's height wins even inside the jitter slack.
    expect(scrollThrough([30, 66, 60]).hidden).toBe(false)
  })

  test('ignores jitter smaller than the slack, measured from the last decision', () => {
    // 300 → 305 → 298 never strays 8px from 300, so the hide stands.
    expect(scrollThrough([100, 300, 305, 298]).hidden).toBe(true)
    // Small steps up still add up to a reveal.
    expect(scrollThrough([100, 300, 296, 292, 288]).hidden).toBe(false)
  })
})
