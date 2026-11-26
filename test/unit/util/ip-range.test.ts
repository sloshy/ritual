import { describe, expect, test } from 'bun:test'
import {
  bareAddress,
  formatIpRange,
  ipRangeSet,
  isIpRangeProblem,
  parseIpRange,
  type IpRangeProblem,
} from '../../../src/util/ip-range'

/** The canonical spelling of a parsed range, or the problem as returned. */
function outcome(raw: string): string | IpRangeProblem {
  const parsed = parseIpRange(raw)
  return isIpRangeProblem(parsed) ? parsed : formatIpRange(parsed)
}

describe('parseIpRange', () => {
  test.each([
    ['192.0.2.10', '192.0.2.10'],
    [' 10.0.0.0/8 ', '10.0.0.0/8'],
    ['192.0.2.10/32', '192.0.2.10'],
    ['0.0.0.1/1', '0.0.0.1/1'],
    ['2001:DB8::/32', '2001:db8::/32'],
    ['::1/128', '::1'],
    ['2001:0DB8:0:0::1', '2001:db8::1'],
    ['fd00:0:0:0:0:0:0:0/8', 'fd00::/8'],
    // An IPv4-mapped entry is the IPv4 range it means.
    ['::ffff:10.0.0.1', '10.0.0.1'],
    ['::ffff:10.0.0.0/104', '10.0.0.0/8'],
    // The hex spelling of the same range is judged alike.
    ['::ffff:a00:0/104', '10.0.0.0/8'],
    ['0:0:0:0:0:ffff:0a00:0005', '10.0.0.5'],
    ['::ffff:7f00:1', '127.0.0.1'],
    // Ranges beside the mapped block, not holding it, are kept.
    ['::/127', '::/127'],
    ['::fffe:0:0/96', '::fffe:0:0/96'],
  ] as const)('%p is the range %p', (raw, expected) => {
    expect(outcome(raw)).toBe(expected)
  })

  test.each([
    ['', 'address'],
    ['proxy.internal', 'address'],
    ['10.0.0', 'address'],
    ['256.0.0.1', 'address'],
    ['fe80::1%eth0', 'address'],
    ['/8', 'address'],
    ['10.0.0.0/33', 'prefix'],
    ['10.0.0.0/', 'prefix'],
    ['10.0.0.0/-1', 'prefix'],
    ['10.0.0.0/8.5', 'prefix'],
    ['2001:db8::/129', 'prefix'],
    // A leading zero is refused rather than read as octal or decimal.
    ['010.0.0.1', 'address'],
    // Ranges that would match every address of a family: a /0, or an IPv6
    // range holding the whole IPv4-mapped block, through which a dual-stack
    // listener reports every IPv4 peer — in any spelling.
    ['0.0.0.0/0', 'too-wide'],
    ['10.0.0.0/0', 'too-wide'],
    ['::/0', 'too-wide'],
    ['2001:db8::/0', 'too-wide'],
    ['::/8', 'too-wide'],
    ['::/80', 'too-wide'],
    ['::ffff:0:0/96', 'too-wide'],
    ['::ffff:0.0.0.0/96', 'too-wide'],
    ['::ffff:0:0/80', 'too-wide'],
    ['0:0:0:0:0:ffff:0:0/96', 'too-wide'],
    ['::ffff:10.0.0.0/8', 'too-wide'],
  ] as const)('%p is refused (%p)', (raw, problem) => {
    expect(outcome(raw)).toBe(problem)
  })
})

describe('bareAddress', () => {
  test.each([
    ['203.0.113.9', '203.0.113.9'],
    [' [2001:DB8::1] ', '2001:db8::1'],
    ['unknown', null],
    ['203.0.113.9:5678', null],
    ['', null],
  ] as const)('%p → %p', (text, expected) => {
    expect(bareAddress(text)).toBe(expected)
  })
})

describe('ipRangeSet across families', () => {
  test('an IPv4 peer is not inside an IPv6 range, nor the other way round', () => {
    const v6 = parseIpRange('fd00::/8')
    const v4 = parseIpRange('10.0.0.0/8')
    if (isIpRangeProblem(v6) || isIpRangeProblem(v4)) throw new Error('fixture is not a range')
    expect(ipRangeSet([v6]).contains('10.0.0.1')).toBeFalse()
    expect(ipRangeSet([v4]).contains('fd00::1')).toBeFalse()
    // …but an IPv4-mapped peer, in either spelling, is its IPv4 address.
    expect(ipRangeSet([v4]).contains('::ffff:a00:5')).toBeTrue()
    expect(ipRangeSet([v4]).contains('::ffff:10.0.0.5')).toBeTrue()
  })

  test('a hex-spelled mapped loopback peer matches 127.0.0.0/8', () => {
    const loopback = parseIpRange('127.0.0.0/8')
    if (isIpRangeProblem(loopback)) throw new Error('fixture is not a range')
    expect(ipRangeSet([loopback]).contains('::ffff:7f00:1')).toBeTrue()
    expect(ipRangeSet([loopback]).contains('::ffff:a00:5')).toBeFalse()
  })
})

describe('ipRangeSet', () => {
  const parsed = (raw: string) => {
    const range = parseIpRange(raw)
    if (isIpRangeProblem(range)) throw new Error(`fixture ${raw} is not a range`)
    return range
  }
  const set = ipRangeSet(['10.1.0.0/16', '192.0.2.7', 'fd00:1::/32'].map(parsed))

  test.each([
    ['10.1.255.3', true],
    ['10.2.0.1', false],
    ['192.0.2.7', true],
    ['192.0.2.8', false],
    // A dual-stack listener reports an IPv4 peer IPv4-mapped.
    ['::ffff:10.1.0.9', true],
    ['::ffff:10.2.0.9', false],
    ['fd00:1:abcd::5', true],
    ['[fd00:1::5]', true],
    ['fd00:2::5', false],
    // A hex-spelled mapped peer is the same IPv4 address.
    ['::ffff:a01:9', true],
    ['::ffff:a02:9', false],
    ['unknown', false],
    ['fd00:1::5%eth0', false],
  ] as const)('%p is in the set → %p', (address, expected) => {
    expect(set.contains(address)).toBe(expected)
  })
})
