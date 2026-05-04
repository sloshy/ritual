import { describe, expect, test } from 'bun:test'
import { applyConfigSet, SETTABLE_FIELDS } from '../../../src/commands/config-set'
import { getDefaultRitualConfig } from '../../../src/ritual-config'

const base = getDefaultRitualConfig()

describe('applyConfigSet — unknown / blocked properties', () => {
  test('returns error for unknown property', () => {
    const result = applyConfigSet(base, 'unknownProp', ['value'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('Unknown property')
      expect(result.error).toContain('unknownProp')
    }
  })

  test('includes available property list in error', () => {
    const result = applyConfigSet(base, 'notReal', ['x'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('decksDir')
    }
  })

  test('blocks "site" property', () => {
    const result = applyConfigSet(base, 'site', ['{}'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('"site"')
      expect(result.error).toContain('init-site')
    }
  })

  test('blocks "site.*" nested paths', () => {
    const result = applyConfigSet(base, 'site.ciSystem', ['github-actions'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('"site"')
    }
  })
})

describe('applyConfigSet — string properties', () => {
  test('sets a string property', () => {
    const result = applyConfigSet(base, 'decksDir', ['./my-decks'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe('./my-decks')
      expect(result.updatedConfig.decksDir).toBe('./my-decks')
    }
  })

  test('sets collectionsDir', () => {
    const result = applyConfigSet(base, 'collectionsDir', ['/abs/path'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.updatedConfig.collectionsDir).toBe('/abs/path')
    }
  })

  test('returns error when multiple values given for string property', () => {
    const result = applyConfigSet(base, 'decksDir', ['./a', './b'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('string')
      expect(result.error).toContain('2')
    }
  })

  test('returns error when --add used with string property', () => {
    const result = applyConfigSet(base, 'decksDir', ['./x'], 'add')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('--add')
      expect(result.error).toContain('array')
    }
  })

  test('returns error when --remove used with string property', () => {
    const result = applyConfigSet(base, 'decksDir', ['./x'], 'remove')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('--remove')
    }
  })
})

describe('applyConfigSet — boolean properties', () => {
  test('sets boolean to true', () => {
    const result = applyConfigSet(base, 'gitEnabled', ['true'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(true)
      expect(result.updatedConfig.gitEnabled).toBe(true)
    }
  })

  test('sets boolean to false', () => {
    const config = { ...base, gitEnabled: true }
    const result = applyConfigSet(config, 'gitEnabled', ['false'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(false)
      expect(result.updatedConfig.gitEnabled).toBe(false)
    }
  })

  test('accepts TRUE (case-insensitive)', () => {
    const result = applyConfigSet(base, 'gitEnabled', ['TRUE'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(true)
    }
  })

  test('accepts False (mixed case)', () => {
    const config = { ...base, gitAutoCommit: true }
    const result = applyConfigSet(config, 'gitAutoCommit', ['False'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(false)
    }
  })

  test('returns error for non-boolean value', () => {
    const result = applyConfigSet(base, 'gitEnabled', ['yes'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('boolean')
      expect(result.error).toContain('"true" or "false"')
      expect(result.error).toContain('"yes"')
    }
  })

  test('returns error when multiple values given for boolean property', () => {
    const result = applyConfigSet(base, 'gitEnabled', ['true', 'false'], 'replace')
    expect('error' in result).toBeTrue()
  })

  test('returns error when --add used with boolean property', () => {
    const result = applyConfigSet(base, 'gitEnabled', ['true'], 'add')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('--add')
    }
  })
})

describe('applyConfigSet — number properties', () => {
  test('sets a number property', () => {
    const result = applyConfigSet(base, 'rateLimitMaxAttempts', ['10'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(10)
      expect(result.updatedConfig.rateLimitMaxAttempts).toBe(10)
    }
  })

  test('accepts zero for failedAuthDelayMs', () => {
    const result = applyConfigSet(base, 'failedAuthDelayMs', ['0'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toBe(0)
    }
  })

  test('returns error for non-numeric string', () => {
    const result = applyConfigSet(base, 'rateLimitMaxAttempts', ['abc'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('number')
      expect(result.error).toContain('"abc"')
    }
  })

  test('returns error for empty string (Number("") would be 0 without guard)', () => {
    const result = applyConfigSet(base, 'rateLimitMaxAttempts', [''], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('empty string')
    }
  })

  test('returns error for float value', () => {
    const result = applyConfigSet(base, 'rateLimitMaxAttempts', ['1.5'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('integer')
    }
  })

  test('returns error for negative value', () => {
    const result = applyConfigSet(base, 'rateLimitMaxAttempts', ['-1'], 'replace')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('non-negative')
    }
  })

  test('returns error when multiple values given for number property', () => {
    const result = applyConfigSet(base, 'rateLimitMaxAttempts', ['5', '10'], 'replace')
    expect('error' in result).toBeTrue()
  })

  test('returns error when --remove used with number property', () => {
    const result = applyConfigSet(base, 'rateLimitWindowMinutes', ['5'], 'remove')
    expect('error' in result).toBeTrue()
    if ('error' in result) {
      expect(result.error).toContain('--remove')
    }
  })
})

describe('applyConfigSet — array properties (replace)', () => {
  test('replaces array with new values', () => {
    const config = { ...base, ipAllowList: ['10.0.0.1'] }
    const result = applyConfigSet(config, 'ipAllowList', ['192.168.1.1', '192.168.1.2'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['192.168.1.1', '192.168.1.2'])
      expect(result.updatedConfig.ipAllowList).toEqual(['192.168.1.1', '192.168.1.2'])
    }
  })

  test('deduplicates values on replace', () => {
    const result = applyConfigSet(base, 'ipAllowList', ['1.2.3.4', '1.2.3.4', '5.6.7.8'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['1.2.3.4', '5.6.7.8'])
    }
  })

  test('can set a single value replacing previous array', () => {
    const config = { ...base, ipAllowList: ['10.0.0.1', '10.0.0.2'] }
    const result = applyConfigSet(config, 'ipAllowList', ['192.168.0.1'], 'replace')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['192.168.0.1'])
    }
  })
})

describe('applyConfigSet — array properties (add)', () => {
  test('appends new values to existing array', () => {
    const config = { ...base, ipAllowList: ['10.0.0.1'] }
    const result = applyConfigSet(config, 'ipAllowList', ['10.0.0.2'], 'add')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['10.0.0.1', '10.0.0.2'])
    }
  })

  test('skips values already in the array', () => {
    const config = { ...base, ipAllowList: ['10.0.0.1'] }
    const result = applyConfigSet(config, 'ipAllowList', ['10.0.0.1', '10.0.0.2'], 'add')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['10.0.0.1', '10.0.0.2'])
    }
  })

  test('adds to an empty array', () => {
    const result = applyConfigSet(base, 'ipAllowList', ['10.0.0.1'], 'add')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['10.0.0.1'])
    }
  })

  test('adds multiple new values at once', () => {
    const result = applyConfigSet(base, 'userAgentDenyList', ['bot1', 'bot2', 'bot3'], 'add')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['bot1', 'bot2', 'bot3'])
    }
  })
})

describe('applyConfigSet — array properties (remove)', () => {
  test('removes a value from the array', () => {
    const config = { ...base, ipAllowList: ['10.0.0.1', '10.0.0.2', '10.0.0.3'] }
    const result = applyConfigSet(config, 'ipAllowList', ['10.0.0.2'], 'remove')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['10.0.0.1', '10.0.0.3'])
    }
  })

  test('removes multiple values at once', () => {
    const config = { ...base, ipDenyList: ['a', 'b', 'c', 'd'] }
    const result = applyConfigSet(config, 'ipDenyList', ['a', 'c'], 'remove')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['b', 'd'])
    }
  })

  test('silently no-ops when removing a value not present', () => {
    const config = { ...base, ipAllowList: ['10.0.0.1'] }
    const result = applyConfigSet(config, 'ipAllowList', ['10.0.0.99'], 'remove')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual(['10.0.0.1'])
    }
  })

  test('can empty an array by removing all values', () => {
    const config = { ...base, ipAllowList: ['10.0.0.1', '10.0.0.2'] }
    const result = applyConfigSet(config, 'ipAllowList', ['10.0.0.1', '10.0.0.2'], 'remove')
    expect('error' in result).toBeFalse()
    if (!('error' in result)) {
      expect(result.newValue).toEqual([])
    }
  })
})

describe('applyConfigSet — immutability', () => {
  test('does not mutate the input config', () => {
    const config = { ...base, gitEnabled: false }
    const result = applyConfigSet(config, 'gitEnabled', ['true'], 'replace')
    expect('error' in result).toBeFalse()
    expect(config.gitEnabled).toBe(false)
  })

  test('does not mutate input array properties', () => {
    const original = ['10.0.0.1']
    const config = { ...base, ipAllowList: original }
    applyConfigSet(config, 'ipAllowList', ['10.0.0.2'], 'add')
    expect(original).toEqual(['10.0.0.1'])
  })
})

describe('SETTABLE_FIELDS', () => {
  test('contains all expected top-level config keys', () => {
    const keys = Object.keys(SETTABLE_FIELDS)
    expect(keys).toContain('decksDir')
    expect(keys).toContain('collectionsDir')
    expect(keys).toContain('wantedDir')
    expect(keys).toContain('gitEnabled')
    expect(keys).toContain('gitAutoCommit')
    expect(keys).toContain('gitAutoPush')
    expect(keys).toContain('ipAllowList')
    expect(keys).toContain('rateLimitMaxAttempts')
    expect(keys).toContain('failedAuthDelayMs')
  })

  test('does not expose the site key', () => {
    expect(Object.keys(SETTABLE_FIELDS)).not.toContain('site')
  })

  test('maps array fields to string[] type', () => {
    expect(SETTABLE_FIELDS['ipAllowList']).toBe('string[]')
    expect(SETTABLE_FIELDS['ipDenyList']).toBe('string[]')
    expect(SETTABLE_FIELDS['userAgentAllowList']).toBe('string[]')
    expect(SETTABLE_FIELDS['userAgentDenyList']).toBe('string[]')
  })

  test('maps numeric fields to number type', () => {
    expect(SETTABLE_FIELDS['rateLimitMaxAttempts']).toBe('number')
    expect(SETTABLE_FIELDS['rateLimitWindowMinutes']).toBe('number')
    expect(SETTABLE_FIELDS['failedAuthDelayMs']).toBe('number')
  })
})
