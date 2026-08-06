import { afterEach, describe, expect, test } from 'bun:test'
import {
  engageSellMode,
  resetSellMode,
  sellModeActive,
  sellModeEngaging,
  setSellModeActive,
} from '../../src/site/sell-mode'

/**
 * `engageSellMode` defers the flip until after a paint, so these tests drive its
 * two schedulers by hand: `requestAnimationFrame` is not defined under Bun at
 * all, and real timers would make the assertions race the deferral.
 */

type FrameGlobals = {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number
  cancelAnimationFrame?: (handle: number) => void
}

const frameGlobals = globalThis as typeof globalThis & FrameGlobals

type Frames = {
  /** Run the pending frame callback, as the browser would before painting. */
  paint: () => void
  /** How many frames have been requested since the stub was installed. */
  requested: () => number
}

/** Restore for the stub the current test installed; run by the hook below. */
let restoreFrames: (() => void) | null = null

function stubFrames(): Frames {
  let frame: (() => void) | null = null
  let requested = 0
  const previous = frameGlobals.requestAnimationFrame
  const previousCancel = frameGlobals.cancelAnimationFrame
  frameGlobals.requestAnimationFrame = (callback) => {
    frame = () => callback(0)
    requested++
    return requested
  }
  frameGlobals.cancelAnimationFrame = () => {
    frame = null
  }
  // Registered from a module-scoped hook rather than from here: a hook added
  // mid-test would leave each test's restore depending on the runner's ordering.
  restoreFrames = () => {
    frameGlobals.requestAnimationFrame = previous
    frameGlobals.cancelAnimationFrame = previousCancel
  }
  return {
    paint: () => {
      frame?.()
      frame = null
    },
    requested: () => requested,
  }
}

afterEach(() => {
  resetSellMode()
  restoreFrames?.()
  restoreFrames = null
})

/**
 * Let the `setTimeout(…, 0)` the frame callback scheduled run. Ordering is FIFO,
 * so the flip's timer — registered inside `paint()` — always fires before this
 * one; an await that is not a timer would not give it the chance.
 */
const flushTasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('engageSellMode', () => {
  test('marks the toggle engaged before sell mode itself turns on', async () => {
    const frames = stubFrames()

    engageSellMode()
    // The whole point: the button has something to render before the mode flip
    // drags every card's rebuild into the update.
    expect(sellModeEngaging()).toBe(true)
    expect(sellModeActive()).toBe(false)

    frames.paint()
    // A frame callback runs *before* the paint it belongs to, so the flip must
    // still be pending here — this is what the inner timeout buys.
    expect(sellModeActive()).toBe(false)

    await flushTasks()
    expect(sellModeActive()).toBe(true)
    expect(sellModeEngaging()).toBe(false)
  })

  test('does nothing when sell mode is already on', () => {
    const frames = stubFrames()
    setSellModeActive(true)

    engageSellMode()

    expect(frames.requested()).toBe(0)
    expect(sellModeEngaging()).toBe(false)
  })

  test('is idempotent while a flip is pending', async () => {
    const frames = stubFrames()

    engageSellMode()
    engageSellMode()

    // One frame for two calls: a second schedule would outlive the cancel that
    // a later `setSellModeActive(false)` performs, and flip the mode back on.
    expect(frames.requested()).toBe(1)
    frames.paint()
    await flushTasks()
    expect(sellModeActive()).toBe(true)
  })

  test('an explicit set cancels a pending engage', async () => {
    const frames = stubFrames()

    engageSellMode()
    setSellModeActive(false)
    expect(sellModeEngaging()).toBe(false)

    frames.paint()
    await flushTasks()
    expect(sellModeActive()).toBe(false)
  })

  test('a reset cancels a pending engage', async () => {
    const frames = stubFrames()

    engageSellMode()
    resetSellMode()
    frames.paint()
    await flushTasks()

    expect(sellModeActive()).toBe(false)
    expect(sellModeEngaging()).toBe(false)
  })
})
