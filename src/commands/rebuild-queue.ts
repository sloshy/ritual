export type RebuildQueueOptions<T> = {
  rebuild: (payload: T) => Promise<void>
  /**
   * Combine a pending payload with an incoming one when `trigger` is called
   * while a rebuild is already in flight. Defaults to "latest wins".
   */
  merge?: (pending: T, incoming: T) => T
  /** Optional hook called when `rebuild` throws. */
  onError?: (err: unknown) => void
}

export type RebuildQueue<T> = {
  trigger: (payload: T) => void
  isRunning: () => boolean
}

/**
 * Coalesce overlapping rebuild requests: while a rebuild is in flight, any
 * new `trigger` calls merge their payloads into a single pending request that
 * fires exactly once after the current rebuild completes. Drains repeatedly
 * if events keep arriving.
 */
export function createRebuildQueue<T>(options: RebuildQueueOptions<T>): RebuildQueue<T> {
  const merge = options.merge ?? ((_pending: T, incoming: T) => incoming)
  let running = false
  let hasPending = false
  let pendingPayload: T | undefined

  const run = (payload: T): void => {
    running = true
    void (async () => {
      try {
        await options.rebuild(payload)
      } catch (err) {
        options.onError?.(err)
      } finally {
        if (hasPending) {
          const next = pendingPayload as T
          hasPending = false
          pendingPayload = undefined
          run(next)
        } else {
          running = false
        }
      }
    })()
  }

  return {
    trigger(payload: T): void {
      if (!running) {
        run(payload)
        return
      }
      pendingPayload = hasPending ? merge(pendingPayload as T, payload) : payload
      hasPending = true
    },
    isRunning(): boolean {
      return running
    },
  }
}
