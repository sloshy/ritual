import { ExitCode, getErrorMessage, localizedCommandError } from './errors'

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
  { ok: true; server: T } | { ok: false; error: string }

/**
 * Run `start` (a `Bun.serve` call, or a synchronous wrapper around one) and turn
 * a start failure — nearly always `EADDRINUSE` — into a typed result, so a busy
 * port is a message and an exit code rather than an uncaught throw with a stack
 * trace. Every Ritual server binds through this or {@link startServerOrThrow}.
 * It lives in `util` rather than in `serve` so the cache servers, the admin and
 * the MCP server reach it without importing the site-serving layer.
 */
export function tryStartServer<T extends BoundServer>(start: () => T): StartServerResult<T> {
  try {
    return { ok: true, server: start() }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

/** Where a server tried to listen, for {@link startServerOrThrow}'s message. */
export type ListenAddress = { host: string; port: number }

/**
 * {@link tryStartServer} for a caller that reports failures by throwing: a bind
 * failure becomes the same localized runtime error `serve` prints (exit 1).
 */
export function startServerOrThrow<T extends BoundServer>(
  address: ListenAddress,
  start: () => T,
): T {
  const started = tryStartServer(start)
  if (started.ok) return started.server
  throw localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.serve.startFailed', {
    host: address.host,
    port: address.port,
    error: started.error,
  })
}
