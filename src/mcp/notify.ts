import type { McpServer } from '@modelcontextprotocol/server'

/** Fires `notifications/resources/list_changed`, or does nothing when the transport cannot. */
export interface ListChangeNotifier {
  notifyListsChanged(): void
}

/**
 * A notifier for `server`, active only when the transport keeps one server
 * instance alive across requests.
 *
 * The stateless HTTP leg builds and disposes a server per request, so a
 * notification there has no client connection to reach — the disabled notifier
 * is the honest implementation, and it matches the capability that leg
 * advertises. Stdio pins one instance per connection, so it gets the real one.
 */
export function createListChangeNotifier(server: McpServer, enabled: boolean): ListChangeNotifier {
  if (!enabled) return { notifyListsChanged: () => {} }
  return {
    notifyListsChanged: () => {
      try {
        server.sendResourceListChanged()
      } catch (error) {
        // A notification is a courtesy; the write it follows already succeeded,
        // and failing the tool call over it would be strictly worse.
        console.error('Failed to send resources/list_changed:', error)
      }
    },
  }
}
