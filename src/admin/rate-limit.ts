interface AttemptRecord {
  failures: number
  lockedUntil: number | null
  timestamps: number[]
}

export class RateLimiter {
  private attempts = new Map<string, AttemptRecord>()

  recordFailure(ip: string, maxAttempts: number, windowMinutes: number): void {
    const now = Date.now()
    const windowMs = windowMinutes * 60_000
    let record = this.attempts.get(ip)

    if (!record) {
      record = { failures: 0, lockedUntil: null, timestamps: [] }
      this.attempts.set(ip, record)
    }

    // Prune old timestamps outside the window
    record.timestamps = record.timestamps.filter((t) => now - t < windowMs)
    record.timestamps.push(now)
    record.failures = record.timestamps.length

    if (record.failures >= maxAttempts) {
      record.lockedUntil = now + windowMs
    }
  }

  isLocked(ip: string): boolean {
    const record = this.attempts.get(ip)
    if (!record || record.lockedUntil === null) {
      return false
    }

    if (Date.now() >= record.lockedUntil) {
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
    const remaining = record.lockedUntil - Date.now()
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0
  }

  recordSuccess(ip: string): void {
    this.attempts.delete(ip)
  }

  getFailureCount(ip: string): number {
    return this.attempts.get(ip)?.failures ?? 0
  }
}

export const globalRateLimiter = new RateLimiter()
