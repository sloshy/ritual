import { describe, test, expect, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { matchFinishPin, matchPrintingPin, resolveAddedLanguage } from '../../src/card/printing-pin'
import type { ScryfallCard } from '../../src/scryfall/types'
import { makeScryfallCard } from '../test-utils'
import { setBaseDir } from '../../src/config/base-dir'
import { refreshRitualConfig, resetRitualConfigCache } from '../../src/config/ritual-config'

// ── Strict printing/finish pin matching ───────────────────────────────────────

function makePrinting(
  set: string,
  collectorNumber: string,
  finishes: string[] = ['nonfoil'],
): ScryfallCard {
  return makeScryfallCard({
    id: `id-${set}-${collectorNumber}`,
    set,
    set_name: set.toUpperCase(),
    collector_number: collectorNumber,
    rarity: 'rare',
    finishes,
  })
}

describe('matchPrintingPin', () => {
  const printings = [makePrinting('lea', '161'), makePrinting('sta', '42')]

  test('matches an existing printing', () => {
    const result = matchPrintingPin('Test Card', printings, 'sta', '42')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.printing.set).toBe('sta')
  })

  test('matches set codes case-insensitively', () => {
    const upper = [makePrinting('LEA', '161')]
    const result = matchPrintingPin('Test Card', upper, 'lea', '161')
    expect(result.ok).toBe(true)
  })

  test('rejects an unknown set/collector-number pair with the available printings', () => {
    const result = matchPrintingPin('Test Card', printings, 'lea', '999')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('LEA:999')
    expect(result.message).toContain('LEA:161')
    expect(result.message).toContain('STA:42')
    expect(result.available).toEqual([
      { set: 'lea', collectorNumber: '161' },
      { set: 'sta', collectorNumber: '42' },
    ])
    expect(result.totalPrintings).toBe(2)
  })

  test('collector numbers must match exactly (no prefix matching)', () => {
    const result = matchPrintingPin('Test Card', printings, 'lea', '16')
    expect(result.ok).toBe(false)
  })

  test('lists at most 10 printings and reports the remainder count', () => {
    const many = Array.from({ length: 13 }, (_, i) => makePrinting('set', String(i + 1)))
    const result = matchPrintingPin('Test Card', many, 'set', '999')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.available).toHaveLength(10)
    expect(result.totalPrintings).toBe(13)
    expect(result.message).toContain('and 3 more')
  })

  test('reports an empty printing list distinctly', () => {
    const result = matchPrintingPin('Test Card', [], 'lea', '161')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('No printings')
    expect(result.available).toEqual([])
    expect(result.totalPrintings).toBe(0)
  })
})

describe('matchFinishPin', () => {
  test('accepts a finish the printing offers', () => {
    const result = matchFinishPin(
      'Test Card',
      makePrinting('sta', '42', ['nonfoil', 'foil']),
      'foil',
    )
    expect(result.ok).toBe(true)
  })

  test('rejects a finish the printing does not offer, listing the available ones', () => {
    const result = matchFinishPin('Test Card', makePrinting('lea', '161', ['nonfoil']), 'etched')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('LEA:161')
    expect(result.message).toContain('etched')
    expect(result.message).toContain('nonfoil')
    expect(result.available).toEqual(['nonfoil'])
  })

  test('treats missing finish data as nonfoil-only', () => {
    const result = matchFinishPin('Test Card', makePrinting('lea', '161', []), 'nonfoil')
    expect(result.ok).toBe(true)
    const foil = matchFinishPin('Test Card', makePrinting('lea', '161', []), 'foil')
    expect(foil.ok).toBe(false)
  })
})

describe('resolveAddedLanguage', () => {
  test('en collapses to undefined (a bare line means English)', () => {
    expect(resolveAddedLanguage('en')).toBeUndefined()
  })

  test('a resolved non-en language is recorded as-is', () => {
    expect(resolveAddedLanguage('ja')).toBe('ja')
  })

  describe('with a configured non-en defaultLanguage', () => {
    const testDir = path.join(import.meta.dir, '../.test-printing-pin')
    const originalCwd = process.cwd()

    afterEach(async () => {
      setBaseDir(originalCwd)
      resetRitualConfigCache()
      await fs.rm(testDir, { recursive: true, force: true })
    })

    test('an unresolved language is stamped with the configured default', async () => {
      await fs.mkdir(testDir, { recursive: true })
      await fs.writeFile(
        path.join(testDir, 'ritual.config.json'),
        JSON.stringify({ defaultLanguage: 'ja' }),
      )
      setBaseDir(testDir)
      await refreshRitualConfig()
      expect(resolveAddedLanguage(undefined)).toBe('ja')
    })
  })
})
