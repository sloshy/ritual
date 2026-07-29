import { describe, expect, test } from 'bun:test'
import type { McpServer } from '@modelcontextprotocol/server'
import { createListChangeNotifier } from '../../../src/mcp/notify'

/**
 * The `notifications/resources/list_changed` notifier.
 *
 * Two behaviours matter and neither is reachable through the server harness: the
 * disabled notifier the stateless HTTP leg gets must be silent (there is no
 * client connection to reach), and the enabled one must swallow a send failure —
 * the write it follows already succeeded, so failing the tool call over a
 * courtesy notification would be strictly worse.
 */

/** A stand-in server recording how often it was asked to notify. */
type FakeServer = { sent: number; server: McpServer }

function fakeServer(fail = false): FakeServer {
  const state: FakeServer = {
    sent: 0,
    server: {
      sendResourceListChanged: () => {
        state.sent++
        if (fail) throw new Error('no transport')
      },
    } as unknown as McpServer,
  }
  return state
}

describe('createListChangeNotifier', () => {
  test('the enabled notifier fires on every list change', () => {
    const fake = fakeServer()
    const notifier = createListChangeNotifier(fake.server, true)

    // Create, rename, delete: three separate writes, three notifications.
    notifier.notifyListsChanged()
    notifier.notifyListsChanged()
    notifier.notifyListsChanged()

    expect(fake.sent).toBe(3)
  })

  test('the disabled notifier never touches the server', () => {
    const fake = fakeServer()
    createListChangeNotifier(fake.server, false).notifyListsChanged()
    expect(fake.sent).toBe(0)
  })

  test('a send that throws is swallowed, so the write that succeeded still reports success', () => {
    const fake = fakeServer(true)
    const notifier = createListChangeNotifier(fake.server, true)

    const originalError = console.error
    console.error = () => {}
    try {
      expect(() => notifier.notifyListsChanged()).not.toThrow()
    } finally {
      console.error = originalError
    }
    expect(fake.sent).toBe(1)
  })
})
