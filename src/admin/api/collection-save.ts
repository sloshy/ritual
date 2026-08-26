import { getErrorMessage } from '../../util/errors'
import type { CollectionCardEntry } from '../../list/site-data'
import type { ChangeEvent } from '../../changes/change-event'
import { applyChangesCollectingMisses, describeUnmatchedChanges } from '../../changes/apply-batch'
import { getCollectionsDir } from '../../config/ritual-config'
import { assignEntryIds } from '../../card/card-id'
import { parseCollectionFile } from '../../list/collection-file'
import { computeEntrySaveEffects } from '../../editor/save-effects'
import {
  applyChangeToCollection,
  findCollectionPrintingError,
  toCollectionCardEntries,
} from '../../changes/collection-changes'
import { collectionToMarkdown } from '../../list/list-export'
import { parseTitleFromContent } from '../../list/section-format'
import { changeCardNames, refuseUnknownCardNames } from './card-name-check'
import { applyCrossListMoves } from './move-save'
import {
  apiError,
  entryLineQuantities,
  PARTIAL_LOAD_HINT,
  readJsonObjectBody,
  validateContentHash,
  finishListSave,
  listSaveOutcome,
  listSaveResponse,
  normalizeRequestLabels,
  normalizeRequestLanguages,
  normalizeRequestReplacements,
  normalizeRequestNotes,
  refuseUnreadableBaseline,
  type ListSaveTail,
} from './save-helpers'
import { resolveFlatListFile, resolveListFileOrRefuse } from './list-file'
import { parseSlugFromUrl } from './target'
import { MAX_LIST_BODY_SIZE } from '../validation'

interface CollectionSaveRequest {
  changes: ChangeEvent[]
  contentHash: string
  /** Section names in display order, including empty sections. Optional for back-compat. */
  sectionOrder?: string[]
  /** Merge into the session's existing changelog entry instead of a new one. */
  continueSession?: boolean
  /** Refuse the save when a change names a card the local Scryfall cache does not know. */
  validateCardNames?: boolean
}

export async function handleCollectionSave(req: Request): Promise<Response> {
  try {
    const parsedSlug = parseSlugFromUrl(req)
    if (!parsedSlug.ok) return apiError(parsedSlug.message, 400)
    const { slug } = parsedSlug

    const parsedBody = await readJsonObjectBody(req, MAX_LIST_BODY_SIZE)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.body as unknown as CollectionSaveRequest
    const { changes, contentHash, sectionOrder, continueSession } = body

    if (!changes || typeof contentHash !== 'string') {
      return apiError(`changes and contentHash are required. ${PARTIAL_LOAD_HINT}`, 400)
    }

    const noteError = normalizeRequestNotes(changes, [])
    if (noteError) return noteError

    const labelError = normalizeRequestLabels(changes, 'collection')
    if (labelError) return labelError

    // Collection entries are rebuilt server-side from the baseline file, so only
    // the changes carry request-supplied languages here.
    const languageError = normalizeRequestLanguages(changes, [])
    if (languageError) return languageError

    const replacementError = normalizeRequestReplacements(changes)
    if (replacementError) return replacementError

    const printingError = findCollectionPrintingError(changes)
    if (printingError) return apiError(printingError, 400)

    const collectionsDir = getCollectionsDir()
    const resolved = await resolveListFileOrRefuse(resolveFlatListFile, {
      slug,
      dir: collectionsDir,
      label: 'collection',
    })
    if (!resolved.ok) return resolved.response
    const { filePath } = resolved

    // Validate content hash for conflict detection
    const hashCheck = await validateContentHash(filePath, contentHash, 'Collection')
    if (!hashCheck.valid) return hashCheck.response

    // Parse the file and build card entries. A line this parse could not read is
    // a line the save would delete, because the write re-serializes the whole
    // list from these entries — refuse instead.
    const parsed = parseCollectionFile(hashCheck.content)
    const unreadable = refuseUnreadableBaseline(filePath, parsed)
    if (unreadable) return unreadable
    const cardEntries = toCollectionCardEntries(parsed.entries)

    const nameError = await refuseUnknownCardNames(
      body.validateCardNames,
      changeCardNames(changes),
      () => parsed.entries.map((entry) => entry.name),
    )
    if (nameError) return nameError

    // Replay the changes, tracking any that do not apply. A miss means the
    // caller's view of the list is wrong (the content hash only guards against
    // concurrent *file* edits) — rejecting is the only honest answer, because a
    // save that reports success while dropping changes also writes a changelog
    // block for edits that never happened.
    const { data: current, unmatched } = applyChangesCollectingMisses<
      CollectionCardEntry[],
      ChangeEvent
    >(cardEntries, changes, applyChangeToCollection)
    if (unmatched.length > 0) {
      return apiError(describeUnmatchedChanges(unmatched, { type: 'collection', slug }), 400)
    }

    // Re-serialize as a sectioned list, preserving the `# Title` H1. The client-sent section
    // order (which reflects any add/rename/remove-section edits, including now-empty sections)
    // drives ordering; fall back to the file's parsed order when the client omits it.
    const title = parseTitleFromContent(hashCheck.content) ?? slug

    // Apply the other side of any cross-list moves first — the destination of
    // each `move-from`, the source of each `move-to` — every one validated in
    // memory before anything lands, so a bad destination (missing list, or a
    // printing-less card into a collection) or a source with no copy to take
    // aborts before this list is written.
    const previousLineQuantities = entryLineQuantities(cardEntries)
    const moves = await applyCrossListMoves(
      { type: 'collection', name: title },
      filePath,
      changes,
      previousLineQuantities,
    )

    const order = sectionOrder ?? parsed.sectionOrder
    // Ids are assigned here rather than only inside `collectionToMarkdown`
    // (which re-runs the assigner idempotently) so the response can report them.
    const { entries: idedEntries, assignments } = assignEntryIds(current)
    const newContent = collectionToMarkdown(title, idedEntries, order, parsed.frontMatter)

    const tail: ListSaveTail = {
      listType: 'collection',
      filePath,
      content: newContent,
      changelogName: slug,
      changes,
      // Computed before the write: the tail re-files the list's custom art
      // against the ids these effects report as freed or renumbered.
      effects: computeEntrySaveEffects({ before: cardEntries, after: idedEntries, assignments }),
      previousLineQuantities,
      continueSession,
      extraFiles: moves.writtenFiles,
      adoptedArt: moves.adoptedArt,
    }
    const saved = await finishListSave(tail)

    return Response.json(listSaveResponse(tail, listSaveOutcome(saved, moves)))
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
  }
}
