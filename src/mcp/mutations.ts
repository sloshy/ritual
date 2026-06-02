import type { ChangeEvent } from '../change-event'
import type { ListType } from '../list-type'
import type { WantedListCardEntry, WantedListEntryState } from '../site/data-types'
import { DEFAULT_SECTION } from '../types'
import { applyChangeToDeck } from '../admin/site/types/deck-changes'
import { applyChangeToWantedList } from '../admin/site/types/wanted-changes'
import { callApi } from './dispatch'
import type {
  CollectionLoadResult,
  DeckLoadResult,
  ParsedWantedEntry,
  SaveResult,
  WantedLoadResult,
} from './types'

function slugPath(slug: string): string {
  return encodeURIComponent(slug)
}

function wantedState(entry: ParsedWantedEntry): WantedListEntryState {
  if (!entry.set || !entry.collectorNumber) return 'name-only'
  return entry.finish ? 'fully-specified' : 'printing'
}

/**
 * Convert the parsed entries returned by the wanted load endpoint into the
 * card-entry shape {@link applyChangeToWantedList} operates on. The wanted save
 * endpoint serializes the entries it receives (unlike the collection endpoint,
 * which re-derives them from disk), so the change must be applied here and the
 * full entry list sent back.
 */
function toWantedCardEntries(parsed: ParsedWantedEntry[]): WantedListCardEntry[] {
  return parsed.map((entry, index) => ({
    name: entry.name,
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    price: 0,
    fileOrder: index,
    section: entry.section ?? DEFAULT_SECTION,
    note: entry.note,
    state: wantedState(entry),
    cardId: entry.cardId,
  }))
}

/**
 * Apply one change to a deck atomically: load it fresh (for its current content
 * hash), apply the change client-side (the save endpoint persists the `deck` we
 * send, using `changes` only for the changelog), then save. The agent never sees
 * or manages the content hash; a concurrent edit surfaces as a 409 → tool error.
 */
export async function mutateDeck(slug: string, change: ChangeEvent): Promise<SaveResult> {
  const loaded = (await callApi('GET', `/api/deck/${slugPath(slug)}`)) as DeckLoadResult
  const deck = applyChangeToDeck(loaded.deck, change)
  return (await callApi('POST', `/api/deck/${slugPath(slug)}/save`, {
    changes: [change],
    deck,
    frontMatter: loaded.frontMatter,
    contentHash: loaded.contentHash,
  })) as SaveResult
}

/**
 * Apply one change to a collection atomically. The collection save endpoint
 * re-parses the file and replays the changes itself, so only the change list,
 * the content hash, and the section order need to be sent.
 */
export async function mutateCollection(slug: string, change: ChangeEvent): Promise<SaveResult> {
  const loaded = (await callApi('GET', `/api/collection/${slugPath(slug)}`)) as CollectionLoadResult
  return (await callApi('POST', `/api/collection/${slugPath(slug)}/save`, {
    changes: [change],
    contentHash: loaded.contentHash,
    sectionOrder: loaded.sectionOrder,
  })) as SaveResult
}

/** Apply one change to a wanted list atomically (see {@link toWantedCardEntries}). */
export async function mutateWanted(slug: string, change: ChangeEvent): Promise<SaveResult> {
  const loaded = (await callApi('GET', `/api/wanted/${slugPath(slug)}`)) as WantedLoadResult
  const entries = applyChangeToWantedList(toWantedCardEntries(loaded.entries), change)
  return (await callApi('POST', `/api/wanted/${slugPath(slug)}/save`, {
    changes: [change],
    entries,
    contentHash: loaded.contentHash,
    sectionOrder: loaded.sectionOrder,
  })) as SaveResult
}

/** Apply one change to a list of the given type via its load→mutate→save flow. */
export function mutateList(type: ListType, slug: string, change: ChangeEvent): Promise<SaveResult> {
  if (type === 'deck') return mutateDeck(slug, change)
  if (type === 'collection') return mutateCollection(slug, change)
  return mutateWanted(slug, change)
}
