import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { handleCollectionLoad } from '../../src/admin/api/collection-load'
import { handleDeckLoad } from '../../src/admin/api/deck-load'
import { handleDeckSave } from '../../src/admin/api/deck-save'
import { handleWantedListLoad } from '../../src/admin/api/wanted-load'
import type {
  CollectionLoadResult,
  DeckLoadResult,
  ListSummaryLoadResult,
  WantedLoadResult,
} from '../../src/admin/api/load-results'
import {
  writeCategoriesSidecar,
  writeUnreadableCategoriesSidecar,
} from '../helpers/card-categories'
import { seedCardNames } from '../test-utils'
import { callJson } from './helpers/request'
import { stubFetch, type StubbedFetch } from '../helpers/stub-fetch'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from '../helpers/workspace'

/**
 * The `?view=` short-circuit on the three list load routes.
 *
 * Filter semantics are pinned on the pure parser in
 * test/unit/admin/list-load-params.test.ts. What this covers is the part only
 * the handler can prove: that `summary` and `cards` return **before** the
 * changelog-name pass, the Scryfall card/printing/price load, and the symbol-map
 * fetch — the expensive work that makes these views worth having — and that
 * `full` is unchanged.
 */

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ config: false, clearCardCache: true })
  await writeDeckFile(ws.dir, 'burn', {
    name: 'Burn',
    frontMatter: { format: 'modern', tags: ['aggro'] },
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 4, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
          { quantity: 3, name: 'Lava Spike', cardId: 2 },
        ],
      },
      { name: 'Sideboard', cards: [{ quantity: 2, name: 'Smash to Smithereens', cardId: 3 }] },
    ],
  })
  await writeCollectionFile(ws.dir, 'binder', {
    title: 'Binder',
    entries: [
      { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
    ],
  })
  await writeWantedFile(ws.dir, 'wishlist', {
    title: 'Wishlist',
    entries: [
      { name: 'Mana Crypt', cardId: 1 },
      { name: 'Sol Ring', cardId: 2 },
    ],
  })
})

afterEach(async () => {
  await ws.dispose()
})

/** The expensive payload a cheap view must not carry. */
const EXPENSIVE_KEYS = ['cards', 'printings', 'symbolMap']

describe('view=summary', () => {
  test('a deck reports counts and none of the expensive payload', async () => {
    const { status, body } = await callJson<ListSummaryLoadResult>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn?view=summary',
    )
    expect(status).toBe(200)
    expect(body.view).toBe('summary')
    expect(body.slug).toBe('burn')
    expect(body.counts).toEqual({
      entryCount: 3,
      cardCount: 9,
      sections: [
        { name: 'Main', entryCount: 2, cardCount: 7 },
        { name: 'Sideboard', entryCount: 1, cardCount: 2 },
      ],
    })
    for (const key of [...EXPENSIVE_KEYS, 'deck']) {
      expect(Object.keys(body)).not.toContain(key)
    }
  })

  test('a collection reports counts only', async () => {
    const { body } = await callJson<ListSummaryLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=summary',
    )
    expect(body.counts.entryCount).toBe(2)
    expect(body.counts.cardCount).toBe(2)
    for (const key of [...EXPENSIVE_KEYS, 'entries']) {
      expect(Object.keys(body)).not.toContain(key)
    }
  })

  test('a wanted list reports counts only', async () => {
    const { body } = await callJson<ListSummaryLoadResult>(
      handleWantedListLoad,
      'GET',
      '/api/wanted/wishlist?view=summary',
    )
    expect(body.counts.entryCount).toBe(2)
    expect(Object.keys(body)).not.toContain('entries')
  })

  test('a summary honours the filters, so it counts what was asked for', async () => {
    const { body } = await callJson<ListSummaryLoadResult>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn?view=summary&section=Main',
    )
    expect(body.counts.entryCount).toBe(2)
    expect(body.counts.sections.map((s) => s.name)).toEqual(['Main'])
  })

  test('a summary ignores paging — the counts describe the whole filtered set', async () => {
    // `limit=1` would otherwise report "1 card", which is the client's own page
    // size dressed up as a fact about the deck and useless for deciding how many
    // pages there are.
    const { body } = await callJson<ListSummaryLoadResult>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn?view=summary&limit=1&offset=1',
    )
    expect(body.counts).toEqual({
      entryCount: 3,
      cardCount: 9,
      sections: [
        { name: 'Main', entryCount: 2, cardCount: 7 },
        { name: 'Sideboard', entryCount: 1, cardCount: 2 },
      ],
    })
  })
})

describe('view=cards', () => {
  test('a filtered deck returns the matching lines, totalCount, and its front matter', async () => {
    const { body } = await callJson<DeckLoadResult & { success: true }>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn?view=cards&section=Main&limit=1',
    )
    expect(body.view).toBe('cards')
    expect(body.deck.sections.flatMap((s) => s.cards.map((c) => c.name))).toEqual([
      'Lightning Bolt',
    ])
    // totalCount is the match count before the limit, so a client can page.
    expect(body.totalCount).toBe(2)
    // Front matter travels with the cards view: the deck save flow re-sends it,
    // and dropping it here would silently blank the file's YAML.
    expect(body.frontMatter).toMatchObject({ format: 'modern' })
    for (const key of EXPENSIVE_KEYS) expect(Object.keys(body)).not.toContain(key)
  })

  test('an unfiltered load is not partial, and carries the hash a save needs', async () => {
    const { body } = await callJson<DeckLoadResult & { success: true }>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn?view=cards',
    )
    expect(typeof body.contentHash).toBe('string')
    expect(Object.keys(body)).not.toContain('partial')
    expect(body.totalCount).toBe(3)
  })

  test('a deck cards view projects its front-matter labels default and line overrides', async () => {
    await writeDeckFile(ws.dir, 'proxies', {
      name: 'Proxies',
      frontMatter: { labels: ['proxy'] },
      cards: [
        { quantity: 1, name: 'Black Lotus', set: 'lea', collectorNumber: '232', cardId: 1 },
        {
          quantity: 1,
          name: 'Mox Pearl',
          set: 'lea',
          collectorNumber: '265',
          labels: ['proxy'],
          cardId: 2,
        },
      ],
    })
    const { body } = await callJson<DeckLoadResult & { success: true }>(
      handleDeckLoad,
      'GET',
      '/api/deck/proxies?view=cards',
    )
    expect(body.labels).toEqual(['proxy'])
    const cards = body.deck.sections.flatMap((s) => s.cards)
    expect(cards.find((c) => c.name === 'Mox Pearl')!.labels).toEqual(['proxy'])
    // No override on the other line: its effective labels are the deck default.
    expect(cards.find((c) => c.name === 'Black Lotus')!.labels).toBeUndefined()
  })

  test('a collection cards view filters by name terms', async () => {
    const { body } = await callJson<{ entries: { name: string }[]; totalCount: number }>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards&nameContains=sol',
    )
    expect(body.entries.map((e) => e.name)).toEqual(['Sol Ring'])
    expect(body.totalCount).toBe(1)
  })

  test('a wanted cards view returns its entries and section order', async () => {
    const { body } = await callJson<WantedLoadResult & { success: true }>(
      handleWantedListLoad,
      'GET',
      '/api/wanted/wishlist?view=cards',
    )
    expect(body.view).toBe('cards')
    expect(body.entries.map((e) => e.name)).toEqual(['Mana Crypt', 'Sol Ring'])
    expect(body.sectionOrder).toEqual(['Main'])
    for (const key of EXPENSIVE_KEYS) expect(Object.keys(body)).not.toContain(key)
  })
})

describe('a narrowed load is not a save payload', () => {
  test.each([
    ['a section filter', '/api/deck/burn?view=cards&section=Main'],
    ['a name filter', '/api/deck/burn?view=cards&nameContains=bolt'],
    ['a limit', '/api/deck/burn?view=cards&limit=1'],
    ['an offset', '/api/deck/burn?view=cards&offset=1'],
  ])('%s marks the body partial and withholds the content hash', async (_label, path) => {
    const { body } = await callJson<DeckLoadResult & { success: true }>(handleDeckLoad, 'GET', path)
    expect(body.partial).toBeTrue()
    expect(Object.keys(body)).not.toContain('contentHash')
  })

  test('a narrowed summary withholds the hash too', async () => {
    // A summary is not exempt: its counts describe the filtered slice, and the
    // hash is the token a save reads as "this is the whole file".
    const { body } = await callJson<ListSummaryLoadResult>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn?view=summary&section=Main',
    )
    expect(body.partial).toBeTrue()
    expect(Object.keys(body)).not.toContain('contentHash')
  })

  test('the save route refuses a body with no content hash, and says why', async () => {
    const { body: loaded } = await callJson<DeckLoadResult & { success: true }>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn?view=cards&limit=1',
    )
    // Exactly the round trip the omission exists to prevent: save back what a
    // narrowed load returned, which would leave the file holding one line.
    const { status, body } = await callJson<{ message: string }>(
      handleDeckSave,
      'POST',
      '/api/deck/burn/save',
      { changes: [], deck: loaded.deck, frontMatter: loaded.frontMatter },
    )
    expect(status).toBe(400)
    expect(body.message).toContain('partial')
    // The file still holds every line.
    const onDisk = await Bun.file(path.join(ws.dir, 'decks', 'burn.md')).text()
    expect(onDisk).toContain('Lava Spike')
    expect(onDisk).toContain('Smash to Smithereens')
  })
})

describe('view=full', () => {
  let stubbed: StubbedFetch

  beforeEach(async () => {
    // Seeding stamps the cache's bulk-refresh time too, which is what keeps the
    // full load from deciding it needs a Scryfall bulk download.
    await seedCardNames('Lightning Bolt', 'Lava Spike', 'Smash to Smithereens')
    // The only remaining external is symbology; answer it with an empty list.
    stubbed = stubFetch({ 'https://api.scryfall.com': () => Response.json({ data: [] }) })
  })

  afterEach(() => {
    stubbed.restore()
  })

  test('is the default and still carries the editor payload', async () => {
    const { body } = await callJson<Record<string, unknown>>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn',
    )
    expect(body.view).toBe('full')
    for (const key of EXPENSIVE_KEYS) expect(Object.keys(body)).toContain(key)
    expect(Object.keys(body)).toContain('lowestPriceCards')
    expect(Object.keys(body)).toContain('frontMatter')
  })

  test('filters apply in full too — the card data is loaded for the survivors only', async () => {
    const { body } = await callJson<{
      deck: { sections: { name: string }[] }
      cards: Record<string, unknown>
      totalCount: number
      partial?: true
    }>(handleDeckLoad, 'GET', '/api/deck/burn?section=Main&nameContains=bolt')
    expect(body.deck.sections.map((s) => s.name)).toEqual(['Main'])
    expect(body.totalCount).toBe(1)
    // The filtered-out names never reach the Scryfall load, which is what makes
    // a narrow filter cheap in this view rather than merely small.
    expect(Object.keys(body.cards)).toEqual(['Lightning Bolt'])
    expect(body.partial).toBeTrue()
  })
})

describe('refusals', () => {
  test('an unknown view is a 400 that names the choices', async () => {
    const { status, body } = await callJson<{ message: string }>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn?view=everything',
    )
    expect(status).toBe(400)
    expect(body.message).toContain('full, cards, summary')
  })

  test('view is matched case-insensitively, as every other enum field is', async () => {
    const { status, body } = await callJson<ListSummaryLoadResult>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn?view=Summary',
    )
    expect(status).toBe(200)
    expect(body.view).toBe('summary')
  })

  test('a malformed slug is refused the same way on all three routes', async () => {
    for (const [handler, area] of [
      [handleDeckLoad, 'deck'],
      [handleCollectionLoad, 'collection'],
      [handleWantedListLoad, 'wanted'],
    ] as const) {
      const { status, body } = await callJson<{ message: string }>(
        handler,
        'GET',
        `/api/${area}/${encodeURIComponent('../secret')}`,
      )
      expect(status).toBe(400)
      expect(body.message).toBe('Invalid list slug')
    }
  })

  test('a missing list names the way to find the real slugs', async () => {
    const { status, body } = await callJson<{ message: string }>(
      handleDeckLoad,
      'GET',
      '/api/deck/nope',
    )
    expect(status).toBe(404)
    expect(body.message).toContain('/api/lists')
  })
})

describe('warnings reach every view', () => {
  let stubbed: StubbedFetch

  beforeEach(async () => {
    // A line no parser can read, appended to the deck the fixture already wrote.
    // Every view has to report it: a list that loaded merely *shorter* than it is
    // is exactly what an unreported warning looks like from the client's side.
    const deckPath = path.join(ws.dir, 'decks', 'burn.md')
    await Bun.write(deckPath, (await Bun.file(deckPath).text()) + '\nthis is not a card line\n')
    await seedCardNames('Lightning Bolt', 'Lava Spike', 'Smash to Smithereens')
    stubbed = stubFetch({ 'https://api.scryfall.com': () => Response.json({ data: [] }) })
  })

  afterEach(() => {
    stubbed.restore()
  })

  test.each([
    ['summary', '/api/deck/burn?view=summary'],
    ['cards', '/api/deck/burn?view=cards'],
    ['full', '/api/deck/burn?view=full'],
  ])('view=%s carries the parser warning', async (_view, url) => {
    const { status, body } = await callJson<{ warnings: string[] }>(handleDeckLoad, 'GET', url)
    expect(status).toBe(200)
    expect(body.warnings).toEqual(['Skipped malformed line: this is not a card line'])
  })

  test('the save route refuses a list whose file holds an unreadable line', async () => {
    // The other half of the same guarantee: reporting the line on load is no use
    // if the next save deletes it (and recycles its &N).
    const { body: loaded } = await callJson<DeckLoadResult & { success: true }>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn?view=cards',
    )
    const { status, body } = await callJson<{ message: string }>(
      handleDeckSave,
      'POST',
      '/api/deck/burn/save',
      {
        changes: [],
        deck: loaded.deck,
        frontMatter: loaded.frontMatter,
        contentHash: loaded.contentHash,
      },
    )
    expect(status).toBe(400)
    expect(body.message).toContain('holds content the parser cannot re-emit')
    expect(body.message).toContain('this is not a card line')
    // The file is exactly as it was.
    expect(await Bun.file(path.join(ws.dir, 'decks', 'burn.md')).text()).toContain(
      'this is not a card line',
    )
  })
})

describe('a fenced code block reaches the save gate', () => {
  let stubbed: StubbedFetch
  let deckPath: string
  let original: string

  beforeEach(async () => {
    // A fenced block parses cleanly — no per-line warning — but the canonical
    // re-emit cannot reproduce it, so the same gate has to refuse the save.
    deckPath = path.join(ws.dir, 'decks', 'burn.md')
    original = `${await Bun.file(deckPath).text()}\n\`\`\`\n1 Fake Card &99\n\`\`\`\n`
    await Bun.write(deckPath, original)
    await seedCardNames('Lightning Bolt', 'Lava Spike', 'Smash to Smithereens')
    stubbed = stubFetch({ 'https://api.scryfall.com': () => Response.json({ data: [] }) })
  })

  afterEach(() => {
    stubbed.restore()
  })

  test('load reports it and save refuses, leaving the file byte-identical', async () => {
    const { body: loaded } = await callJson<DeckLoadResult & { success: true }>(
      handleDeckLoad,
      'GET',
      '/api/deck/burn?view=cards',
    )
    expect(loaded.warnings).toEqual([
      'Fenced code block content (3 line(s)) — read as prose, but a whole-file rewrite would delete it',
    ])
    // The fenced card is not one of the deck's cards.
    expect(JSON.stringify(loaded.deck)).not.toContain('Fake Card')

    const { status, body } = await callJson<{ message: string }>(
      handleDeckSave,
      'POST',
      '/api/deck/burn/save',
      {
        changes: [],
        deck: loaded.deck,
        frontMatter: loaded.frontMatter,
        contentHash: loaded.contentHash,
      },
    )
    expect(status).toBe(400)
    expect(body.message).toContain('Fenced code block content (3 line(s))')
    expect(await Bun.file(deckPath).text()).toBe(original)
  })
})

describe('tags reach the load bodies', () => {
  test('every list type reports each line’s tags, canonical and without the sigil', async () => {
    // Written by hand rather than through the fixtures: the point is what the
    // *parsers* hand the routes: canonical, case kept, sorted, absent when none.
    await fs.writeFile(
      path.join(ws.dir, 'collections', 'tagged.md'),
      '# Tagged\n\n- Sol Ring (C21:240) #Ramp, binder/trade, ramp &1\n- Lightning Bolt (LEA:161) &2\n',
    )
    await fs.writeFile(
      path.join(ws.dir, 'decks', 'tagged.md'),
      '# Tagged\n\n## Main\n\n1 Sol Ring #ramp &1\n',
    )
    await fs.writeFile(
      path.join(ws.dir, 'wanted', 'tagged.md'),
      '# Tagged\n\n- Sol Ring #ramp &1\n',
    )

    const collection = await callJson<{ entries: { tags?: string[] }[] }>(
      handleCollectionLoad,
      'GET',
      '/api/collection/tagged?view=cards',
    )
    expect(collection.body.entries.map((entry) => entry.tags)).toEqual([
      ['binder/trade', 'ramp', 'Ramp'],
      undefined,
    ])

    const deck = await callJson<DeckLoadResult>(
      handleDeckLoad,
      'GET',
      '/api/deck/tagged?view=cards',
    )
    expect(deck.body.deck.sections[0]!.cards[0]!.tags).toEqual(['ramp'])

    const wanted = await callJson<WantedLoadResult>(
      handleWantedListLoad,
      'GET',
      '/api/wanted/tagged?view=cards',
    )
    expect(wanted.body.entries[0]!.tags).toEqual(['ramp'])
  })
})

describe('categories reach the load bodies', () => {
  /** The collection every case below writes a sidecar beside. */
  const binderPath = (): string => path.join(ws.dir, 'collections', 'binder.md')

  test('every list type reports the list’s categories and each card’s own', async () => {
    await writeCategoriesSidecar(path.join(ws.dir, 'decks', 'burn.md'), ['Burn'], {
      'Lightning Bolt': ['Burn'],
    })
    await writeCategoriesSidecar(binderPath(), ['Ramp', 'Artifacts'], {
      'Sol Ring': ['Ramp', 'Artifacts'],
    })
    await writeCategoriesSidecar(path.join(ws.dir, 'wanted', 'wishlist.md'), ['Ramp'], {
      'Mana Crypt': ['Ramp'],
    })

    const deck = await callJson<DeckLoadResult>(handleDeckLoad, 'GET', '/api/deck/burn?view=cards')
    expect(deck.body.categories).toEqual({ order: ['Burn'], cards: { 'Lightning Bolt': ['Burn'] } })
    const deckCards = deck.body.deck.sections.flatMap((section) => section.cards)
    expect(deckCards.find((card) => card.name === 'Lightning Bolt')?.categories).toEqual(['Burn'])
    // Absent means none: bun's `toEqual` ignores an undefined-valued key, so the
    // key's presence is what the assertion has to look at.
    expect('categories' in deckCards.find((card) => card.name === 'Lava Spike')!).toBeFalse()

    const collection = await callJson<CollectionLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    expect(collection.body.categories?.cards).toEqual({ 'Sol Ring': ['Ramp', 'Artifacts'] })
    expect(collection.body.entries[0]!.categories).toEqual(['Ramp', 'Artifacts'])
    expect('categories' in collection.body.entries[1]!).toBeFalse()

    const wanted = await callJson<WantedLoadResult>(
      handleWantedListLoad,
      'GET',
      '/api/wanted/wishlist?view=cards',
    )
    expect(wanted.body.categories?.order).toEqual(['Ramp'])
    expect(wanted.body.entries[0]!.categories).toEqual(['Ramp'])
    expect('categories' in wanted.body.entries[1]!).toBeFalse()
  })

  test('a list with no sidecar carries neither field', async () => {
    const { body } = await callJson<Record<string, unknown>>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    expect(Object.keys(body)).not.toContain('categories')
    expect(Object.keys(body)).not.toContain('categoryWarnings')
  })

  test('an unreadable sidecar warns and blocks nothing', async () => {
    await writeUnreadableCategoriesSidecar(binderPath())
    const { status, body } = await callJson<CollectionLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    expect(status).toBe(200)
    expect(body.categoryWarnings).toHaveLength(1)
    expect(body.categoryWarnings![0]).toContain('binder.categories.json')
    // The card lines are untouched: a sidecar problem is not a `warnings` entry.
    expect(body.warnings).toEqual([])
    expect(Object.keys(body)).not.toContain('categories')
    expect(body.entries).toHaveLength(2)
  })

  test('entries for cards the list no longer holds are reported, not dropped', async () => {
    await writeCategoriesSidecar(binderPath(), ['Ramp'], {
      'Mana Crypt': ['Ramp'],
    })
    const { body } = await callJson<CollectionLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    expect(body.categoryWarnings?.[0]).toContain('Mana Crypt')
    // A read never prunes: the entry is still in the body's record.
    expect(body.categories?.cards).toEqual({ 'Mana Crypt': ['Ramp'] })
  })

  test('a list with unreadable lines skips the stale check', async () => {
    const listPath = binderPath()
    await Bun.write(listPath, (await Bun.file(listPath).text()) + '\n- (LEA:161) &9\n')
    await writeCategoriesSidecar(listPath, ['Ramp'], { 'Mana Crypt': ['Ramp'] })
    const { body } = await callJson<CollectionLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards',
    )
    // The list holds a line the parser refused, so "this name is gone" is not a
    // question a read can answer — the check is skipped rather than guessed at.
    expect(body.warnings.length).toBeGreaterThan(0)
    expect(Object.keys(body)).not.toContain('categoryWarnings')
    expect(body.categories?.cards).toEqual({ 'Mana Crypt': ['Ramp'] })
  })

  test('the stale check reads the whole list, not the filtered page', async () => {
    // Decision 0.4's real hazard: the known-names set is built from the
    // unfiltered list. Filtering `Lightning Bolt` out of the page must not make
    // its assignment look like an entry the list no longer holds.
    await writeCategoriesSidecar(binderPath(), ['Burn'], { 'Lightning Bolt': ['Burn'] })
    const { body } = await callJson<CollectionLoadResult>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=cards&nameContains=sol',
    )
    expect(Object.keys(body)).not.toContain('categoryWarnings')
    expect(body.categories?.cards).toEqual({ 'Lightning Bolt': ['Burn'] })
    // The per-card join runs over the page, so the survivor answers for itself.
    expect(body.entries).toHaveLength(1)
    expect('categories' in body.entries[0]!).toBeFalse()
  })

  test('a summary view carries neither field', async () => {
    await writeCategoriesSidecar(binderPath(), ['Ramp'], {
      'Sol Ring': ['Ramp'],
    })
    const { body } = await callJson<Record<string, unknown>>(
      handleCollectionLoad,
      'GET',
      '/api/collection/binder?view=summary',
    )
    expect(Object.keys(body)).not.toContain('categories')
    expect(Object.keys(body)).not.toContain('categoryWarnings')
  })

  describe('view=full carries them too', () => {
    let stubbed: StubbedFetch

    beforeEach(async () => {
      // The `full` arm builds its own body object, so it needs its own case —
      // and, like the suite's other full-view tests, a warm cache and a stubbed
      // symbology fetch so nothing reaches the network.
      await seedCardNames('Lightning Bolt', 'Lava Spike', 'Smash to Smithereens', 'Sol Ring')
      stubbed = stubFetch({ 'https://api.scryfall.com': () => Response.json({ data: [] }) })
    })

    afterEach(() => {
      stubbed.restore()
    })

    test('a collection’s full body carries the list’s categories and the entry’s own', async () => {
      await writeCategoriesSidecar(binderPath(), ['Ramp'], { 'Sol Ring': ['Ramp'] })
      const { body } = await callJson<CollectionLoadResult>(
        handleCollectionLoad,
        'GET',
        '/api/collection/binder?view=full',
      )
      expect(body.categories?.cards).toEqual({ 'Sol Ring': ['Ramp'] })
      expect(body.entries.find((entry) => entry.name === 'Sol Ring')?.categories).toEqual(['Ramp'])
    })

    test('a deck’s full body carries them on the deck it returns', async () => {
      await writeCategoriesSidecar(path.join(ws.dir, 'decks', 'burn.md'), ['Burn'], {
        'Lightning Bolt': ['Burn'],
      })
      const { body } = await callJson<DeckLoadResult>(
        handleDeckLoad,
        'GET',
        '/api/deck/burn?view=full',
      )
      expect(body.categories?.order).toEqual(['Burn'])
      const cards = body.deck.sections.flatMap((section) => section.cards)
      expect(cards.find((card) => card.name === 'Lightning Bolt')?.categories).toEqual(['Burn'])
    })
  })
})

describe('labels reach the load bodies', () => {
  test('a labeled collection carries the list default and per-entry overrides', async () => {
    await writeCollectionFile(ws.dir, 'labeled', {
      title: 'Labeled',
      labels: ['sale', 'trade'],
      entries: [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '240', labels: ['keep'], cardId: 1 },
        { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
      ],
    })
    const { body } = await callJson<{
      labels?: string[]
      entries: { name: string; labels?: string[] }[]
    }>(handleCollectionLoad, 'GET', '/api/collection/labeled?view=cards')
    expect(body.labels).toEqual(['sale', 'trade'])
    expect(body.entries[0]!.labels).toEqual(['keep'])
    expect(body.entries[1]!.labels).toBeUndefined()
  })

  test('wanted loads carry no labels field', async () => {
    const { body } = await callJson<Record<string, unknown>>(
      handleWantedListLoad,
      'GET',
      '/api/wanted/wishlist?view=cards',
    )
    expect('labels' in body).toBeFalse()
  })
})
