import { assignDeckCardIds } from '../../card/card-id'
import { serializeDeckToMarkdown, validateDeckFrontMatter } from '../../list/deck-file'
import { readFrontMatterMapping } from '../../list/front-matter-write'
import { computeDeckSaveEffects } from '../../changes/save-effects'
import { getErrorMessage } from '../../util/errors'
import type { DeckData } from '../../list/deck'
import type { ChangeEvent } from '../../changes/change-event'
import { getDecksDir } from '../../config/ritual-config'
import { parseDeckText } from '../../importers/text-file'
import { changeCardNames, refuseUnknownCardNames } from './card-name-check'
import { applyCrossListMoves } from '../../list/move-prepare'
import { apiError, readJsonObjectBody } from '../../api/http'
import {
  PARTIAL_LOAD_HINT,
  validateContentHash,
  finishListSave,
  listSaveOutcome,
  listSaveResponse,
  normalizeRequestLabels,
  normalizeRequestLanguages,
  normalizeRequestReplacements,
  normalizeRequestNotes,
  normalizeRequestTags,
  refuseUnreadableBaseline,
  type ListSaveTail,
} from './save-helpers'
import { deckLineQuantities } from '../../changes/line-copies'
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

    // The request's deck cards are serialized directly, so their labels, tags
    // and languages are validated alongside the changes' — a deck line carries
    // `proxy` alone, and an unvalidated set would reach the serializer.
    const labelError = normalizeRequestLabels(changes, 'deck', allDeckCards)
    if (labelError) return labelError

    const tagError = normalizeRequestTags(changes, allDeckCards)
    if (tagError) return tagError

    const languageError = normalizeRequestLanguages(changes, allDeckCards)
    if (languageError) return languageError

    const replacementError = normalizeRequestReplacements(changes)
    if (replacementError) return replacementError

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

    // Apply the other side of any cross-list moves first — the destination of
    // each `move-from`, the source of each `move-to` — every one validated in
    // memory before anything lands, so a bad destination (missing list, or a
    // printing-less card into a collection) or a source with no copy to take
    // aborts before this list is written.
    const previousLineQuantities = deckLineQuantities(previousDeck)
    const moves = await applyCrossListMoves(
      { type: 'deck', name: deck.name },
      filePath,
      changes,
      previousLineQuantities,
    )

    // Ids are assigned here rather than only inside `serializeDeckToMarkdown`
    // (which re-runs the assigner idempotently) so the response can report the
    // ids the save allocated.
    const { deck: idedDeck, assignments } = assignDeckCardIds(deck)
    // Front matter is read back off disk and the request's keys layered over it,
    // rather than trusting the client's snapshot wholesale: an editor session
    // takes that snapshot at load and never refreshes it for keys it does not
    // own, so a cover image (or a default label set) written out of band by the
    // metadata route mid-session would be deleted by the next card save.
    const onDisk = readFrontMatterMapping(hashCheck.content)
    const markdown = serializeDeckToMarkdown(idedDeck, {
      ...(onDisk.ok ? validateDeckFrontMatter(onDisk.data) : {}),
      ...frontMatter,
    })

    const tail: ListSaveTail = {
      listType: 'deck',
      filePath,
      content: markdown,
      changelogName: deck.name,
      changes,
      // Computed before the write: the tail re-files the list's custom art
      // against the ids these effects report as freed or renumbered.
      effects: computeDeckSaveEffects({ before: previousDeck, after: idedDeck, assignments }),
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
