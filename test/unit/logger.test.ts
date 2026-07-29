import { afterEach, describe, expect, test } from 'bun:test'
import { getLogger, MemoryLogger, resetLogger, setLogger } from '../../src/logger'

describe('logger facade', () => {
  afterEach(() => {
    resetLogger()
  })

  test('allows overriding active logger and inspecting entries', () => {
    const logger = new MemoryLogger()
    setLogger(logger)

    getLogger().info('hello')
    getLogger().warn('warn message')
    getLogger().error('error message')
    getLogger().progress('50%')

    expect(logger.entries).toHaveLength(4)
    expect(logger.entries[0]?.level).toBe('info')
    expect(logger.entries[1]?.level).toBe('warn')
    expect(logger.entries[2]?.level).toBe('error')
    expect(logger.entries[3]?.level).toBe('progress')
  })
})
