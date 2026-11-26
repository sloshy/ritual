/** The JSON-RPC `tools/list` body every HTTP MCP transport check posts. */
export const TOOLS_LIST_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {},
})

/** POST a bare `tools/list` to an MCP endpoint with `headers` added. */
export function postToolsList(
  endpoint: string | URL,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: TOOLS_LIST_BODY,
  })
}

/**
 * Run `body` with a port already taken on `hostname`. A CLI gate test passes
 * it as the listener's port, so if the gate ever stops refusing, the server
 * fails to bind and the run exits 1 at once instead of serving until the test
 * times out.
 */
export async function withBusyPort(
  hostname: string,
  body: (port: string) => Promise<void>,
): Promise<void> {
  const busy = Bun.serve({ port: 0, hostname, fetch: () => new Response('busy') })
  try {
    await body(String(busy.port))
  } finally {
    await busy.stop(true)
  }
}

/** A port that was free a moment ago, for a server spawned in another process. */
export async function freePort(hostname = '127.0.0.1'): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname, fetch: () => new Response('') })
  const port = probe.port ?? 0
  await probe.stop(true)
  return port
}
