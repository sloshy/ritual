interface AttemptRecord {
  failures: number
  lockedUntil: number | null
  timestamps: number[]
  /** The limit the last failure was counted against, which {@link RateLimiter.release} re-checks. */
  maxAttempts: number
}

/** Where a limiter reads the time, in epoch milliseconds. */
export type LimiterClock = () => number

/** How many recorded failures pass between two sweeps of idle records. */
const SWEEP_EVERY = 100

/**
 * Failed-attempt counting per key (a client address): `maxAttempts` failures
 * inside `windowMinutes` lock the key for the window.
 *
 * Records whose failures have all aged out of their window, and that are not
 * locked, are swept now and then, so a stream of one-off keys (a scan from
 * many addresses) cannot grow the map without bound.
 */
export class RateLimiter {
  private attempts = new Map<string, AttemptRecord>()
  private sinceSweep = 0
  private lastWindowMs = 0

  constructor(private readonly clock: LimiterClock = Date.now) {}

  recordFailure(ip: string, maxAttempts: number, windowMinutes: number): void {
    const now = this.clock()
    const windowMs = windowMinutes * 60_000
    this.lastWindowMs = windowMs
    let record = this.attempts.get(ip)

    if (!record) {
      record = { failures: 0, lockedUntil: null, timestamps: [], maxAttempts }
      this.attempts.set(ip, record)
    }

    // Prune old timestamps outside the window
    record.timestamps = record.timestamps.filter((t) => now - t < windowMs)
    record.timestamps.push(now)
    record.failures = record.timestamps.length
    record.maxAttempts = maxAttempts

    if (record.failures >= maxAttempts) {
      record.lockedUntil = now + windowMs
    }

    this.sinceSweep += 1
    if (this.sinceSweep >= SWEEP_EVERY) this.sweep(now)
  }

  isLocked(ip: string): boolean {
    const record = this.attempts.get(ip)
    if (!record || record.lockedUntil === null) {
      return false
    }

    if (this.clock() >= record.lockedUntil) {
      // Lock expired, reset
      this.attempts.delete(ip)
      return false
    }

    return true
  }

  getRemainingLockSeconds(ip: string): number {
    const record = this.attempts.get(ip)
    if (!record || record.lockedUntil === null) {
      return 0
    }
    const remaining = record.lockedUntil - this.clock()
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0
  }

  /**
   * Take back the most recent counted failure for `ip`: an attempt reserved
   * before checking that turned out not to be a failure at all (the admin
   * login's "password right, now enter your code" answer). A lock it alone
   * caused is lifted.
   */
  release(ip: string): void {
    const record = this.attempts.get(ip)
    if (!record || record.timestamps.length === 0) return
    record.timestamps.pop()
    record.failures = record.timestamps.length
    if (record.failures < record.maxAttempts) record.lockedUntil = null
    if (record.failures === 0) this.attempts.delete(ip)
  }

  recordSuccess(ip: string): void {
    this.attempts.delete(ip)
  }

  getFailureCount(ip: string): number {
    return this.attempts.get(ip)?.failures ?? 0
  }

  /** How many keys are tracked (for tests of the sweep). */
  get size(): number {
    return this.attempts.size
  }

  /** Drop unlocked records whose every failure is older than the last window used. */
  private sweep(now: number): void {
    this.sinceSweep = 0
    for (const [key, record] of this.attempts) {
      const locked = record.lockedUntil !== null && now < record.lockedUntil
      const recent = record.timestamps.some((t) => now - t < this.lastWindowMs)
      if (!locked && !recent) this.attempts.delete(key)
    }
  }
}

export const globalRateLimiter = new RateLimiter()
