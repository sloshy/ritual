import { describe, expect, test } from 'bun:test'
import { compareVersions, isValidSemver } from '../../src/semver'

describe('compareVersions', () => {
  describe('major/minor/patch ordering', () => {
    test('0.1.0 < 0.2.0', () => {
      expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
    })

    test('0.2.0 > 0.1.0', () => {
      expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0)
    })

    test('0.1.0 < 0.12.0 (numeric not lexicographic)', () => {
      expect(compareVersions('0.1.0', '0.12.0')).toBeLessThan(0)
    })

    test('0.1.0 < 0.1.1', () => {
      expect(compareVersions('0.1.0', '0.1.1')).toBeLessThan(0)
    })

    test('1.0.0 > 0.99.99', () => {
      expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
    })

    test('equal release versions return 0', () => {
      expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    })

    test('strips leading v prefix', () => {
      expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    })
  })

  describe('pre-release vs release', () => {
    test('1.0.0-beta1 < 1.0.0', () => {
      expect(compareVersions('1.0.0-beta1', '1.0.0')).toBeLessThan(0)
    })

    test('1.0.0 > 1.0.0-rc1', () => {
      expect(compareVersions('1.0.0', '1.0.0-rc1')).toBeGreaterThan(0)
    })

    test('0.1.0-beta5 < 0.2.0', () => {
      expect(compareVersions('0.1.0-beta5', '0.2.0')).toBeLessThan(0)
    })
  })

  describe('pre-release ordering', () => {
    test('0.1.0-beta1 < 0.1.0-beta5', () => {
      expect(compareVersions('0.1.0-beta1', '0.1.0-beta5')).toBeLessThan(0)
    })

    test('0.1.0-beta5 < 0.1.0-rc1 (alpha < beta < rc)', () => {
      expect(compareVersions('0.1.0-beta5', '0.1.0-rc1')).toBeLessThan(0)
    })

    test('0.1.0-alpha < 0.1.0-beta', () => {
      expect(compareVersions('0.1.0-alpha', '0.1.0-beta')).toBeLessThan(0)
    })

    test('0.1.0-rc1 < 0.1.0-rc2', () => {
      expect(compareVersions('0.1.0-rc1', '0.1.0-rc2')).toBeLessThan(0)
    })

    test('0.1.0-beta10 > 0.1.0-beta2 (numeric comparison)', () => {
      expect(compareVersions('0.1.0-beta10', '0.1.0-beta2')).toBeGreaterThan(0)
    })

    test('equal pre-release versions return 0', () => {
      expect(compareVersions('1.0.0-beta5', '1.0.0-beta5')).toBe(0)
    })
  })

  describe('dev builds', () => {
    test('1.0.0-dev.abc < 1.0.0 (dev is a pre-release)', () => {
      expect(compareVersions('1.0.0-dev.abc', '1.0.0')).toBeLessThan(0)
    })

    test('1.0.1-dev.abc > 1.0.0', () => {
      expect(compareVersions('1.0.1-dev.abc', '1.0.0')).toBeGreaterThan(0)
    })
  })

  describe('the sequence specified in requirements', () => {
    test('0.1.0-beta1 < 0.1.0-rc1 < 0.1.0 < 0.2.0 < 0.12.0', () => {
      const versions = ['0.1.0-rc1', '0.12.0', '0.1.0-beta1', '0.1.0', '0.2.0']
      const sorted = [...versions].sort(compareVersions)
      expect(sorted).toEqual(['0.1.0-beta1', '0.1.0-rc1', '0.1.0', '0.2.0', '0.12.0'])
    })
  })
})

describe('isValidSemver', () => {
  test('accepts standard release versions', () => {
    expect(isValidSemver('1.0.0')).toBe(true)
    expect(isValidSemver('0.1.0')).toBe(true)
    expect(isValidSemver('1.2.3')).toBe(true)
  })

  test('accepts versions with a leading v prefix', () => {
    expect(isValidSemver('v1.0.0')).toBe(true)
    expect(isValidSemver('v0.1.0')).toBe(true)
  })

  test('accepts pre-release versions', () => {
    expect(isValidSemver('1.0.0-beta1')).toBe(true)
    expect(isValidSemver('1.0.0-rc.1')).toBe(true)
    expect(isValidSemver('1.0.0-dev.abc123')).toBe(true)
  })

  test('rejects plain words', () => {
    expect(isValidSemver('latest')).toBe(false)
    expect(isValidSemver('abc')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isValidSemver('')).toBe(false)
  })

  test('rejects partial version strings', () => {
    expect(isValidSemver('1.0')).toBe(false)
    expect(isValidSemver('1')).toBe(false)
  })

  test('rejects versions with extra leading/trailing text', () => {
    expect(isValidSemver('version-1.0.0')).toBe(false)
    expect(isValidSemver('1.0.0 ')).toBe(false)
  })
})
