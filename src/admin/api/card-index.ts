import { getErrorMessage } from '../../errors'
import { isListType, type ListType } from '../../list-type'
import { loadAllLists, loadPhysicalCards } from '../../commands/move-helpers'
import { listSlug, type ListInfo } from '../../list-info'
import { matchesNameTerms, normalizeCardName, splitNameTerms } from '../../term-match'
import { moveCardKey, type MovePhysicalCard } from './move'
import { isValidListSlug } from './target'

/**
 * `GET /api/card-index` — every list plus every physical card across them, with
 * no Scryfall payload. `lists` is always the full roster (clients need it to
 * render move destinations); only `cards` is filtered.
 */
export type CardIndexResponse = {
  success: true
  lists: ListInfo[]
  cards: MovePhysicalCard[]
}

/** `GET /api/card-index` failure body. */
export type CardIndexErrorResponse = { success: false; message: string }

/** Validated `GET /api/card-index` query filters; every field is optional. */
export type CardIndexFilters = {
  /** Whitespace-separated name terms, matched case/diacritic/punctuation-insensitively. */
  nameTerms?: string[]
  listType?: ListType
  slug?: string
  /** Lowercase set code. */
  set?: string
}

function errorResponse(message: string, status: number): Response {
  const body: CardIndexErrorResponse = { success: false, message }
  return Response.json(body, { status })
}

/**
 * Parse the query string into {@link CardIndexFilters}, or return the error
 * message explaining why it is not usable. Blank values are treated as absent
 * rather than as "match nothing".
 */
export function parseCardIndexFilters(params: URLSearchParams): CardIndexFilters | string {
  const filters: CardIndexFilters = {}

  const name = params.get('name')?.trim()
  if (name) {
    const terms = splitNameTerms(name)
    if (terms.length > 0) filters.nameTerms = terms
  }

  const listType = params.get('listType')?.trim()
  if (listType) {
    if (!isListType(listType)) return `Invalid list type '${listType}'.`
    filters.listType = listType
  }

  const slug = params.get('slug')?.trim()
  if (slug) {
    if (!isValidListSlug(slug)) return `Invalid list slug '${slug}'.`
    filters.slug = slug
  }

  const set = params.get('set')?.trim()
  // Set codes are lowercase internally; a caller may send either casing.
  if (set) filters.set = set.toLowerCase()

  return filters
}

/**
 * Build the unfiltered cross-list index: every list, and one entry per physical
 * card (deck entries with quantity > 1 expand to one entry per copy). The single
 * enumeration point behind `GET /api/card-index`.
 */
async function loadCardIndex(): Promise<CardIndexResponse> {
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

  return { success: true, lists: listInfos, cards }
}

/** Apply filters to an already-built index. Every filter given must match (they intersect). */
export function filterCardIndex(
  cards: MovePhysicalCard[],
  filters: CardIndexFilters,
): MovePhysicalCard[] {
  const { nameTerms, listType, slug, set } = filters
  return cards.filter((card) => {
    if (nameTerms && !matchesNameTerms(normalizeCardName(card.name), nameTerms)) return false
    if (listType && card.listType !== listType) return false
    if (slug && card.listSlug !== slug) return false
    if (set && card.set?.toLowerCase() !== set) return false
    return true
  })
}

/**
 * `GET /api/card-index` — the cross-list physical-card index, optionally
 * filtered by `name` (term matching, as autocomplete matches), `listType`,
 * `slug`, and `set` (matched lowercase). Backs the admin Move Cards page and
 * any client that needs to find where a card physically lives.
 */
export async function handleCardIndex(req: Request): Promise<Response> {
  try {
    const filters = parseCardIndexFilters(new URL(req.url).searchParams)
    if (typeof filters === 'string') return errorResponse(filters, 400)

    const index = await loadCardIndex()
    const body: CardIndexResponse = {
      ...index,
      cards: filterCardIndex(index.cards, filters),
    }
    return Response.json(body)
  } catch (error) {
    return errorResponse(getErrorMessage(error), 500)
  }
}
