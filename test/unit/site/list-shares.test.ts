import { describe, expect, test } from 'bun:test'
import {
  buildListShareKeys,
  createListShareStore,
  ensureListShares,
  listShareIndex,
  pruneOwnShareSelections,
  resetListShares,
  setListShareSource,
  shareListsExcluding,
  type ListShareSource,
  type ListShareStore,
  type ShareEntryRef,
} from '../../../src/site/list-shares'
import {
  createDefaultCardFilters,
  type CardFilters,
  type ListShareKeys,
} from '../../../src/site/card-filters'
import type { CardFiltersControl } from '../../../src/site/useCardFilters'
import {
  listRefKey,
  type CombinedListRef,
  type ListRefKey,
  type NamedListRef,
} from '../../../src/list-view/combined-list'
import type { ScryfallCard } from '../../../src/scryfall/types'
import { makeScryfallCard } from '../../test-utils'

describe('buildListShareKeys', () => {
  test('a pinned entry contributes its own set:cn, lowercased', () => {
    const keys = buildListShareKeys([{ name: 'Shifty', set: 'MKM', collectorNumber: '507A' }], {})
    expect([...keys.printings]).toEqual(['mkm:507a'])
    expect([...keys.names]).toEqual(['shifty'])
  })

  test('an unpinned entry resolved through the cards map uses the resolved printing', () => {
    const cards: Record<string, ScryfallCard | null> = {
      'Lightning Bolt': makeScryfallCard({
        name: 'Lightning Bolt',
        set: 'lea',
        collector_number: '161',
      }),
    }
    const keys = buildListShareKeys([{ name: 'Lightning Bolt' }], cards)
    expect([...keys.printings]).toEqual(['lea:161'])
    expect([...keys.names]).toEqual(['lightning bolt'])
  })

  test('an unpinned, unresolvable entry gets a name key only', () => {
    const keys = buildListShareKeys([{ name: 'Mystery Card' }], {})
    expect([...keys.names]).toEqual(['mystery card'])
    expect(keys.printings.size).toBe(0)
  })

  test('names prefer the resolved Scryfall name over the entry name', () => {
    // The entry omits the back face; the resolved card carries the full name,
    // and the key is the front face of that.
    const cards: Record<string, ScryfallCard | null> = {
      Fire: makeScryfallCard({ name: 'Fire // Ice', set: 'apc', collector_number: '128' }),
    }
    const keys = buildListShareKeys([{ name: 'Fire' }], cards)
    expect([...keys.names]).toEqual(['fire'])
    expect([...keys.printings]).toEqual(['apc:128'])
  })

  test('names fold the front face, case, and diacritics', () => {
    const entries: ShareEntryRef[] = [
      { name: 'Fire // Ice', set: 'apc', collectorNumber: '128' },
      { name: 'Jötun Grunt' },
    ]
    const keys = buildListShareKeys(entries, {})
    expect([...keys.names].sort()).toEqual(['fire', 'jotun grunt'])
  })

  test('a pinned entry whose printing has an explicit null in the map keeps its own pin', () => {
    // The build recorded "looked for, not in the cache" for the pin. Were the
    // explicit null not honored, the lookup would fall through to the NAME
    // key, which here holds a DIFFERENT card entirely — so both the name and
    // the pin surviving proves the null stopped the fallback.
    const keys = buildListShareKeys(
      [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }],
      {
        'lea:161': null,
        'Lightning Bolt': makeScryfallCard({
          name: 'Fire // Ice',
          set: 'm10',
          collector_number: '146',
        }),
      },
    )
    expect([...keys.printings]).toEqual(['lea:161'])
    expect([...keys.names]).toEqual(['lightning bolt'])
  })

  test('a language token resolves the set:cn@lang object', () => {
    // The `@ja` key holds the Japanese scan whose name field differs; the
    // entry's language token is what routes the lookup to it.
    const cards: Record<string, ScryfallCard | null> = {
      'neo:99': makeScryfallCard({ name: 'Wrong Object', set: 'neo', collector_number: '99' }),
      'neo:99@ja': makeScryfallCard({
        name: 'Right // Object',
        set: 'neo',
        collector_number: '99',
      }),
    }
    const keys = buildListShareKeys(
      [{ name: 'Fallback Name', set: 'neo', collectorNumber: '99', language: 'ja' }],
      cards,
    )
    expect([...keys.names]).toEqual(['right'])
    expect([...keys.printings]).toEqual(['neo:99'])
  })
})

/** A controllable source: resolves each load on demand and counts calls per key. */
type FakeSource = {
  source: ListShareSource
  calls: Map<ListRefKey, number>
  resolve: (key: ListRefKey, keys: ListShareKeys | null) => void
}

function makeFakeSource(): FakeSource {
  const calls = new Map<ListRefKey, number>()
  const resolvers = new Map<ListRefKey, (keys: ListShareKeys | null) => void>()
  const source: ListShareSource = {
    load(ref: CombinedListRef): Promise<ListShareKeys | null> {
      const key = listRefKey(ref)
      calls.set(key, (calls.get(key) ?? 0) + 1)
      return new Promise((res) => resolvers.set(key, res))
    },
  }
  return {
    source,
    calls,
    resolve: (key, keys) => {
      const res = resolvers.get(key)
      if (!res) throw new Error(`no in-flight load for ${key}`)
      resolvers.delete(key)
      res(keys)
    },
  }
}

function shareKeys(names: string[]): ListShareKeys {
  return { names: new Set(names), printings: new Set() }
}

/** A fresh store over a fresh fake source — the arrange step of every store test. */
type StoreSetup = { fake: FakeSource; store: ListShareStore }

function newStore(): StoreSetup {
  const fake = makeFakeSource()
  return { fake, store: createListShareStore(() => fake.source) }
}

/** Read a loaded entry, failing the test if it is absent or 'failed'. */
function loadedEntry(store: ListShareStore, key: ListRefKey): ListShareKeys {
  const entry = store.index().get(key)
  if (entry === undefined || entry === 'failed') {
    throw new Error(`expected loaded keys for ${key}, got ${String(entry)}`)
  }
  return entry
}

describe('createListShareStore', () => {
  test('ensure loads exactly the requested keys and caches the results', async () => {
    const { fake, store } = newStore()
    const done = store.ensure(['deck:a'])
    expect(fake.calls.get('deck:a')).toBe(1)
    fake.resolve('deck:a', shareKeys(['bolt']))
    await done
    expect(loadedEntry(store, 'deck:a').names.has('bolt')).toBe(true)
    expect(store.index().size).toBe(1)
  })

  test('a second ensure for a cached key does not call the source again', async () => {
    const { fake, store } = newStore()
    const first = store.ensure(['deck:a'])
    fake.resolve('deck:a', shareKeys(['bolt']))
    await first
    await store.ensure(['deck:a'])
    expect(fake.calls.get('deck:a')).toBe(1)
  })

  test('a concurrent ensure for an in-flight key reuses the pending load', async () => {
    const { fake, store } = newStore()
    const first = store.ensure(['deck:a'])
    const second = store.ensure(['deck:a'])
    expect(fake.calls.get('deck:a')).toBe(1)
    fake.resolve('deck:a', shareKeys(['bolt']))
    await Promise.all([first, second])
    expect(fake.calls.get('deck:a')).toBe(1)
  })

  test("a failed load caches 'failed' and is not retried", async () => {
    const { fake, store } = newStore()
    const done = store.ensure(['deck:broken'])
    fake.resolve('deck:broken', null)
    await done
    expect(store.index().get('deck:broken')).toBe('failed')
    await store.ensure(['deck:broken'])
    expect(fake.calls.get('deck:broken')).toBe(1)
  })

  test("a rejecting source settles ensure, caches 'failed', and is not retried", async () => {
    let calls = 0
    const source: ListShareSource = {
      load(): Promise<ListShareKeys | null> {
        calls++
        return Promise.reject(new Error('boom'))
      },
    }
    const store = createListShareStore(() => source)
    // Resolves rather than rejecting — the rejection must not escape into
    // callers, which fire-and-forget this promise.
    await store.ensure(['deck:a'])
    expect(store.index().get('deck:a')).toBe('failed')
    await store.ensure(['deck:a'])
    expect(calls).toBe(1)
  })

  test('malformed tokens are skipped without calling the source', async () => {
    const { fake, store } = newStore()
    // Malformed tokens can only arrive as unvalidated strings (hand-edited
    // URLs), which is exactly what the cast reproduces.
    await store.ensure(['nonsense', 'deck:', ':x', 'unknown:slug'] as ListRefKey[])
    expect(fake.calls.size).toBe(0)
    expect(store.index().size).toBe(0)
  })

  test('the source is read per load, so a swap between ensures is honored', async () => {
    const first = makeFakeSource()
    const second = makeFakeSource()
    let active = first.source
    const store = createListShareStore(() => active)
    const a = store.ensure(['deck:a'])
    active = second.source
    const b = store.ensure(['deck:b'])
    expect(first.calls.get('deck:a')).toBe(1)
    expect(second.calls.get('deck:b')).toBe(1)
    expect(first.calls.has('deck:b')).toBe(false)
    first.resolve('deck:a', shareKeys(['x']))
    second.resolve('deck:b', shareKeys(['y']))
    await Promise.all([a, b])
  })

  test('each settled load produces a new index identity', async () => {
    const { fake, store } = newStore()
    const before = store.index()
    const done = store.ensure(['deck:a', 'collection:b'])
    fake.resolve('deck:a', shareKeys(['bolt']))
    await new Promise((r) => setTimeout(r, 0))
    const afterFirst = store.index()
    fake.resolve('collection:b', shareKeys(['ring']))
    await done
    const afterSecond = store.index()
    expect(afterFirst).not.toBe(before)
    expect(afterSecond).not.toBe(afterFirst)
    expect(afterSecond.size).toBe(2)
  })

  test('ensure resolves only after every requested load settles', async () => {
    const { fake, store } = newStore()
    let settled = false
    const done = store.ensure(['deck:a', 'deck:b']).then(() => {
      settled = true
    })
    fake.resolve('deck:a', shareKeys(['x']))
    // A full macrotask, so any settled `.then` chain has definitely run.
    await new Promise((r) => setTimeout(r, 0))
    expect(settled).toBe(false)
    fake.resolve('deck:b', shareKeys(['y']))
    await done
    expect(settled).toBe(true)
    expect(store.index().size).toBe(2)
  })

  test('clear empties the index and forgets pending keys', async () => {
    const { fake, store } = newStore()
    const first = store.ensure(['deck:a'])
    fake.resolve('deck:a', shareKeys(['bolt']))
    await first
    store.clear()
    expect(store.index().size).toBe(0)
    const again = store.ensure(['deck:a'])
    expect(fake.calls.get('deck:a')).toBe(2)
    fake.resolve('deck:a', shareKeys(['bolt']))
    await again
  })
})

describe('session singleton', () => {
  test('setListShareSource routes ensureListShares; reset clears the cache', async () => {
    resetListShares()
    try {
      const fake = makeFakeSource()
      setListShareSource(fake.source)
      const done = ensureListShares(['deck:a'])
      expect(fake.calls.get('deck:a')).toBe(1)
      fake.resolve('deck:a', shareKeys(['bolt']))
      await done
      const cached = listShareIndex().get('deck:a')
      expect(cached !== undefined && cached !== 'failed' && cached.names.has('bolt')).toBe(true)
      resetListShares()
      expect(listShareIndex().size).toBe(0)
    } finally {
      resetListShares()
    }
  })
})

describe('shareListsExcluding', () => {
  const lists: NamedListRef[] = [
    { type: 'deck', slug: 'alpha', name: 'Alpha' },
    { type: 'collection', slug: 'alpha', name: 'Alpha Binder' },
    { type: 'deck', slug: 'beta', name: 'Beta' },
  ]

  test('drops exactly the self list and returns its key', () => {
    const result = shareListsExcluding(lists, { type: 'deck', slug: 'alpha' })
    expect(result.selfKey).toBe('deck:alpha')
    expect(result.others.map(listRefKey)).toEqual(['collection:alpha', 'deck:beta'])
  })

  test('a same-slug list of another type is kept', () => {
    const result = shareListsExcluding(lists, { type: 'collection', slug: 'alpha' })
    expect(result.others.map(listRefKey)).toEqual(['deck:alpha', 'deck:beta'])
  })

  test('undefined lists yield empty others, with the self key still resolved', () => {
    const result = shareListsExcluding(undefined, { type: 'wanted', slug: 'wish' })
    expect(result.others).toEqual([])
    expect(result.selfKey).toBe('wanted:wish')
  })
})

describe('pruneOwnShareSelections', () => {
  /** A filters control fake that records every patch `update` receives. */
  type FakeFiltersControl = { control: CardFiltersControl; patches: Partial<CardFilters>[] }

  function fakeFiltersControl(
    sharedWith: ListRefKey[],
    notSharedWith: ListRefKey[],
  ): FakeFiltersControl {
    const filters: CardFilters = { ...createDefaultCardFilters(), sharedWith, notSharedWith }
    const patches: Partial<CardFilters>[] = []
    const control: CardFiltersControl = {
      filters,
      update: (patch) => {
        patches.push(patch)
        Object.assign(filters, patch)
      },
      reset: () => {},
      resetEpoch: () => 0,
      activeCount: () => 0,
      narrowingCount: () => 0,
    }
    return { control, patches }
  }

  test('removes the self key from both selections in one update', () => {
    const { control, patches } = fakeFiltersControl(
      ['deck:self', 'deck:other'],
      ['deck:self', 'collection:binder'],
    )
    pruneOwnShareSelections(control, 'deck:self')
    expect(patches.length).toBe(1)
    expect(control.filters.sharedWith).toEqual(['deck:other'])
    expect(control.filters.notSharedWith).toEqual(['collection:binder'])
  })

  test('writes nothing when no chip names the self key', () => {
    const { control, patches } = fakeFiltersControl(['deck:other'], ['collection:binder'])
    pruneOwnShareSelections(control, 'deck:self')
    expect(patches.length).toBe(0)
  })

  test('the untouched selection keeps its array identity', () => {
    const notShared = ['collection:binder' as ListRefKey]
    const { control } = fakeFiltersControl(['deck:self'], notShared)
    pruneOwnShareSelections(control, 'deck:self')
    expect(control.filters.sharedWith).toEqual([])
    expect(control.filters.notSharedWith).toBe(notShared)
  })
})
