import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { artSidecarPath, saveCardArt, type CardArtRef } from '../../src/list/card-art'
import { loadPriceListInputs, type PriceListInput } from '../../src/pricing/price-report'
import { loadSellListInputs } from '../../src/pricing/sell-report'
import type { ListLocation } from '../../src/list/resolve-list'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  type BoundWorkspace,
} from '../helpers/workspace'

/**
 * The shared list loader behind `ritual price` and `ritual sell`, at the one
 * layer that can prove it: real files on disk. What it covers is label
 * resolution — an entry's own `[proxy]` token, and the list front matter's
 * `labels:` default it inherits when it has none — the custom-art sidecar it
 * reads beside the card lines, and the exclusions the sell loader applies on
 * top. Pricing semantics themselves are pinned on the pure engine in
 * test/unit/price-report.test.ts.
 */

let ws: BoundWorkspace
let locations: ListLocation[]
let deckFile: string
let collectionFile: string

beforeEach(async () => {
  ws = await bindWorkspace()
  const deckPath = await writeDeckFile(ws.dir, 'burn', {
    name: 'Burn',
    frontMatter: { labels: ['proxy'] },
    cards: [
      { quantity: 1, name: 'Sol Ring', cardId: 1 },
      { quantity: 1, name: 'Lightning Bolt', cardId: 2 },
    ],
  })
  const collectionPath = await writeCollectionFile(ws.dir, 'binder', {
    labels: ['sale'],
    entries: [
      { name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 },
      { name: 'Sol Ring', set: 'c19', collectorNumber: '221', labels: ['proxy'], cardId: 2 },
      { name: 'Mox Ruby', set: 'lea', collectorNumber: '265', labels: ['keep'], cardId: 3 },
    ],
  })
  deckFile = deckPath
  collectionFile = collectionPath
  locations = [
    { type: 'deck', name: 'burn', filePath: deckPath },
    { type: 'collection', name: 'binder', filePath: collectionPath },
  ]
})

afterEach(async () => {
  await ws.dispose()
})

function entriesOf(inputs: PriceListInput[], name: string): PriceListInput['entries'] {
  return inputs.find((input) => input.name === name)!.entries
}

describe('loadPriceListInputs label resolution', () => {
  test('deck lines inherit the deck’s front-matter default labels', async () => {
    const { inputs } = await loadPriceListInputs(undefined, locations)
    expect(entriesOf(inputs, 'burn').map((entry) => entry.labels)).toEqual([['proxy'], ['proxy']])
  })

  test('collection lines take their own labels, else the list default', async () => {
    const { inputs } = await loadPriceListInputs(undefined, locations)
    expect(entriesOf(inputs, 'binder').map((entry) => entry.labels)).toEqual([
      ['sale'],
      ['proxy'],
      ['keep'],
    ])
  })
})

describe('loadPriceListInputs custom art', () => {
  test('flags the entries the list’s art sidecar names, by card id', async () => {
    await saveCardArt(
      collectionFile,
      new Map<number, CardArtRef>([[3, { url: 'https://example.com/mox.png' }]]),
    )
    await saveCardArt(deckFile, new Map<number, CardArtRef>([[2, { file: 'bolt.png' }]]))

    const { inputs, warnings } = await loadPriceListInputs(undefined, locations)
    expect(warnings).toEqual([])
    expect(entriesOf(inputs, 'binder').map((entry) => entry.hasCustomArt)).toEqual([
      undefined,
      undefined,
      true,
    ])
    expect(entriesOf(inputs, 'burn').map((entry) => entry.hasCustomArt)).toEqual([undefined, true])
  })

  test('a list with no sidecar flags nothing', async () => {
    const { inputs } = await loadPriceListInputs(undefined, locations)
    // The length first: `every` over an empty list is vacuously true, so
    // without it this would keep passing if the loader stopped returning the
    // binder's entries at all.
    expect(entriesOf(inputs, 'binder')).toHaveLength(3)
    expect(entriesOf(inputs, 'binder').every((entry) => entry.hasCustomArt === undefined)).toBe(
      true,
    )
  })

  test('an unreadable sidecar warns and leaves the lines priceable', async () => {
    await fs.writeFile(artSidecarPath(collectionFile), '{ not json')

    const { inputs, warnings } = await loadPriceListInputs(undefined, locations)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('binder: ')
    expect(warnings[0]).toContain('.art.json')
    expect(entriesOf(inputs, 'binder')).toHaveLength(3)
    expect(entriesOf(inputs, 'binder').every((entry) => entry.hasCustomArt === undefined)).toBe(
      true,
    )
  })
})

describe('loadSellListInputs proxy exclusion', () => {
  test('drops proxy entries without merging them into an identical real copy', async () => {
    const { inputs } = await loadSellListInputs(undefined, locations)
    // The two Sol Rings are the same printing, finish, and condition — only the
    // label differs, and the variant key does not carry labels, so a proxy left
    // in would be aggregated into the real copy's quantity.
    expect(entriesOf(inputs, 'binder').map((entry) => [entry.name, entry.quantity])).toEqual([
      ['Sol Ring', 1],
      ['Mox Ruby', 1],
    ])
  })

  test('a deck whose default label is proxy contributes nothing to sell', async () => {
    const { inputs } = await loadSellListInputs(undefined, locations)
    expect(entriesOf(inputs, 'burn')).toEqual([])
  })

  test('a custom-art copy is dropped like a proxy, before it can merge into a real one', async () => {
    // Card 1 is the real Sol Ring the first test keeps; giving it custom art
    // must drop it and leave the *other* Sol Ring (the proxy) dropped too, so
    // the binder is down to the one card that is still sellable.
    await saveCardArt(collectionFile, new Map<number, CardArtRef>([[1, { file: 'sol-ring.png' }]]))
    const { inputs } = await loadSellListInputs(undefined, locations)
    expect(entriesOf(inputs, 'binder').map((entry) => [entry.name, entry.quantity])).toEqual([
      ['Mox Ruby', 1],
    ])
  })
})
