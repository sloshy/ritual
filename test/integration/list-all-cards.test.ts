import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { collectAllCards, formatAllCardsFile } from '../../src/commands/list-all-cards'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from './helpers/workspace'

describe('list-all-cards', () => {
  let ws: BoundWorkspace

  beforeEach(async () => {
    // No list subdirectories up front: the last test needs them absent.
    ws = await bindWorkspace({ dirs: [], config: false, init: true })
  })

  afterEach(async () => {
    await ws.dispose()
  })

  test('dedupes cards across decks, collections, and wanted lists', async () => {
    await writeDeckFile(ws.dir, 'sample', {
      frontMatter: { name: 'Sample Deck', format: 'commander' },
      sections: [
        {
          name: 'Commander',
          cards: [
            { quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161' },
            { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
          ],
        },
        {
          name: 'Mainboard',
          cards: [
            { quantity: 3, name: 'Counterspell', set: 'lea', collectorNumber: '55' },
            { quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161' },
          ],
        },
      ],
    })
    await writeCollectionFile(ws.dir, 'main', {
      title: 'My Collection',
      entries: [
        { name: 'Sol Ring', set: 'cmr', collectorNumber: '1' },
        { name: 'Counterspell', set: 'lea', collectorNumber: '55' },
        {
          name: 'Black Lotus',
          set: 'lea',
          collectorNumber: '232',
          finish: 'foil',
          condition: 'NM',
          note: 'first edition',
          cardId: 7,
        },
      ],
    })
    await writeWantedFile(ws.dir, 'wishlist', {
      title: 'Wishlist',
      entries: [
        { name: 'Mox Ruby', set: 'lea', collectorNumber: '265' },
        { name: 'Lightning Bolt' },
        { name: 'Black Lotus', set: 'lea', collectorNumber: '232' },
      ],
    })

    const entries = await collectAllCards()
    const keys = entries.map((e) => `${e.name}|${e.set ?? ''}|${e.collectorNumber ?? ''}`)

    // Sol Ring (LEA:161) appears in deck twice and isn't duplicated; Sol Ring
    // (CMR:1) is a separate printing.
    expect(keys.filter((k) => k === 'Sol Ring|lea|161')).toHaveLength(1)
    expect(keys.filter((k) => k === 'Sol Ring|cmr|1')).toHaveLength(1)

    // Black Lotus (LEA:232) appears in collection (with foil/NM/note) AND
    // wanted list — should still collapse to one entry, with no finish/etc.
    expect(keys.filter((k) => k === 'Black Lotus|lea|232')).toHaveLength(1)

    // Lightning Bolt with no printing AND with printing are separate entries
    expect(keys).toContain('Lightning Bolt||')
    expect(keys).toContain('Lightning Bolt|lea|161')
  })

  test('sorts entries alphabetically by name, then by set, then by collector number', async () => {
    await writeDeckFile(ws.dir, 'sample', {
      frontMatter: { name: 'S' },
      cards: [
        { quantity: 1, name: 'Sol Ring', set: 'cmr', collectorNumber: '1' },
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
        { quantity: 1, name: 'Sol Ring', set: 'lea', collectorNumber: '161' },
        { quantity: 1, name: 'Black Lotus', set: 'lea', collectorNumber: '232' },
      ],
    })

    const entries = await collectAllCards()
    expect(entries.map((e) => e.name)).toEqual([
      'Black Lotus',
      'Lightning Bolt',
      'Sol Ring',
      'Sol Ring',
    ])
    const solRings = entries.filter((e) => e.name === 'Sol Ring')
    expect(solRings.map((e) => e.set)).toEqual(['cmr', 'lea'])
  })

  test('formatAllCardsFile produces deterministic output without finish/condition/notes', () => {
    const content = formatAllCardsFile([
      { name: 'Black Lotus', set: 'lea', collectorNumber: '232' },
      { name: 'Lightning Bolt' },
      { name: 'Sol Ring', set: 'cmr', collectorNumber: '1' },
    ])
    expect(content).toBe(
      [
        '# All cards',
        '',
        '- Black Lotus (LEA:232)',
        '- Lightning Bolt',
        '- Sol Ring (CMR:1)',
        '',
      ].join('\n'),
    )
  })

  test('returns an empty list when no list directories exist', async () => {
    const entries = await collectAllCards()
    expect(entries).toEqual([])
    expect(formatAllCardsFile(entries)).toBe('# All cards\n\n')
  })
})
