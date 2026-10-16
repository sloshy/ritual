import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { Mock } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { applyConfigSet, applyConfigUnset } from '../../src/config/config-fields'
import {
  loadRitualConfig,
  parseRitualConfig,
  isConfigParseError,
  savePartialRitualConfig,
  saveRitualConfig,
} from '../../src/config/ritual-config'
import { saveExportPreset } from '../../src/export/output'
import { resolveExportSettings } from '../../src/export/presets'
import { applyMigration, planMigration } from '../../src/migrate/runner'
import type { Migration } from '../../src/migrate/types'
import { renderSyncMessage, type SyncMessage } from '../../src/sync/message'
import { currentLocale, DEFAULT_LOCALE } from '../../src/i18n/runtime'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { putConfig } from '../helpers/config-api'
import { foreignLocales, withGuardedLocaleAsync } from '../helpers/sync-text'

/**
 * What the config writers put in `ritual.config.json` is the same bytes in every
 * UI language.
 *
 * The file is user data a collaborator's Ritual (in another language) reads
 * back, so no writer may let the interface language in: not a refusal's text,
 * not a reordered key. Each run below drives every writer — `config set`
 * (including `uiLocale`, canonicalized through `Intl.Locale`) and `config
 * unset`, the admin `PUT /api/config`, `export --save-preset` and a migration's
 * raw rewrite — over a hand-written file holding a value the loader warns
 * about, and asks each validator for a refusal on the way.
 *
 * Under German no catalog text changes and none of the written values is
 * locale-sensitive (the canonical tag is the same in every language), so for
 * the file's bytes that leg is a tripwire for a writer that ever starts
 * formatting a value through `Intl`. It does real work on the refusals: two of
 * them carry a `unit` list of three or more names, which German joins with
 * "und" — so their English pins that the list is joined in English, not in the
 * process's language. The pseudo-locale leg changes every message.
 */

/** The file after each writer, the English of every refusal, and how each rendered. */
type ConfigRun = {
  /** `ritual.config.json` after each step, in order. */
  snapshots: string[]
  english: string[]
  rendered: string[]
  /** The lenient loader's console warnings, as printed. */
  warnings: string[]
}

/** Hand-written, with a value and a whole block the loader warns about and resets. */
const HAND_WRITTEN = `${JSON.stringify(
  { decksDir: './decks', searchDebounceMs: -5, updateCheck: true, admin: 4 },
  null,
  2,
)}\n`

/** A migration that moves the wanted lists, as a numbered workspace migration would. */
const MOVE_WANTED: Migration = {
  id: 1,
  // A test migration: any params-free key will do for a description nobody reads.
  descriptionKey: 'cli.migrate.planHeading',
  applies: () => true,
  plan: () => Promise.resolve([{ type: 'config-set', path: ['wantedDir'], value: './wants' }]),
}

let warn: Mock<typeof console.warn>
beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
})

async function writeEverything(): Promise<ConfigRun> {
  const ws: BoundWorkspace = await bindWorkspace({ dirs: [], config: false })
  const configPath = path.join(ws.dir, 'ritual.config.json')
  const snapshots: string[] = []
  const refusals: SyncMessage[] = []
  const snap = async (): Promise<void> => {
    snapshots.push(await fs.readFile(configPath, 'utf-8'))
  }
  const refuse = (outcome: unknown): void => {
    if (!isConfigParseError(outcome)) throw new Error('expected a refusal')
    refusals.push(outcome.error)
  }
  try {
    await fs.writeFile(configPath, HAND_WRITTEN)
    warn.mockClear()

    // `config set`: a tag canonicalized through `Intl.Locale`, an array merge.
    const locale = applyConfigSet(await loadRitualConfig(), 'uiLocale', ['de-at'], 'replace')
    if ('error' in locale) throw new Error(locale.error.message)
    await saveRitualConfig(locale.updatedConfig)
    await snap()
    const stores = applyConfigSet(await loadRitualConfig(), 'priceSources', ['cardmarket'], 'add')
    if ('error' in stores) throw new Error(stores.error.message)
    await saveRitualConfig(stores.updatedConfig)
    await snap()
    refuse(applyConfigSet(await loadRitualConfig(), 'cacheSource', ['torrent'], 'replace'))
    refuse(applyConfigSet(await loadRitualConfig(), 'site.ciSystem', ['manual'], 'replace'))
    refuse(applyConfigSet(await loadRitualConfig(), 'nope', ['1'], 'replace'))

    // `config unset`.
    const unset = applyConfigUnset(await loadRitualConfig(), 'searchDebounceMs')
    if ('error' in unset) throw new Error(unset.error.message)
    await savePartialRitualConfig(unset.updatedConfig)
    await snap()

    // The admin Settings page / MCP `update_config`, one refusal and one write.
    const refused = await putConfig({ site: { ciSystem: 'gitlab' } })
    expect(refused.status).toBe(400)
    refusals.push((await refused.json()) as SyncMessage)
    const saved = await putConfig({ cacheSource: 'feed', admin: { rateLimitMaxAttempts: 9 } })
    expect(saved.status).toBe(200)
    await snap()

    // `export --save-preset`, the one fenced writer of this file.
    await saveExportPreset(
      'mine',
      resolveExportSettings(undefined, { format: 'csv', columns: ['name', 'quantity'] }),
    )
    await snap()

    // `ritual migrate`'s raw writer.
    const plan = await planMigration({
      migrations: [MOVE_WANTED],
      skills: [],
      build: { version: '0.0.0-dev.test', release: false },
    })
    if (plan.kind !== 'plan') throw new Error(`expected a plan, got ${plan.kind}`)
    await applyMigration(plan, { skills: [] })
    await snap()

    // The strict validator `migrate` runs, on a file that would stay broken.
    refuse(parseRitualConfig({ managed: { migration: 'one' } }))

    return {
      snapshots,
      english: refusals.map((message) => message.message),
      rendered: refusals.map((message) => renderSyncMessage(message)),
      warnings: warn.mock.calls.map((call) => String(call[0])),
    }
  } finally {
    await ws.dispose()
  }
}

describe('ritual.config.json bytes under a foreign UI language (Integration)', () => {
  let english: ConfigRun

  beforeAll(async () => {
    const spy = spyOn(console, 'warn').mockImplementation(() => {})
    warn = spy
    try {
      // The baseline the foreign runs compare against really is English.
      expect(currentLocale()).toBe(DEFAULT_LOCALE)
      english = await writeEverything()
    } finally {
      spy.mockRestore()
    }
  })

  test('the English run exercises every writer and refusal the pins are about', () => {
    expect(english.snapshots).toHaveLength(6)
    const last = JSON.parse(english.snapshots.at(-1) ?? '{}') as Record<string, unknown>
    // The tag is canonical, and each writer's change landed.
    expect(last).toMatchObject({
      uiLocale: 'de-AT',
      priceSources: ['tcgplayer', 'cardmarket'],
      cacheSource: 'feed',
      wantedDir: './wants',
      exportPresets: { mine: { format: 'csv', columns: ['name', 'quantity'] } },
      managed: { migration: 1 },
    })
    // `unknown[]`: the asymmetric matcher below is typed `any`.
    const expected: unknown[] = [
      '"cacheSource" must be one of: scryfall, feed',
      'The "site" property is managed by "ritual init-site" and cannot be set with "config set", except for the public-site selection lists: site.includeDecks, site.includeCollections, site.includeWantedLists, site.excludeDecks, site.excludeCollections, site.excludeWantedLists, site.bannedPrintings, site.apiBaseUrl, site.sellMode.',
      expect.stringMatching(
        /^Unknown property: "nope". Available properties: decksDir, collectionsDir, /,
      ),
      'site config: "ciSystem" must be "github-actions" or "manual"',
      'managed config: "migration" must be a non-negative integer',
    ]
    expect<unknown[]>(english.english).toEqual(expected)
    expect(english.warnings).toEqual([
      'ritual.config.json: ignoring invalid searchDebounceMs — "searchDebounceMs" must be a non-negative integer',
      'ritual.config.json: ignoring invalid admin config — admin config must be a JSON object',
    ])
  })

  test.each(foreignLocales())(
    'writes the same bytes, and refuses in the same English, under $tag',
    async ({ tag, catalog }) => {
      const localized = await withGuardedLocaleAsync(tag, catalog, () => writeEverything())
      expect(localized.snapshots).toEqual(english.snapshots)
      expect(localized.english).toEqual(english.english)
      // …while what a reader in that language sees follows it: the CLI's
      // rendering of a refusal, and the loader's console warning.
      if (tag === 'en-XA') {
        for (const [index, rendered] of localized.rendered.entries()) {
          expect(rendered).not.toBe(english.english[index])
        }
        expect(localized.warnings).toHaveLength(english.warnings.length)
        for (const line of localized.warnings) expect(english.warnings).not.toContain(line)
      } else {
        // German: the two refusals listing three or more names render with the
        // locale's "und" — so the identical English above is not vacuous.
        expect(localized.rendered[1]).not.toBe(english.english[1])
        expect(localized.rendered[2]).not.toBe(english.english[2])
      }
    },
  )
})
