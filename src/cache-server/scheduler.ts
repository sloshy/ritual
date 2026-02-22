import { type FileCacheManager } from '../cache'
import { type PriceData } from '../types'
import { CACHE_SERVER_LOG_PREFIX, PRICE_REFRESH_STAGGER_MS } from './constants'
import { getInitialPriceRefreshAt } from './helpers'
import {
  type PriceRefreshBucket,
  type PriceRefreshReason,
  type PriceRefreshSchedule,
} from './types'

/**
 * Coordinates recurring price refreshes by grouping keys into time buckets.
 * This reduces timer overhead, centralizes rescheduling/cleanup, and deduplicates concurrent refreshes.
 */
export class PriceRefreshScheduler {
  /** Groups keys by cadence bucket so timers can be shared. */
  private buckets: Map<string, PriceRefreshBucket> = new Map()
  /** Stores the next scheduled refresh metadata for each key. */
  private keySchedules: Map<string, PriceRefreshSchedule> = new Map()
  /** Deduplicates concurrent refreshes per key. */
  private refreshInFlight: Map<string, Promise<PriceData | null>> = new Map()

  constructor(
    /** Refresh interval in milliseconds for each key. */
    private intervalMs: number,
    /** Cache manager used to read key timestamps. */
    private cache: FileCacheManager<'prices'>,
    /** Refresh function invoked for scheduled/manual refreshes. */
    private refreshKey: (key: string, reason: PriceRefreshReason) => Promise<PriceData | null>,
  ) {}

  /** Returns the configured refresh interval in milliseconds. */
  getIntervalMs(): number {
    return this.intervalMs
  }

  /** Returns the next scheduled refresh timestamp for a key. */
  getScheduledRefreshAt(key: string): number | null {
    return this.keySchedules.get(key)?.refreshAt ?? null
  }

  /** Seeds schedules for all cached keys using their cache timestamps. */
  async initializeFromCache(): Promise<void> {
    const keys = await this.cache.keys()
    const now = Date.now()
    let staleQueueIndex = 0
    for (const key of keys) {
      const timestamp = await this.cache.getTimestamp(key)
      if (timestamp === null) {
        this.unscheduleKey(key)
        continue
      }

      const isStaleForCadence = now - timestamp > this.intervalMs
      const refreshAt = getInitialPriceRefreshAt(this.intervalMs, timestamp, now, staleQueueIndex)
      if (isStaleForCadence) {
        staleQueueIndex++
      }
      this.scheduleAt(key, refreshAt)
    }
  }

  /** Schedules a key from cache data only if it is not already scheduled. */
  async ensureScheduledFromTimestamp(key: string): Promise<void> {
    if (this.keySchedules.has(key)) return
    await this.scheduleFromTimestamp(key)
  }

  /** Schedules a key based on its cached timestamp plus interval. */
  async scheduleFromTimestamp(key: string): Promise<void> {
    const timestamp = await this.cache.getTimestamp(key)
    if (timestamp === null) {
      this.unscheduleKey(key)
      return
    }
    this.scheduleAt(key, timestamp + this.intervalMs)
  }

  /** Schedules a key to refresh intervalMs from now. */
  scheduleFromNow(key: string, now: number = Date.now()): void {
    this.scheduleAt(key, now + this.intervalMs)
  }

  /** Removes a key from scheduling state and updates its bucket timer. */
  unscheduleKey(key: string): void {
    const schedule = this.keySchedules.get(key)
    if (!schedule) return

    this.keySchedules.delete(key)
    const bucket = this.buckets.get(schedule.bucketId)
    if (!bucket) return

    bucket.keys.delete(key)
    if (bucket.keys.size === 0) {
      if (bucket.timeout) {
        clearTimeout(bucket.timeout)
      }
      this.buckets.delete(schedule.bucketId)
      return
    }

    this.rescheduleBucketTimer(schedule.bucketId)
  }

  /** Clears all bucket timers and scheduled key state. */
  clearAll(): void {
    for (const bucket of this.buckets.values()) {
      if (bucket.timeout) {
        clearTimeout(bucket.timeout)
      }
    }
    this.buckets.clear()
    this.keySchedules.clear()
  }

  /** Immediately refreshes a key, then re-schedules on success. */
  async forceRefreshNow(key: string): Promise<PriceData | null> {
    this.unscheduleKey(key)
    const refreshed = await this.runRefreshWithDedup(key, 'manual-override')
    if (refreshed) {
      this.scheduleFromNow(key)
    }
    return refreshed
  }

  /** Places a key in the correct bucket and re-arms that bucket timer. */
  private scheduleAt(key: string, refreshAt: number): void {
    this.unscheduleKey(key)

    const bucketId = this.getBucketId(refreshAt)
    let bucket = this.buckets.get(bucketId)
    if (!bucket) {
      bucket = { keys: new Set(), timeout: null }
      this.buckets.set(bucketId, bucket)
    }

    bucket.keys.add(key)
    this.keySchedules.set(key, { refreshAt, bucketId })
    this.rescheduleBucketTimer(bucketId)
  }

  /** Maps a refresh timestamp to a stable interval bucket id. */
  private getBucketId(refreshAt: number): string {
    return String(Math.floor(refreshAt / this.intervalMs))
  }

  /** Recomputes and arms the next timer for a bucket. */
  private rescheduleBucketTimer(bucketId: string): void {
    const bucket = this.buckets.get(bucketId)
    if (!bucket) return

    if (bucket.timeout) {
      clearTimeout(bucket.timeout)
      bucket.timeout = null
    }

    let nextRefreshAt: number | null = null
    for (const key of bucket.keys) {
      const schedule = this.keySchedules.get(key)
      if (!schedule || schedule.bucketId !== bucketId) continue
      if (nextRefreshAt === null || schedule.refreshAt < nextRefreshAt) {
        nextRefreshAt = schedule.refreshAt
      }
    }

    if (nextRefreshAt === null) {
      this.buckets.delete(bucketId)
      return
    }

    const delay = Math.max(0, nextRefreshAt - Date.now())
    bucket.timeout = setTimeout(() => {
      void this.runBucket(bucketId)
    }, delay)
  }

  /** Runs one bucket cycle with error logging and retry scheduling. */
  private async runBucket(bucketId: string): Promise<void> {
    try {
      await this.refreshDueKeys(bucketId)
    } catch (error) {
      console.error(`${CACHE_SERVER_LOG_PREFIX} Scheduled price refresh bucket failed:`, error)
      this.rescheduleBucketTimer(bucketId)
    }
  }

  /** Refreshes all keys that are due in a bucket and reschedules survivors. */
  private async refreshDueKeys(bucketId: string): Promise<void> {
    const bucket = this.buckets.get(bucketId)
    if (!bucket) return

    bucket.timeout = null
    const now = Date.now()
    const dueKeys: string[] = []

    for (const key of Array.from(bucket.keys)) {
      const schedule = this.keySchedules.get(key)
      if (!schedule || schedule.bucketId !== bucketId) {
        bucket.keys.delete(key)
        continue
      }

      if (schedule.refreshAt <= now) {
        dueKeys.push(key)
      }
    }

    for (const key of dueKeys) {
      bucket.keys.delete(key)
      this.keySchedules.delete(key)
    }

    for (const [index, key] of dueKeys.entries()) {
      if (index > 0) {
        await Bun.sleep(PRICE_REFRESH_STAGGER_MS)
      }
      try {
        const refreshed = await this.runRefreshWithDedup(key, 'scheduled')
        if (refreshed) {
          this.scheduleFromNow(key)
        }
      } catch (error) {
        console.error(
          `${CACHE_SERVER_LOG_PREFIX} Scheduled price refresh failed for '${key}':`,
          error,
        )
        this.scheduleFromNow(key)
      }
    }

    if (bucket.keys.size === 0) {
      this.buckets.delete(bucketId)
      return
    }

    this.rescheduleBucketTimer(bucketId)
  }

  /** Executes refresh for a key while deduplicating concurrent callers. */
  private async runRefreshWithDedup(
    key: string,
    reason: PriceRefreshReason,
  ): Promise<PriceData | null> {
    const existing = this.refreshInFlight.get(key)
    if (existing) {
      return existing
    }

    const pending = this.refreshKey(key, reason)
    this.refreshInFlight.set(key, pending)
    try {
      return await pending
    } finally {
      this.refreshInFlight.delete(key)
    }
  }
}
