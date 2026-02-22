import { describe, expect, test } from 'bun:test'
import {
  cadenceToMs,
  getInitialPriceRefreshAt,
  isOlderThan,
  parseRefreshCadence,
  runStaggeredTasksInCompletionOrder,
  shouldForcePriceRefresh,
} from '../../../src/commands/cache-server'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const MONTH_MS = 30 * DAY_MS
const STAGGER_MS = 200

describe('cache-server staleness checks', () => {
  test('treats missing timestamp as stale', () => {
    expect(isOlderThan(null, 1000, 5000)).toBeTrue()
  })

  test('treats old timestamp as stale', () => {
    expect(isOlderThan(1000, 2000, 5001)).toBeTrue()
  })

  test('treats recent timestamp as fresh', () => {
    expect(isOlderThan(3000, 3000, 5000)).toBeFalse()
  })

  test('parses supported refresh cadence values', () => {
    expect(parseRefreshCadence('daily')).toBe('daily')
    expect(parseRefreshCadence('weekly')).toBe('weekly')
    expect(parseRefreshCadence('monthly')).toBe('monthly')
  })

  test('maps cadence to expected milliseconds', () => {
    expect(cadenceToMs('daily')).toBe(DAY_MS)
    expect(cadenceToMs('weekly')).toBe(WEEK_MS)
    expect(cadenceToMs('monthly')).toBe(MONTH_MS)
  })

  test('forces weekly/monthly price refresh after one day before scheduled run', () => {
    const now = 20 * DAY_MS
    const lastUpdatedAt = now - 2 * DAY_MS
    const scheduledAt = now + 3 * DAY_MS
    expect(shouldForcePriceRefresh(WEEK_MS, lastUpdatedAt, scheduledAt, now)).toBeTrue()
  })

  test('does not force daily price refresh before scheduled run', () => {
    const now = 20 * DAY_MS
    const twoDays = 2 * DAY_MS
    const tenMinutes = 10 * 60 * 1000
    const lastUpdatedAt = now - twoDays
    const scheduledAt = now + tenMinutes
    expect(shouldForcePriceRefresh(DAY_MS, lastUpdatedAt, scheduledAt, now)).toBeFalse()
  })

  test('stages startup refreshes for stale daily prices by 200ms', () => {
    const now = 10 * DAY_MS
    const twoDays = 2 * DAY_MS
    const staleTimestamp = now - twoDays
    expect(getInitialPriceRefreshAt(DAY_MS, staleTimestamp, now, 0)).toBe(now)
    expect(getInitialPriceRefreshAt(DAY_MS, staleTimestamp, now, 1)).toBe(now + STAGGER_MS)
    expect(getInitialPriceRefreshAt(DAY_MS, staleTimestamp, now, 2)).toBe(now + 2 * STAGGER_MS)
  })

  test('stages startup refreshes for stale weekly and monthly prices by 200ms', () => {
    const now = 20 * DAY_MS
    const staleWeeklyTimestamp = now - 10 * DAY_MS
    const staleMonthlyTimestamp = now - 35 * DAY_MS
    expect(getInitialPriceRefreshAt(WEEK_MS, staleWeeklyTimestamp, now, 0)).toBe(now)
    expect(getInitialPriceRefreshAt(MONTH_MS, staleMonthlyTimestamp, now, 1)).toBe(now + STAGGER_MS)
  })

  test('keeps normal cadence timing for fresh daily/weekly/monthly prices', () => {
    const now = 40 * DAY_MS
    const freshDailyTimestamp = now - 60 * 60 * 1000
    const freshWeeklyTimestamp = now - 2 * DAY_MS
    const freshMonthlyTimestamp = now - 10 * DAY_MS
    expect(getInitialPriceRefreshAt(DAY_MS, freshDailyTimestamp, now, 0)).toBe(
      freshDailyTimestamp + DAY_MS,
    )
    expect(getInitialPriceRefreshAt(WEEK_MS, freshWeeklyTimestamp, now, 0)).toBe(
      freshWeeklyTimestamp + WEEK_MS,
    )
    expect(getInitialPriceRefreshAt(MONTH_MS, freshMonthlyTimestamp, now, 0)).toBe(
      freshMonthlyTimestamp + MONTH_MS,
    )
  })

  test('runs staggered refresh tasks and emits completion order', async () => {
    const order: string[] = []
    await runStaggeredTasksInCompletionOrder(
      [
        async () => {
          await Bun.sleep(80)
          return 'first'
        },
        async () => {
          await Bun.sleep(10)
          return 'second'
        },
        async () => {
          await Bun.sleep(10)
          return 'third'
        },
      ],
      20,
      async (result) => {
        order.push(result)
      },
      async () => {},
    )

    expect(order).toEqual(['second', 'third', 'first'])
  })
})
