import type { ChangeEvent } from '../changes/change-event'
import type { EditorStatusActions } from './useEditorStatus'
import type { SaveEffect } from '../changes/save-effects'
import { listSavePath, listSaveRequest } from '../changes/wire-changes'
import type { ListType } from '../list/list-type'
import { saveEditorChanges } from './saveEditorChanges'

/** Everything a {@link CommitSink} needs to persist (or export) a set of edits. */
export type CommitContext = {
  slug: string
  changes: readonly ChangeEvent[]
  contentHash: string
  /**
   * True when this session has already saved at least once, so the changelog
   * should fold these changes into the existing session entry rather than open
   * a new one.
   */
  continueSession: boolean
  /** Drives the editor's save/error status messaging. */
  statusActions: EditorStatusActions
}

/**
 * Outcome of a commit. A new `contentHash` (when returned) refreshes the
 * editor's conflict baseline and marks the commit as landed; the `effects` are
 * what the save reported it did to individual card lines, which is how a client
 * learns the `&N` its optimistic ids became. A sink with no server behind it
 * (the public editor's export) returns neither.
 */
export type CommitResult =
  | {
      contentHash?: string
      effects?: readonly SaveEffect[]
      /**
       * Card names whose categories the save pruned, so the editor's baseline
       * record can adopt exactly what the file now holds.
       */
      prunedCategories?: readonly string[]
    }
  | undefined

/**
 * How an editor "commits" its edits. The admin editor POSTs them to the list's
 * save route ({@link createApiCommit}); the public site instead exports the
 * change list or downloads an updated list file. Injecting this is what lets the
 * same editor run with or without a server backend.
 */
export type CommitSink = (ctx: CommitContext) => Promise<CommitResult>

/**
 * Admin {@link CommitSink}: posts the pending changes to
 * `/api/{type}/{slug}/save` and surfaces success/conflict/error status.
 *
 * Only the changes travel — in their wire form, without the session envelope —
 * because the route replays them over the file itself. The list never does, so
 * a save's size follows the edit rather than the list.
 */
export function createApiCommit(type: ListType): CommitSink {
  return async (ctx) => {
    const result = await saveEditorChanges(
      listSavePath(type, ctx.slug),
      listSaveRequest(ctx.changes, ctx.contentHash, { continueSession: ctx.continueSession }),
      ctx.statusActions,
    )
    return result?.contentHash
      ? {
          contentHash: result.contentHash,
          effects: result.effects,
          prunedCategories: result.prunedCategories,
        }
      : undefined
  }
}
