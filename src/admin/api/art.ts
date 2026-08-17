import { loadDeckFile } from '../../importers/text-file'
import { parseCollectionFile } from '../../collection-file'
import { parseWantedListFile } from '../../commands/wanted-helpers'
import { collectDeckCardIds, collectExistingIds } from '../../card-id'
import {
  artSidecarPath,
  cardArtFilePath,
  cardArtToRecord,
  isCardArtRefError,
  loadCardArt,
  parseCardArtRef,
  saveCardArt,
  type CardArtRecord,
  type CardArtRef,
} from '../../card-art'
import { getArtDir } from '../../ritual-config'
import { listTypeLabel, type ListType } from '../../list-type'
import { dirForType } from '../../resolve-list'
import { apiHandler } from '../utils'
import { resolveListFile } from './list-info'
import { apiMessage, type ApiMessage } from './result'
import { apiError, autoCommitAndPush, badRequest, readJsonObjectBody } from './save-helpers'
import { parseListTarget } from './target'

/**
 * `PUT /api/art/:type/:slug` — set or clear one card's custom art.
 *
 * Custom art is list *metadata*, like the primer sidecar: it is written
 * immediately and directly, with no change event, no changelog entry, and no
 * `contentHash` round trip. Card lines and the `<list>.art.json` sidecar are
 * disjoint, so the write is safe alongside an editor's pending card edits.
 *
 * The read side lives here too ({@link listArtRecord}), so the shape the load
 * routes hand out and the shape this route writes cannot drift.
 */

/** `PUT /api/art/:type/:slug` request body. `art: null` clears the card's art. */
export type CardArtSaveRequest = {
  /** The card line's `&N` id, which must exist in the list. */
  cardId: number
  art: CardArtRef | null
}

/** `PUT /api/art/:type/:slug` success body. */
export type CardArtSaveResponse = ApiMessage & {
  success: true
  slug: string
  cardId: number
  /** The reference now stored for the card, or `null` when it was cleared. */
  art: CardArtRef | null
}

/**
 * Validate an untrusted request body into a {@link CardArtSaveRequest}, or
 * return the message explaining the refusal. Unknown keys are refused so a
 * typo cannot look like a successful write that changed nothing.
 */
export function parseCardArtSaveBody(raw: Record<string, unknown>): CardArtSaveRequest | string {
  for (const key of Object.keys(raw)) {
    if (key !== 'cardId' && key !== 'art') {
      return `Unknown field '${key}'. Accepted fields: cardId, art.`
    }
  }
  if (typeof raw.cardId !== 'number' || !Number.isSafeInteger(raw.cardId) || raw.cardId < 1) {
    return 'cardId must be a card line’s &N id (a positive integer).'
  }
  if (!('art' in raw)) {
    return 'art is required — an object with a "file" or "url", or null to clear the card’s art.'
  }
  if (raw.art === null) return { cardId: raw.cardId, art: null }
  const ref = parseCardArtRef(raw.art)
  if (isCardArtRefError(ref)) return ref.error
  return { cardId: raw.cardId, art: ref }
}

/**
 * Every `&N` id the list currently holds — what an art entry must point at.
 * The three parsers differ only in shape, so the type switch lives here rather
 * than at the two call sites.
 */
export async function listCardIds(type: ListType, filePath: string): Promise<Set<number>> {
  if (type === 'deck') {
    const { deck } = await loadDeckFile(filePath)
    return new Set(collectDeckCardIds(deck))
  }
  const content = await Bun.file(filePath).text()
  const parsed = type === 'collection' ? parseCollectionFile(content) : parseWantedListFile(content)
  return new Set(collectExistingIds(parsed.entries))
}

/** {@link listArtRecord}'s inputs — see its doc comment. */
export type ListArtRecordOptions = {
  /**
   * The ids the response carries, i.e. what to project. A filtered or paged
   * load narrows this; it is not the list's id space.
   */
  cardIds: Iterable<number | undefined>
  /**
   * Every id the *whole* list holds, filter and paging ignored. Sidecar entries
   * outside it point at cards that no longer exist and are reported as a
   * warning; omitting it skips the check.
   */
  knownCardIds?: ReadonlySet<number>
}

/** What a load body carries about a list's custom art. */
export type ListArtRecord = {
  /** The sidecar's entries for the ids in the body; absent when there are none. */
  customArt?: CardArtRecord
  /**
   * What was wrong with the sidecar, if anything. Deliberately **not** the load
   * body's `warnings`: that channel is unreadable *card lines*, and the save
   * routes refuse a baseline that has any. Art is display metadata living in a
   * file no card save writes, so an unreadable sidecar must never make a list
   * unsaveable. Absent when the sidecar was clean.
   */
  artWarnings?: string[]
}

/**
 * A list's custom art in the shape the load routes return.
 *
 * An unreadable sidecar's message and any orphaned entries come back as
 * {@link ListArtRecord.artWarnings} — the load still answers with the list,
 * since art is display metadata and never blocks editing. The orphan check runs
 * against the whole list rather than the projected page: a paged load must not
 * report every card it did not ask for as missing.
 */
export async function listArtRecord(
  filePath: string,
  options: ListArtRecordOptions,
): Promise<ListArtRecord> {
  const loaded = await loadCardArt(filePath, { knownCardIds: options.knownCardIds })
  if (!loaded.ok) return { artWarnings: [loaded.message] }
  const artWarnings = loaded.warnings.map(
    (warning) =>
      `${artSidecarPath(filePath)}: custom art is set for cards that are no longer in this list: ` +
      `${warning.ids.join(', ')}.`,
  )
  const record: ListArtRecord = artWarnings.length > 0 ? { artWarnings } : {}
  if (loaded.art.size === 0) return record
  const projected = new Map<number, CardArtRef>()
  for (const cardId of options.cardIds) {
    if (cardId === undefined) continue
    const ref = loaded.art.get(cardId)
    if (ref !== undefined) projected.set(cardId, ref)
  }
  if (projected.size === 0) return record
  return { ...record, customArt: cardArtToRecord(projected) }
}

export function handleArtSave(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const target = parseListTarget(req)
    if (typeof target === 'string') return badRequest(target)

    const read = await readJsonObjectBody(req)
    if (!read.ok) return read.response
    const parsed = parseCardArtSaveBody(read.body)
    if (typeof parsed === 'string') return badRequest(parsed)

    const filePath = await resolveListFile(target.type, target.slug)
    if (!filePath) {
      return apiError(`No ${listTypeLabel(target.type)} named '${target.slug}'`, 404)
    }

    const cardIds = await listCardIds(target.type, filePath)
    if (!cardIds.has(parsed.cardId)) {
      return badRequest(
        `Card ${parsed.cardId} is not in ${listTypeLabel(target.type)} '${target.slug}'.`,
      )
    }

    // Named with the path that was checked: the art directory is configurable,
    // so "no such file" without it says nothing about where to put the image.
    if (parsed.art !== null && 'file' in parsed.art) {
      const source = cardArtFilePath(getArtDir(), parsed.art)
      if (!(await Bun.file(source).exists())) {
        return badRequest(`No image at ${source}.`)
      }
    }

    // Read-modify-write, refusing on an unreadable sidecar: overwriting it
    // would erase custom art the user still has, for cards this request never
    // mentioned.
    const loaded = await loadCardArt(filePath)
    if (!loaded.ok) return apiError(loaded.message, 400)
    if (parsed.art === null) loaded.art.delete(parsed.cardId)
    else loaded.art.set(parsed.cardId, parsed.art)

    const written = await saveCardArt(filePath, loaded.art)
    // `absent` means there was no sidecar and none was written — committing a
    // path that does not exist would fail the `git add`. A removal is committed
    // (git stages a deletion of a tracked file).
    if (written.action !== 'absent') {
      await autoCommitAndPush(
        dirForType(target.type),
        [written.path],
        `Update custom art for ${listTypeLabel(target.type)} ${target.slug}`,
      )
    }

    const response: CardArtSaveResponse = {
      success: true,
      slug: target.slug,
      cardId: parsed.cardId,
      art: parsed.art,
      ...apiMessage(parsed.art === null ? 'admin.api.art.cleared' : 'admin.api.art.set', {
        name: target.slug,
      }),
    }
    return Response.json(response)
  })
}
