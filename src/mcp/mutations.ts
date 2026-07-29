import type { ChangeEvent } from '../change-event'
import type { ListType } from '../list-type'
import {
  applyChangesCollectingMisses,
  describeUnmatchedChanges,
  type UnmatchedChange,
} from '../editor/apply-batch'
import { applyChangeToDeck } from '../editor/deck-changes'
import { applyChangeToWantedList } from '../editor/wanted-changes'
import { toWantedCardEntries } from '../editor/wanted-entries'
import { callApi } from './dispatch'
import { apiErrorToMcp } from './errors'
import type { CollectionLoadResult, DeckLoadResult, SaveResult, WantedLoadResult } from './types'

function slugPath(slug: string): string {
  return encodeURIComponent(slug)
}

/**
 * Fail the whole batch when any change did not apply: nothing is saved, no
 * changelog block is written, and the error names each unapplied change — the
 * alternative (report success, write nothing) is the one behavior an agent
 * cannot recover from, because it never learns anything went wrong.
 */
function assertAllApplied(
  unmatched: UnmatchedChange<ChangeEvent>[],
  type: ListType,
  slug: string,
): void {
  if (unmatched.length === 0) return
  throw apiErrorToMcp(400, {
    message:
      describeUnmatchedChanges(unmatched, { type, slug }) +
      ' Call load_list to see the current entries and their cardIds.',
  })
}

/**
 * Apply an ordered batch of changes to a deck atomically: load it fresh (for its
 * current content hash), apply every change client-side in order (the save
 * endpoint persists the `deck` we send, using `changes` only for the changelog),
 * then save once — one load, one write, one changelog block. The agent never
 * sees or manages the content hash; a concurrent edit surfaces as a 409 → tool
 * error.
 */
export async function mutateDeck(slug: string, changes: ChangeEvent[]): Promise<SaveResult> {
  const loaded = (await callApi('GET', `/api/deck/${slugPath(slug)}`)) as DeckLoadResult
  const { data: deck, unmatched } = applyChangesCollectingMisses(
    loaded.deck,
    changes,
    applyChangeToDeck,
  )
  assertAllApplied(unmatched, 'deck', slug)
  return (await callApi('POST', `/api/deck/${slugPath(slug)}/save`, {
    changes,
    deck,
    frontMatter: loaded.frontMatter,
    contentHash: loaded.contentHash,
  })) as SaveResult
}

/**
 * Apply an ordered batch of changes to a collection atomically. The collection
 * save endpoint re-parses the file and replays the changes itself, so only the
 * change list, the content hash, and the section order need to be sent. A
 * change that misses its target is rejected by the handler (400 → tool error
 * naming the unapplied changes); nothing is saved.
 */
export async function mutateCollection(slug: string, changes: ChangeEvent[]): Promise<SaveResult> {
  const loaded = (await callApi('GET', `/api/collection/${slugPath(slug)}`)) as CollectionLoadResult
  return (await callApi('POST', `/api/collection/${slugPath(slug)}/save`, {
    changes,
    contentHash: loaded.contentHash,
    sectionOrder: loaded.sectionOrder,
  })) as SaveResult
}

/** Apply an ordered batch of changes to a wanted list atomically (see {@link toWantedCardEntries}). */
export async function mutateWanted(slug: string, changes: ChangeEvent[]): Promise<SaveResult> {
  const loaded = (await callApi('GET', `/api/wanted/${slugPath(slug)}`)) as WantedLoadResult
  const { data: entries, unmatched } = applyChangesCollectingMisses(
    toWantedCardEntries(loaded.entries),
    changes,
    applyChangeToWantedList,
  )
  assertAllApplied(unmatched, 'wanted', slug)
  return (await callApi('POST', `/api/wanted/${slugPath(slug)}/save`, {
    changes,
    entries,
    contentHash: loaded.contentHash,
    sectionOrder: loaded.sectionOrder,
  })) as SaveResult
}

/** Apply an ordered change batch to a list of the given type via its load→mutate→save flow. */
export function mutateList(
  type: ListType,
  slug: string,
  changes: ChangeEvent[],
): Promise<SaveResult> {
  if (type === 'deck') return mutateDeck(slug, changes)
  if (type === 'collection') return mutateCollection(slug, changes)
  return mutateWanted(slug, changes)
}
