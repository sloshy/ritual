import { writeFileWithHash, hashPath } from '../../content-hash'
import { getErrorMessage } from '../../errors'
import { appendChangelog } from '../../changelog-writer'
import type { WantedListCardEntry } from '../../site/data-types'
import type { ChangeEvent } from '../../change-event'
import { getWantedDir } from '../../ritual-config'
import { wantedToMarkdown } from '../../editor/list-export'
import { parseTitleFromContent } from '../../section-format'
import { parseWantedListFile } from '../../commands/wanted-helpers'
import { assignEntryIds } from '../../card-id'
import { computeEntrySaveEffects } from '../../editor/save-effects'
import { changeCardNames, refuseUnknownCardNames } from './card-name-check'
import { applyOutgoingMoves, type ListSaveResponse } from './move-save'
import {
  apiError,
  PARTIAL_LOAD_HINT,
  readJsonObjectBody,
  validateContentHash,
  autoCommitAndPush,
  normalizeRequestNotes,
} from './save-helpers'
import { resolveFlatListFile, resolveListFileOrRefuse } from './list-file'
import { parseSlugFromUrl } from './target'

interface WantedListSaveRequest {
  changes: ChangeEvent[]
  entries: WantedListCardEntry[]
  contentHash: string
  /** Section names in display order, including empty sections. Optional for back-compat. */
  sectionOrder?: string[]
  /** Merge into the session's existing changelog entry instead of a new one. */
  continueSession?: boolean
  /** Refuse the save when a change names a card the local Scryfall cache does not know. */
  validateCardNames?: boolean
}

export async function handleWantedListSave(req: Request): Promise<Response> {
  try {
    const parsedSlug = parseSlugFromUrl(req)
    if (!parsedSlug.ok) return apiError(parsedSlug.message, 400)
    const { slug } = parsedSlug

    const parsedBody = await readJsonObjectBody(req)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.body as unknown as WantedListSaveRequest
    const { changes, entries, contentHash, sectionOrder, continueSession } = body

    if (!entries || !changes || typeof contentHash !== 'string') {
      return apiError(`changes, entries, and contentHash are required. ${PARTIAL_LOAD_HINT}`, 400)
    }

    const noteError = normalizeRequestNotes(changes, entries)
    if (noteError) return noteError

    const wantedListsDir = getWantedDir()
    const resolved = await resolveListFileOrRefuse(resolveFlatListFile, {
      slug,
      dir: wantedListsDir,
      label: 'wanted list',
    })
    if (!resolved.ok) return resolved.response
    const { filePath } = resolved

    // Validate content hash for conflict detection
    const hashCheck = await validateContentHash(filePath, contentHash, 'Wanted list')
    if (!hashCheck.valid) return hashCheck.response

    // The list as it stands on disk: the baseline for both the card-name check
    // and the effects diff. Parsed once — not from the request's `entries`,
    // which already carry the change and would vouch for the very name added.
    const previousEntries = parseWantedListFile(hashCheck.content).entries
    const nameError = await refuseUnknownCardNames(
      body.validateCardNames,
      changeCardNames(changes),
      () => previousEntries.map((entry) => entry.name),
    )
    if (nameError) return nameError

    const filesToCommit: string[] = [filePath, hashPath(filePath)]

    // Re-serialize as a sectioned list, preserving the `# Title` H1. Entries carry their
    // section from the client; the client-sent section order drives ordering (including any
    // now-empty sections), falling back to the order discovered in the entries themselves.
    const title = parseTitleFromContent(hashCheck.content) ?? slug

    // Apply the destination side of any cross-list moves first; a bad destination
    // aborts before the source is rewritten.
    const outgoing = await applyOutgoingMoves({ type: 'wanted', name: title }, changes)
    filesToCommit.push(...outgoing.writtenFiles)

    const order = sectionOrder ?? []
    // Ids are assigned here rather than only inside `wantedToMarkdown` (which
    // re-runs the assigner idempotently) so the response can report them.
    const { entries: idedEntries, assignments } = assignEntryIds(entries)
    const newContent = wantedToMarkdown(title, idedEntries, order)
    const newContentHash = await writeFileWithHash(filePath, newContent)

    // Write changelog
    if (changes.length > 0) {
      const changelogPath = await appendChangelog(filePath, slug, changes, { continueSession })
      filesToCommit.push(changelogPath)
    }

    // Auto-commit if enabled
    await autoCommitAndPush(
      wantedListsDir,
      filesToCommit,
      `Edit wanted list: ${slug} (${changes.length} changes)`,
    )

    const responseBody: ListSaveResponse = {
      success: true,
      message: `Saved ${changes.length} changes to ${slug}`,
      contentHash: newContentHash,
      droppedNotes: outgoing.droppedNotes,
      effects: computeEntrySaveEffects({
        before: previousEntries,
        after: idedEntries,
        assignments,
      }),
    }
    return Response.json(responseBody)
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
  }
}
