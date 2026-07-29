import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { handleGetConfig, handleUpdateConfig } from '../../src/admin/api/config'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'

/**
 * The subset of the effective config these tests read back. Deliberately
 * partial — the handler returns the whole `RitualConfig`.
 */
type ConfigView = {
  site?: { bannedPrintings?: string[] }
  defaultCurrency?: string
  cacheLockTimeoutSeconds?: number
  cacheSource?: string
  cacheFeedUrl?: string
  searchDebounceMs?: number
  exportPresets?: Record<string, { format?: string }>
  admin?: { gitEnabled?: boolean; rateLimitEnabled?: boolean; rateLimitMaxAttempts?: number }
  collectionSync?: { pullTarget?: string }
}

type AcceptedConfigUpdate = {
  label: string
  update: Record<string, unknown>
  read: (config: ConfigView) => unknown
  expected: unknown
}

type RejectedConfigUpdate = {
  label: string
  update: Record<string, unknown>
}

function putConfig(config: Record<string, unknown>): Promise<Response> {
  // The route takes the partial config object as the body itself (that is what
  // the `update_config` MCP tool and the admin Settings page both send).
  const body = JSON.stringify(config)
  return handleUpdateConfig(
    new Request('http://admin/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
      body,
    }),
  )
}

async function readConfig(): Promise<ConfigView> {
  const data = (await (await handleGetConfig()).json()) as { config: ConfigView }
  return data.config
}

describe('PUT /api/config', () => {
  let workspace: BoundWorkspace

  beforeEach(async () => {
    workspace = await bindWorkspace({ init: true })
  })
  afterEach(async () => {
    await workspace.dispose()
  })

  test('accepts valid values and returns them normalized', async () => {
    const cases: AcceptedConfigUpdate[] = [
      {
        label: 'bannedPrintings (set codes lowercased)',
        update: { site: { bannedPrintings: ['SLD:123', 'mh2:42'] } },
        read: (config) => config.site?.bannedPrintings,
        expected: ['sld:123', 'mh2:42'],
      },
      {
        label: 'defaultCurrency (case normalized)',
        update: { defaultCurrency: 'EUR' },
        read: (config) => config.defaultCurrency,
        expected: 'eur',
      },
      {
        label: 'cacheLockTimeoutSeconds',
        update: { cacheLockTimeoutSeconds: 120 },
        read: (config) => config.cacheLockTimeoutSeconds,
        expected: 120,
      },
      {
        label: 'cacheSource',
        update: { cacheSource: 'feed' },
        read: (config) => config.cacheSource,
        expected: 'feed',
      },
      {
        label: 'cacheFeedUrl',
        update: { cacheFeedUrl: 'https://feed.example/feed.json' },
        read: (config) => config.cacheFeedUrl,
        expected: 'https://feed.example/feed.json',
      },
      {
        // The Settings page PUTs the whole config back, so this key has to be on
        // the allowlist or every save would 400.
        label: 'collectionSync.pullTarget (trimmed)',
        update: { collectionSync: { pullTarget: '  Red Binder ' } },
        read: (config) => config.collectionSync?.pullTarget,
        expected: 'Red Binder',
      },
      {
        label: 'searchDebounceMs',
        update: { searchDebounceMs: 250 },
        read: (config) => config.searchDebounceMs,
        expected: 250,
      },
      {
        label: 'exportPresets',
        update: { exportPresets: { trades: { format: 'csv', columns: ['name', 'set'] } } },
        read: (config) => config.exportPresets?.trades?.format,
        expected: 'csv',
      },
    ]

    for (const { label, update, read, expected } of cases) {
      const response = await putConfig(update)
      expect({ label, ok: response.ok }).toEqual({ label, ok: true })
      expect({ label, value: read(await readConfig()) }).toEqual({ label, value: expected })
    }
  })

  test('rejects invalid values with a 400 and persists none of them', async () => {
    const cases: RejectedConfigUpdate[] = [
      { label: 'negative searchDebounceMs', update: { searchDebounceMs: -1 } },
      { label: 'non-object exportPresets', update: { exportPresets: 42 } },
      {
        label: 'malformed bannedPrintings entry',
        update: { site: { bannedPrintings: ['not-a-printing'] } },
      },
      { label: 'invalid defaultCurrency', update: { defaultCurrency: 'gbp' } },
      { label: 'non-positive cacheLockTimeoutSeconds', update: { cacheLockTimeoutSeconds: 0 } },
      { label: 'invalid cacheSource', update: { cacheSource: 'torrent' } },
      {
        label: 'non-http(s) cacheFeedUrl',
        update: { cacheFeedUrl: 'ftp://feed.example/feed.json' },
      },
      {
        label: 'blank collectionSync.pullTarget',
        update: { collectionSync: { pullTarget: '   ' } },
      },
      { label: 'unknown top-level key', update: { bogusKey: true } },
      // Unknown nested admin keys must be rejected, not spread verbatim into
      // the persisted config (parseAdminConfig silently ignores them).
      { label: 'unknown nested admin key', update: { admin: { gitEnabled: true, bogusKey: 1 } } },
      { label: 'wrong-typed admin field', update: { admin: { gitEnabled: 'yes' } } },
      { label: 'wrong-typed directory key', update: { decksDir: 42 } },
    ]

    const baseline = await readConfig()
    for (const { label, update } of cases) {
      const response = await putConfig(update)
      // The handler answers every validation failure with a 400 (`badRequest`);
      // a 500 or a 2xx-with-success:false would be a different bug.
      expect({ label, status: response.status }).toEqual({ label, status: 400 })
    }
    // Nothing from the rejected batch may have been persisted.
    expect(await readConfig()).toEqual(baseline)
  })

  test('deep-merges admin fields without clobbering siblings', async () => {
    // Establish non-default siblings first: with defaults on disk, "kept the
    // current values" and "clobbered with parser defaults" are the same bytes,
    // and the merge assertion below could never fail.
    expect(
      (await putConfig({ admin: { rateLimitEnabled: false, rateLimitMaxAttempts: 9 } })).ok,
    ).toBe(true)
    expect((await putConfig({ admin: { gitEnabled: true } })).ok).toBe(true)

    const config = await readConfig()
    expect(config.admin?.gitEnabled).toBe(true)
    // Omitted admin siblings keep their current (non-default) values — only a
    // real merge can produce these.
    expect(config.admin?.rateLimitEnabled).toBe(false)
    expect(config.admin?.rateLimitMaxAttempts).toBe(9)
  })

  test('clears an existing cacheFeedUrl with an empty string', async () => {
    expect((await putConfig({ cacheFeedUrl: 'https://feed.example/feed.json' })).ok).toBe(true)
    expect((await putConfig({ cacheFeedUrl: '' })).ok).toBe(true)

    expect((await readConfig()).cacheFeedUrl).toBeUndefined()
  })
})
