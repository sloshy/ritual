import type { ChangeEvent } from '../change-event'
import type { ListType } from '../list-type'
import { applyChangeToDeck } from '../editor/deck-changes'
import { applyChangeToWantedList } from '../editor/wanted-changes'
import { toWantedCardEntries } from '../editor/wanted-entries'
import { callApi } from './dispatch'
import type { CollectionLoadResult, DeckLoadResult, SaveResult, WantedLoadResult } from './types'

function slugPath(slug: string): string {
  return encodeURIComponent(slug)
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
