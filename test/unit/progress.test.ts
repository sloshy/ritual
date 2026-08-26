import { describe, expect, test } from 'bun:test'
import { itemStartProgress, itemsDoneProgress } from '../../src/util/progress'

describe('itemStartProgress', () => {
  test('counts finished items in progress and 1-based positions in the message', () => {
    expect(itemStartProgress('Syncing Atraxa', 0, 3)).toEqual({
      progress: 0,
      total: 3,
      message: 'Syncing Atraxa (1/3)',
    })
    expect(itemStartProgress('Syncing Atraxa', 2, 3)).toEqual({
      progress: 2,
      total: 3,
      message: 'Syncing Atraxa (3/3)',
    })
  })

  test('never reports the scale as already complete on the last item start', () => {
    const last = itemStartProgress('Syncing', 4, 5)
    expect(last.progress).toBeLessThan(last.total!)
  })
})

describe('itemsDoneProgress', () => {
  test('completes the scale, carrying the run’s summary as its message', () => {
    expect(itemsDoneProgress(3, 'Pulled 3 decks.')).toEqual({
      progress: 3,
      total: 3,
      message: 'Pulled 3 decks.',
    })
  })

  test('a run that started nothing reports an honest empty scale', () => {
    // Both syncs report `0` when no `item-start` ever arrived, which is what a
    // run with nothing to sync looks like. `0/0` is complete, not stuck.
    expect(itemsDoneProgress(0, 'No Archidekt decks found to sync.')).toEqual({
      progress: 0,
      total: 0,
      message: 'No Archidekt decks found to sync.',
    })
  })

  test('pairs with itemStartProgress: the terminal report closes the same scale', () => {
    // The pairing is the contract, and the reason `itemsDoneProgress` takes the
    // engine's total rather than a count from the finished report: the two must
    // share a denominator, or the bar's scale moves under frames already sent.
    const total = 4
    const starts = Array.from({ length: total }, (_, i) => itemStartProgress('Syncing', i, total))
    const done = itemsDoneProgress(total, 'Pulled 4 decks.')

    const reports = [...starts, done]
    expect(reports.every((r) => r.total === total)).toBeTrue()
    // Strictly increasing all the way through, ending exactly on the endpoint.
    for (let i = 1; i < reports.length; i++) {
      expect(reports[i]!.progress).toBeGreaterThan(reports[i - 1]!.progress)
    }
    expect(done.progress).toBe(total)
    expect(starts.at(-1)!.progress).toBe(total - 1)
  })
})
