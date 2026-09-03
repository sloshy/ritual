import { getErrorMessage } from '../../util/errors'
import type { WantedListCardEntry } from '../../list/site-data'
import type { ChangeEvent } from '../../changes/change-event'
import { getWantedDir } from '../../config/ritual-config'
import { wantedToMarkdown } from '../../list/list-export'
import { parseTitleFromContent } from '../../list/section-format'
import { parseWantedListFile } from '../../list/wanted-file'
import { assignEntryIds } from '../../card/card-id'
import { computeEntrySaveEffects } from '../../changes/save-effects'
import { changeCardNames, refuseUnknownCardNames } from './card-name-check'
import { applyCrossListMoves } from '../../list/move-prepare'
import { apiError, readJsonObjectBody } from '../../api/http'
import {
  PARTIAL_LOAD_HINT,
  validateContentHash,
  finishListSave,
  normalizeRequestCategories,
  listSaveOutcome,
  listSaveResponse,
  normalizeRequestLanguages,
  normalizeRequestReplacements,
  normalizeRequestNotes,
  normalizeRequestTags,
  refuseUnreadableBaseline,
  type ListSaveTail,
} from './save-helpers'
import { entryLineQuantities } from '../../changes/line-copies'
import { resolveFlatListFile, resolveListFileOrRefuse } from './list-file'
import { parseSlugFromUrl } from './target'
import { MAX_LIST_BODY_SIZE } from '../validation'

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

    const parsedBody = await readJsonObjectBody(req, MAX_LIST_BODY_SIZE)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.body as unknown as WantedListSaveRequest
    const { changes, entries, contentHash, sectionOrder, continueSession } = body

    if (!entries || !changes || typeof contentHash !== 'string') {
      return apiError(`changes, entries, and contentHash are required. ${PARTIAL_LOAD_HINT}`, 400)
    }

    const noteError = normalizeRequestNotes(changes, entries)
    if (noteError) return noteError

    // The request's entries are serialized directly, so their languages and
    // tags are validated alongside the changes'.
    const languageError = normalizeRequestLanguages(changes, entries)
    if (languageError) return languageError

    const tagError = normalizeRequestTags(changes, entries)
    if (tagError) return tagError

    const replacementError = normalizeRequestReplacements(changes)
    if (replacementError) return replacementError

    const categoryError = normalizeRequestCategories(changes)
    if (categoryError) return categoryError

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
    const previous = parseWantedListFile(hashCheck.content)
    // A line this parse could not read is a line the save would delete, because
    // the write re-serializes the whole list — refuse instead.
    const unreadable = refuseUnreadableBaseline(filePath, previous)
    if (unreadable) return unreadable
    const previousEntries = previous.entries
    const nameError = await refuseUnknownCardNames(
      body.validateCardNames,
      changeCardNames(changes),
      () => previousEntries.map((entry) => entry.name),
    )
    if (nameError) return nameError

    // Re-serialize as a sectioned list, preserving the `# Title` H1. Entries carry their
    // section from the client; the client-sent section order drives ordering (including any
    // now-empty sections), falling back to the order discovered in the entries themselves.
    const title = parseTitleFromContent(hashCheck.content) ?? slug

    // Apply the other side of any cross-list moves first — the destination of
    // each `move-from`, the source of each `move-to` — every one validated in
    // memory before anything lands, so a bad destination (missing list, or a
    // printing-less card into a collection) or a source with no copy to take
    // aborts before this list is written.
    const previousLineQuantities = entryLineQuantities(previousEntries)
    const moves = await applyCrossListMoves(
      { type: 'wanted', name: title },
      filePath,
      changes,
      previousLineQuantities,
    )

    const order = sectionOrder ?? []
    // Ids are assigned here rather than only inside `wantedToMarkdown` (which
    // re-runs the assigner idempotently) so the response can report them.
    const { entries: idedEntries, assignments } = assignEntryIds(entries)
    const newContent = wantedToMarkdown(title, idedEntries, order, previous.frontMatter)

    const tail: ListSaveTail = {
      listType: 'wanted',
      filePath,
      content: newContent,
      changelogName: slug,
      changes,
      // Computed before the write: the tail re-files the list's custom art
      // against the ids these effects report as freed or renumbered.
      effects: computeEntrySaveEffects({
        before: previousEntries,
        after: idedEntries,
        assignments,
      }),
      previousLineQuantities,
      continueSession,
      extraFiles: moves.writtenFiles,
      adoptedArt: moves.adoptedArt,
      // The names the written content holds — what the categories sidecar (keyed
      // by card name) is pruned against.
      cardNames: idedEntries.map((entry) => entry.name),
    }
    const saved = await finishListSave(tail)

    return Response.json(listSaveResponse(tail, listSaveOutcome(saved, moves)))
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
  }
}
