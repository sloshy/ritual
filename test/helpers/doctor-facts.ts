import type { CacheStatusResult } from '../../src/cache/status'
import type { DoctorContext, DoctorFacts } from '../../src/doctor/report'

/**
 * Synthetic `ritual doctor` facts: a healthy setup every check passes, judged
 * at a fixed time — shared by the verdict suite and the MCP schema samples.
 */

export const HOUR = 60 * 60 * 1000
export const NOW = Date.parse('2026-10-30T12:00:00.000Z')
export const CONTEXT: DoctorContext = { now: NOW, home: '/home/ana' }

export const FRESH_CACHE: CacheStatusResult = {
  empty: false,
  cardCount: 31_240,
  lastCardRefresh: new Date(NOW - 3 * HOUR).toISOString(),
  priceAgeHours: 3,
  priceStale: false,
  tagsPresent: true,
  source: 'local',
  cacheDir: '/home/ana/.cache/ritual',
  cacheDirSource: 'default',
  defaultLanguage: 'en',
  cardBulkType: 'default_cards',
  bulkTypeStale: false,
}

/** A healthy setup: every check passes. */
export function healthy(): DoctorFacts {
  const folder = (name: string, lists: number): DoctorFacts['workspace']['folders']['deck'] => ({
    dir: `/home/ana/mtg/${name}`,
    exists: true,
    lists,
  })
  return {
    ritual: {
      version: '0.1.0',
      build: 'release',
      install: 'binary',
      platform: 'linux',
      arch: 'x64',
      bunVersion: '1.4.4',
      issuesUrl: 'https://example.test/fork/issues',
    },
    workspace: {
      baseDir: '/home/ana/mtg',
      configFile: true,
      folders: {
        deck: folder('decks', 3),
        collection: folder('collections', 1),
        wanted: folder('wanted', 0),
      },
    },
    config: { state: 'valid', problems: [] },
    migrations: { state: 'current', remedy: null, problem: null },
    cache: {
      dir: FRESH_CACHE.cacheDir,
      dirSource: 'default',
      dirExists: true,
      server: null,
      status: FRESH_CACHE,
      problem: null,
    },
    update: {
      mode: 'on',
      latest: '0.1.0',
      checkedAt: new Date(NOW - 2 * HOUR).toISOString(),
      available: false,
    },
  }
}
