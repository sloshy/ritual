import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleGetConfig } from '../../src/admin/api/config'
import { startAdminServer } from '../../src/admin/server'
import { clearSiteSellModeOverride, setSiteSellModeOverride } from '../../src/config/ritual-config'
import type { SyncMessage } from '../../src/sync/message'
import { bindWorkspace, writeConfig, type BoundWorkspace } from '../helpers/workspace'
import { keyedMessage } from '../helpers/api-message'
import { putConfig } from '../helpers/config-api'
import { pseudoCatalog, withGuardedLocaleAsync } from '../helpers/sync-text'

/**
 * The subset of the effective config these tests read back. Deliberately
 * partial — the handler returns the whole `RitualConfig`.
 */
type ConfigView = {
  site?: { bannedPrintings?: string[]; sellMode?: boolean }
  defaultPriceSource?: string
  priceSources?: string[]
  defaultCategories?: string[]
  defaultLanguage?: string
  cacheLockTimeoutSeconds?: number
  cacheSource?: string
  cacheFeedUrl?: string
  searchDebounceMs?: number
  updateCheck?: boolean
  exportPresets?: Record<string, { format?: string }>
  admin?: { gitEnabled?: boolean; rateLimitEnabled?: boolean; rateLimitMaxAttempts?: number }
  collectionSync?: { pullTarget?: string }
  managed?: { migration?: number; output?: string }
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

  test('accepts a round-tripped managed block but never takes it from the body', async () => {
    await writeConfig(workspace.dir, { managed: { migration: 1, output: 'sha256:a' } })

    // The Settings page PUTs back the whole config it read, managed included.
    const response = await putConfig({ managed: { migration: 99 }, searchDebounceMs: 250 })

    expect(response.ok).toBe(true)
    const config = await readConfig()
    expect(config.searchDebounceMs).toBe(250)
    expect(config.managed).toEqual({ migration: 1, output: 'sha256:a' })
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
        label: 'defaultPriceSource (case normalized)',
        update: { defaultPriceSource: 'CardKingdom' },
        read: (config) => config.defaultPriceSource,
        expected: 'cardkingdom',
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
        label: 'updateCheck',
        update: { updateCheck: false },
        read: (config) => config.updateCheck,
        expected: false,
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

  test('defaultCategories is validated and canonicalized like config set', async () => {
    const response = await putConfig({ defaultCategories: [' Ramp ', 'ramp', 'Board  Wipes'] })
    expect(response.ok).toBe(true)
    expect((await readConfig()).defaultCategories).toEqual(['Ramp', 'Board Wipes'])
  })

  test('rejects invalid values with a 400 and persists none of them', async () => {
    const cases: RejectedConfigUpdate[] = [
      { label: 'negative searchDebounceMs', update: { searchDebounceMs: -1 } },
      { label: 'non-boolean updateCheck', update: { updateCheck: 'no' } },
      { label: 'non-object exportPresets', update: { exportPresets: 42 } },
      {
        label: 'malformed bannedPrintings entry',
        update: { site: { bannedPrintings: ['not-a-printing'] } },
      },
      { label: 'invalid defaultPriceSource', update: { defaultPriceSource: 'usd' } },
      { label: 'unknown price store', update: { priceSources: ['ebay'] } },
      { label: 'non-array priceSources', update: { priceSources: 'tcgplayer' } },
      { label: 'malformed defaultCategories entry', update: { defaultCategories: ['a,b'] } },
      { label: 'non-array defaultCategories', update: { defaultCategories: 'Ramp' } },
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

  test('clears an existing defaultPriceSource with an empty string', async () => {
    expect((await putConfig({ defaultPriceSource: 'cardmarket' })).ok).toBe(true)
    expect((await putConfig({ defaultPriceSource: '' })).ok).toBe(true)

    expect((await readConfig()).defaultPriceSource).toBeUndefined()
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

/**
 * A config refusal reaches the admin page and MCP as English plus its key —
 * never in the server process's own UI language — with a refusal nested inside
 * another kept as a message of its own, so a client can render both halves.
 * Run under a synthetic process locale: a refusal rendered with `t()` would
 * come back pseudo-localized.
 */
describe('config refusals on the wire (Integration)', () => {
  let workspace: BoundWorkspace

  beforeEach(async () => {
    workspace = await bindWorkspace({ init: true })
  })
  afterEach(async () => {
    await workspace.dispose()
  })

  /** Run `body` with the pseudo-locale in force for the whole process. */
  function inPseudoLocale<T>(body: () => Promise<T>): Promise<T> {
    return withGuardedLocaleAsync('en-XA', pseudoCatalog(), body)
  }

  test('a PUT refusal nests the field refusal inside its section', async () => {
    const response = await inPseudoLocale(() => putConfig({ site: { ciSystem: 'gitlab' } }))
    expect(response.status).toBe(400)
    const body = (await response.json()) as SyncMessage & { success: boolean }
    expect(body.success).toBe(false)
    expect(keyedMessage(body)).toBe('site config: "ciSystem" must be "github-actions" or "manual"')
    expect(body).toMatchObject({
      messageKey: 'domain.config.inSection',
      messageParams: {
        section: 'site',
        reason: {
          messageKey: 'domain.config.mustBeEither',
          messageParams: { field: 'ciSystem', first: 'github-actions', second: 'manual' },
        },
      },
    })
  })

  test('a PUT refusal of an accepted-values list nests the list', async () => {
    const response = await inPseudoLocale(() => putConfig({ cacheSource: 'torrent' }))
    const body = (await response.json()) as SyncMessage
    expect(keyedMessage(body)).toBe('"cacheSource" must be one of: scryfall, feed')
    expect(body.messageParams).toEqual({
      field: 'cacheSource',
      values: { list: ['scryfall', 'feed'], join: 'unit' },
    })
  })

  test('a defaultCategories refusal is keyed, the category rule nested', async () => {
    const response = await inPseudoLocale(() => putConfig({ defaultCategories: ['Ramp', 'a,b'] }))
    expect(response.status).toBe(400)
    const body = (await response.json()) as SyncMessage & { success: boolean }
    expect(body.success).toBe(false)
    expect(keyedMessage(body)).toBe(
      'Invalid category "a,b": a category is non-empty plain text that cannot contain a comma or a control character.',
    )
    expect(body).toMatchObject({
      messageKey: 'domain.card.category.invalid',
      messageParams: {
        value: '"a,b"',
        rule: { messageKey: 'domain.card.category.shapeRule' },
      },
    })

    const notArray = await inPseudoLocale(() => putConfig({ defaultCategories: 'Ramp' }))
    expect(notArray.status).toBe(400)
    const notArrayBody = (await notArray.json()) as SyncMessage
    expect(notArrayBody.messageKey).toBe('domain.config.defaultCategoriesNotArray')
    expect(keyedMessage(notArrayBody)).toBe('defaultCategories must be an array of category names')
  })

  test('an exportPresets refusal is keyed, the column list’s own refusal nested', async () => {
    const response = await inPseudoLocale(() =>
      putConfig({ exportPresets: { p: { format: 'csv', columns: ['price'] } } }),
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as SyncMessage
    expect(keyedMessage(body)).toStartWith(
      'exportPresets["p"].columns: Unknown column \'price\'. Available columns: name, quantity, ',
    )
    expect(body).toMatchObject({
      messageKey: 'domain.export.problem.presetColumnsInvalid',
      messageParams: {
        preset: 'exportPresets["p"]',
        reason: {
          messageKey: 'domain.export.problem.columnUnknown',
          messageParams: { column: 'price', columns: { join: 'unit' } },
        },
      },
    })
  })

  test('a refusal worded outside the catalog is its English alone, with no key', async () => {
    // `priceSources` is validated by the pricing module, not yet converted.
    const response = await inPseudoLocale(() => putConfig({ priceSources: ['ebay'] }))
    expect(response.status).toBe(400)
    const body = (await response.json()) as SyncMessage & { success: boolean }
    expect(body).toEqual({
      success: false,
      message:
        '"priceSources" contains unknown store "ebay". Must be any of: tcgplayer, cardmarket, cardkingdom, cardhoarder',
    })
  })

  test('a config file broken by hand refuses a route with the reason nested', async () => {
    await fs.writeFile(path.join(workspace.dir, 'ritual.config.json'), '[]\n')
    const response = await inPseudoLocale(() => handleGetConfig())
    expect(response.status).toBe(500)
    const body = (await response.json()) as SyncMessage
    expect(keyedMessage(body)).toBe(
      `ritual.config.json is not valid JSON: ${path.join(workspace.dir, 'ritual.config.json')}\n` +
        '  the file must contain a JSON object\n' +
        'Fix the file (or delete it to fall back to defaults) and try again.',
    )
    expect(body.messageParams).toMatchObject({
      reason: { messageKey: 'domain.config.fileNotObject' },
    })
  })

  test('the admin server refuses every request over a broken file the same way', async () => {
    const configPath = path.join(workspace.dir, 'ritual.config.json')
    await fs.writeFile(configPath, '{ "decksDir": ')
    const body = await inPseudoLocale(async () => {
      const server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: workspace.dir })
      try {
        // Refused before any route (or the login check) is chosen.
        const response = await fetch(`http://127.0.0.1:${server.port}/api/lists`)
        expect(response.status).toBe(500)
        return (await response.json()) as SyncMessage & { success: boolean }
      } finally {
        await server.stop(true)
      }
    })
    expect(body.success).toBe(false)
    expect(body.messageKey).toBe('domain.config.fileNotJson')
    expect(keyedMessage(body)).toStartWith(
      `ritual.config.json is not valid JSON: ${configPath}\n  `,
    )
    // The parser's own complaint has no key: it rides as its text.
    expect(typeof body.messageParams?.reason).toBe('string')
  })
})
