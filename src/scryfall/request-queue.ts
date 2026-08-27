/** Scryfall's request pacing: the per-request gap and the queue that enforces it. */

export const RATE_LIMIT_MS = 150

export class RequestQueue {
  private readonly queue: Array<() => Promise<void>> = []
  private tickPending = false
  private lastFiredAt = 0

  constructor(private readonly intervalMs: number) {}

  enqueueBack(task: () => Promise<void>): void {
    this.queue.push(task)
    this.scheduleIfNeeded()
  }

  enqueueFront(task: () => Promise<void>): void {
    this.queue.unshift(task)
    this.scheduleIfNeeded()
  }

  private scheduleIfNeeded(): void {
    if (this.tickPending || this.queue.length === 0) return
    const elapsed = Date.now() - this.lastFiredAt
    const delay = Math.max(0, this.intervalMs - elapsed)
    this.tickPending = true
    setTimeout(() => this.tick(), delay)
  }

  private tick(): void {
    this.tickPending = false
    this.lastFiredAt = Date.now()
    const task = this.queue.shift()
    if (task) void task()
    this.scheduleIfNeeded()
  }
}
