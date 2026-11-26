import { describe, expect, test } from 'bun:test'
import { addressKey } from '../../../src/util/address-key'

describe('addressKey', () => {
  test.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['[2001:DB8:0001:0002::ffff]', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['fe80::1%en0', 'fe80:0:0:0::/64'],
    ['unknown', 'unknown'],
  ])('%p is keyed as %p', (address, key) => {
    expect(addressKey(address)).toBe(key)
  })

  test('two addresses in one /64 share a key; neighbouring /64s do not', () => {
    expect(addressKey('2001:db8:1:2::a')).toBe(addressKey('2001:db8:1:2:ffff::b'))
    expect(addressKey('2001:db8:1:2::a')).not.toBe(addressKey('2001:db8:1:3::a'))
  })
})
