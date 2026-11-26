import type { AdminConfig } from '../config/ritual-config'
import {
  bareAddress,
  ipRangeSet,
  isIpRangeProblem,
  parseIpRange,
  type IpRange,
  type IpRangeSet,
} from '../util/ip-range'

/**
 * The rightmost entry of a comma-separated forwarding header: the one the
 * proxy nearest Ritual wrote. `X-Forwarded-Host` is read this way; entries to
 * its left are whatever an earlier hop, or the client, sent. Null when the
 * header is absent or its last entry is empty. Read only through
 * {@link readRequestSource}, which walks `X-Forwarded-For` hop by hop instead.
 */
export function lastForwarded(value: string | null): string | null {
  const last = value?.split(',').at(-1)?.trim()
  return last === undefined || last === '' ? null : last
}

/** A peer address, as a Bun server reports it. */
export type SocketAddress = { address: string }

/** Whatever can tell a request's peer address: a Bun server, or a test stand-in. */
export type RequestIPServer = { requestIP?: (req: Request) => SocketAddress | null }

/** The settings the forwarding decision reads. */
export type ProxySettings = Pick<AdminConfig, 'trustProxy' | 'trustedProxies'>

/**
 * The proxies that are always trusted under `admin.trustProxy`: this machine's
 * loopback addresses, which covers a tunnel client or reverse proxy running
 * beside Ritual (cloudflared, Tailscale Serve, Caddy, nginx). An IPv4-mapped
 * peer (`::ffff:127.0.0.1`) matches the IPv4 range.
 */
const LOOPBACK_RANGES = [
  { address: '127.0.0.0', prefix: 8, family: 'ipv4' },
  { address: '::1', prefix: 128, family: 'ipv6' },
] as const satisfies readonly IpRange[]

/**
 * Where a request came from and which host it was addressed to, once the
 * forwarding headers have been believed or ignored.
 */
export type RequestSource = {
  /**
   * The client's address: when the request came through a trusted proxy, the
   * first `X-Forwarded-For` entry from the right that is not itself a trusted
   * proxy (see {@link forwardedClient}); otherwise the connection's own peer;
   * `unknown` when there is no peer. Rate limits, the audit log and the IP
   * lists key on it.
   */
  clientIp: string
  /**
   * The host the browser addressed, from the proxy-appended `X-Forwarded-Host`
   * entry when the request came through a trusted proxy; null when the header
   * is not believed or absent, so the request's own `Host` applies.
   */
  forwardedHost: string | null
}

/**
 * The proxies `settings` trusts: loopback plus `admin.trustedProxies`. The
 * loader has already refused a malformed entry, so none is skipped here in
 * practice.
 */
function trustedProxySet(settings: ProxySettings): IpRangeSet {
  const configured = settings.trustedProxies
    .map(parseIpRange)
    .filter((range): range is IpRange => !isIpRangeProblem(range))
  return ipRangeSet([...LOOPBACK_RANGES, ...configured])
}

/**
 * The client address an `X-Forwarded-For` header names, read from a trusted
 * proxy `peer`. Each proxy appends the address it was reached from, so the
 * header is walked right to left, skipping the entries that are trusted
 * proxies themselves (a CDN in front of a local proxy, say): the first entry
 * outside the trusted set is the client. Entries to its left were written by
 * that client, so they are never read. When every entry is a trusted proxy,
 * the leftmost is the client.
 *
 * An entry that is not a bare IP address (a proxy's `unknown`, `host:port`, an
 * empty entry) stops the walk: the address is then the last trusted hop the
 * walk passed, or `peer` itself, an address a trusted proxy vouched for, never
 * one the client chose.
 */
function forwardedClient(header: string | null, peer: string, trusted: IpRangeSet): string {
  if (header === null) return peer
  let hop = peer
  for (const entry of header.split(',').reverse()) {
    const address = bareAddress(entry)
    if (address === null) return hop
    if (!trusted.contains(address)) return address
    hop = address
  }
  return hop
}

/**
 * Read a request's source. This is the one place that decides whether the
 * forwarding headers are believed: only under `admin.trustProxy`, and only
 * when the connection's own peer is a trusted proxy (loopback, or inside an
 * `admin.trustedProxies` range). Any other peer could write any address or
 * host into them, so for it every forwarding header is ignored and the
 * connection's own address and the request's own `Host` are used. Shared by
 * the admin server and the MCP OAuth routes.
 */
export function readRequestSource(
  req: Request,
  server: RequestIPServer,
  settings: ProxySettings,
): RequestSource {
  const peer = server.requestIP?.(req)?.address ?? null
  if (peer === null) return { clientIp: 'unknown', forwardedHost: null }
  if (!settings.trustProxy) return { clientIp: peer, forwardedHost: null }
  const trusted = trustedProxySet(settings)
  if (!trusted.contains(peer)) return { clientIp: peer, forwardedHost: null }
  return {
    clientIp: forwardedClient(req.headers.get('X-Forwarded-For'), peer, trusted),
    forwardedHost: lastForwarded(req.headers.get('X-Forwarded-Host')),
  }
}
