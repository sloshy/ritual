import { isIPv4, isIPv6 } from 'node:net'

/**
 * The key a client address is rate-limited under. An IPv4 address (including
 * one written IPv4-mapped, `::ffff:192.0.2.1`) is its own key; an IPv6
 * address is keyed by its /64, the block one subscriber is normally given, so
 * stepping through the interface half of a prefix does not buy fresh limits.
 * Anything else (`unknown`, a proxy's odd value) is used as it is.
 */
export function addressKey(address: string): string {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0] ?? address
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare)?.[1]
  if (mapped !== undefined && isIPv4(mapped)) return mapped
  if (isIPv4(bare) || !isIPv6(bare)) return bare
  const [head = '', tail = ''] = bare.toLowerCase().split('::')
  const headGroups = head === '' ? [] : head.split(':')
  const tailGroups = bare.includes('::') ? (tail === '' ? [] : tail.split(':')) : []
  const missing = 8 - headGroups.length - tailGroups.length
  const groups = bare.includes('::')
    ? [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups]
    : headGroups
  const prefix = groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, ''))
  return `${prefix.join(':')}::/64`
}
