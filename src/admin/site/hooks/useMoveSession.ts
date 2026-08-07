import { type Accessor, batch, createSignal, createMemo, createEffect, on, onMount } from 'solid-js'
import { createStore, type SetStoreFunction, type Store } from 'solid-js/store'
import type { DeckData, ScryfallCard } from '../../../types'
import type { CollectionCardEntry, WantedListCardEntry } from '../../../site/data-types'
import { createChangeId } from '../../../change-event'
import { formatDroppedNotesSuffix } from '../../../editor/dropped-notes'
import type { MoveCommitResponse } from '../../api/move'
import type { MovePhysicalCard } from '../../../card-index-types'
import type { CardIndexResponse } from '../../api/card-index'
import type { ApiErrorResponse } from '../../api/save-helpers'
import type { ListInfo } from '../../../list-info'
import {
  type PendingMove,
  type MoveDestPrinting,
  type TileTarget,
  type CardGroup,
  overlayDeck,
  overlayCollection,
  overlayWanted,
  matchesTile,
  pendingMatchesTile,
  reconcilePendingMoves,
  groupCards,
} from '../move-overlay'
import { type ListId, listId, listInfoId } from '../list-grouping'
import {
  matchesNameTerms,
  normalizeCardName,
  normalizeForSearch,
  rankNameMatches,
  splitNameTerms,
} from '../../../term-match'
import { indexPrintingCard } from '../../../editor/card-data-utils'

/** Merged Scryfall display data, accumulated across every list fetched this session. */
export type MoveCardData = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
}

/** Freshly-loaded (pre-overlay) data for a single list, cached by list id. */
type RichListData =
  | { type: 'deck'; deck: DeckData }
  | { type: 'collection'; entries: CollectionCardEntry[]; sectionOrder: string[] }
  | { type: 'wanted'; entries: WantedListCardEntry[]; sectionOrder: string[] }

/** The overlaid (pending-moves-applied) data passed to the standard list view. */
export type ViewedListData =
  | { type: 'deck'; name: string; deck: DeckData }
  | { type: 'collection'; name: string; entries: CollectionCardEntry[]; sectionOrder: string[] }
  | { type: 'wanted'; name: string; entries: WantedListCardEntry[]; sectionOrder: string[] }

type DeckLoadResponse = MoveCardData & { success: boolean; deck: DeckData }
type EntryLoadResponse = MoveCardData & {
  success: boolean
  entries: (CollectionCardEntry | WantedListCardEntry)[]
  sectionOrder?: string[]
}
type CardPrintingsResponse = { success: boolean; printings: ScryfallCard[] }

export type UseMoveSessionResult = {
  loaded: Accessor<boolean>
  error: Accessor<string | null>
  status: Accessor<string | null>
  saving: Accessor<boolean>

  lists: Accessor<ListInfo[]>
  /** Currently selected list id (null when none / searching). */
  viewedListId: Accessor<ListId | null>
  selectList: (id: ListId | null) => void
  viewedList: Accessor<ListInfo | null>
  viewedData: Accessor<ViewedListData | null>
  viewedLoading: Accessor<boolean>

  search: Accessor<string>
  setSearch: (q: string) => void
  searchResults: Accessor<CardGroup[]>

  cardData: Store<MoveCardData>

  pending: Accessor<PendingMove[]>
  pendingCount: Accessor<number>

  /** Lists eligible as destinations for a card currently in `fromId` (dest filter + not self). */
  destinationsFor: (fromId: ListId) => ListInfo[]
  sourceEnabled: (id: ListId) => boolean
  destEnabled: (id: ListId) => boolean
  toggleSource: (id: ListId) => void
  toggleDest: (id: ListId) => void
  setAllSources: (on: boolean) => void
  setAllDests: (on: boolean) => void

  /** How many copies of `target` in `sourceList` can still be moved (excludes already-queued). */
  availableToMove: (sourceList: ListInfo, target: TileTarget) => number
  requestMove: (
    sourceList: ListInfo,
    target: TileTarget,
    count: number,
    dest: ListInfo,
    override?: MoveDestPrinting,
  ) => void
  removePending: (id: string) => void
  discardAll: () => void
  commit: () => Promise<void>
}

const SOURCES_KEY = 'ritual:admin:move:disabled-sources'
const DESTS_KEY = 'ritual:admin:move:disabled-dests'

function loadDisabled(key: string): Set<ListId> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

function persistDisabled(key: string, value: Set<ListId>): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, JSON.stringify([...value]))
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Index a card's printings into the merged store: keyed by name (the newest
 * printing as the representative) and by `set:collector_number` (each printing),
 * matching how the deck and entry load endpoints key their `cards` maps. Used as
 * a lightweight fallback for cards moved in from a list that hasn't been opened;
 * the destination entry resolves its own exact printing by `set:collector_number`.
 */
function indexPrintings(
  name: string,
  printings: ScryfallCard[],
  set: SetStoreFunction<MoveCardData>,
): void {
  if (printings.length === 0) return
  set('printings', name, printings)
  // Key by lowercased `set:collector_number` (matching how the entries look up),
  // with foreign-language objects under `set:cn@lang` and the plain slot holding
  // the default-language object — the same dual keying as the load endpoints.
  const keyed: Record<string, ScryfallCard | null> = {}
  for (const p of printings) {
    indexPrintingCard(keyed, p)
  }
  for (const [key, card] of Object.entries(keyed)) {
    set('cards', key, card)
  }
  const newest = [...printings].sort((a, b) =>
    (b.released_at ?? '').localeCompare(a.released_at ?? ''),
  )[0]!
  set('cards', name, newest)
}

export function useMoveSession(): UseMoveSessionResult {
  const [loaded, setLoaded] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [status, setStatus] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)

  const [lists, setLists] = createSignal<ListInfo[]>([])
  const [allCards, setAllCards] = createSignal<MovePhysicalCard[]>([])
  const [pending, setPending] = createSignal<PendingMove[]>([])

  const [viewedListId, setViewedListId] = createSignal<ListId | null>(null)
  const [search, setSearchSignal] = createSignal('')

  const [richCache, setRichCache] = createSignal<Record<ListId, RichListData>>({})
  const [viewedLoading, setViewedLoading] = createSignal(false)
  // Bumped after a commit to force the viewed list to reload from disk even though
  // its id is unchanged (the cached data is now stale).
  const [refreshKey, setRefreshKey] = createSignal(0)
  const [cardData, setCardData] = createStore<MoveCardData>({
    cards: {},
    printings: {},
    symbolMap: {},
  })

  const [disabledSources, setDisabledSources] = createSignal<Set<ListId>>(loadDisabled(SOURCES_KEY))
  const [disabledDests, setDisabledDests] = createSignal<Set<ListId>>(loadDisabled(DESTS_KEY))

  // Names already fetched via the per-card printings endpoint, so re-views don't refetch.
  const fetchedCardNames = new Set<string>()

  // Merge with per-key writes (in one batch) so only the changed card/printing/symbol
  // slots notify — readers of a specific `cards[key]` don't re-run on unrelated loads.
  const mergeCardData = (incoming: Partial<MoveCardData>) => {
    batch(() => {
      for (const [k, v] of Object.entries(incoming.cards ?? {})) setCardData('cards', k, v)
      for (const [k, v] of Object.entries(incoming.printings ?? {})) setCardData('printings', k, v)
      for (const [k, v] of Object.entries(incoming.symbolMap ?? {})) setCardData('symbolMap', k, v)
    })
  }

  const reloadBulk = async (): Promise<void> => {
    try {
      const resp = await fetch('/api/card-index', { credentials: 'same-origin' })
      const data = (await resp.json()) as CardIndexResponse | ApiErrorResponse
      if (!data.success) {
        setError(data.message)
        return
      }
      setLists(data.lists)
      setAllCards(data.cards)
      setLoaded(true)
    } catch (err) {
      setError(`Failed to load lists: ${errorMessage(err)}`)
    }
  }

  onMount(() => void reloadBulk())

  const findList = (id: ListId): ListInfo | undefined => lists().find((l) => listInfoId(l) === id)

  const viewedList = createMemo(() => {
    const id = viewedListId()
    return id ? (findList(id) ?? null) : null
  })

  // Fetch the selected list's rich data lazily (once), plus any moved-in cards' data.
  const loadList = async (list: ListInfo): Promise<void> => {
    const id = listInfoId(list)
    if (richCache()[id]) return
    setViewedLoading(true)
    try {
      const endpoint =
        list.type === 'deck'
          ? `/api/deck/${encodeURIComponent(list.slug)}`
          : list.type === 'collection'
            ? `/api/collection/${encodeURIComponent(list.slug)}`
            : `/api/wanted/${encodeURIComponent(list.slug)}`
      const resp = await fetch(endpoint, { credentials: 'same-origin' })
      const json = (await resp.json()) as DeckLoadResponse | EntryLoadResponse
      if (!json.success) {
        setError(`Failed to load ${list.name}`)
        return
      }
      if (list.type === 'deck') {
        const d = json as DeckLoadResponse
        mergeCardData({ cards: d.cards, printings: d.printings, symbolMap: d.symbolMap })
        setRichCache((prev) => ({ ...prev, [id]: { type: 'deck', deck: d.deck } }))
      } else {
        const e = json as EntryLoadResponse
        mergeCardData({ cards: e.cards, printings: e.printings, symbolMap: e.symbolMap })
        const sectionOrder = e.sectionOrder ?? []
        // Narrow per type so the stored RichListData arm is checked, not cast. The load
        // endpoints return the entry shape matching the requested list type.
        const entry: RichListData =
          list.type === 'collection'
            ? { type: 'collection', entries: e.entries as CollectionCardEntry[], sectionOrder }
            : { type: 'wanted', entries: e.entries as WantedListCardEntry[], sectionOrder }
        setRichCache((prev) => ({ ...prev, [id]: entry }))
      }
    } catch (err) {
      setError(`Failed to load ${list.name}: ${errorMessage(err)}`)
    } finally {
      setViewedLoading(false)
    }
  }

  /** Fetch Scryfall data for card names not yet in the merged store (e.g. moved-in from search). */
  const ensureCardData = async (names: string[]): Promise<void> => {
    const missing = names.filter((n) => !fetchedCardNames.has(n) && !cardData.printings[n])
    for (const name of missing) fetchedCardNames.add(name)
    await Promise.all(
      missing.map(async (name) => {
        try {
          const resp = await fetch(`/api/card-printings?name=${encodeURIComponent(name)}`, {
            credentials: 'same-origin',
          })
          const json = (await resp.json()) as CardPrintingsResponse
          if (json.success) indexPrintings(name, json.printings, setCardData)
        } catch {
          // A missing card simply renders name-only; not fatal to the move flow.
        }
      }),
    )
  }

  // Load the selected list and its moved-in cards whenever the selection (or a
  // post-commit refresh, or a lists reload) changes. `lists` is a dependency so a
  // post-commit `reloadBulk` re-fetches the viewed list even when its id is unchanged.
  createEffect(
    on([viewedListId, refreshKey, lists], ([id]) => {
      if (!id) return
      const list = findList(id)
      if (!list) return
      void (async () => {
        await loadList(list)
        const incoming = pending().filter((m) => listInfoId(m.to) === id)
        await ensureCardData(incoming.map((m) => m.source.name))
      })()
    }),
  )

  const viewedData = createMemo<ViewedListData | null>(() => {
    const id = viewedListId()
    const list = viewedList()
    if (!id || !list) return null
    const base = richCache()[id]
    if (!base) return null
    if (base.type === 'deck') {
      return { type: 'deck', name: list.name, deck: overlayDeck(base.deck, pending(), id) }
    }
    if (base.type === 'collection') {
      return {
        type: 'collection',
        name: list.name,
        entries: overlayCollection(base.entries, pending(), id),
        sectionOrder: base.sectionOrder,
      }
    }
    return {
      type: 'wanted',
      name: list.name,
      entries: overlayWanted(base.entries, pending(), id),
      sectionOrder: base.sectionOrder,
    }
  })

  const pendingKeys = createMemo(() => new Set(pending().map((m) => m.cardKey)))

  const searchResults = createMemo<CardGroup[]>(() => {
    const query = search().trim()
    if (normalizeForSearch(query).length < 2) return []
    // Term matching, as everywhere else cards are searched by name: "in tre"
    // finds "In the Trenches". Alphabetical only breaks equally close matches.
    // A query that is all punctuation leaves no terms, and no term matches
    // everything — so it searches for nothing rather than for every card.
    const terms = splitNameTerms(query)
    if (terms.length === 0) return []
    const keys = pendingKeys()
    const matches = allCards().filter(
      (c) =>
        sourceEnabled(listId(c.listType, c.listSlug)) &&
        !keys.has(c.key) &&
        matchesNameTerms(normalizeCardName(c.name), terms),
    )
    const groups = groupCards(matches).sort((a, b) => a.name.localeCompare(b.name))
    return rankNameMatches(groups, query, (group) => group.name)
  })

  // Prefetch Scryfall data for the current search matches so their hover previews are ready.
  createEffect(
    on(searchResults, (results) => {
      if (results.length === 0) return
      void ensureCardData([...new Set(results.map((g) => g.name))])
    }),
  )

  // ── Filters ────────────────────────────────────────────────────────────────
  const sourceEnabled = (id: ListId) => !disabledSources().has(id)
  const destEnabled = (id: ListId) => !disabledDests().has(id)

  const toggle = (
    get: Accessor<Set<ListId>>,
    setSig: (v: Set<ListId>) => void,
    storageKey: string,
    id: ListId,
  ) => {
    const next = new Set(get())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSig(next)
    persistDisabled(storageKey, next)
  }
  const toggleSource = (id: ListId) => toggle(disabledSources, setDisabledSources, SOURCES_KEY, id)
  const toggleDest = (id: ListId) => toggle(disabledDests, setDisabledDests, DESTS_KEY, id)

  const setAllSources = (onState: boolean) => {
    const next = onState ? new Set<ListId>() : new Set(lists().map(listInfoId))
    setDisabledSources(next)
    persistDisabled(SOURCES_KEY, next)
  }
  const setAllDests = (onState: boolean) => {
    const next = onState ? new Set<ListId>() : new Set(lists().map(listInfoId))
    setDisabledDests(next)
    persistDisabled(DESTS_KEY, next)
  }

  const destinationsFor = (fromId: ListId): ListInfo[] =>
    lists().filter((l) => listInfoId(l) !== fromId && destEnabled(listInfoId(l)))

  // ── Moving ───────────────────────────────────────────────────────────────────
  const availableToMove = (sourceList: ListInfo, target: TileTarget): number => {
    const sourceId = listInfoId(sourceList)
    const keys = pendingKeys()
    const native = allCards().filter(
      (c) =>
        listId(c.listType, c.listSlug) === sourceId && matchesTile(c, target) && !keys.has(c.key),
    ).length
    const chain = pending().filter(
      (m) => listInfoId(m.to) === sourceId && pendingMatchesTile(m, target),
    ).length
    return native + chain
  }

  const requestMove = (
    sourceList: ListInfo,
    target: TileTarget,
    count: number,
    dest: ListInfo,
    override?: MoveDestPrinting,
  ) => {
    setPending(
      reconcilePendingMoves({
        pending: pending(),
        allCards: allCards(),
        sourceList,
        target,
        count,
        dest,
        override,
        newId: createChangeId,
      }),
    )
    void ensureCardData([target.cardName])
    setStatus(null)
  }

  const removePending = (id: string) => setPending(pending().filter((m) => m.id !== id))
  const discardAll = () => setPending([])

  const commit = async (): Promise<void> => {
    const moves = pending()
    if (moves.length === 0) return
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const resp = await fetch('/api/move/commit', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moves: moves.map((m) => ({
            cardKey: m.cardKey,
            toType: m.to.type,
            toSlug: m.to.slug,
            set: m.dest.set,
            collectorNumber: m.dest.collectorNumber,
            finish: m.dest.finish,
            condition: m.dest.condition,
          })),
        }),
      })
      const json = (await resp.json()) as MoveCommitResponse | ApiErrorResponse
      if (!json.success) {
        setError(json.message)
        return
      }
      setPending([])
      // Re-derive everything from disk: the cached list data is now stale.
      setRichCache({})
      fetchedCardNames.clear()
      await reloadBulk()
      // Force the viewed list (unchanged id) to reload now that its cache is cleared.
      setRefreshKey((k) => k + 1)
      const skippedNote = json.skipped > 0 ? ` (${json.skipped} skipped)` : ''
      const droppedNote = formatDroppedNotesSuffix(json.droppedNotes)
      setStatus(
        `Moved ${json.moved} card${json.moved === 1 ? '' : 's'}.${skippedNote}${droppedNote}`,
      )
    } catch (err) {
      setError(`Failed to save moves: ${errorMessage(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const selectList = (id: ListId | null) => {
    setViewedListId(id)
    if (id) setSearchSignal('')
  }
  const setSearch = (q: string) => setSearchSignal(q)

  return {
    loaded,
    error,
    status,
    saving,
    lists,
    viewedListId,
    selectList,
    viewedList,
    viewedData,
    viewedLoading,
    search,
    setSearch,
    searchResults,
    cardData,
    pending,
    pendingCount: createMemo(() => pending().length),
    destinationsFor,
    sourceEnabled,
    destEnabled,
    toggleSource,
    toggleDest,
    setAllSources,
    setAllDests,
    availableToMove,
    requestMove,
    removePending,
    discardAll,
    commit,
  }
}
