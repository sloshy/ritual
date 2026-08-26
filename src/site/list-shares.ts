import { createEffect, createSignal, untrack, type Accessor } from 'solid-js'
import type { ScryfallCard } from '../scryfall/types'
import {
  cardPrintingKey,
  lookupPrintingCard,
  printingKey,
  type PrintingRef,
} from '../card/printing-key'
import { hasSpecificPrinting } from '../card/card-printing'
import { findMatchKey } from '../card/find-search'
import {
  listRefKey,
  loadListDetail,
  parseListRefKeyToken,
  type CombinedListRef,
  type ListRefKey,
  type NamedListRef,
} from '../list-view/combined-list'
import {
  updateShareSelection,
  type CardFilterContext,
  type CardFilters,
  type ListShareKeys,
  type ShareFilterField,
  type ShareIndex,
  type ShareLoad,
} from './card-filters'
import type { CardFiltersControl } from './useCardFilters'

/**
 * Lazy, session-cached loading of other lists' contents for the toolbar's
 * "Shares cards with" / "Doesn't share cards with" filters.
 *
 * The comparison is against SAVED (baked/persisted) list contents only —
 * pending in-memory editor sessions of other lists are deliberately ignored,
 * matching the Find page and Find Other Printings. Each selected list is
 * fetched once per session, on first selection, through a pluggable
 * {@link ListShareSource}: the public site reads the list's detail JSON, the
 * admin site its credentialed load routes (`src/admin/site/share-source.ts`).
 *
 * `card-filters.ts` never imports this module — pages hand the loaded index in
 * through {@link CardFilterContext} — so the predicate stays pure and the
 * import graph acyclic.
 */

/**
 * One card line as the share-key builder reads it: the entry's name plus its
 * pin and language token, when present — exactly the fields
 * {@link lookupPrintingCard} resolves by, so a `[ja]` line resolves its
 * baked `set:cn@lang` object.
 */
export type ShareEntryRef = Pick<PrintingRef, 'name' | 'set' | 'collectorNumber' | 'language'>

/**
 * Build one list's share key sets from its entries and its baked/loaded cards
 * map. Names go through {@link findMatchKey} (the resolved Scryfall name
 * preferred over the entry name, front face only, case/diacritic-folded).
 * Printings: the entry's own pin when present, else the resolved display
 * printing, else nothing — an unresolvable name-only line has a name identity
 * but no printing identity.
 */
export function buildListShareKeys(
  entries: readonly ShareEntryRef[],
  cards: Record<string, ScryfallCard | null>,
): ListShareKeys {
  const names = new Set<string>()
  const printings = new Set<string>()
  for (const entry of entries) {
    const resolved = lookupPrintingCard(cards, entry)
    names.add(findMatchKey(resolved?.name ?? entry.name))
    if (hasSpecificPrinting(entry)) {
      printings.add(printingKey(entry.set, entry.collectorNumber))
    } else if (resolved) {
      printings.add(cardPrintingKey(resolved))
    }
  }
  return { names, printings }
}

/** Loads one list's saved/baked contents as share keys; `null` reports a failed load. */
export interface ListShareSource {
  load(ref: CombinedListRef): Promise<ListShareKeys | null>
}

/** A session cache of loaded share key sets over one {@link ListShareSource}. */
export interface ListShareStore {
  /**
   * `ListRefKey` -> load outcome. A failed load is cached as `'failed'` — it
   * contributes nothing to the predicate (exactly like a key absent here,
   * which is unrequested or still in flight) but is not retried.
   */
  index: Accessor<ShareIndex>
  /**
   * Kick off loads for any keys not yet cached or in flight; resolves when
   * every requested load has settled — a load that fails or rejects settles as
   * `'failed'`, never as a rejection of this promise. Malformed tokens are
   * skipped. Results stay cached for the session even if the list is later
   * deselected. The cache check reads the index untracked, so calling this
   * inside an effect does not subscribe the effect to the index.
   */
  ensure(keys: readonly ListRefKey[]): Promise<void>
  /**
   * Drop every cached and pending entry; reactive subscribers see an empty
   * index. Loads already in flight still land when they settle — acceptable
   * for its purpose (resetting between tests).
   */
  clear(): void
}

/**
 * Create a share store over `source`. The source is read lazily per load, so a
 * source swapped in at boot (the admin site) is honored without ordering
 * constraints against module initialization.
 */
export function createListShareStore(source: () => ListShareSource): ListShareStore {
  const [index, setIndex] = createSignal<ShareIndex>(new Map())
  const pending = new Map<ListRefKey, Promise<void>>()

  function ensure(keys: readonly ListRefKey[]): Promise<void> {
    const waits: Promise<void>[] = []
    // Untracked: `ensure` runs inside callers' effects, and reading the index
    // reactively here would re-run them on every settled load anywhere.
    const cached = untrack(index)
    for (const key of keys) {
      if (cached.has(key)) continue
      const inFlight = pending.get(key)
      if (inFlight) {
        waits.push(inFlight)
        continue
      }
      const ref = parseListRefKeyToken(key)
      if (!ref) continue
      const task = (async (): Promise<void> => {
        let loaded: ShareLoad
        try {
          loaded = (await source().load(ref)) ?? 'failed'
        } catch (e) {
          // A source that rejects instead of returning null is still just a
          // failed load: cache 'failed' so it is not retried, and never let
          // the rejection escape into `ensure`'s callers.
          console.error(`Share filter: load for ${key} rejected:`, e)
          loaded = 'failed'
        } finally {
          pending.delete(key)
        }
        // A new Map identity per write is what makes page memos re-run.
        setIndex((prev) => new Map(prev).set(key, loaded))
      })()
      pending.set(key, task)
      waits.push(task)
    }
    return Promise.all(waits).then(() => undefined)
  }

  function clear(): void {
    setIndex(new Map())
    pending.clear()
  }

  return { index, ensure, clear }
}

/**
 * The public site's source: the list's baked (or live-served) detail JSON —
 * exactly what the read pages render, so membership matches what a visitor
 * sees on that list's own page.
 */
export function createPublicListShareSource(): ListShareSource {
  return {
    async load(ref: CombinedListRef): Promise<ListShareKeys | null> {
      try {
        const loaded = await loadListDetail(ref)
        return loaded.kind === 'deck'
          ? buildListShareKeys(
              loaded.detail.deck.sections.flatMap((section) => section.cards),
              loaded.detail.cards,
            )
          : buildListShareKeys(loaded.detail.entries, loaded.detail.cards)
      } catch (e) {
        // Deliberately NOT reportDataFetchError: share tokens arrive from
        // user-editable URLs, so a missing list is expected input here — it
        // must not degrade the whole app into static/fallback data mode.
        console.error(`Share filter: failed to load ${ref.type}/${ref.slug}:`, e)
        return null
      }
    },
  }
}

// ----- Session singleton -----

let activeSource: ListShareSource = createPublicListShareSource()

/**
 * Replace the session source (admin boot registration). Must run before any
 * list page mounts; already-cached keys are not reloaded.
 */
export function setListShareSource(source: ListShareSource): void {
  activeSource = source
}

// One store for the module's life: swapping the store itself would strand
// reactive subscribers on the old signal, so resets clear it instead.
const sessionStore: ListShareStore = createListShareStore(() => activeSource)

/** The session-wide loaded share index. */
export const listShareIndex: Accessor<ShareIndex> = () => sessionStore.index()

/** Ensure the given refKeys are loading/loaded in the session store. */
export function ensureListShares(keys: readonly ListRefKey[]): Promise<void> {
  return sessionStore.ensure(keys)
}

/** Test-only: drop the session cache and restore the public source. */
export function resetListShares(): void {
  activeSource = createPublicListShareSource()
  sessionStore.clear()
}

/**
 * Wire a page's filters to the session share store: whenever a list is
 * selected in either share filter, lazily load its keys; returns the context
 * accessor for `filterCards`. Reading the returned context inside the caller's
 * filtering memo is what makes the view update when a list's data arrives.
 */
export function useShareFilterContext(filters: CardFiltersControl): () => CardFilterContext {
  createEffect(() => {
    // Track the selections alone. The loads this kicks off write the share
    // index, and reading it here — even transitively — would re-run the
    // effect on every settled load anywhere in the app.
    const keys = [...filters.filters.sharedWith, ...filters.filters.notSharedWith]
    untrack(() => void ensureListShares(keys))
  })
  return () => ({ shares: listShareIndex() })
}

/** A page's share-filter offering: every other list, plus the page's own refKey. */
export interface ShareListsForPage {
  others: NamedListRef[]
  selfKey: ListRefKey
}

/**
 * The single spelling of "every list except this one, plus my own key": feeds
 * a page's share-filter options (`others`) and its URL-sync `currentShareList`
 * (`selfKey`), so the two can never disagree about which list is "this page".
 */
export function shareListsExcluding(
  lists: readonly NamedListRef[] | undefined,
  self: CombinedListRef,
): ShareListsForPage {
  const selfKey = listRefKey(self)
  return {
    others: (lists ?? []).filter((list) => listRefKey(list) !== selfKey),
    selfKey,
  }
}

/**
 * Drop `selfKey` from both share selections, writing only when a chip actually
 * names it. `useListViewUrlSync` already strips the current list from URL
 * state, but that sync is inert where URL state is off (the admin editors,
 * Move Cards) — and those surfaces keep one page component mounted across slug
 * switches, so a chip naming the newly opened list would survive and filter
 * the list against itself. Pages call this whenever their slug changes.
 */
export function pruneOwnShareSelections(filters: CardFiltersControl, selfKey: ListRefKey): void {
  // Composed through updateShareSelection — the selections' single writer, so
  // the disjointness invariant keeps exactly one owner — but only for a field
  // that actually holds the key: the writer rebuilds the field it is handed,
  // and an untouched selection must keep its array identity for the memos
  // keyed on it.
  let patch: Pick<CardFilters, ShareFilterField> | undefined
  for (const field of ['sharedWith', 'notSharedWith'] as const) {
    const base = patch ?? filters.filters
    if (!base[field].includes(selfKey)) continue
    patch = updateShareSelection(
      base,
      field,
      base[field].filter((key) => key !== selfKey),
    )
  }
  if (patch) filters.update(patch)
}
