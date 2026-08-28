import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { prereadUiLocale } from '../../../src/i18n/config-preread'
import {
  isConfigParseError,
  loadRitualConfig,
  parseUiLocale,
  RitualConfigParseError,
} from '../../../src/config/ritual-config'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'
import { DEFAULT_LOCALE } from '../../../src/i18n/runtime'

// No config file is written on bind: one test asks what the pre-read does when
// the file is absent, and every other one writes its own.
let ws: BoundWorkspace
let testDir = ''
let configPath = ''

async function writeConfig(contents: string): Promise<void> {
  await fs.writeFile(configPath, contents, 'utf-8')
}

/**
 * The pre-read duplicates config knowledge on purpose — Commander's help
 * strings are registered before any async config machinery exists. This asserts
 * the duplication stays honest.
 *
 * The two answer deliberately different questions, so "agreement" is not
 * equality: the pre-read reports *what the file says* (`undefined` when the file
 * names nothing usable), while the loader reports the *effective* value and
 * materializes the `en` default either way. Keeping those distinguishable is
 * what lets OS detection outrank an unset key while an explicit
 * `uiLocale: "en"` still outranks it — see `resolveUiLocale`.
 *
 * So: whatever the pre-read returns must parse to exactly the value the loader
 * settled on, and a file the loader cannot read at all must leave the pre-read
 * declining to guess rather than preempting the loader's error.
 */
async function expectAgreement(): Promise<void> {
  const preread = prereadUiLocale(testDir)
  let loaded: Awaited<ReturnType<typeof loadRitualConfig>>
  try {
    loaded = await loadRitualConfig()
  } catch (error) {
    // A malformed file is the loader's error to report, later and loudly.
    expect(error).toBeInstanceOf(RitualConfigParseError)
    expect(preread).toBeUndefined()
    return
  }
  if (preread === undefined) {
    expect(loaded.uiLocale).toBe(DEFAULT_LOCALE)
    return
  }
  const parsed = parseUiLocale(preread)
  expect(loaded.uiLocale).toBe(isConfigParseError(parsed) ? DEFAULT_LOCALE : parsed)
}

describe('prereadUiLocale', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
    testDir = ws.dir
    configPath = path.join(testDir, 'ritual.config.json')
  })

  afterEach(async () => {
    await ws.dispose()
  })

  test('reads a configured uiLocale', async () => {
    await writeConfig(JSON.stringify({ decksDir: './decks', uiLocale: 'de-AT' }))
    expect(prereadUiLocale(testDir)).toBe('de-AT')
    await expectAgreement()
  })

  test('trims surrounding whitespace', async () => {
    await writeConfig(JSON.stringify({ uiLocale: '  ja  ' }))
    expect(prereadUiLocale(testDir)).toBe('ja')
  })

  test('returns undefined when the key is absent', async () => {
    await writeConfig(JSON.stringify({ decksDir: './decks' }))
    expect(prereadUiLocale(testDir)).toBeUndefined()
    await expectAgreement()
  })

  test('returns undefined when the file does not exist', async () => {
    expect(prereadUiLocale(testDir)).toBeUndefined()
    await expectAgreement()
  })

  test('returns undefined for a missing base dir', () => {
    expect(prereadUiLocale(path.join(testDir, 'nope'))).toBeUndefined()
  })

  test('returns undefined for invalid JSON without preempting the loader', async () => {
    await writeConfig('{ not json')
    expect(prereadUiLocale(testDir)).toBeUndefined()
    // The loader still reports the malformed file — the pre-read must not
    // swallow the error, only decline to answer.
    await expectAgreement()
  })

  test('returns undefined for a JSON document that is not an object', async () => {
    await writeConfig('["de-AT"]')
    expect(prereadUiLocale(testDir)).toBeUndefined()
    await expectAgreement()
  })

  test('returns undefined for a non-string uiLocale', async () => {
    await writeConfig(JSON.stringify({ uiLocale: 42 }))
    expect(prereadUiLocale(testDir)).toBeUndefined()
    await expectAgreement()
  })

  test('returns undefined for an empty uiLocale', async () => {
    await writeConfig(JSON.stringify({ uiLocale: '   ' }))
    expect(prereadUiLocale(testDir)).toBeUndefined()
    await expectAgreement()
  })

  test('does not validate the tag — the authoritative parser still gets to reject it', async () => {
    await writeConfig(JSON.stringify({ uiLocale: 'not a tag' }))
    expect(prereadUiLocale(testDir)).toBe('not a tag')
    // The loader warns and falls back to English; the pre-read reported the raw
    // value rather than pretending the key was absent.
    await expectAgreement()
  })

  test('never throws, whatever is on disk', async () => {
    for (const contents of ['', 'null', '0', '"de"', '{}', '{"uiLocale":null}']) {
      await writeConfig(contents)
      expect(() => prereadUiLocale(testDir)).not.toThrow()
    }
  })
})
