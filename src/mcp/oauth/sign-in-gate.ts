/** What {@link SignInGate.run} resolved to: the task's value, or `busy` when the queue was full. */
export type GateResult<T> = { ok: true; value: T } | { ok: false }

/**
 * Runs credential checks one at a time per client address, and at most
 * `limit` at once overall. Together with reserving each attempt against the
 * rate limiter before it starts, this keeps a burst of parallel guesses from
 * all being checked before the first failure is counted; the global cap keeps
 * a spread of addresses from tying up the process with bcrypt.
 *
 * Only the check itself belongs inside: the failed-attempt delay is waited out
 * after the slot is released, so delayed failures cannot hold every slot. And
 * the queue is bounded: past `limit + maxWaiting` tasks admitted and not yet
 * finished, a new one is refused at once rather than left to wait behind an
 * attacker's backlog.
 */
export class SignInGate {
  private readonly perKey = new Map<string, Promise<unknown>>()
  private running = 0
  private admitted = 0
  private readonly waiting: (() => void)[] = []

  constructor(
    private readonly limit: number,
    private readonly maxWaiting: number,
  ) {}

  /** Whether a task would be admitted now. Synchronous, so a caller can decide before it counts. */
  hasRoom(): boolean {
    return this.admitted < this.limit + this.maxWaiting
  }

  /** Run `task` once no other task for `key` runs and a global slot is free; refused when full. */
  run<T>(key: string, task: () => Promise<T>): Promise<GateResult<T>> {
    if (!this.hasRoom()) return Promise.resolve({ ok: false })
    this.admitted += 1
    const previous = this.perKey.get(key) ?? Promise.resolve()
    const start = (): Promise<T> => this.withSlot(task)
    const next = previous.then(start, start)
    const settled = next.then(
      () => undefined,
      () => undefined,
    )
    this.perKey.set(key, settled)
    void settled.then(() => {
      this.admitted -= 1
      if (this.perKey.get(key) === settled) this.perKey.delete(key)
    })
    return next.then((value): GateResult<T> => ({ ok: true, value }))
  }

  private async withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    } else {
      this.running += 1
    }
    try {
      return await task()
    } finally {
      const wake = this.waiting.shift()
      // A woken task inherits this slot, so the count stays the same.
      if (wake === undefined) this.running -= 1
      else wake()
    }
  }
}
