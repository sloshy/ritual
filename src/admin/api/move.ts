import path from 'node:path'
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
  commitAllMoves,
  type ListEntry,
} from '../../commands/move-helpers'
import { validateBodySize, autoCommitAndPush } from './save-helpers'

/** Lightweight summary of a movable list, identified by slug like the other admin endpoints. */
export type MoveListInfo = {
  type: ListType
  slug: string
  name: string
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
  lists: MoveListInfo[]
  cards: MovePhysicalCard[]
}

/** The file basename (without extension) used as the slug for a list, matching the load endpoints. */
function slugOf(listEntry: ListEntry): string {
  return path.basename(listEntry.filePath).replace(/\.(md|txt)$/i, '')
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
    const slugByPath = new Map(lists.map((l) => [l.filePath, slugOf(l)]))

    const listInfos: MoveListInfo[] = lists.map((l) => ({
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
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}

/** A single queued move, identified by the source card's session key and a destination list. */
export type MoveCommitItem = {
  cardKey: string
  toType: ListType
  toSlug: string
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
      return Response.json({ success: false, message: 'moves array is required' }, { status: 400 })
    }
    for (const m of raw.moves as unknown[]) {
      const item = m as Record<string, unknown>
      if (
        typeof item.cardKey !== 'string' ||
        typeof item.toType !== 'string' ||
        !isListType(item.toType) ||
        typeof item.toSlug !== 'string'
      ) {
        return Response.json({ success: false, message: 'Invalid move request' }, { status: 400 })
      }
    }
    const body = raw as MoveCommitRequest

    const lists = await loadAllLists()
    const physical = await loadPhysicalCards(lists)
    const state = buildVirtualState(physical)
    const slugByPath = new Map(lists.map((l) => [l.filePath, slugOf(l)]))

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
      applyVirtualMove(state, internalKey, dest)
    }

    const { moved, writtenFiles } = await commitAllMoves(state)

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

    return Response.json({
      success: true,
      moved,
      requested: body.moves.length,
      skipped,
      message: `Moved ${moved} card${moved === 1 ? '' : 's'}.`,
    })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
