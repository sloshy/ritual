import { ProtocolError } from '@modelcontextprotocol/server'
import { pickMessage, type ApiMessage } from '../api/result'
import type { ChangeEvent } from '../changes/change-event'
import type { ListType } from '../list/list-type'
import { listSavePath, listSaveRequest } from '../changes/wire-changes'
import { callApi } from './dispatch'
import { isConflictError, mcpErrorDetail } from './errors'
import type { ListSaveResponse, SaveEffect } from './types'

/**
 * The load every mutation opens with, read only for the list's content hash.
 * `view=cards` skips the Scryfall card, printing, price, and symbol-map work a
 * mutation never needs.
 */
function loadPath(type: ListType, slug: string): string {
  return `/api/${type}/${encodeURIComponent(slug)}?view=cards`
}

/** The one field of a list load a mutation reads; an unfiltered load always carries it. */
type LoadedHash = { contentHash: string }

/**
 * Run a load→save attempt, retrying **once** when the list changed under it.
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
 * Point an all-or-nothing refusal at the tool that shows the current entries.
 * The route's message already names each change that missed; the agent's next
 * move is to re-read the list, which only this surface knows to suggest.
 */
function withGetListHint(error: unknown): unknown {
  const detail = mcpErrorDetail(error)
  if (!ProtocolError.isInstance(error) || detail?.unmatched === undefined) return error
  return new ProtocolError(
    error.code,
    `${error.message} Call get_list to see the current entries and their cardIds.`,
    detail,
  )
}

/**
 * Apply an ordered batch of changes to a list atomically: load it (for its
 * current content hash), then post the changes alone to its save route, which
 * replays them over the file — one write, one changelog block. A change that
 * misses its target fails the whole batch with a structured `unmatched` list and
 * nothing is saved; a concurrent edit surfaces as a 409 and is retried once. The
 * agent never sees or manages the content hash.
 */
export async function mutateList(
  type: ListType,
  slug: string,
  changes: ChangeEvent[],
): Promise<ListSaveResponse> {
  try {
    return await withConflictRetry(async () => {
      const loaded = (await callApi('GET', loadPath(type, slug))) as LoadedHash
      return (await callApi(
        'POST',
        listSavePath(type, slug),
        listSaveRequest(changes, loaded.contentHash, { validateCardNames: true }),
      )) as ListSaveResponse
    })
  } catch (error) {
    throw withGetListHint(error)
  }
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
  /**
   * Categories sidecars the save could not read or write. Never a failure: the
   * card lines were written and only `<list>.categories.json` stayed as it was.
   * Absent when clean.
   */
  categoryWarnings?: string[]
  /**
   * Card names whose category assignments this save dropped, because the list
   * no longer holds a line of that name — categories are keyed by name in one
   * list, so the assignment goes with the last copy. Absent when none.
   */
  prunedCategories?: string[]
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
    ...(saved.categoryWarnings === undefined ? {} : { categoryWarnings: saved.categoryWarnings }),
    ...(saved.prunedCategories === undefined ? {} : { prunedCategories: saved.prunedCategories }),
  }
}
