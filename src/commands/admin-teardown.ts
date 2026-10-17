/**
 * Shutdown of `ritual admin`'s listeners — the admin web server and, with
 * `--mcp`, the embedded MCP HTTP endpoint. Each listener carries the sentence
 * its own failed teardown prints, so the message can never be paired with the
 * wrong server by position.
 */

/** The sentence a listener prints when it refuses to close. */
export type TeardownFailureKey = 'cli.admin.teardownFailedMcp' | 'cli.admin.teardownFailedAdmin'

/** A listener to stop on shutdown: how to stop it, and what its failure says. */
export type AdminListener = {
  failure: TeardownFailureKey
  /** Resolves once the listener closed (at once for one that never started). */
  stop: () => Promise<unknown>
}

/** A listener that refused to close, and why. */
export type TeardownFailure = { failure: TeardownFailureKey; reason: unknown }

/**
 * The failures among settled stop calls, each named by its own listener's
 * sentence. `results` is in `listeners` order, as `Promise.allSettled` returns.
 */
export function teardownFailures(
  listeners: readonly Pick<AdminListener, 'failure'>[],
  results: readonly PromiseSettledResult<unknown>[],
): TeardownFailure[] {
  const failures: TeardownFailure[] = []
  listeners.forEach((listener, index) => {
    const result = results[index]
    if (result?.status === 'rejected') {
      failures.push({ failure: listener.failure, reason: result.reason })
    }
  })
  return failures
}

/**
 * Stop every listener at once. `allSettled`, so one refusing to close still
 * lets the others; the failures are returned rather than discarded, because a
 * teardown that failed is a port left bound.
 */
export async function stopListeners(
  listeners: readonly AdminListener[],
): Promise<TeardownFailure[]> {
  const results = await Promise.allSettled(listeners.map((listener) => listener.stop()))
  return teardownFailures(listeners, results)
}
