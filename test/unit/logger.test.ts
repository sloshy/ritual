import { afterEach, describe, expect, test } from 'bun:test'
import {
  getLogger,
  MemoryLogger,
  resetLogger,
  setLogger,
  StreamingLogger,
  type CacheProgressEvent,
} from '../../src/logger'

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

describe('StreamingLogger', () => {
  function collect(fn: (logger: StreamingLogger) => void): CacheProgressEvent[] {
    const events: CacheProgressEvent[] = []
    const logger = new StreamingLogger((event) => events.push(event))
    fn(logger)
    return events
  }

  test('parses download progress with percentage', () => {
    const events = collect((logger) => {
      logger.progress('\rDownloading: 0% (0.00/250.45 MiB)')
      logger.progress('\rDownloading: 45% (112.50/250.45 MiB)')
      logger.progress('\rDownloading: 100% (250.45/250.45 MiB)')
    })

    expect(events).toHaveLength(3)
    expect(events.every((e) => e.stage === 'download')).toBeTrue()
    expect(events.map((e) => e.percentage)).toEqual([0, 45, 100])
    expect(events[1]!.message).toBe('Downloading: 45% (112.50/250.45 MiB)')
  })

  test('ignores non-download progress messages', () => {
    const events = collect((logger) => {
      logger.progress('\n')
    })

    expect(events).toHaveLength(0)
  })

  test('maps warn messages to info stage with prefix', () => {
    const events = collect((logger) => {
      logger.warn('Something unexpected happened')
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.stage).toBe('info')
    expect(events[0]!.message).toBe('Warning: Something unexpected happened')
  })

  test('error emits events', () => {
    const events = collect((logger) => {
      logger.error('Failed to fetch')
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ stage: 'info', message: 'Error: Failed to fetch' })
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

    logger.info('Saving to cache...')
    logger.progress('\rDownloading: 50% (125.00/250.00 MiB)')
    logger.error('oops')

    expect(mirrored).toEqual([
      'info:Saving to cache...',
      'progress:\rDownloading: 50% (125.00/250.00 MiB)',
      'error:oops',
    ])
    expect(events).toHaveLength(3)
  })

  test('full cache refresh lifecycle produces correct stage sequence', () => {
    // Mirrors the messages downloadBulkCards emits for the streamed JSONL bulk:
    // parsing/processing happen inline with the download, so there is no
    // separate parse/process stage anymore.
    const events = collect((logger) => {
      logger.info('Fetching bulk data metadata from Scryfall...')
      logger.info('Bulk URL: https://example.com/bulk.jsonl.gz')
      logger.info('Download size: 72.50 MiB (compressed)')
      logger.progress('\rDownloading: 0% (0.00/72.50 MiB)')
      logger.progress('\rDownloading: 50% (36.25/72.50 MiB)')
      logger.progress('\rDownloading: 100% (72.50/72.50 MiB)')
      logger.progress('\n')
      logger.info('Filtered out 1234 arena-only or token printings.')
      logger.info('Processed 62000 cards.')
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
      'info', // Filtered out
      'info', // Processed cards
      'save', // Saving to cache
      'done', // Done!
    ])
  })
})
