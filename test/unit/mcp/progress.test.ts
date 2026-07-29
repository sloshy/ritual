import { describe, expect, test } from 'bun:test'
import type { Notification, ServerContext } from '@modelcontextprotocol/server'
import { createToolProgressSink } from '../../../src/mcp/progress'

/**
 * The bridge from a route's progress reports onto `notifications/progress`.
 *
 * Driven against a hand-rolled context rather than a transport (the
 * `notify.test.ts` precedent): what matters here is the gate (no token, no
 * frames), the monotonic guard, and that a rejecting `notify` cannot escape into
 * the tool call.
 */

type FakeCtx = {
  sent: Notification[]
  ctx: ServerContext
}

type FakeCtxOptions = {
  progressToken?: string | number
  aborted?: boolean
  failNotify?: boolean
}

function fakeCtx(options: FakeCtxOptions = {}): FakeCtx {
  const sent: Notification[] = []
  const controller = new AbortController()
  if (options.aborted) controller.abort()
  const ctx = {
    mcpReq: {
      _meta:
        options.progressToken === undefined ? undefined : { progressToken: options.progressToken },
      signal: controller.signal,
      notify: (notification: Notification): Promise<void> => {
        sent.push(notification)
        return options.failNotify ? Promise.reject(new Error('not connected')) : Promise.resolve()
      },
    },
  } as unknown as ServerContext
  return { sent, ctx }
}

describe('createToolProgressSink', () => {
  test('returns undefined when the client supplied no progressToken', () => {
    expect(createToolProgressSink(fakeCtx().ctx)).toBeUndefined()
  })

  test('emits one notifications/progress per report, echoing the token', () => {
    const fake = fakeCtx({ progressToken: 7 })
    const sink = createToolProgressSink(fake.ctx)!

    sink({ progress: 1, total: 100, message: 'Fetching…' })
    sink({ progress: 50, total: 100, message: 'Processing…' })

    expect(fake.sent).toHaveLength(2)
    expect(fake.sent[0]).toEqual({
      method: 'notifications/progress',
      params: { progressToken: 7, progress: 1, total: 100, message: 'Fetching…' },
    })
    expect(fake.sent[1]?.params?.progress).toBe(50)
  })

  test('drops a report that does not increase', () => {
    const fake = fakeCtx({ progressToken: 'tok' })
    const sink = createToolProgressSink(fake.ctx)!

    sink({ progress: 10, total: 100 })
    sink({ progress: 10, total: 100 })
    sink({ progress: 9, total: 100 })
    sink({ progress: 11, total: 100 })

    expect(fake.sent.map((n) => n.params?.progress)).toEqual([10, 11])
  })

  test('stops emitting once the request was cancelled', () => {
    const fake = fakeCtx({ progressToken: 1, aborted: true })
    const sink = createToolProgressSink(fake.ctx)!

    sink({ progress: 1, total: 3 })

    expect(fake.sent).toHaveLength(0)
  })

  test('a rejecting notify does not throw out of the sink', () => {
    const fake = fakeCtx({ progressToken: 1, failNotify: true })
    const sink = createToolProgressSink(fake.ctx)!

    expect(() => sink({ progress: 1, total: 3 })).not.toThrow()
    expect(fake.sent).toHaveLength(1)
  })
})
