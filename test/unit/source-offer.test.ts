import { describe, expect, test } from 'bun:test'
import {
  isSourceOffer,
  revisionRef,
  sourceOfferFor,
  UPSTREAM_SOURCE_URL,
} from '../../src/config/source-offer'
import { normalizeVersion, SOURCE_OFFER } from '../../src/config/version'

describe('revisionRef', () => {
  test.each([
    ['1.2.3', 'v1.2.3'],
    ['1.2.3-rc1', 'v1.2.3-rc1'],
    ['1.2.3-dev.abc1234', 'abc1234'],
    ['1.2.3-beta8-dev.abc1234', 'abc1234'],
    ['0.0.0-dev.abc1234', 'abc1234'],
  ])('%p was built from %p', (version, ref) => {
    expect(revisionRef(version)).toBe(ref)
  })

  // The contract with the producer: `git describe` refs as `normalizeVersion`
  // turns them into the version a build reports.
  test.each([
    ['v1.2.3', 'v1.2.3'],
    ['v1.2.3-rc1', 'v1.2.3-rc1'],
    ['v1.2.3-5-gabc1234', 'abc1234'],
    ['v1.2.3-beta8-5-gabc1234', 'abc1234'],
    ['abc1234', 'abc1234'],
  ])('git ref %p is linked as %p', (ref, expected) => {
    expect(revisionRef(normalizeVersion(ref))).toBe(expected)
  })

  test.each([
    '0.0.0-unknown',
    '0.0.0-dev.unknown',
    '1.2.3-dev.not-a-hash',
    '1.2.3-dev.abc123',
    `1.2.3-dev.${'a'.repeat(41)}`,
    '1.2.3-dev.ABC1234',
  ])('%p names no ref', (version) => {
    expect(revisionRef(version)).toBeNull()
  })
})

describe('sourceOfferFor', () => {
  test('a release links its tag', () => {
    expect(sourceOfferFor('1.0.0', 'https://github.com/sloshy/ritual')).toEqual({
      version: '1.0.0',
      license: 'AGPL-3.0-only',
      sourceUrl: 'https://github.com/sloshy/ritual',
      revisionUrl: 'https://github.com/sloshy/ritual/tree/v1.0.0',
    })
  })

  test('a fork with trailing slashes links its own commit', () => {
    const offer = sourceOfferFor('1.0.0-dev.abc1234', 'https://git.example.com/me/ritual//')
    expect(offer.sourceUrl).toBe('https://git.example.com/me/ritual')
    expect(offer.revisionUrl).toBe('https://git.example.com/me/ritual/tree/abc1234')
  })

  test('a version naming no ref links the repository', () => {
    expect(sourceOfferFor('0.0.0-unknown', 'https://github.com/sloshy/ritual').revisionUrl).toBe(
      'https://github.com/sloshy/ritual',
    )
  })
})

describe('isSourceOffer', () => {
  test('accepts an offer and refuses anything short of one', () => {
    const offer = sourceOfferFor('1.0.0', UPSTREAM_SOURCE_URL)
    expect(isSourceOffer(offer)).toBe(true)
    expect(isSourceOffer({ ...offer, revisionUrl: 1 })).toBe(false)
    expect(isSourceOffer({ version: '1.0.0' })).toBe(false)
    expect(isSourceOffer(null)).toBe(false)
  })
})

test('an unconfigured build offers the upstream repository', () => {
  // Unit tests run from source, where scripts/build.sh never defined
  // RITUAL_SOURCE_URL.
  expect(SOURCE_OFFER.sourceUrl).toBe(UPSTREAM_SOURCE_URL)
  expect(Object.isFrozen(SOURCE_OFFER)).toBe(true)
})
