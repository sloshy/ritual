import { describe, expect, test } from 'bun:test'
import { startServerOrThrow, tryStartServer } from '../../src/util/start-server'
import { ExitCode } from '../../src/util/errors'
import { failureIdentity } from '../helpers/rejection'

/** A listener on an OS-chosen free port, so the test owns the port it makes busy. */
function occupyPort(): Bun.Server<undefined> {
  return Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('busy') })
}

/** The port `busy` holds; a listener without one would quietly turn the test into a free-port bind. */
function portOf(busy: Bun.Server<undefined>): number {
  if (busy.port === undefined) throw new Error('the busy listener bound no TCP port')
  return busy.port
}

/** A start function binding `port` on loopback. */
const bindTo = (port: number) => (): Bun.Server<undefined> =>
  Bun.serve({ port, hostname: '127.0.0.1', fetch: () => new Response('') })

describe('binding a server to a busy port', () => {
  test('tryStartServer reports the failure instead of throwing', async () => {
    const busy = occupyPort()
    const started = tryStartServer(bindTo(portOf(busy)))
    try {
      expect(started.ok).toBeFalse()
    } finally {
      if (started.ok) await started.server.stop(true)
      await busy.stop(true)
    }
  })

  test('startServerOrThrow throws the localized runtime error, exit 1', async () => {
    const busy = occupyPort()
    try {
      const port = portOf(busy)
      // `startServerOrThrow` throws synchronously; the async wrapper turns that
      // into the rejection the helper reads (and would stop a listener that
      // bound after all, rather than leak it).
      const attempt = (async (): Promise<void> => {
        const server = startServerOrThrow({ host: '127.0.0.1', port }, bindTo(port))
        await server.stop(true)
      })()
      expect(await failureIdentity(attempt)).toEqual({
        key: 'cli.serve.startFailed',
        exitCode: ExitCode.RuntimeError,
      })
    } finally {
      await busy.stop(true)
    }
  })
})
