import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { refreshCardCache, resolveFeedUrl } from '../../src/cache/refresh-source'
import { refreshRitualConfig } from '../../src/config/ritual-config'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'

let ws: BoundWorkspace
let configPath: string

const FEED_URL = 'https://feed.example/feed.json'

/** Whether the logger holds a warning whose text includes `text`. */
function warned(logger: MemoryLogger, text: string): boolean {
  return logger.entries.some(
    (entry) =>
      entry.level === 'warn' && typeof entry.args[0] === 'string' && entry.args[0].includes(text),
  )
}

describe('resolveFeedUrl', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
    configPath = path.join(ws.dir, 'ritual.config.json')
  })

  afterEach(async () => {
    await ws.dispose()
  })

  // There is no public feed, so there is no built-in default to fall back to.
  test('is undefined when neither explicit nor config is set', async () => {
    await refreshRitualConfig()
    expect(resolveFeedUrl()).toBeUndefined()
  })

  test('uses the configured cacheFeedUrl when no explicit URL is given', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({ cacheFeedUrl: 'https://feed.example/feed.json' }),
    )
    await refreshRitualConfig()
    expect(resolveFeedUrl()).toBe('https://feed.example/feed.json')
  })

  test('an explicit URL always wins over the configured cacheFeedUrl', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({ cacheFeedUrl: 'https://feed.example/feed.json' }),
    )
    await refreshRitualConfig()
    expect(resolveFeedUrl('https://explicit.example/feed.json')).toBe(
      'https://explicit.example/feed.json',
    )
  })

  test('an explicit URL wins even when no config has been loaded', () => {
    expect(resolveFeedUrl('https://explicit.example/feed.json')).toBe(
      'https://explicit.example/feed.json',
    )
  })
})

describe('refreshCardCache', () => {
  afterEach(() => {
    resetLogger()
  })

  test('scryfall source goes straight to the Scryfall preload', async () => {
    const calls: string[] = []
    await refreshCardCache({
      source: 'scryfall',
      feedRefresh: async () => {
        calls.push('feed')
        return 'ingested'
      },
      scryfallPreload: async () => {
        calls.push('scryfall')
      },
    })
    expect(calls).toEqual(['scryfall'])
  })

  test('feed source uses the feed and skips Scryfall', async () => {
    const calls: string[] = []
    await refreshCardCache({
      source: 'feed',
      url: FEED_URL,
      feedRefresh: async () => {
        calls.push('feed')
        return 'unchanged'
      },
      scryfallPreload: async () => {
        calls.push('scryfall')
      },
    })
    expect(calls).toEqual(['feed'])
  })

  test('an explicit url with no explicit source implies the feed source', async () => {
    const calls: string[] = []
    const feedUrls: (string | undefined)[] = []
    await refreshCardCache({
      url: 'https://explicit.example/feed.json',
      feedRefresh: async (url) => {
        calls.push('feed')
        feedUrls.push(url)
        return 'ingested'
      },
      scryfallPreload: async () => {
        calls.push('scryfall')
      },
    })
    expect(calls).toEqual(['feed'])
    expect(feedUrls).toEqual(['https://explicit.example/feed.json'])
  })

  test('force threads through to the feed refresh', async () => {
    const forcedFlags: (boolean | undefined)[] = []
    await refreshCardCache({
      source: 'feed',
      url: FEED_URL,
      force: true,
      feedRefresh: async (_url, force) => {
        forcedFlags.push(force)
        return 'ingested'
      },
      scryfallPreload: async () => {},
    })
    expect(forcedFlags).toEqual([true])
  })

  test('a failing feed falls back to Scryfall with a warning', async () => {
    const logger = new MemoryLogger()
    setLogger(logger)
    const calls: string[] = []
    await refreshCardCache({
      source: 'feed',
      url: FEED_URL,
      feedRefresh: async () => {
        calls.push('feed')
        throw new Error('feed is down')
      },
      scryfallPreload: async () => {
        calls.push('scryfall')
      },
    })
    expect(calls).toEqual(['feed', 'scryfall'])
    expect(warned(logger, 'feed is down')).toBeTrue()
  })

  // A config that names the feed but no URL used to try a placeholder host and
  // fall back with a DNS error; now it says what is missing.
  test('a feed source with no URL anywhere warns, naming cacheFeedUrl, and uses Scryfall', async () => {
    ws = await bindWorkspace({ dirs: [], config: { cacheSource: 'feed' } })
    await refreshRitualConfig()
    try {
      const logger = new MemoryLogger()
      setLogger(logger)
      const calls: string[] = []
      await refreshCardCache({
        feedRefresh: async () => {
          calls.push('feed')
          return 'ingested'
        },
        scryfallPreload: async () => {
          calls.push('scryfall')
        },
      })
      expect(calls).toEqual(['scryfall'])
      expect(warned(logger, 'cacheFeedUrl is not set')).toBeTrue()
    } finally {
      await ws.dispose()
    }
  })
})
