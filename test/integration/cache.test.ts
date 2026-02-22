import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { FileCacheManager } from '../../src/cache'
import path from 'path'
import fs from 'fs/promises'
import { type PriceData } from '../../src/types'

const TEST_CACHE_DIR = path.join(process.cwd(), 'test_cache')
const TEST_CACHE_FILE = path.join(TEST_CACHE_DIR, 'test_cache.json')

describe('FileCacheManager (Integration)', () => {
  let cacheManager: FileCacheManager<'prices'>

  beforeEach(async () => {
    // Ensure clean state
    await fs.rm(TEST_CACHE_DIR, { recursive: true, force: true })
    cacheManager = new FileCacheManager(TEST_CACHE_FILE, 'prices')
  })

  afterEach(async () => {
    // Cleanup
    await fs.rm(TEST_CACHE_DIR, { recursive: true, force: true })
  })

  test('should write to file and read back', async () => {
    const data: PriceData = { latest: 10, min: 1, max: 20 }

    await cacheManager.set('Test Card', data)

    // Verify file exists
    const fileExists = await fs
      .access(TEST_CACHE_FILE)
      .then(() => true)
      .catch(() => false)
    expect(fileExists).toBe(true)

    // Verify content
    const content = await fs.readFile(TEST_CACHE_FILE, 'utf-8')
    const json = JSON.parse(content)
    expect(json.prices['Test Card'].data).toEqual(data)

    // Create new instance to ensure reading from disk
    const newManager = new FileCacheManager(TEST_CACHE_FILE, 'prices')
    const result = await newManager.get('Test Card')
    expect(result).toEqual(data)

    const timestamp = await newManager.getTimestamp('Test Card')
    expect(typeof timestamp).toBe('number')

    const lastRefreshedAt = await newManager.getLastRefreshedAt()
    expect(lastRefreshedAt).toBeNull()

    await newManager.bulkSet({
      'Bulk Card': { latest: 11, min: 2, max: 21 },
    })
    const refreshedAfterBulkSet = await newManager.getLastRefreshedAt()
    expect(typeof refreshedAfterBulkSet).toBe('number')
  })

  test('should expire items', async () => {
    // Short expiration
    const shortCache = new FileCacheManager(TEST_CACHE_FILE, 'prices', 10) // 10ms
    const data: PriceData = { latest: 100, min: 50, max: 150 }

    await shortCache.set('Expired Card', data)

    // Validate immediate read
    expect(await shortCache.get('Expired Card')).toEqual(data)

    // Wait for expiration
    await new Promise((r) => setTimeout(r, 20))

    // Read again
    const result = await shortCache.get('Expired Card')
    expect(result).toBeNull()
  })
})
