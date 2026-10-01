import { describe, expect, test } from 'bun:test'
import { isReleaseVersion, normalizeVersion } from '../../src/config/version'

describe('normalizeVersion', () => {
  describe('exact tags', () => {
    test('strips leading v from release tag', () => {
      expect(normalizeVersion('v1.2.3')).toBe('1.2.3')
    })

    test('leaves unversioned release tag unchanged', () => {
      expect(normalizeVersion('1.2.3')).toBe('1.2.3')
    })

    test('strips leading v from pre-release tag', () => {
      expect(normalizeVersion('v0.1.0-beta8')).toBe('0.1.0-beta8')
    })

    test('handles rc pre-release tag', () => {
      expect(normalizeVersion('v1.0.0-rc1')).toBe('1.0.0-rc1')
    })
  })

  describe('tag + commits ahead', () => {
    test('release tag with commits ahead', () => {
      expect(normalizeVersion('v1.2.3-5-gabcdef1')).toBe('1.2.3-dev.abcdef1')
    })

    test('pre-release tag with commits ahead', () => {
      expect(normalizeVersion('v0.1.0-beta8-39-g7af3afd')).toBe('0.1.0-beta8-dev.7af3afd')
    })

    test('rc tag with commits ahead', () => {
      expect(normalizeVersion('v1.0.0-rc1-2-gabc1234')).toBe('1.0.0-rc1-dev.abc1234')
    })
  })

  describe('fallback', () => {
    test('bare hash gets 0.0.0-dev prefix', () => {
      expect(normalizeVersion('abc1234')).toBe('0.0.0-dev.abc1234')
    })
  })
})

describe('isReleaseVersion', () => {
  test('a release-workflow build exactly at a tag is a release', () => {
    expect(isReleaseVersion(true, '1.2.3')).toBeTrue()
    expect(isReleaseVersion(true, '1.2.3-rc2')).toBeTrue()
  })

  test.each([
    ['not a release-workflow build', false, '1.2.3'],
    ['commits past a tag', true, '1.2.3-dev.abcdef'],
    ['an untagged fallback', true, '0.0.0-dev.abcdef'],
    ['an unknown version', true, '0.0.0-unknown'],
  ] as const)('%s is not a release', (_label, compiled, normalized) => {
    expect(isReleaseVersion(compiled, normalized)).toBeFalse()
  })
})
