import { describe, test, expect } from 'bun:test'
import {
  bulkAllowed,
  decideBulkRefresh,
  headlessPolicy,
  refreshStaleAllowed,
  type BulkRefreshPrompt,
  type RefreshMode,
  type RefreshPolicy,
} from '../../src/cache/refresh'

describe('bulkAllowed', () => {
  test('permits bulk only for ask and auto', () => {
    expect(bulkAllowed('ask')).toBe(true)
    expect(bulkAllowed('auto')).toBe(true)
    expect(bulkAllowed('no-bulk')).toBe(false)
    expect(bulkAllowed('never')).toBe(false)
  })
})

describe('refreshStaleAllowed', () => {
  test('refreshes stale prices for every mode except never', () => {
    expect(refreshStaleAllowed('ask')).toBe(true)
    expect(refreshStaleAllowed('auto')).toBe(true)
    expect(refreshStaleAllowed('no-bulk')).toBe(true)
    expect(refreshStaleAllowed('never')).toBe(false)
  })
})

describe('decideBulkRefresh', () => {
  const prompt: BulkRefreshPrompt = { message: 'go?', initial: true }

  /** A policy whose confirm records how often it was asked. */
  type RecordedPolicy = { asked: number; policy: RefreshPolicy }

  /** A policy whose confirm records whether it was asked and answers `answer`. */
  function recording(mode: RefreshMode, answer: boolean): RecordedPolicy {
    const state: RecordedPolicy = {
      asked: 0,
      policy: { mode, confirm: async () => (state.asked++, answer) },
    }
    return state
  }

  test('auto accepts without asking', async () => {
    const r = recording('auto', false)
    expect(await decideBulkRefresh(r.policy, prompt)).toBe(true)
    expect(r.asked).toBe(0)
  })

  test.each(['no-bulk', 'never'] as const)('%s declines without asking', async (mode) => {
    const r = recording(mode, true)
    expect(await decideBulkRefresh(r.policy, prompt)).toBe(false)
    expect(r.asked).toBe(0)
  })

  test.each([true, false])('ask follows the policy confirm (%p)', async (answer) => {
    const r = recording('ask', answer)
    expect(await decideBulkRefresh(r.policy, prompt)).toBe(answer)
    expect(r.asked).toBe(1)
  })

  test('a headless policy declines every ask', async () => {
    expect(await decideBulkRefresh(headlessPolicy('ask'), prompt)).toBe(false)
  })

  test('a headless auto policy still accepts: nobody is asked', async () => {
    expect(await decideBulkRefresh(headlessPolicy('auto'), prompt)).toBe(true)
  })
})
