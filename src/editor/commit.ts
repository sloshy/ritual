import type { ChangeEvent } from '../changes/change-event'
import type { EditorStatusActions } from './useEditorStatus'
import type { SaveEffect } from '../changes/save-effects'
import { saveEditorChanges } from './saveEditorChanges'

/** Everything a {@link CommitSink} needs to persist (or export) a set of edits. */
export type CommitContext<TData> = {
  slug: string
  data: TData
  changes: ChangeEvent[]
  contentHash: string
  extra: Record<string, unknown>
  sectionOrder: string[]
  /**
   * True when this session has already saved at least once, so the changelog
   * should fold these changes into the existing session entry rather than open
   * a new one.
   */
  continueSession: boolean
  /** Drives the editor's save/error status messaging. */
  statusActions: EditorStatusActions
  /** Clears the pending-change stack on a successful commit. */
  discardAll: () => void
}

/**
 * Outcome of a commit. A new `contentHash` (when returned) refreshes the
 * editor's conflict baseline; the `effects` are what the save reported it did to
 * individual card lines, which is how a client learns the `&N` its optimistic
 * ids became. A sink with no server behind it (the public editor's export)
 * returns neither.
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

/** The editor state a {@link createApiCommit} `buildSaveBody` turns into a POST body. */
export type SaveBodyParams<TData> = {
  data: TData
  changes: ChangeEvent[]
  contentHash: string
  extra: Record<string, unknown>
  sectionOrder: string[]
  /** Whether to merge this save into the session's existing changelog entry. */
  continueSession: boolean
}

/**
 * How an editor "commits" its edits. The admin editor POSTs to a save endpoint
 * ({@link createApiCommit}); the public site instead exports the change list or
 * downloads an updated list file. Injecting this is what lets the same editor run
 * with or without a server backend.
 */
export type CommitSink<TData> = (ctx: CommitContext<TData>) => Promise<CommitResult>

/**
 * Admin {@link CommitSink}: builds the POST body and saves it to the server,
 * surfacing success/conflict/error status. `buildSaveBody` is list-specific
 * (decks carry front matter, flat lists carry section order, etc.).
 */
export function createApiCommit<TData>(
  saveEndpoint: (slug: string) => string,
  buildSaveBody: (params: SaveBodyParams<TData>) => unknown,
): CommitSink<TData> {
  return async (ctx) => {
    const result = await saveEditorChanges(
      saveEndpoint(ctx.slug),
      buildSaveBody({
        data: ctx.data,
        changes: ctx.changes,
        contentHash: ctx.contentHash,
        extra: ctx.extra,
        sectionOrder: ctx.sectionOrder,
        continueSession: ctx.continueSession,
      }),
      ctx.statusActions,
      ctx.discardAll,
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
