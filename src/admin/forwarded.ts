/**
 * The entry of a comma-separated forwarding header (`X-Forwarded-For`,
 * `X-Forwarded-Host`) that the reverse proxy appended: the rightmost one. The
 * leftmost entries are whatever the client sent, so they are never trusted.
 * Null when the header is absent or its last entry is empty. Read only under
 * `admin.trustProxy`.
 */
export function lastForwarded(value: string | null): string | null {
  const last = value?.split(',').at(-1)?.trim()
  return last === undefined || last === '' ? null : last
}

/** A peer address, as a Bun server reports it. */
type SocketAddress = { address: string }

/** Whatever can tell a request's peer address: a Bun server, or a test stand-in. */
export type RequestIPServer = { requestIP?: (req: Request) => SocketAddress | null }

/**
 * The address a request came from: the proxy-appended `X-Forwarded-For` entry
 * under `admin.trustProxy`, otherwise the socket's peer, otherwise `unknown`.
 * Shared by the admin server and the MCP OAuth routes, which key their rate
 * limits and audit entries on it.
 */
export function getClientIp(req: Request, server: RequestIPServer, trustProxy: boolean): string {
  const forwarded = trustProxy ? lastForwarded(req.headers.get('X-Forwarded-For')) : null
  if (forwarded !== null) return forwarded
  if (server.requestIP) {
    const ip = server.requestIP(req)
    if (ip) return ip.address
  }
  return 'unknown'
}
