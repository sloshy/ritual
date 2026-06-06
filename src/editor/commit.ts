import type { ChangeEvent } from '../change-event'
import type { EditorStatusActions } from './useEditorStatus'
import { saveEditorChanges } from './saveEditorChanges'

/** Everything a {@link CommitSink} needs to persist (or export) a set of edits. */
export type CommitContext<TData> = {
  slug: string
  data: TData
  changes: ChangeEvent[]
  contentHash: string
  extra: Record<string, unknown>
  sectionOrder: string[]
  /** Drives the editor's save/error status messaging. */
  statusActions: EditorStatusActions
  /** Clears the pending-change stack on a successful commit. */
  discardAll: () => void
}

/** Outcome of a commit. A new `contentHash` (when returned) refreshes the editor's conflict baseline. */
export type CommitResult = { contentHash?: string } | undefined

/** The editor state a {@link createApiCommit} `buildSaveBody` turns into a POST body. */
export type SaveBodyParams<TData> = {
  data: TData
  changes: ChangeEvent[]
  contentHash: string
  extra: Record<string, unknown>
  sectionOrder: string[]
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
      }),
      ctx.statusActions,
      ctx.discardAll,
    )
    return result?.contentHash ? { contentHash: result.contentHash } : undefined
  }
}
