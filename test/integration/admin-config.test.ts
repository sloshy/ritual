import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { handleGetConfig, handleUpdateConfig } from '../../src/admin/api/config'
import { clearSiteSellModeOverride, setSiteSellModeOverride } from '../../src/config/ritual-config'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

/**
 * The subset of the effective config these tests read back. Deliberately
 * partial — the handler returns the whole `RitualConfig`.
 */
type ConfigView = {
  site?: { bannedPrintings?: string[]; sellMode?: boolean }
  defaultCurrency?: string
  priceSources?: string[]
  defaultLanguage?: string
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

/** The `GET /api/config` body, as much of it as these tests read. */
type ConfigBody = { config: ConfigView; overrides?: Record<string, unknown> }

function getConfig(): Promise<ConfigBody> {
  return handleGetConfig().then((response) => response.json() as Promise<ConfigBody>)
}

async function readConfig(): Promise<ConfigView> {
  return (await getConfig()).config
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
        label: 'defaultLanguage (case normalized)',
        update: { defaultLanguage: 'JA' },
        read: (config) => config.defaultLanguage,
        expected: 'ja',
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

  test('priceSources is validated and normalized like config set', async () => {
    const response = await putConfig({ priceSources: ['CardKingdom', 'cardkingdom', 'tcgplayer'] })
    expect(response.ok).toBe(true)
    expect((await readConfig()).priceSources).toEqual(['cardkingdom', 'tcgplayer'])
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
      { label: 'unknown price store', update: { priceSources: ['ebay'] } },
      { label: 'non-array priceSources', update: { priceSources: 'tcgplayer' } },
      // Aliases like "jp" are a `config set` convenience; the API takes only
      // canonical Scryfall codes.
      { label: 'invalid defaultLanguage', update: { defaultLanguage: 'jp' } },
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

  test('unsets site.sellMode when the site object omits it', async () => {
    // The Settings page's **Offer sell mode** checkbox writes `true` when ticked
    // and drops the key when unticked, rather than storing `false`. That only
    // unsets it because `site` replaces wholesale — a deep merge would keep the
    // stored `true` and the checkbox would appear to do nothing.
    expect((await putConfig({ site: { sellMode: true } })).ok).toBe(true)
    expect((await readConfig()).site?.sellMode).toBe(true)

    expect((await putConfig({ site: {} })).ok).toBe(true)

    // Absent, not `false`: `config get site.sellMode` reports it unset again
    // (exit 3), exactly as before the box was ever ticked.
    expect((await readConfig()).site).not.toHaveProperty('sellMode')
  })

  test('clears an existing cacheFeedUrl with an empty string', async () => {
    expect((await putConfig({ cacheFeedUrl: 'https://feed.example/feed.json' })).ok).toBe(true)
    expect((await putConfig({ cacheFeedUrl: '' })).ok).toBe(true)

    expect((await readConfig()).cacheFeedUrl).toBeUndefined()
  })
})

/**
 * The stored config and what the *running server* is operating with are two
 * different answers, and `--sell-mode` is what makes them differ. A client (an
 * MCP agent above all) has no other way to tell that this instance answers its
 * sell routes while `site.sellMode` is unset on disk.
 */
describe('GET /api/config session overrides', () => {
  let workspace: BoundWorkspace

  beforeEach(async () => {
    workspace = await bindWorkspace({ init: true })
  })
  afterEach(async () => {
    clearSiteSellModeOverride()
    await workspace.dispose()
  })

  test('omits the key entirely when the process follows the stored config', async () => {
    // Absence is the contract, not an empty object: a client reads "no key" as
    // "stored config is what this server runs with".
    expect(await getConfig()).not.toHaveProperty('overrides')
  })

  test('reports a --sell-mode session without disturbing the stored config', async () => {
    setSiteSellModeOverride(true)

    const body = await getConfig()

    expect(body.overrides).toEqual({ 'site.sellMode': true })
    // The stored half stays honest: the flag wrote nothing, so `site.sellMode`
    // is still unset — which is exactly the disagreement `overrides` exists to
    // report.
    expect(body.config.site?.sellMode).toBeUndefined()

    // And dropping the override takes the key back off the wire, so a client
    // polling this route sees the instance return to the stored config.
    clearSiteSellModeOverride()
    expect(await getConfig()).not.toHaveProperty('overrides')
  })
})
