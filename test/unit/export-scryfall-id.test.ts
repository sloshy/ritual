import { describe, expect, test } from 'bun:test'
import type { CardPrintingsLookup } from '../../src/card/card-printing'
import type { ExportEntry } from '../../src/export/entries'
import { columnsNeedScryfallIds, resolveExportScryfallIds } from '../../src/export/scryfall-id'
import { makeScryfallCard } from '../test-utils'

function entry(overrides: Partial<ExportEntry> = {}): ExportEntry {
  return {
    listType: 'collection',
    listName: 'Binder',
    section: 'Main',
    name: 'Lightning Bolt',
    quantity: 1,
    set: 'lea',
    collectorNumber: '161',
    fileOrder: 0,
    ...overrides,
  }
}

/** A name → printings lookup that also records which names were asked for. */
function lookup(cards: ReturnType<typeof makeScryfallCard>[]): {
  lookup: CardPrintingsLookup
  asked: string[]
} {
  const asked: string[] = []
  return {
    asked,
    lookup: (name) => {
      asked.push(name)
      return Promise.resolve(cards.filter((card) => card.name.toLowerCase() === name.toLowerCase()))
    },
  }
}

const bolt = makeScryfallCard({
  id: '1b59533a-3e38-495d-873e-2f89fbd08494',
  name: 'Lightning Bolt',
  set: 'lea',
  collector_number: '161',
})

describe('columnsNeedScryfallIds', () => {
  test('is true only when the id column is selected', () => {
    expect(columnsNeedScryfallIds(['name', 'scryfallId'])).toBe(true)
    expect(columnsNeedScryfallIds(['name', 'set', 'edition'])).toBe(false)
  })
})

describe('resolveExportScryfallIds', () => {
  test('fills in the id of the pinned printing without mutating the input', async () => {
    const input = [entry()]
    const { entries } = await resolveExportScryfallIds(input, lookup([bolt]).lookup)

    expect(entries[0]?.scryfallId).toBe('1b59533a-3e38-495d-873e-2f89fbd08494')
    expect(input[0]?.scryfallId).toBeUndefined()
  })

  test('matches the printing case-insensitively on the set code', async () => {
    const { entries } = await resolveExportScryfallIds(
      [entry({ set: 'LEA' })],
      lookup([bolt]).lookup,
    )
    expect(entries[0]?.scryfallId).toBe(bolt.id)
  })

  test('an uncached printing keeps an empty id and warns once per printing', async () => {
    const { entries, warnings } = await resolveExportScryfallIds(
      [entry(), entry({ fileOrder: 1 }), entry({ collectorNumber: '162', fileOrder: 2 })],
      lookup([]).lookup,
    )

    expect(entries.every((e) => e.scryfallId === undefined)).toBe(true)
    // Two distinct printings, three copies: one warning each, naming the printing.
    expect(warnings).toEqual([
      'No Scryfall ID for Lightning Bolt (LEA:161): the printing is not in the Scryfall cache.',
      'No Scryfall ID for Lightning Bolt (LEA:162): the printing is not in the Scryfall cache.',
    ])
  })

  test('an entry with no pinned printing has nothing to look up', async () => {
    const asked = lookup([bolt])
    const { entries, warnings } = await resolveExportScryfallIds(
      [entry({ name: 'Brainstorm', set: undefined, collectorNumber: undefined })],
      asked.lookup,
    )

    expect(entries[0]?.scryfallId).toBeUndefined()
    expect(warnings).toEqual([
      'No Scryfall ID for Brainstorm: the entry has no set and collector number.',
    ])
    expect(asked.asked).toEqual([])
  })

  test('a [ja] entry resolves the Japanese object id when the cache holds it', async () => {
    const boltJa = makeScryfallCard({
      id: '9f0a30cf-b9d6-4b7e-8a6b-2a8b1c3d4e5f',
      name: 'Lightning Bolt',
      set: 'lea',
      collector_number: '161',
      lang: 'ja',
    })
    const { entries } = await resolveExportScryfallIds(
      [entry({ language: 'ja' }), entry({ fileOrder: 1 })],
      lookup([bolt, boltJa]).lookup,
    )

    // The Japanese entry exports the Japanese object's id; the bare entry the
    // English one — the same printing, two ids.
    expect(entries[0]?.scryfallId).toBe(boltJa.id)
    expect(entries[1]?.scryfallId).toBe(bolt.id)
  })

  test('a [ja] entry falls back to the English object under an English-only cache', async () => {
    const { entries, warnings } = await resolveExportScryfallIds(
      [entry({ language: 'ja' })],
      lookup([bolt]).lookup,
    )

    expect(entries[0]?.scryfallId).toBe(bolt.id)
    expect(warnings).toEqual([])
  })

  test('looks each distinct name up once however many copies it has', async () => {
    const asked = lookup([bolt])
    await resolveExportScryfallIds(
      [entry(), entry({ fileOrder: 1 }), entry({ name: 'lightning bolt', fileOrder: 2 })],
      asked.lookup,
    )

    expect(asked.asked).toEqual(['Lightning Bolt'])
  })
})
