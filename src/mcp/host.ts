/**
 * Loopback host names that don't fit the 127.0.0.0/8 dotted-quad pattern:
 * the bracketed IPv6 form users copy out of URLs (and the SDK's own host
 * allowlist uses), plus the IPv4-mapped IPv6 spelling.
 */
const LOOPBACK_NAMES = new Set(['localhost', '::1', '[::1]', '::ffff:127.0.0.1'])

const LOOPBACK_V4_PATTERN = /^127(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

/**
 * Whether a bind host is loopback-only (no exposure beyond the local machine).
 *
 * Kept SDK-free so `src/commands/mcp.ts` can gate its unauthenticated-bind
 * refusal on it without pulling the MCP SDK into every command's module graph.
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase()
  if (LOOPBACK_NAMES.has(normalized)) return true
  return LOOPBACK_V4_PATTERN.test(normalized)
}
