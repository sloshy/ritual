import { describe, expect, test } from 'bun:test'
import { isRefusedByAccessLists, matchesPattern } from '../../../src/admin/access-lists'

const NONE = { ipAllowList: [], ipDenyList: [], userAgentAllowList: [], userAgentDenyList: [] }

describe('matchesPattern', () => {
  test.each([
    ['10.0.0.5', '*', true],
    ['10.0.0.5', '10.0.*', true],
    ['10.0.0.5', '*.0.5', true],
    ['Mozilla Firefox', '*FIREFOX*', true],
    ['10.0.0.5', '10.0.0.6', false],
  ])('%p against %p is %p', (value, pattern, expected) => {
    expect(matchesPattern(value, pattern)).toBe(expected)
  })
})

describe('isRefusedByAccessLists', () => {
  test('empty lists refuse nothing', () => {
    expect(isRefusedByAccessLists(NONE, '1.2.3.4', 'curl')).toBe(false)
  })

  test('a deny match or a missed allow list refuses', () => {
    expect(isRefusedByAccessLists({ ...NONE, ipDenyList: ['1.2.*'] }, '1.2.3.4', 'x')).toBe(true)
    expect(isRefusedByAccessLists({ ...NONE, ipAllowList: ['10.*'] }, '1.2.3.4', 'x')).toBe(true)
    expect(isRefusedByAccessLists({ ...NONE, ipAllowList: ['10.*'] }, '10.1.1.1', 'x')).toBe(false)
    expect(isRefusedByAccessLists({ ...NONE, userAgentDenyList: ['*bot*'] }, 'x', 'evilbot')).toBe(
      true,
    )
    expect(isRefusedByAccessLists({ ...NONE, userAgentAllowList: ['Mozilla*'] }, 'x', 'curl')).toBe(
      true,
    )
  })
})
