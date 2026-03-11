import { describe, test, expect } from 'bun:test'
import { StreamingLogger } from '../../src/logger'
import type { CacheProgressEvent } from '../../src/logger'

describe('StreamingLogger', () => {
  function collect(fn: (logger: StreamingLogger) => void): CacheProgressEvent[] {
    const events: CacheProgressEvent[] = []
    const logger = new StreamingLogger((event) => events.push(event))
    fn(logger)
    return events
  }

  test('parses download progress with percentage', () => {
    const events = collect((logger) => {
      logger.progress('\rDownloading: 45% (112.50/250.45 MiB)')
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.stage).toBe('download')
    expect(events[0]!.percentage).toBe(45)
    expect(events[0]!.message).toBe('Downloading: 45% (112.50/250.45 MiB)')
  })

  test('parses 0% download progress', () => {
    const events = collect((logger) => {
      logger.progress('\rDownloading: 0% (0.00/250.45 MiB)')
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.stage).toBe('download')
    expect(events[0]!.percentage).toBe(0)
  })

  test('parses 100% download progress', () => {
    const events = collect((logger) => {
      logger.progress('\rDownloading: 100% (250.45/250.45 MiB)')
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.stage).toBe('download')
    expect(events[0]!.percentage).toBe(100)
  })

  test('ignores non-download progress messages', () => {
    const events = collect((logger) => {
      logger.progress('\n')
    })

    expect(events).toHaveLength(0)
  })

  test('detects parsing stage from info', () => {
    const events = collect((logger) => {
      logger.info('Parsing JSON...')
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.stage).toBe('parse')
    expect(events[0]!.message).toBe('Parsing JSON...')
  })

  test('detects processing stage from info', () => {
    const events = collect((logger) => {
      logger.info('Processing 62000 cards...')
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.stage).toBe('process')
    expect(events[0]!.message).toContain('Processing')
  })

  test('detects save stage from info', () => {
    const events = collect((logger) => {
      logger.info('Saving to cache...')
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.stage).toBe('save')
  })

  test('detects done stage from info', () => {
    const events = collect((logger) => {
      logger.info('Done! Card cache populated.')
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.stage).toBe('done')
  })

  test('maps other info messages to info stage', () => {
    const events = collect((logger) => {
      logger.info('Fetching bulk data metadata from Scryfall...')
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.stage).toBe('info')
  })

  test('maps warn messages to info stage with prefix', () => {
    const events = collect((logger) => {
      logger.warn('Something unexpected happened')
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.stage).toBe('info')
    expect(events[0]!.message).toBe('Warning: Something unexpected happened')
  })

  test('error does not emit events', () => {
    const events = collect((logger) => {
      logger.error('Failed to fetch')
    })

    expect(events).toHaveLength(0)
  })

  test('mirrors to secondary logger', () => {
    const mirrored: string[] = []
    const mirror = {
      info: (msg?: unknown) => mirrored.push(`info:${msg}`),
      warn: (msg?: unknown) => mirrored.push(`warn:${msg}`),
      error: (msg?: unknown) => mirrored.push(`error:${msg}`),
      progress: (msg: string) => mirrored.push(`progress:${msg}`),
    }

    const events: CacheProgressEvent[] = []
    const logger = new StreamingLogger((e) => events.push(e), mirror)

    logger.info('Parsing JSON...')
    logger.progress('\rDownloading: 50% (125.00/250.00 MiB)')
    logger.error('oops')

    expect(mirrored).toEqual([
      'info:Parsing JSON...',
      'progress:\rDownloading: 50% (125.00/250.00 MiB)',
      'error:oops',
    ])
    expect(events).toHaveLength(2)
  })

  test('full cache refresh lifecycle produces correct stage sequence', () => {
    const events = collect((logger) => {
      logger.info('Fetching bulk data metadata from Scryfall...')
      logger.info('Bulk URL: https://example.com/bulk.json')
      logger.info('Download size: 250.45 MiB')
      logger.progress('\rDownloading: 0% (0.00/250.45 MiB)')
      logger.progress('\rDownloading: 50% (125.22/250.45 MiB)')
      logger.progress('\rDownloading: 100% (250.45/250.45 MiB)')
      logger.progress('\n')
      logger.info('Parsing JSON...')
      logger.info('Processing 62000 cards...')
      logger.info('Filtered out 1234 arena-only or token printings.')
      logger.info('Saving to cache...')
      logger.info('Done! Card cache populated.')
    })

    const stageSequence = events.map((e) => e.stage)
    expect(stageSequence).toEqual([
      'info', // Fetching metadata
      'info', // Bulk URL
      'info', // Download size
      'download', // 0%
      'download', // 50%
      'download', // 100%
      'parse', // Parsing JSON
      'process', // Processing cards
      'info', // Filtered out
      'save', // Saving to cache
      'done', // Done!
    ])
  })
})
