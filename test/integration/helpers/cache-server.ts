import { LOCALE_ENV, binaryPath, ensureBinary } from './cli'

/** What a spawned cache server printed by the time it stopped. */
export type CacheServerOutput = { stdout: string; stderr: string }

/** A `ritual cache server` running as its own process. */
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
  /** Flags after `cache server --host 127.0.0.1 --port <port>`. */
  args?: string[]
  /** Env over the suite's scrubbed baseline (`LOCALE_ENV` pins English). */
  env?: Record<string, string | undefined>
}

/** How long a server gets to answer `/health` before the spawn counts as failed. */
const READY_TIMEOUT_MS = 10_000

function pickPort(): number {
  return 41000 + Math.floor(Math.random() * 2000)
}

/**
 * Spawn `ritual cache server` on a loopback port and wait until it answers
 * `/health`. A server that never answers is killed, and the spawn fails with
 * what it printed to stderr. The ambient cache-server variables are cleared, so
 * a developer's shell cannot point the server at another server or schedule.
 */
export async function spawnCacheServer(
  options: SpawnCacheServerOptions,
): Promise<SpawnedCacheServer> {
  await ensureBinary()
  const port = pickPort()
  const url = `http://127.0.0.1:${port}`
  const proc = Bun.spawn(
    [
      binaryPath,
      'cache',
      'server',
      '--host',
      '127.0.0.1',
      '--port',
      `${port}`,
      ...(options.args ?? []),
    ],
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
      proc.kill()
      await Promise.race([proc.exited, Bun.sleep(2000)])
      return { stdout: await stdout, stderr: await stderr }
    })()
    return stopped
  }

  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const healthy = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) }).then(
      (response) => response.ok,
      () => false,
    )
    if (healthy) return { port, url, stop }
    if (proc.exitCode !== null) break
    await Bun.sleep(100)
  }
  const output = await stop()
  throw new Error(`cache server never answered on port ${port}:\n${output.stderr}`)
}
