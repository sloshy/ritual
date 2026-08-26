import { pickMessage, type ApiMessage } from '../admin/api/result'
import type { ChangeEvent } from '../changes/change-event'
import type { ListType } from '../list/list-type'
import {
  applyChangesCollectingMisses,
  describeUnmatchedChanges,
  listUnmatchedChanges,
  type UnmatchedChange,
} from '../editor/apply-batch'
import { applyChangeToDeck } from '../editor/deck-changes'
import { applyChangeToWantedList } from '../editor/wanted-changes'
import { toWantedCardEntries } from '../editor/wanted-entries'
import { callApi } from './dispatch'
import { apiErrorToMcp, isConflictError, type McpErrorDetail } from './errors'
import type {
  CollectionLoadResult,
  DeckLoadResult,
  ListSaveResponse,
  SaveEffect,
  WantedLoadResult,
} from './types'

function slugPath(slug: string): string {
  return encodeURIComponent(slug)
}

/**
 * The load every mutation opens with. `view=cards` skips the Scryfall card,
 * printing, price, and symbol-map work a mutation never reads — for a deck it
 * still carries `frontMatter`, which the save re-sends.
 */
function loadPath(type: ListType, slug: string): string {
  return `/api/${type}/${slugPath(slug)}?view=cards`
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
  // The per-change descriptions ride along as structured detail so the tool
  // wrapper can report them as `unmatched` rather than only in the message.
  throw apiErrorToMcp(
    400,
    {
      message:
        describeUnmatchedChanges(unmatched, { type, slug }) +
        ' Call get_list to see the current entries and their cardIds.',
    },
    { unmatched: listUnmatchedChanges(unmatched) } satisfies McpErrorDetail,
  )
}

/**
 * Run a load→apply→save attempt, retrying **once** when the list changed under
 * it.
 *
 * The retry re-runs the whole attempt, load included, so the changes are applied
 * to the content that actually won — a retry that resent the stale hash would
 * only lose again. A second conflict propagates: two losses in a row mean a live
 * concurrent editor, and retrying forever would let the agent overwrite work it
 * never saw.
 */
export async function withConflictRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt()
  } catch (error) {
    if (!isConflictError(error)) throw error
    return await attempt()
  }
}

/**
 * Apply an ordered batch of changes to a deck atomically: load it fresh (for its
 * current content hash), apply every change client-side in order (the save
 * endpoint persists the `deck` we send, using `changes` only for the changelog),
 * then save once — one load, one write, one changelog block. The agent never
 * sees or manages the content hash; a concurrent edit surfaces as a 409 → tool
 * error.
 */
export function mutateDeck(slug: string, changes: ChangeEvent[]): Promise<ListSaveResponse> {
  return withConflictRetry(async () => {
    const loaded = (await callApi('GET', loadPath('deck', slug))) as DeckLoadResult
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
      validateCardNames: true,
    })) as ListSaveResponse
  })
}

/**
 * Apply an ordered batch of changes to a collection atomically. The collection
 * save endpoint re-parses the file and replays the changes itself, so only the
 * change list, the content hash, and the section order need to be sent. A
 * change that misses its target is rejected by the handler (400 → tool error
 * naming the unapplied changes); nothing is saved.
 */
export function mutateCollection(slug: string, changes: ChangeEvent[]): Promise<ListSaveResponse> {
  return withConflictRetry(async () => {
    const loaded = (await callApi('GET', loadPath('collection', slug))) as CollectionLoadResult
    return (await callApi('POST', `/api/collection/${slugPath(slug)}/save`, {
      changes,
      contentHash: loaded.contentHash,
      sectionOrder: loaded.sectionOrder,
      validateCardNames: true,
    })) as ListSaveResponse
  })
}

/** Apply an ordered batch of changes to a wanted list atomically (see {@link toWantedCardEntries}). */
export function mutateWanted(slug: string, changes: ChangeEvent[]): Promise<ListSaveResponse> {
  return withConflictRetry(async () => {
    const loaded = (await callApi('GET', loadPath('wanted', slug))) as WantedLoadResult
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
      validateCardNames: true,
    })) as ListSaveResponse
  })
}

/** Apply an ordered change batch to a list of the given type via its load→mutate→save flow. */
export function mutateList(
  type: ListType,
  slug: string,
  changes: ChangeEvent[],
): Promise<ListSaveResponse> {
  if (type === 'deck') return mutateDeck(slug, changes)
  if (type === 'collection') return mutateCollection(slug, changes)
  return mutateWanted(slug, changes)
}

/**
 * What a mutation did, as the write tools report it.
 *
 * `applied` is the batch size, which is honest under the all-or-nothing
 * contract: a call that returns at all applied every change it was given.
 */
export interface MutationResult extends ApiMessage {
  applied: number
  listType: ListType
  slug: string
  /**
   * What the save did to individual entries, with the `&N` ids it allocated —
   * the round trip to `get_list` this used to require.
   */
  effects: SaveEffect[]
  /**
   * Changes that did not apply. Always empty on a returning call: single-list
   * edits are all-or-nothing, so a batch with a miss fails with a structured
   * error carrying the same list (`ToolErrorPayload.unmatched`). Present so the
   * success and failure shapes speak one vocabulary.
   */
  unmatched: string[]
  /**
   * Custom-art sidecars the save could not re-file — the list's own, or a move
   * destination's. Never a failure: the card lines were written, and only the
   * `&N` re-filing of `<list>.art.json` did not happen. Absent when clean.
   */
  artWarnings?: string[]
}

/** {@link mutateList}, reported as the structured result the write tools return. */
export async function applyMutation(
  type: ListType,
  slug: string,
  changes: ChangeEvent[],
): Promise<MutationResult> {
  const saved = await mutateList(type, slug, changes)
  return {
    applied: changes.length,
    // The whole message triple, not just the rendered English: every other tool
    // result is `OmitSuccess<HandlerResponse>` and carries the pair
    // structurally, and mcp.md documents that as a blanket property of results
    // the shared admin handlers produce.
    ...pickMessage(saved),
    listType: type,
    slug,
    effects: saved.effects,
    unmatched: [],
    ...(saved.artWarnings === undefined ? {} : { artWarnings: saved.artWarnings }),
  }
}
