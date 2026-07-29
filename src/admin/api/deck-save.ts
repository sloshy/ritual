import { assignDeckCardIds } from '../../card-id'
import { writeFileWithHash, hashPath } from '../../content-hash'
import { serializeDeckToMarkdown } from '../../deck-file'
import { computeDeckSaveEffects } from '../../editor/save-effects'
import { getErrorMessage } from '../../errors'
import { appendChangelog } from '../../changelog-writer'
import type { DeckData } from '../../types'
import type { ChangeEvent } from '../../change-event'
import { getDecksDir } from '../../ritual-config'
import { parseDeckText } from '../../importers/text-file'
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
import { resolveDeckFile, resolveListFileOrRefuse } from './list-file'
import { parseSlugFromUrl } from './target'

interface DeckSaveRequest {
  changes: ChangeEvent[]
  deck: DeckData
  frontMatter: Record<string, unknown>
  contentHash: string
  /** Merge into the session's existing changelog entry instead of a new one. */
  continueSession?: boolean
  /**
   * Refuse the save when a change names a card the local Scryfall cache does not
   * know. Off by default: the admin UI only ever sends names it read from a
   * list, and the check needs a warm cache.
   */
  validateCardNames?: boolean
}

export async function handleDeckSave(req: Request): Promise<Response> {
  try {
    const parsedSlug = parseSlugFromUrl(req)
    if (!parsedSlug.ok) return apiError(parsedSlug.message, 400)
    const { slug } = parsedSlug

    const parsedBody = await readJsonObjectBody(req)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.body as unknown as DeckSaveRequest
    const { changes, deck, frontMatter, contentHash, continueSession } = body

    if (!deck || !changes || typeof contentHash !== 'string') {
      return apiError(`changes, deck, and contentHash are required. ${PARTIAL_LOAD_HINT}`, 400)
    }

    const allDeckCards = deck.sections.flatMap((s) => s.cards)
    const noteError = normalizeRequestNotes(changes, allDeckCards)
    if (noteError) return noteError

    const decksDir = getDecksDir()
    const resolved = await resolveListFileOrRefuse(resolveDeckFile, {
      slug,
      dir: decksDir,
      label: 'deck',
    })
    if (!resolved.ok) return resolved.response
    const { filePath } = resolved

    // Validate content hash for conflict detection
    const hashCheck = await validateContentHash(filePath, contentHash, 'Deck')
    if (!hashCheck.valid) return hashCheck.response

    // The deck as it stands on disk: the baseline both the card-name check and
    // the effects diff are computed against. Parsed once — the request's deck
    // already has the change applied, so it would vouch for the very name being
    // added.
    const previousDeck = parseDeckText(hashCheck.content, slug).deck
    const nameError = await refuseUnknownCardNames(
      body.validateCardNames,
      changeCardNames(changes),
      () => previousDeck.sections.flatMap((section) => section.cards.map((card) => card.name)),
    )
    if (nameError) return nameError

    const filesToCommit: string[] = [filePath, hashPath(filePath)]

    // Apply the destination side of any cross-list moves first; a bad destination
    // (missing list, or a printing-less card into a collection) aborts before the
    // source is written.
    const outgoing = await applyOutgoingMoves({ type: 'deck', name: deck.name }, changes)
    filesToCommit.push(...outgoing.writtenFiles)

    // Write changelog
    if (changes.length > 0) {
      const changelogPath = await appendChangelog(filePath, deck.name, changes, {
        continueSession,
      })
      filesToCommit.push(changelogPath)
    }

    // Write deck file. Ids are assigned here rather than only inside
    // `serializeDeckToMarkdown` (which re-runs the assigner idempotently) so the
    // response can report the ids the save allocated.
    const { deck: idedDeck, assignments } = assignDeckCardIds(deck)
    const markdown = serializeDeckToMarkdown(idedDeck, frontMatter)
    const newContentHash = await writeFileWithHash(filePath, markdown)

    // Auto-commit if enabled
    await autoCommitAndPush(
      decksDir,
      filesToCommit,
      `Edit deck: ${deck.name} (${changes.length} changes)`,
    )

    const responseBody: ListSaveResponse = {
      success: true,
      message: `Saved ${changes.length} changes to ${deck.name}`,
      contentHash: newContentHash,
      droppedNotes: outgoing.droppedNotes,
      effects: computeDeckSaveEffects({ before: previousDeck, after: idedDeck, assignments }),
    }
    return Response.json(responseBody)
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
  }
}
