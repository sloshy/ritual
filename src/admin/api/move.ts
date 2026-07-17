import { getErrorMessage } from '../../errors'
import { getBaseDir } from '../../base-dir'
import type { Finish, Condition } from '../../types'
import type { ListType } from '../../list-type'
import { isListType } from '../../list-type'
import {
  loadAllLists,
  loadPhysicalCards,
  buildVirtualState,
  applyVirtualMove,
  applyVirtualRemove,
  commitAllMoves,
  commitAllRemovals,
  type ListEntry,
} from '../../commands/move-helpers'
import type { DroppedNote } from '../../commands/move-io'
import { listSlug, type ListInfo } from '../../list-info'
import { validateBodySize, autoCommitAndPush } from './save-helpers'

/** Error body every move/remove endpoint returns on validation failure or a thrown error. */
export type MoveErrorResponse = { success: false; message: string }

function errorResponse(message: string, status: number): Response {
  const body: MoveErrorResponse = { success: false, message }
  return Response.json(body, { status })
}

/**
 * The one message for a `toSection` aimed at a non-deck destination, shared by
 * the admin endpoints and the MCP `move_cards` schema so the wording never drifts.
 */
export const TO_SECTION_DECK_ONLY_MESSAGE =
  'toSection is only valid when the destination is a deck.'

/** True when a move item carries a `toSection` but its destination is not a deck. */
export function isToSectionInvalid(toSection: unknown, toType: unknown): boolean {
  return toSection !== undefined && toType !== 'deck'
}

/**
 * One movable physical card. Mirrors the CLI's `PhysicalCard` but uses a
 * slug-based, path-free `key` so the browser can echo it back on commit without
 * ever seeing absolute server paths. Deck entries with quantity > 1 expand to one
 * card per copy (distinguished by `copyIndex`).
 */
export type MovePhysicalCard = {
  key: string
  listType: ListType
  listSlug: string
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  note?: string
  cardId?: number
  copyIndex?: number
}

export type MoveDataResponse = {
  success: true
  lists: ListInfo[]
  cards: MovePhysicalCard[]
}

/**
 * Stable, path-free key for a physical card within a move session. Reconstructed
 * identically on the server at commit time (from the unchanged files) so the
 * browser only ever round-trips the opaque key. Matches the shape of the CLI's
 * `PhysicalCard.key` but keyed on `type:slug` rather than the absolute file path.
 */
function moveCardKey(
  type: ListType,
  slug: string,
  cardId: number | undefined,
  name: string,
  copyIndex: number | undefined,
): string {
  return `${type}:${slug}:${cardId ?? name}:${copyIndex ?? 0}`
}

/** GET /api/move — every list and every movable card across them (no Scryfall payload). */
export async function handleMoveData(): Promise<Response> {
  try {
    const lists = await loadAllLists()
    const physical = await loadPhysicalCards(lists)
    const slugByPath = new Map(lists.map((l) => [l.filePath, listSlug(l.filePath)]))

    const listInfos: ListInfo[] = lists.map((l) => ({
      type: l.ref.type,
      slug: slugByPath.get(l.filePath)!,
      name: l.ref.name,
    }))

    const cards: MovePhysicalCard[] = physical.map((pc) => {
      const slug = slugByPath.get(pc.listEntry.filePath)!
      return {
        key: moveCardKey(pc.listEntry.ref.type, slug, pc.cardId, pc.name, pc.copyIndex),
        listType: pc.listEntry.ref.type,
        listSlug: slug,
        name: pc.name,
        set: pc.set,
        collectorNumber: pc.collectorNumber,
        finish: pc.finish,
        condition: pc.condition,
        note: pc.note,
        cardId: pc.cardId,
        copyIndex: pc.copyIndex,
      }
    })

    const body: MoveDataResponse = { success: true, lists: listInfos, cards }
    return Response.json(body)
  } catch (error) {
    return errorResponse(getErrorMessage(error), 500)
  }
}

/** A single queued move, identified by the source card's session key and a destination list. */
export type MoveCommitItem = {
  cardKey: string
  toType: ListType
  toSlug: string
  /** Destination deck section (deck destinations only; exact name, created when missing). */
  toSection?: string
  /**
   * Destination printing overrides. Carried so a name-only card resolved to a
   * specific printing (required for collection destinations) lands with that
   * printing, mirroring the CLI's interactive printing resolution.
   */
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
}

export type MoveCommitRequest = { moves: MoveCommitItem[] }

/** POST /api/move/commit success body. */
export type MoveCommitResponse = {
  success: true
  moved: number
  requested: number
  skipped: number
  droppedNotes: DroppedNote[]
  message: string
}

/** Untrusted request body shape, validated before narrowing to {@link MoveCommitRequest}. */
type RawCommitBody = { moves?: unknown }

/**
 * POST /api/move/commit — apply a batch of queued moves atomically.
 *
 * The virtual move state is rebuilt fresh from disk (so the same key scheme
 * resolves to the current files), each requested move is applied to it, and the
 * shared {@link commitAllMoves} performs the atomic LOAD→APPLY→WRITE→CHANGELOG
 * pass. Moves whose card or destination can no longer be resolved (e.g. the file
 * changed since the page loaded) are skipped and reported.
 */
export async function handleMoveCommit(req: Request): Promise<Response> {
  try {
    const sizeError = validateBodySize(req)
    if (sizeError) return sizeError

    const raw = (await req.json()) as RawCommitBody
    if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.moves)) {
      return errorResponse('moves array is required', 400)
    }
    for (const m of raw.moves as unknown[]) {
      const item = m as Record<string, unknown>
      if (
        typeof item.cardKey !== 'string' ||
        typeof item.toType !== 'string' ||
        !isListType(item.toType) ||
        typeof item.toSlug !== 'string' ||
        (item.toSection !== undefined &&
          (typeof item.toSection !== 'string' || item.toSection.trim() === ''))
      ) {
        return errorResponse('Invalid move request', 400)
      }
      if (isToSectionInvalid(item.toSection, item.toType)) {
        return errorResponse(TO_SECTION_DECK_ONLY_MESSAGE, 400)
      }
    }
    const body = raw as MoveCommitRequest

    const lists = await loadAllLists()
    const physical = await loadPhysicalCards(lists)
    const state = buildVirtualState(physical)
    const slugByPath = new Map(lists.map((l) => [l.filePath, listSlug(l.filePath)]))

    // Reconstruct the same client-facing keys the load endpoint produced, mapping each
    // back to the internal `PhysicalCard.key` that the virtual state is keyed on.
    const internalByClient = new Map<string, string>()
    for (const pc of physical) {
      const slug = slugByPath.get(pc.listEntry.filePath)!
      internalByClient.set(
        moveCardKey(pc.listEntry.ref.type, slug, pc.cardId, pc.name, pc.copyIndex),
        pc.key,
      )
    }

    const findDest = (type: ListType, slug: string): ListEntry | undefined =>
      lists.find((l) => l.ref.type === type && slugByPath.get(l.filePath) === slug)

    let skipped = 0
    for (const m of body.moves) {
      const internalKey = internalByClient.get(m.cardKey)
      const dest = findDest(m.toType, m.toSlug)
      if (!internalKey || !dest) {
        skipped++
        continue
      }
      const vc = state.get(internalKey)
      if (!vc) {
        skipped++
        continue
      }
      // Apply destination printing overrides (set codes normalized to lowercase) so a
      // resolved printing is what gets written, leaving unspecified fields untouched.
      if (
        m.set !== undefined ||
        m.collectorNumber !== undefined ||
        m.finish !== undefined ||
        m.condition !== undefined
      ) {
        vc.card = {
          ...vc.card,
          set: m.set !== undefined ? m.set.toLowerCase() : vc.card.set,
          collectorNumber: m.collectorNumber ?? vc.card.collectorNumber,
          finish: m.finish ?? vc.card.finish,
          condition: m.condition ?? vc.card.condition,
        }
      }
      applyVirtualMove(state, internalKey, dest, { section: m.toSection })
    }

    const { moved, writtenFiles, droppedNotes } = await commitAllMoves(state)

    // Auto-commit the written files (markdown, hashes, changelogs) when git is enabled,
    // matching the editor save endpoints. The whole repo lives under the base dir, so a
    // cross-list move is committed in one pass from there. Guarded on `moved` so a no-op
    // batch never produces a "Move 0 cards" message or an empty commit.
    if (moved > 0) {
      await autoCommitAndPush(
        getBaseDir(),
        writtenFiles,
        `Move ${moved} card${moved === 1 ? '' : 's'}`,
      )
    }

    const responseBody: MoveCommitResponse = {
      success: true,
      moved,
      requested: body.moves.length,
      skipped,
      droppedNotes,
      message: `Moved ${moved} card${moved === 1 ? '' : 's'}.`,
    }
    return Response.json(responseBody)
  } catch (error) {
    return errorResponse(getErrorMessage(error), 500)
  }
}

/**
 * One card to remove, addressed by list + identity. `cardId`/`copyIndex` mirror the
 * physical-card key scheme: deck copies are distinguished by `copyIndex` (0..qty-1),
 * while collection/wanted entries use their `cardId` with `copyIndex` 0.
 */
export type RemoveCommitItem = {
  listType: ListType
  listSlug: string
  name: string
  cardId?: number
  copyIndex?: number
}

export type RemoveCommitRequest = { removes: RemoveCommitItem[] }

/** POST /api/remove/commit success body. */
export type RemoveCommitResponse = {
  success: true
  removed: number
  requested: number
  skipped: number
  message: string
}

/** Untrusted request body shape, validated before narrowing to {@link RemoveCommitRequest}. */
type RawRemoveBody = { removes?: unknown }

/**
 * POST /api/remove/commit — remove a batch of cards across lists atomically.
 *
 * Backs the cross-list "Remove all selected" multi-select action. The virtual
 * state is rebuilt fresh from disk, each requested card is resolved back to its
 * physical key and marked for removal, and {@link commitAllRemovals} performs the
 * atomic LOAD→APPLY→WRITE→CHANGELOG pass. Cards that can no longer be resolved
 * (e.g. the file changed since the page loaded) are skipped and reported.
 */
export async function handleRemoveCommit(req: Request): Promise<Response> {
  try {
    const sizeError = validateBodySize(req)
    if (sizeError) return sizeError

    const raw = (await req.json()) as RawRemoveBody
    if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.removes)) {
      return errorResponse('removes array is required', 400)
    }
    for (const r of raw.removes as unknown[]) {
      const item = r as Record<string, unknown>
      if (
        typeof item.listType !== 'string' ||
        !isListType(item.listType) ||
        typeof item.listSlug !== 'string' ||
        typeof item.name !== 'string' ||
        (item.cardId !== undefined && typeof item.cardId !== 'number') ||
        (item.copyIndex !== undefined && typeof item.copyIndex !== 'number')
      ) {
        return errorResponse('Invalid remove request', 400)
      }
    }
    const body = raw as RemoveCommitRequest

    const lists = await loadAllLists()
    const physical = await loadPhysicalCards(lists)
    const state = buildVirtualState(physical)
    const slugByPath = new Map(lists.map((l) => [l.filePath, listSlug(l.filePath)]))

    // Reconstruct the same physical-card keys the load endpoint produced.
    const internalByClient = new Map<string, string>()
    for (const pc of physical) {
      const slug = slugByPath.get(pc.listEntry.filePath)!
      internalByClient.set(
        moveCardKey(pc.listEntry.ref.type, slug, pc.cardId, pc.name, pc.copyIndex),
        pc.key,
      )
    }

    let skipped = 0
    for (const r of body.removes) {
      const clientKey = moveCardKey(r.listType, r.listSlug, r.cardId, r.name, r.copyIndex)
      const internalKey = internalByClient.get(clientKey)
      if (!internalKey || !applyVirtualRemove(state, internalKey)) {
        skipped++
      }
    }

    const { removed, writtenFiles } = await commitAllRemovals(state)

    if (removed > 0) {
      await autoCommitAndPush(
        getBaseDir(),
        writtenFiles,
        `Remove ${removed} card${removed === 1 ? '' : 's'}`,
      )
    }

    const responseBody: RemoveCommitResponse = {
      success: true,
      removed,
      requested: body.removes.length,
      skipped,
      message: `Removed ${removed} card${removed === 1 ? '' : 's'}.`,
    }
    return Response.json(responseBody)
  } catch (error) {
    return errorResponse(getErrorMessage(error), 500)
  }
}

/**
 * One selected card to move, addressed by source list + identity (mirroring
 * {@link RemoveCommitItem}) plus a destination list (by type + slug, matching
 * {@link MoveCommitItem}) and an optional resolved printing. Used by the
 * cross-list "Move all selected" navbar action, which moves each selected card
 * from its own list into one destination.
 */
export type SelectedMoveItem = {
  listType: ListType
  listSlug: string
  name: string
  cardId?: number
  copyIndex?: number
  toType: ListType
  toSlug: string
  /** Destination deck section (deck destinations only; exact name, created when missing). */
  toSection?: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
}

export type SelectedMoveRequest = { moves: SelectedMoveItem[] }

/** POST /api/move/selected success body — the same shape as {@link MoveCommitResponse}. */
export type SelectedMoveResponse = MoveCommitResponse

type RawSelectedMoveBody = { moves?: unknown }

/**
 * POST /api/move/selected — move a batch of selected cards across lists atomically.
 *
 * Backs the cross-list "Move all selected" multi-select action. Each item is
 * resolved back to its physical key (same scheme as the load endpoint) and its
 * destination by type + slug, optional printing overrides are applied, and the
 * shared {@link commitAllMoves} performs the atomic LOAD→APPLY→WRITE→CHANGELOG pass.
 * Cards or destinations that can no longer be resolved are skipped and reported.
 */
export async function handleSelectedMove(req: Request): Promise<Response> {
  try {
    const sizeError = validateBodySize(req)
    if (sizeError) return sizeError

    const raw = (await req.json()) as RawSelectedMoveBody
    if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.moves)) {
      return errorResponse('moves array is required', 400)
    }
    for (const m of raw.moves as unknown[]) {
      const item = m as Record<string, unknown>
      if (
        typeof item.listType !== 'string' ||
        !isListType(item.listType) ||
        typeof item.listSlug !== 'string' ||
        typeof item.name !== 'string' ||
        typeof item.toType !== 'string' ||
        !isListType(item.toType) ||
        typeof item.toSlug !== 'string' ||
        (item.toSection !== undefined &&
          (typeof item.toSection !== 'string' || item.toSection.trim() === '')) ||
        (item.cardId !== undefined && typeof item.cardId !== 'number') ||
        (item.copyIndex !== undefined && typeof item.copyIndex !== 'number')
      ) {
        return errorResponse('Invalid move request', 400)
      }
      if (isToSectionInvalid(item.toSection, item.toType)) {
        return errorResponse(TO_SECTION_DECK_ONLY_MESSAGE, 400)
      }
    }
    const body = raw as SelectedMoveRequest

    const lists = await loadAllLists()
    const physical = await loadPhysicalCards(lists)
    const state = buildVirtualState(physical)
    const slugByPath = new Map(lists.map((l) => [l.filePath, listSlug(l.filePath)]))

    const internalByClient = new Map<string, string>()
    for (const pc of physical) {
      const slug = slugByPath.get(pc.listEntry.filePath)!
      internalByClient.set(
        moveCardKey(pc.listEntry.ref.type, slug, pc.cardId, pc.name, pc.copyIndex),
        pc.key,
      )
    }

    const findDest = (type: ListType, slug: string): ListEntry | undefined =>
      lists.find((l) => l.ref.type === type && slugByPath.get(l.filePath) === slug)

    let skipped = 0
    for (const m of body.moves) {
      const internalKey = internalByClient.get(
        moveCardKey(m.listType, m.listSlug, m.cardId, m.name, m.copyIndex),
      )
      const dest = findDest(m.toType, m.toSlug)
      const vc = internalKey ? state.get(internalKey) : undefined
      if (!internalKey || !dest || !vc) {
        skipped++
        continue
      }
      // Don't move a card onto the list it already lives in.
      if (vc.currentList.filePath === dest.filePath) {
        skipped++
        continue
      }
      if (
        m.set !== undefined ||
        m.collectorNumber !== undefined ||
        m.finish !== undefined ||
        m.condition !== undefined
      ) {
        vc.card = {
          ...vc.card,
          set: m.set !== undefined ? m.set.toLowerCase() : vc.card.set,
          collectorNumber: m.collectorNumber ?? vc.card.collectorNumber,
          finish: m.finish ?? vc.card.finish,
          condition: m.condition ?? vc.card.condition,
        }
      }
      applyVirtualMove(state, internalKey, dest, { section: m.toSection })
    }

    const { moved, writtenFiles, droppedNotes } = await commitAllMoves(state)

    if (moved > 0) {
      await autoCommitAndPush(
        getBaseDir(),
        writtenFiles,
        `Move ${moved} card${moved === 1 ? '' : 's'}`,
      )
    }

    const responseBody: SelectedMoveResponse = {
      success: true,
      moved,
      requested: body.moves.length,
      skipped,
      droppedNotes,
      message: `Moved ${moved} card${moved === 1 ? '' : 's'}.`,
    }
    return Response.json(responseBody)
  } catch (error) {
    return errorResponse(getErrorMessage(error), 500)
  }
}
