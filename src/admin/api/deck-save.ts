import { assignDeckCardIds } from '../../card-id'
import { serializeDeckToMarkdown } from '../../deck-file'
import { computeDeckSaveEffects } from '../../editor/save-effects'
import { getErrorMessage } from '../../errors'
import type { DeckData } from '../../types'
import type { ChangeEvent } from '../../change-event'
import { getDecksDir } from '../../ritual-config'
import { parseDeckText } from '../../importers/text-file'
import { changeCardNames, refuseUnknownCardNames } from './card-name-check'
import { applyOutgoingMoves } from './move-save'
import {
  apiError,
  PARTIAL_LOAD_HINT,
  readJsonObjectBody,
  validateContentHash,
  finishListSave,
  listSaveResponse,
  normalizeRequestLanguages,
  normalizeRequestNotes,
  refuseUnreadableBaseline,
  type ListSaveTail,
} from './save-helpers'
import { resolveDeckFile, resolveListFileOrRefuse } from './list-file'
import { parseSlugFromUrl } from './target'
import { MAX_LIST_BODY_SIZE } from '../validation'

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

    const parsedBody = await readJsonObjectBody(req, MAX_LIST_BODY_SIZE)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.body as unknown as DeckSaveRequest
    const { changes, deck, frontMatter, contentHash, continueSession } = body

    if (!deck || !changes || typeof contentHash !== 'string') {
      return apiError(`changes, deck, and contentHash are required. ${PARTIAL_LOAD_HINT}`, 400)
    }

    const allDeckCards = deck.sections.flatMap((s) => s.cards)
    const noteError = normalizeRequestNotes(changes, allDeckCards)
    if (noteError) return noteError

    // The request's deck cards are serialized directly, so their languages are
    // validated alongside the changes'.
    const languageError = normalizeRequestLanguages(changes, allDeckCards)
    if (languageError) return languageError

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
    const previous = parseDeckText(hashCheck.content, slug)
    // A line this parse could not read is a line the save would delete, because
    // the write re-serializes the whole deck. Refuse instead.
    const unreadable = refuseUnreadableBaseline(filePath, previous)
    if (unreadable) return unreadable
    const previousDeck = previous.deck
    const nameError = await refuseUnknownCardNames(
      body.validateCardNames,
      changeCardNames(changes),
      () => previousDeck.sections.flatMap((section) => section.cards.map((card) => card.name)),
    )
    if (nameError) return nameError

    // Apply the destination side of any cross-list moves first; a bad destination
    // (missing list, or a printing-less card into a collection) aborts before the
    // source is written.
    const outgoing = await applyOutgoingMoves({ type: 'deck', name: deck.name }, changes)

    // Ids are assigned here rather than only inside `serializeDeckToMarkdown`
    // (which re-runs the assigner idempotently) so the response can report the
    // ids the save allocated.
    const { deck: idedDeck, assignments } = assignDeckCardIds(deck)
    const markdown = serializeDeckToMarkdown(idedDeck, frontMatter)

    const tail: ListSaveTail = {
      listType: 'deck',
      filePath,
      content: markdown,
      changelogName: deck.name,
      changes,
      continueSession,
      extraFiles: outgoing.writtenFiles,
    }
    const { contentHash: newContentHash } = await finishListSave(tail)

    return Response.json(
      listSaveResponse(tail, {
        contentHash: newContentHash,
        droppedNotes: outgoing.droppedNotes,
        effects: computeDeckSaveEffects({ before: previousDeck, after: idedDeck, assignments }),
      }),
    )
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
  }
}
