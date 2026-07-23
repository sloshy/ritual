import { afterEach, describe, expect, test } from 'bun:test'
import {
  DEFAULT_SEARCH_DEBOUNCE_MS,
  resetSearchDebounceMs,
  searchDebounceMs,
  setSearchDebounceMs,
  type SearchDebounceOverride,
} from '../../src/editor/search-debounce'

const overrideHost = globalThis as unknown as SearchDebounceOverride

describe('searchDebounceMs resolution', () => {
  afterEach(() => {
    delete overrideHost.__ritualSearchDebounceMs__
    resetSearchDebounceMs()
  })

  test('falls back to the built-in default when nothing is set', () => {
    expect(searchDebounceMs()).toBe(DEFAULT_SEARCH_DEBOUNCE_MS)
  })

  test('uses the configured value once applied, including 0', () => {
    setSearchDebounceMs(250)
    expect(searchDebounceMs()).toBe(250)
    setSearchDebounceMs(0)
    expect(searchDebounceMs()).toBe(0)
  })

  test('the global test-seam override beats the configured value', () => {
    // This is what keeps e2e runs deterministic: disableSearchDebounce injects
    // 0 before the app boots, and the config arriving later must not re-arm
    // the timer.
    overrideHost.__ritualSearchDebounceMs__ = 0
    setSearchDebounceMs(250)
    expect(searchDebounceMs()).toBe(0)
  })

  test('a non-finite override is ignored', () => {
    overrideHost.__ritualSearchDebounceMs__ = Number.NaN
    expect(searchDebounceMs()).toBe(DEFAULT_SEARCH_DEBOUNCE_MS)
    setSearchDebounceMs(250)
    expect(searchDebounceMs()).toBe(250)
  })
})
