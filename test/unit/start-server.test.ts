import { describe, expect, test } from 'bun:test'
import { startServerOrThrow, tryStartServer } from '../../src/util/start-server'
import { CardCommandError, ExitCode } from '../../src/util/errors'
import { rejectionOf } from '../helpers/rejection'

/** A listener on an OS-chosen free port, so the test owns the port it makes busy. */
function occupyPort(): Bun.Server<undefined> {
  return Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('busy') })
}

describe('binding a server to a busy port', () => {
  test('tryStartServer reports the failure instead of throwing', async () => {
    const busy = occupyPort()
    try {
      const port = busy.port ?? 0
      const started = tryStartServer(() =>
        Bun.serve({ port, hostname: '127.0.0.1', fetch: () => new Response('') }),
      )
      expect(started.ok).toBeFalse()
    } finally {
      await busy.stop(true)
    }
  })

  test('startServerOrThrow throws the localized runtime error, exit 1', async () => {
    const busy = occupyPort()
    try {
      const port = busy.port ?? 0
      const error = await rejectionOf(
        (async () =>
          startServerOrThrow({ host: '127.0.0.1', port }, () =>
            Bun.serve({ port, hostname: '127.0.0.1', fetch: () => new Response('') }),
          ))(),
      )
      expect(error).toBeInstanceOf(CardCommandError)
      if (!(error instanceof CardCommandError)) return
      expect(error.exitCode).toBe(ExitCode.RuntimeError)
      expect(error.message).toStartWith(`Failed to start the server on 127.0.0.1:${port}: `)
    } finally {
      await busy.stop(true)
    }
  })
})
