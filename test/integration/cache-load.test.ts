import { test } from 'bun:test'
import { defaultCache } from '../../src/cache'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'

test('loads full cache and sleeps', async () => {
  setLogger(new MemoryLogger())
  try {
    // Trigger a load by checking if empty or getting a value
    await defaultCache.isEmpty()

    await new Promise((resolve) => setTimeout(resolve, 5000))
  } finally {
    resetLogger()
  }
}, 10000) // Increase timeout to allow for the 5s sleep
