import { getErrorMessage } from '../../errors'
import { getBaseDir } from '../../base-dir'
import type { Finish, Condition } from '../../types'
import { isCardLanguage, storedLanguage, type CardLanguage } from '../../card-language'
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
  type VirtualCard,
} from '../../commands/move-helpers'
import type { DroppedNote } from '../../commands/move-io'
import { listSlug } from '../../list-info'
import { indexPhysicalCards, moveCardKey, type MovePhysicalCard } from '../../card-index-types'
import { refuseUnknownCardNames } from './card-name-check'
import { apiMessage, type ApiMessage } from './result'
import { DEFAULT_LOCALE } from '../../i18n/runtime'
import { tIn } from '../../i18n/t'
import { autoCommitAndPush, apiError, badRequest, readJsonObjectBody } from './save-helpers'

// The index vocabulary lives in `src/card-index-types.ts` — the index is the
// general shape and this move flow is one of its consumers. Re-exported so the
// admin site keeps its single import path.
export { moveCardKey }
export type { MovePhysicalCard }

/**
 * The one message for a `toSection` aimed at a non-deck destination, shared by
 * the admin endpoints and the MCP `move_selected_cards` schema so the wording never drifts.
 */
export const TO_SECTION_DECK_ONLY_MESSAGE =
  'toSection is only valid when the destination is a deck.'

/** True when a move item carries a `toSection` but its destination is not a deck. */
export function isToSectionInvalid(toSection: unknown, toType: unknown): boolean {
  return toSection !== undefined && toType !== 'deck'
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
  /** Arrival language override; `en` clears the token (a bare line means `en`). */
  language?: CardLanguage
}

export type MoveCommitRequest = { moves: MoveCommitItem[] }

/** The destination printing/attribute overrides a move item may carry. */
type MovePrintingOverride = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  language?: CardLanguage
}

/**
 * Apply a move item's destination overrides onto the virtual card (set codes
 * normalized to lowercase) so a resolved printing is what gets written, leaving
 * unspecified fields untouched. Shared by both commit handlers so the override
 * semantics — including `en` clearing the language token — can never drift.
 */
function applyMoveOverrides(vc: VirtualCard, m: MovePrintingOverride): void {
  if (
    m.set === undefined &&
    m.collectorNumber === undefined &&
    m.finish === undefined &&
    m.condition === undefined &&
    m.language === undefined
  ) {
    return
  }
  vc.card = {
    ...vc.card,
    set: m.set !== undefined ? m.set.toLowerCase() : vc.card.set,
    collectorNumber: m.collectorNumber ?? vc.card.collectorNumber,
    finish: m.finish ?? vc.card.finish,
    condition: m.condition ?? vc.card.condition,
    // `en` clears the token — serializers omit English, a bare line means `en`.
    language: m.language !== undefined ? storedLanguage(m.language) : vc.card.language,
  }
}

/** True when a move item's optional `language` is present but not a known code. */
function isMoveLanguageInvalid(language: unknown): boolean {
  return language !== undefined && (typeof language !== 'string' || !isCardLanguage(language))
}

/**
 * POST /api/move/commit success body.
 *
 * `warnings` carries the read/parse problems hit while rebuilding the card index
 * this commit resolves keys against — the same list `GET /api/card-index`
 * reports. A list that could not be read holds no movable cards, which is
 * indistinguishable from "that card was already moved" unless the failure is
 * named. Always present, possibly empty.
 */
export type MoveCommitResponse = ApiMessage & {
  success: true
  moved: number
  requested: number
  skipped: number
  droppedNotes: DroppedNote[]
  warnings: string[]
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
    const parsedBody = await readJsonObjectBody(req)
    if (!parsedBody.ok) return parsedBody.response
    const raw = parsedBody.body as unknown as RawCommitBody
    if (!Array.isArray(raw.moves)) {
      return badRequest('moves array is required')
    }
    for (const m of raw.moves as unknown[]) {
      const item = m as Record<string, unknown>
      if (
        typeof item.cardKey !== 'string' ||
        typeof item.toType !== 'string' ||
        !isListType(item.toType) ||
        typeof item.toSlug !== 'string' ||
        (item.toSection !== undefined &&
          (typeof item.toSection !== 'string' || item.toSection.trim() === '')) ||
        isMoveLanguageInvalid(item.language)
      ) {
        return badRequest('Invalid move request')
      }
      if (isToSectionInvalid(item.toSection, item.toType)) {
        return badRequest(TO_SECTION_DECK_ONLY_MESSAGE)
      }
    }
    const body = raw as MoveCommitRequest

    const lists = await loadAllLists()
    const { cards: physical, warnings } = await loadPhysicalCards(lists)
    const state = buildVirtualState(physical)
    const slugByPath = new Map(lists.map((l) => [l.filePath, listSlug(l.filePath)]))

    // Reconstruct the same client-facing keys the load endpoint produced, mapping each
    // back to the internal `PhysicalCard.key` that the virtual state is keyed on.
    const internalByClient = indexPhysicalCards(physical, slugByPath)

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
      applyMoveOverrides(vc, m)
      applyVirtualMove(state, internalKey, dest, { section: m.toSection })
    }

    const { moved, writtenFiles, droppedNotes } = await commitAllMoves(state)

    // Auto-commit the written files (markdown, hashes, changelogs) when git is enabled,
    // matching the editor save endpoints. The whole repo lives under the base dir, so a
    // cross-list move is committed in one pass from there. Guarded on `moved` so a no-op
    // batch never produces a "Move 0 cards" message or an empty commit.
    //
    // The count phrase comes from the catalog rendered in DEFAULT_LOCALE, not the
    // active one: a commit message is git data, English by contract (plan §4.9), and
    // routing it through `domain.count.cards` keeps one plural table for the whole repo.
    if (moved > 0) {
      await autoCommitAndPush(
        getBaseDir(),
        writtenFiles,
        `Move ${tIn(DEFAULT_LOCALE, 'domain.count.cards', { count: moved })}`,
      )
    }

    const responseBody: MoveCommitResponse = {
      success: true,
      moved,
      requested: body.moves.length,
      skipped,
      droppedNotes,
      warnings,
      ...apiMessage('admin.api.move.moved', { count: moved }),
    }
    return Response.json(responseBody)
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
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

export type RemoveCommitRequest = {
  removes: RemoveCommitItem[]
  /**
   * Refuse the request when an item names a card the local Scryfall cache does
   * not know. Off by default; names already present in the affected lists are
   * accepted regardless, so a custom or unreleased card stays removable.
   */
  validateCardNames?: boolean
}

/** POST /api/remove/commit success body. See {@link MoveCommitResponse.warnings}. */
export type RemoveCommitResponse = ApiMessage & {
  success: true
  removed: number
  requested: number
  skipped: number
  warnings: string[]
}

/** Untrusted request body shape, validated before narrowing to {@link RemoveCommitRequest}. */
type RawRemoveBody = { removes?: unknown; validateCardNames?: unknown }

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
    const parsedBody = await readJsonObjectBody(req)
    if (!parsedBody.ok) return parsedBody.response
    const raw = parsedBody.body as unknown as RawRemoveBody
    if (!Array.isArray(raw.removes)) {
      return badRequest('removes array is required')
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
        return badRequest('Invalid remove request')
      }
    }
    const body = raw as RemoveCommitRequest

    const lists = await loadAllLists()
    const { cards: physical, warnings } = await loadPhysicalCards(lists)
    const nameError = await refuseUnknownCardNames(
      raw.validateCardNames,
      body.removes.map((r) => r.name),
      () => physical.map((pc) => pc.name),
    )
    if (nameError) return nameError
    const state = buildVirtualState(physical)
    const slugByPath = new Map(lists.map((l) => [l.filePath, listSlug(l.filePath)]))

    // Reconstruct the same physical-card keys the load endpoint produced.
    const internalByClient = indexPhysicalCards(physical, slugByPath)

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
        `Remove ${tIn(DEFAULT_LOCALE, 'domain.count.cards', { count: removed })}`,
      )
    }

    const responseBody: RemoveCommitResponse = {
      success: true,
      removed,
      requested: body.removes.length,
      skipped,
      warnings,
      ...apiMessage('admin.api.move.removed', { count: removed }),
    }
    return Response.json(responseBody)
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
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
  /** Arrival language override; `en` clears the token (a bare line means `en`). */
  language?: CardLanguage
}

export type SelectedMoveRequest = {
  moves: SelectedMoveItem[]
  /** See {@link RemoveCommitRequest.validateCardNames}. */
  validateCardNames?: boolean
}

/** POST /api/move/selected success body — the same shape as {@link MoveCommitResponse}. */
export type SelectedMoveResponse = MoveCommitResponse

type RawSelectedMoveBody = { moves?: unknown; validateCardNames?: unknown }

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
    const parsedBody = await readJsonObjectBody(req)
    if (!parsedBody.ok) return parsedBody.response
    const raw = parsedBody.body as unknown as RawSelectedMoveBody
    if (!Array.isArray(raw.moves)) {
      return badRequest('moves array is required')
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
        (item.copyIndex !== undefined && typeof item.copyIndex !== 'number') ||
        isMoveLanguageInvalid(item.language)
      ) {
        return badRequest('Invalid move request')
      }
      if (isToSectionInvalid(item.toSection, item.toType)) {
        return badRequest(TO_SECTION_DECK_ONLY_MESSAGE)
      }
    }
    const body = raw as SelectedMoveRequest

    const lists = await loadAllLists()
    const { cards: physical, warnings } = await loadPhysicalCards(lists)
    const nameError = await refuseUnknownCardNames(
      raw.validateCardNames,
      body.moves.map((m) => m.name),
      () => physical.map((pc) => pc.name),
    )
    if (nameError) return nameError
    const state = buildVirtualState(physical)
    const slugByPath = new Map(lists.map((l) => [l.filePath, listSlug(l.filePath)]))

    const internalByClient = indexPhysicalCards(physical, slugByPath)

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
      applyMoveOverrides(vc, m)
      applyVirtualMove(state, internalKey, dest, { section: m.toSection })
    }

    const { moved, writtenFiles, droppedNotes } = await commitAllMoves(state)

    if (moved > 0) {
      await autoCommitAndPush(
        getBaseDir(),
        writtenFiles,
        `Move ${tIn(DEFAULT_LOCALE, 'domain.count.cards', { count: moved })}`,
      )
    }

    const responseBody: SelectedMoveResponse = {
      success: true,
      moved,
      requested: body.moves.length,
      skipped,
      droppedNotes,
      warnings,
      ...apiMessage('admin.api.move.moved', { count: moved }),
    }
    return Response.json(responseBody)
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
  }
}
