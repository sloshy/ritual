import { describe, expect, test } from 'bun:test'
import {
  IDLE_PRINTING_FLOW,
  advancePrintingFlow,
  confirmPrintingCount,
  openPrintingFlow,
  startBulkPrintingFlow,
  startPrintingFlow,
  type PrintingFlowState,
} from '../../src/editor/change-printing-flow'
import type { CardContextInfo } from '../../src/list-view/card-context'
import { makeContextInfo } from '../test-utils'

const tile = (cardName: string, quantity: number): CardContextInfo =>
  makeContextInfo({ cardName, quantity })

describe('openPrintingFlow', () => {
  test('a multi-copy tile asks for a count first, defaulting to every copy', () => {
    expect(openPrintingFlow(tile('Sol Ring', 3))).toEqual({
      target: tile('Sol Ring', 3),
      step: 'quantity',
      count: 3,
    })
  })

  test('a single copy goes straight to the printing picker', () => {
    expect(openPrintingFlow(tile('Sol Ring', 1))).toMatchObject({ step: 'printing', count: 1 })
  })
})

describe('startPrintingFlow', () => {
  test('opens the menu flow on the target, keeping an in-flight bulk queue', () => {
    const queued = [tile('Counterspell', 1)]
    const state: PrintingFlowState = { flow: openPrintingFlow(tile('Sol Ring', 1)), queue: queued }
    expect(startPrintingFlow(state, tile('Fog', 2))).toEqual({
      flow: { target: tile('Fog', 2), step: 'quantity', count: 2 },
      queue: queued,
    })
  })
})

describe('startBulkPrintingFlow', () => {
  test('opens the first target and queues the rest, replacing any earlier queue', () => {
    const state: PrintingFlowState = { flow: null, queue: [tile('Stale', 1)] }
    expect(startBulkPrintingFlow(state, [tile('Sol Ring', 1), tile('Fog', 1)])).toEqual({
      flow: { target: tile('Sol Ring', 1), step: 'printing', count: 1 },
      queue: [tile('Fog', 1)],
    })
  })

  test('no targets leaves the state alone', () => {
    expect(startBulkPrintingFlow(IDLE_PRINTING_FLOW, [])).toBe(IDLE_PRINTING_FLOW)
  })
})

describe('confirmPrintingCount', () => {
  test('moves the quantity prompt on to the picker with the chosen count', () => {
    const state: PrintingFlowState = { flow: openPrintingFlow(tile('Sol Ring', 3)), queue: [] }
    expect(confirmPrintingCount(state, 2)).toEqual({
      flow: { target: tile('Sol Ring', 3), step: 'printing', count: 2 },
      queue: [],
    })
  })

  test('is a no-op with no flow open', () => {
    expect(confirmPrintingCount(IDLE_PRINTING_FLOW, 2)).toBe(IDLE_PRINTING_FLOW)
  })
})

describe('advancePrintingFlow', () => {
  test('walks a bulk run: open → confirm count → advance through a 2-item queue → done', () => {
    const [first, second] = [tile('Sol Ring', 2), tile('Counterspell', 3)]
    let state = startBulkPrintingFlow(IDLE_PRINTING_FLOW, [first, second])
    expect(state.flow).toMatchObject({ step: 'quantity', count: 2 })

    state = confirmPrintingCount(state, 1)
    expect(state.flow).toMatchObject({ target: first, step: 'printing', count: 1 })

    // A queued multi-copy card re-enters at the quantity prompt like any other.
    state = advancePrintingFlow(state)
    expect(state).toEqual({
      flow: { target: second, step: 'quantity', count: 3 },
      queue: [],
    })

    state = advancePrintingFlow(state)
    expect(state).toBe(IDLE_PRINTING_FLOW)
  })

  test('with an empty queue it only closes the flow', () => {
    const state: PrintingFlowState = { flow: openPrintingFlow(tile('Sol Ring', 1)), queue: [] }
    expect(advancePrintingFlow(state)).toBe(IDLE_PRINTING_FLOW)
  })

  test('already idle, it returns the same state', () => {
    expect(advancePrintingFlow(IDLE_PRINTING_FLOW)).toBe(IDLE_PRINTING_FLOW)
  })
})
