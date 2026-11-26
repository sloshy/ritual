import { BlockList, isIPv4, isIPv6 } from 'node:net'

/** The two address families, spelled as `node:net`'s `BlockList` takes them. */
export type IpFamily = 'ipv4' | 'ipv6'

/**
 * One IP address or CIDR range: an address and how many of its leading bits
 * must match. A bare address is a range of its full width (`/32`, `/128`).
 */
export type IpRange = {
  /** The address in its canonical spelling (see {@link parseIpRange}). */
  readonly address: string
  readonly prefix: number
  readonly family: IpFamily
}

/**
 * Why a text is not an IP range a proxy may be listed by:
 *
 * - `address`: its address part is not an IP address (a host name, a zone id,
 *   an IPv4 octet with a leading zero, an empty entry);
 * - `prefix`: its `/prefix` is not a whole number within the family's width;
 * - `too-wide`: it would match every address of a family — a `/0`, or an IPv6
 *   range that holds the whole IPv4-mapped block `::ffff:0:0/96` (through
 *   which a dual-stack listener reports every IPv4 peer).
 */
export type IpRangeProblem = 'address' | 'prefix' | 'too-wide'

/** The full width of an address of each family. */
const FAMILY_BITS: Readonly<Record<IpFamily, number>> = { ipv4: 32, ipv6: 128 }

/** The bits of an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) ahead of its IPv4 part. */
const MAPPED_PREFIX_BITS = 96

/** The first six 16-bit groups of every IPv4-mapped address: `0:0:0:0:0:ffff`. */
const MAPPED_HEAD: readonly number[] = [0, 0, 0, 0, 0, 0xffff]

/** The family of a bare address, or `undefined` when it is not one. */
function familyOf(address: string): IpFamily | undefined {
  if (isIPv4(address)) return 'ipv4'
  // A zone id (`fe80::1%eth0`) names an interface on one machine; it is not an
  // address another machine can be listed by, and `BlockList` refuses it.
  if (isIPv6(address) && !address.includes('%')) return 'ipv6'
  return undefined
}

/**
 * An IPv6 address in its RFC 5952 spelling (lowercase, leading zeros and the
 * longest zero run compressed, an IPv4 tail written in hex), as the WHATWG URL
 * parser writes a host. Every spelling of one address comes out the same.
 */
function canonicalIPv6(address: string): string {
  return new URL(`http://[${address}]/`).hostname.slice(1, -1)
}

/** The eight 16-bit groups of a canonical (hex-only) IPv6 address. */
function ipv6Groups(canonical: string): number[] {
  const [head = '', tail = ''] = canonical.split('::')
  const parse = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16))
  const headGroups = parse(head)
  if (!canonical.includes('::')) return headGroups
  const tailGroups = parse(tail)
  const zeros = Array<number>(8 - headGroups.length - tailGroups.length).fill(0)
  return [...headGroups, ...zeros, ...tailGroups]
}

/** Whether the first `prefix` bits of two group lists agree. */
function samePrefix(a: readonly number[], b: readonly number[], prefix: number): boolean {
  for (let bit = 0; bit < prefix; bit += 1) {
    const group = Math.floor(bit / 16)
    const mask = 0x8000 >> (bit % 16)
    if (((a[group] ?? 0) & mask) !== ((b[group] ?? 0) & mask)) return false
  }
  return true
}

/**
 * Parse an IP address (`192.0.2.10`, `2001:db8::1`) or a CIDR range
 * (`10.0.0.0/8`, `fd00::/8`), surrounding spaces ignored. The IPv6 address is
 * canonicalized first, so every spelling is judged alike. Then:
 *
 * - an IPv4-mapped range (`::ffff:10.0.0.0/104`, `::ffff:a00:0/104`) is the
 *   IPv4 range it means (`10.0.0.0/8`);
 * - a `/0`, or an IPv6 range that holds all of `::ffff:0:0/96`, is refused as
 *   `too-wide`.
 */
export function parseIpRange(text: string): IpRange | IpRangeProblem {
  const trimmed = text.trim()
  const slash = trimmed.indexOf('/')
  const written = (slash === -1 ? trimmed : trimmed.slice(0, slash)).toLowerCase()
  const family = familyOf(written)
  if (family === undefined) return 'address'
  const bits = FAMILY_BITS[family]
  let prefix = bits
  if (slash !== -1) {
    const prefixText = trimmed.slice(slash + 1)
    if (!/^\d{1,3}$/.test(prefixText)) return 'prefix'
    prefix = Number(prefixText)
    if (prefix > bits) return 'prefix'
  }
  if (family === 'ipv4') return prefix === 0 ? 'too-wide' : { address: written, prefix, family }
  const address = canonicalIPv6(written)
  const groups = ipv6Groups(address)
  if (samePrefix(groups, MAPPED_HEAD, Math.min(prefix, MAPPED_PREFIX_BITS))) {
    // Inside (or around) the IPv4-mapped block.
    if (prefix <= MAPPED_PREFIX_BITS) return 'too-wide'
    const [high = 0, low = 0] = groups.slice(6)
    const ipv4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
    return { address: ipv4, prefix: prefix - MAPPED_PREFIX_BITS, family: 'ipv4' }
  }
  return prefix === 0 ? 'too-wide' : { address, prefix, family }
}

/**
 * A bare IP address in a comparable spelling (brackets dropped, lowercased),
 * or `null` when the text is not one: what a forwarding header's entry must be
 * before it is used as a client address.
 */
export function bareAddress(text: string): string | null {
  const bare = text
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
  return familyOf(bare) === undefined ? null : bare
}

/** Whether {@link parseIpRange} refused a text. */
export function isIpRangeProblem(value: IpRange | IpRangeProblem): value is IpRangeProblem {
  return typeof value === 'string'
}

/** A range in its canonical spelling: the bare address for a full-width range, else `address/prefix`. */
export function formatIpRange(range: IpRange): string {
  return range.prefix === FAMILY_BITS[range.family]
    ? range.address
    : `${range.address}/${range.prefix}`
}

/**
 * A set of ranges an address can be tested against. Matching is `node:net`'s
 * `BlockList`, which also matches an IPv4-mapped IPv6 address
 * (`::ffff:10.0.0.1`) against an IPv4 range.
 */
export type IpRangeSet = {
  /** Whether `address` (a bare address, as a server reports a peer) is in any range. */
  contains(address: string): boolean
}

/** Build an {@link IpRangeSet} from parsed ranges. */
export function ipRangeSet(ranges: readonly IpRange[]): IpRangeSet {
  const list = new BlockList()
  for (const range of ranges) list.addSubnet(range.address, range.prefix, range.family)
  return {
    contains(address) {
      const bare = bareAddress(address)
      return bare !== null && list.check(bare, familyOf(bare) ?? 'ipv4')
    },
  }
}
