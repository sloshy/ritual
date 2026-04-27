import { createSignal, createMemo, createEffect, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { ScryfallCard, Finish, Condition } from '../types'
import type {
  CollectionDetail,
  DeckDetail,
  WantedListDetail,
  CollectionSummary,
  DeckSummary,
  WantedListSummary,
} from './data-types'
import { fetchJson } from './useFetchJson'

/** A single searchable card entry derived from a collection, deck, or wanted list. */
export interface TradeSearchEntry {
  name: string
  /** Cached lowercase of `name` to avoid re-lowercasing on every keystroke during search. */
  nameLower: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  note?: string
  price?: number
  scryfallCard: ScryfallCard | null
  sourceName: string
  /** 'collection' | 'deck' | 'wanted' */
  sourceKind: 'collection' | 'deck' | 'wanted'
  /** Maximum quantity available from this source for this exact variant. */
  maxQty: number
  /** All card IDs in this aggregated group, in order. Used for URL encoding. */
  cardIds: number[]
}

export type UseTradeDataResult = {
  collectionEntries: Accessor<TradeSearchEntry[]>
  deckEntries: Accessor<TradeSearchEntry[]>
  wantedEntries: Accessor<TradeSearchEntry[]>
  loadingCollections: Accessor<boolean>
  loadingWanted: Accessor<boolean>
  /** True after the initial collections + wanted-list load attempt completes (even if empty). */
  initialReady: Accessor<boolean>
  /** True after deck data finishes loading, or if decks were never requested. */
  decksReady: Accessor<boolean>
  /** Trigger loading deck data (call when "Include Decks" toggle is turned on) */
  loadDecks: () => void
  /** Search collection (and optionally deck) entries by partial card name */
  searchLeft: (query: string, includeDecks: boolean) => TradeSearchEntry[]
  /** Search wanted entries by partial card name */
  searchWanted: (query: string) => TradeSearchEntry[]
}

async function fetchOrNull<T>(url: string, signal: AbortSignal): Promise<T | null> {
  return fetchJson<T>(url, signal).catch(() => null)
}

export type UseTradeDataParams = {
  collections: Accessor<CollectionSummary[] | null>
  wantedLists: Accessor<WantedListSummary[] | null>
  decks: Accessor<DeckSummary[] | null>
}

/**
 * Deck-loading state machine.
 * - `idle`: never requested, no decks loaded.
 * - `requested`: user toggled "include decks" but the load hasn't started yet
 *   (we may still be waiting for `deckSlugs` to populate from the parent index).
 * - `loading`: deck JSONs are being fetched.
 * - `ready`: entries are populated and stable.
 */
type DeckStatus = 'idle' | 'requested' | 'loading' | 'ready'

export function useTradeData(params: UseTradeDataParams): UseTradeDataResult {
  const [collectionEntries, setCollectionEntries] = createSignal<TradeSearchEntry[]>([])
  const [deckEntries, setDeckEntries] = createSignal<TradeSearchEntry[]>([])
  const [wantedEntries, setWantedEntries] = createSignal<TradeSearchEntry[]>([])
  const [loadingCollections, setLoadingCollections] = createSignal(false)
  const [loadingWanted, setLoadingWanted] = createSignal(false)
  const [deckSlugs, setDeckSlugs] = createSignal<string[]>([])
  const [deckStatus, setDeckStatus] = createSignal<DeckStatus>('idle')
  const [initialReady, setInitialReady] = createSignal(false)
  // `decksReady` is true when decks are loaded *or* when the user never requested them.
  // The URL-decode gate uses this to know when it's safe to try resolving deck IDs.
  const decksReady = createMemo(() => {
    const s = deckStatus()
    return s === 'idle' || s === 'ready'
  })

  const controller = new AbortController()
  onCleanup(() => controller.abort())

  const loadCollectionsAndWanted = async () => {
    const collections = params.collections() ?? []
    const wantedLists = params.wantedLists() ?? []
    const decks = params.decks() ?? []

    const loadCollections = async () => {
      if (collections.length === 0) return
      setLoadingCollections(true)
      const allEntries: TradeSearchEntry[] = []
      await Promise.all(
        collections.map(async (col) => {
          const detail = await fetchOrNull<CollectionDetail>(
            `collections/${col.slug}.json`,
            controller.signal,
          )
          if (!detail) return
          // Aggregate note-less duplicates within this collection so maxQty reflects
          // the number of identical physical cards available to trade.
          const groups = new Map<string, TradeSearchEntry>()
          for (const entry of detail.entries) {
            const setLower = entry.set.toLowerCase()
            const cardKey = `${setLower}:${entry.collectorNumber}`
            const scryfallCard = detail.cards[cardKey] ?? null
            const mapped: TradeSearchEntry = {
              name: entry.name,
              nameLower: entry.name.toLowerCase(),
              set: setLower,
              collectorNumber: entry.collectorNumber,
              finish: entry.finish,
              condition: entry.condition,
              note: entry.note,
              price: entry.price,
              scryfallCard,
              sourceName: detail.name,
              sourceKind: 'collection',
              maxQty: 1,
              cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
            }
            if (entry.note) {
              allEntries.push(mapped)
              continue
            }
            const groupKey = `${entry.name}|${setLower}|${entry.collectorNumber}|${entry.finish}|${entry.condition}`
            const existing = groups.get(groupKey)
            if (existing) {
              existing.maxQty += 1
              if (entry.cardId !== undefined) existing.cardIds.push(entry.cardId)
            } else {
              groups.set(groupKey, mapped)
            }
          }
          for (const grouped of groups.values()) allEntries.push(grouped)
        }),
      )
      setCollectionEntries(allEntries)
      setLoadingCollections(false)
    }

    const loadWanted = async () => {
      if (wantedLists.length === 0) return
      setLoadingWanted(true)
      const allWanted: TradeSearchEntry[] = []
      await Promise.all(
        wantedLists.map(async (wl) => {
          const detail = await fetchOrNull<WantedListDetail>(
            `wanted/${wl.slug}.json`,
            controller.signal,
          )
          if (!detail) return
          const groups = new Map<string, TradeSearchEntry>()
          for (const entry of detail.entries) {
            const setLower = entry.set?.toLowerCase()
            const cardKey =
              setLower && entry.collectorNumber
                ? `${setLower}:${entry.collectorNumber}`
                : entry.name
            const scryfallCard = detail.cards[cardKey] ?? detail.cards[entry.name] ?? null
            const mapped: TradeSearchEntry = {
              name: entry.name,
              nameLower: entry.name.toLowerCase(),
              set: setLower,
              collectorNumber: entry.collectorNumber,
              finish: entry.finish,
              note: entry.note,
              price: entry.price,
              scryfallCard,
              sourceName: detail.name,
              sourceKind: 'wanted',
              maxQty: 1,
              cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
            }
            if (entry.note) {
              allWanted.push(mapped)
              continue
            }
            const groupKey = `${entry.name}|${setLower ?? ''}|${entry.collectorNumber ?? ''}|${entry.finish ?? ''}`
            const existing = groups.get(groupKey)
            if (existing) {
              existing.maxQty += 1
              if (entry.cardId !== undefined) existing.cardIds.push(entry.cardId)
            } else {
              groups.set(groupKey, mapped)
            }
          }
          for (const grouped of groups.values()) allWanted.push(grouped)
        }),
      )
      setWantedEntries(allWanted)
      setLoadingWanted(false)
    }

    setDeckSlugs(decks.map((d) => d.slug))

    await Promise.all([loadCollections(), loadWanted()])
    setInitialReady(true)
  }

  const loadDeckData = async () => {
    const status = deckStatus()
    if (status === 'loading' || status === 'ready') return
    setDeckStatus('loading')
    const allDeckEntries: TradeSearchEntry[] = []
    await Promise.all(
      deckSlugs().map(async (slug) => {
        const detail = await fetchOrNull<DeckDetail>(`decks/${slug}.json`, controller.signal)
        if (!detail) return
        const deckName = detail.deck.name
        // Sum quantities across all sections (mainboard + sideboard + ...) for the
        // same printing variant within this deck.
        const groups = new Map<string, TradeSearchEntry>()
        for (const section of detail.deck.sections) {
          for (const card of section.cards) {
            const setLower = card.set?.toLowerCase()
            const scryfallCard = detail.cards[card.name] ?? null
            const groupKey = `${card.name}|${setLower ?? ''}|${card.collectorNumber ?? ''}|${card.finish ?? ''}`
            const existing = groups.get(groupKey)
            if (existing) {
              existing.maxQty += card.quantity
              if (card.cardId !== undefined) existing.cardIds.push(card.cardId)
            } else {
              groups.set(groupKey, {
                name: card.name,
                nameLower: card.name.toLowerCase(),
                set: setLower,
                collectorNumber: card.collectorNumber,
                finish: card.finish,
                scryfallCard,
                sourceName: deckName,
                sourceKind: 'deck',
                maxQty: card.quantity,
                cardIds: card.cardId !== undefined ? [card.cardId] : [],
              })
            }
          }
        }
        for (const grouped of groups.values()) allDeckEntries.push(grouped)
      }),
    )
    setDeckEntries(allDeckEntries)
    setDeckStatus('ready')
  }

  let loadStarted = false
  createEffect(() => {
    if (loadStarted) return
    // All three site-index signals are populated together by useSiteData, but the writes are
    // separate setSignal calls. Solid runs subscriber effects synchronously between each
    // write, so gating on a single signal would let this effect fire after `setDeckList`
    // but before `setCollectionList`/`setWantedListList`. `loadCollectionsAndWanted` reads
    // those accessors synchronously, so a null signal becomes `[] ?? []` and the matching
    // load function returns early without ever fetching its detail JSONs.
    if (params.decks() === null) return
    if (params.collections() === null) return
    if (params.wantedLists() === null) return
    loadStarted = true
    void loadCollectionsAndWanted()
  })

  // Load decks when requested (triggered by "Include Decks" toggle).
  // Also re-evaluates when deckSlugs changes, so toggling before the index loads still works.
  createEffect(() => {
    if (deckStatus() === 'requested' && deckSlugs().length > 0) {
      void loadDeckData()
    }
  })

  const searchLeft = (query: string, includeDecks: boolean): TradeSearchEntry[] => {
    if (query.length < 2) return []
    const q = query.toLowerCase()
    const results: TradeSearchEntry[] = []
    for (const entry of collectionEntries()) {
      if (entry.nameLower.includes(q)) results.push(entry)
    }
    if (includeDecks) {
      for (const entry of deckEntries()) {
        if (entry.nameLower.includes(q)) results.push(entry)
      }
    }
    return results.slice(0, 20)
  }

  const searchWanted = (query: string): TradeSearchEntry[] => {
    if (query.length < 2) return []
    const q = query.toLowerCase()
    const results: TradeSearchEntry[] = []
    for (const entry of wantedEntries()) {
      if (entry.nameLower.includes(q)) results.push(entry)
    }
    return results.slice(0, 20)
  }

  return {
    collectionEntries,
    deckEntries,
    wantedEntries,
    loadingCollections,
    loadingWanted,
    initialReady,
    decksReady,
    loadDecks: () => {
      if (deckStatus() === 'idle') setDeckStatus('requested')
    },
    searchLeft,
    searchWanted,
  }
}
