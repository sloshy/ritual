import { getErrorMessage } from './errors'

/**
 * The part of a bound listener this module needs to know about.
 *
 * It exists to constrain {@link tryStartServer}'s generic: a `Promise` has no
 * `stop`, so handing the helper an *async* start function — whose bind failure
 * arrives as a rejection the `try` below can never see — is a compile error
 * rather than a guard that silently does nothing.
 */
export type BoundServer = {
  stop(closeActiveConnections?: boolean): unknown
}

/** The outcome of binding a server: the live handle, or why the bind failed. */
export type StartServerResult<T extends BoundServer> =
  | { ok: true; server: T }
  | { ok: false; error: string }

/**
 * Run `start` (a `Bun.serve` call, or a synchronous wrapper around one) and turn
 * a start failure — nearly always `EADDRINUSE` — into a typed result, so a busy
 * port is a message and an exit code rather than an uncaught throw with a stack
 * trace. `serve`, `cache server` and `cache feed host` bind through this; the
 * `admin` and `mcp` binds do not yet. It lives in `util` rather than in `serve`
 * because it depends on nothing but `getErrorMessage`, so the two cache servers
 * reach it without importing the site-serving layer.
 */
export function tryStartServer<T extends BoundServer>(start: () => T): StartServerResult<T> {
  try {
    return { ok: true, server: start() }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
