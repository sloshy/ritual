import { LOCALE_ENV, binaryPath, ensureBinary } from './cli'

/** What a spawned cache server (or feed host) printed by the time it stopped. */
export type CacheServerOutput = { stdout: string; stderr: string }

/** A `ritual cache server` (or `cache feed host`) running as its own process. */
export type SpawnedCacheServer = {
  port: number
  /** `http://127.0.0.1:<port>` */
  url: string
  /** Stop the server and collect what it printed; later calls return the same output. */
  stop: () => Promise<CacheServerOutput>
}

export type SpawnCacheServerOptions = {
  /** The workspace the server runs in; its `cache/` is the server's storage. */
  cwd: string
  /** Flags after `<command> --host 127.0.0.1 --port <port>`. */
  args?: string[]
  /** Env over the suite's scrubbed baseline (`LOCALE_ENV` pins English). */
  env?: Record<string, string | undefined>
}

/**
 * How long one spawn attempt gets to answer `/health` before it counts as
 * failed. With the one retry a busy port earns, a spawn waits at most twice
 * this; {@link SpawnedCacheServer.stop} adds up to {@link STOP_SETTLE_MS} plus
 * {@link STOP_GRACE_MS} (and the SIGKILL that follows). A test spawning a
 * server should allow ~25 s.
 */
const READY_TIMEOUT_MS = 10_000

/** How long `stop()` waits before signalling, so the last request's log lines are flushed. */
const STOP_SETTLE_MS = 100

/** How long `stop()` gives the server to exit on SIGTERM before it sends SIGKILL. */
const STOP_GRACE_MS = 2000

/** How much of the server's stdout a readiness failure quotes. */
const STDOUT_TAIL_CHARS = 2000

function pickPort(): number {
  return 41000 + Math.floor(Math.random() * 2000)
}

/** Whether a `/health` body is an object whose `status` is `'ok'`. */
function isOkHealth(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok'
}

/** A cache server's `/health`: `{ status: 'ok' }`. */
const cacheServerHealthy = isOkHealth

/** A feed host's `/health` (`FeedHealthResponse`): its entry count and feed date beside `status`. */
function feedHostHealthy(body: unknown): boolean {
  return (
    isOkHealth(body) &&
    typeof body.entries === 'number' &&
    (typeof body.generatedAt === 'string' || body.generatedAt === null)
  )
}

/**
 * Spawn `ritual cache server` on a loopback port and wait until it answers
 * `/health`. A server that never answers is killed, and the spawn fails with
 * what it printed and how it exited; one that lost a race for its port is
 * retried once on another. The ambient cache-server variables are cleared, so
 * a developer's shell cannot point the server at another server or schedule.
 */
export function spawnCacheServer(options: SpawnCacheServerOptions): Promise<SpawnedCacheServer> {
  return spawnServer(['cache', 'server'], cacheServerHealthy, options)
}

/**
 * Spawn `ritual cache feed host` the same way. It answers `/health` only once
 * its first feed is published, so pass `--upstream` (a local bulk manifest) and
 * `--dir`; pass `--no-seed` too unless the test needs BitTorrent.
 */
export function spawnFeedHost(options: SpawnCacheServerOptions): Promise<SpawnedCacheServer> {
  return spawnServer(['cache', 'feed', 'host'], feedHostHealthy, options)
}

/** Whether a failed spawn's stderr says its port was taken — the one failure worth a retry. */
function lostPortRace(stderr: string): boolean {
  return /EADDRINUSE|in use/i.test(stderr)
}

async function spawnServer(
  command: readonly string[],
  healthy: (body: unknown) => boolean,
  options: SpawnCacheServerOptions,
): Promise<SpawnedCacheServer> {
  await ensureBinary()
  const first = await spawnAttempt(command, healthy, options)
  if (first.ok) return first.server
  if (!lostPortRace(first.output.stderr)) throw first.error
  const second = await spawnAttempt(command, healthy, options)
  if (second.ok) return second.server
  throw second.error
}

/** One spawn on one port: the live server, or what it printed and why it failed. */
type SpawnAttempt =
  { ok: true; server: SpawnedCacheServer } | { ok: false; output: CacheServerOutput; error: Error }

async function spawnAttempt(
  command: readonly string[],
  healthy: (body: unknown) => boolean,
  options: SpawnCacheServerOptions,
): Promise<SpawnAttempt> {
  const port = pickPort()
  const url = `http://127.0.0.1:${port}`
  const proc = Bun.spawn(
    [binaryPath, ...command, '--host', '127.0.0.1', '--port', `${port}`, ...(options.args ?? [])],
    {
      cwd: options.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        RITUAL_BASE_DIR: undefined,
        RITUAL_CACHE_SERVER: '',
        RITUAL_CACHE_SERVER_CARDS_REFRESH: '',
        RITUAL_CACHE_SERVER_PRICES_REFRESH: '',
        RITUAL_CACHE_FEED_REFRESH: '',
        ...LOCALE_ENV,
        ...options.env,
      },
    },
  )
  const stdout = new Response(proc.stdout).text()
  const stderr = new Response(proc.stderr).text()

  // Once: a suite's cleanup may stop a server its test already stopped.
  let stopped: Promise<CacheServerOutput> | undefined
  const stop = (): Promise<CacheServerOutput> => {
    stopped ??= (async () => {
      if (proc.exitCode === null) {
        await Bun.sleep(STOP_SETTLE_MS)
        proc.kill()
        const exited = await Promise.race([
          proc.exited.then(() => true),
          Bun.sleep(STOP_GRACE_MS).then(() => false),
        ])
        if (!exited) proc.kill('SIGKILL')
      }
      await proc.exited
      return { stdout: await stdout, stderr: await stderr }
    })()
    return stopped
  }

  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const body = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) }).then(
      async (response): Promise<unknown> => (response.ok ? await response.json() : undefined),
      () => undefined,
    )
    // A healthy answer counts only from the process this attempt spawned: if it
    // already exited, something else owns the port.
    if (body !== undefined && proc.exitCode === null) {
      if (healthy(body)) return { ok: true, server: { port, url, stop } }
      const output = await stop()
      return failure(command, port, `unexpected /health body ${JSON.stringify(body)}`, output)
    }
    if (proc.exitCode !== null) break
    await Bun.sleep(100)
  }
  const exitCode = proc.exitCode
  const output = await stop()
  return failure(command, port, `never answered (exit code ${String(exitCode)})`, output)
}

function failure(
  command: readonly string[],
  port: number,
  reason: string,
  output: CacheServerOutput,
): SpawnAttempt {
  const tail = output.stdout.slice(-STDOUT_TAIL_CHARS)
  const error = new Error(
    `${command.join(' ')} on port ${port} ${reason}:\nstderr:\n${output.stderr}\nstdout (tail):\n${tail}`,
  )
  return { ok: false, output, error }
}
