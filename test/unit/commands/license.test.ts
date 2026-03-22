import { describe, expect, test } from 'bun:test'
import licenseText from '../../../LICENSE' with { type: 'text' }

describe('license text', () => {
  test('is a non-empty string', () => {
    expect(typeof licenseText).toBe('string')
    expect(licenseText.length).toBeGreaterThan(0)
  })

  test('contains AGPLv3 header', () => {
    expect(licenseText).toContain('GNU AFFERO GENERAL PUBLIC LICENSE')
    expect(licenseText).toContain('Version 3')
  })
})
