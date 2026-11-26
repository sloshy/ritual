import type { AdminConfig } from '../config/ritual-config'

/** The access-list settings {@link isRefusedByAccessLists} reads. */
export type AccessLists = Pick<
  AdminConfig,
  'ipAllowList' | 'ipDenyList' | 'userAgentAllowList' | 'userAgentDenyList'
>

/**
 * Whether `value` matches a list pattern: `*` matches anything, a leading or
 * trailing `*` matches a suffix or prefix, both match a substring, and
 * anything else must be equal. Case-insensitive.
 */
export function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === '*') return true
  const lower = value.toLowerCase()
  if (pattern.startsWith('*') && pattern.endsWith('*')) {
    return lower.includes(pattern.slice(1, -1).toLowerCase())
  }
  if (pattern.startsWith('*')) return lower.endsWith(pattern.slice(1).toLowerCase())
  if (pattern.endsWith('*')) return lower.startsWith(pattern.slice(0, -1).toLowerCase())
  return lower === pattern.toLowerCase()
}

/** Whether `value` matches any of `patterns`. */
export function matchesList(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPattern(value, pattern))
}

/**
 * Whether the `admin.*` IP and User-Agent allow and deny lists refuse a
 * request from `clientIp` with `userAgent`. An empty list never refuses. The
 * admin server applies this before any route, and the MCP OAuth consent page
 * before it shows or accepts a sign-in.
 */
export function isRefusedByAccessLists(
  lists: AccessLists,
  clientIp: string,
  userAgent: string,
): boolean {
  return (
    (lists.ipDenyList.length > 0 && matchesList(clientIp, lists.ipDenyList)) ||
    (lists.ipAllowList.length > 0 && !matchesList(clientIp, lists.ipAllowList)) ||
    (lists.userAgentDenyList.length > 0 && matchesList(userAgent, lists.userAgentDenyList)) ||
    (lists.userAgentAllowList.length > 0 && !matchesList(userAgent, lists.userAgentAllowList))
  )
}
