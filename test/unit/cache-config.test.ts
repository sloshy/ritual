import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearCacheServerAddressOverride,
  getCacheServerBaseUrl,
  resolveCacheServerAddress,
  setCacheServerAddressOverride,
  toCacheServerBaseUrl,
} from '../../src/cache-config'

const originalCacheServerEnv = process.env.RITUAL_CACHE_SERVER

describe('cache server config helpers', () => {
  afterEach(() => {
    clearCacheServerAddressOverride()
    if (originalCacheServerEnv === undefined) {
      delete process.env.RITUAL_CACHE_SERVER
    } else {
      process.env.RITUAL_CACHE_SERVER = originalCacheServerEnv
    }
  })

  test('resolveCacheServerAddress prefers cli value over env var', () => {
    const resolved = resolveCacheServerAddress('127.0.0.1:4001', '127.0.0.1:4000')
    expect(resolved).toBe('127.0.0.1:4001')
  })

  test('resolveCacheServerAddress falls back to env var when cli is empty', () => {
    const resolved = resolveCacheServerAddress('   ', '127.0.0.1:4000')
    expect(resolved).toBe('127.0.0.1:4000')
  })

  test('toCacheServerBaseUrl normalizes protocol and rejects missing port', () => {
    expect(toCacheServerBaseUrl('localhost:4000')).toBe('http://localhost:4000')
    expect(toCacheServerBaseUrl('https://localhost:4443')).toBe('https://localhost:4443')
    expect(() => toCacheServerBaseUrl('localhost')).toThrow(
      'Cache server must include hostname and port',
    )
  })

  test('getCacheServerBaseUrl uses override before env var', () => {
    process.env.RITUAL_CACHE_SERVER = '127.0.0.1:4010'
    expect(getCacheServerBaseUrl()).toBe('http://127.0.0.1:4010')

    setCacheServerAddressOverride('127.0.0.1:4011')
    expect(getCacheServerBaseUrl()).toBe('http://127.0.0.1:4011')
  })
})
