import { test, expect } from 'bun:test'
import { defaultCache } from '../../src/cache'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'

// Smoke test: verifies the cache module can be imported and initialized without crashing.
// The sleep simulates a real-world idle period to catch async initialization issues.
test('loads full cache and sleeps', async () => {
  setLogger(new MemoryLogger())
  try {
    const empty = await defaultCache.isEmpty()
    expect(typeof empty).toBe('boolean')

    await new Promise((resolve) => setTimeout(resolve, 5000))
  } finally {
    resetLogger()
  }
}, 10000) // Increase timeout to allow for the 5s sleep
