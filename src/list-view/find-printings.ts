/**
 * "Find Other Printings" — module-level state and pure result-building logic.
 *
 * Any card surface (the read-view card modal, the editor context menu) can call
 * {@link openFindPrintings} with a card name; the app root renders a single
 * `FindPrintingsModal` (in `site/`) bound to
 * {@link findPrintingsRequest} that shows every copy of that card (matched by
 * front-face name, so double-sided printings like `Steam Vents // Steam Vents`
 * count) across every deck, collection, and wanted list, grouped by list.
 *
 * The modal is only mounted on the public site — it needs the baked per-list
 * JSON — so callers shared with the admin app gate their entry point on
 * {@link findPrintingsAvailable}, which the modal registers while mounted.
 */

import { createSignal, type Accessor } from 'solid-js'
import type { ListType } from '../list/list-type'
import { listRefKey, type CombinedCardData, type CombinedListRef } from './combined-list'
import { cardMatchKey, findMatchKey } from '../card/find-search'

export interface FindPrintingsRequest {
  cardName: string
}

const [request, setRequest] = createSignal<FindPrintingsRequest | null>(null)

/** The card currently being looked up across lists, or null when closed. */
export const findPrintingsRequest: Accessor<FindPrintingsRequest | null> = request

export function openFindPrintings(cardName: string): void {
  setRequest({ cardName })
}

export function closeFindPrintings(): void {
  setRequest(null)
}

const [available, setAvailable] = createSignal(false)

/**
 * Whether a mounted FindPrintingsModal will answer {@link openFindPrintings}.
 * Entry points in components shared with the admin app hide themselves when
 * this is false.
 */
export const findPrintingsAvailable: Accessor<boolean> = available

/** Called by the modal on mount/cleanup so availability tracks its lifetime. */
export function setFindPrintingsAvailable(value: boolean): void {
  setAvailable(value)
}

/**
 * One physical copy of the searched card. Deck lines carry their whole quantity
 * on one entry, so a `3x` line expands to three copies sharing one `tile`;
 * `copy` disambiguates them (and keys the render loop).
 */
export interface FindPrintingsCopy {
  tile: CombinedCardData
  copy: number
}

/** Every copy of the searched card within one list, in file order. */
export interface FindPrintingsGroup {
  kind: ListType
  slug: string
  name: string
  /** Whether this is the list the lookup was opened from. */
  isCurrent: boolean
  copies: FindPrintingsCopy[]
}

/**
 * Collect every copy of `cardName` (matched by normalized front-face name)
 * from the combined cards of all lists, grouped by source list. The list the
 * lookup was opened from (`currentList`) always sorts first; the rest keep the
 * order the lists were loaded in. Copies are expanded one-per-physical-card
 * rather than merged, so identical printings sit side by side.
 */
export function buildFindPrintingsGroups(
  cards: CombinedCardData[],
  cardName: string,
  currentList?: CombinedListRef,
): FindPrintingsGroup[] {
  const key = findMatchKey(cardName)
  if (!key) return []
  const index = new Map<string, FindPrintingsGroup>()
  const out: FindPrintingsGroup[] = []
  for (const c of cards) {
    if (cardMatchKey(c) !== key) continue
    const groupKey = listRefKey({ type: c.sourceKind, slug: c.sourceSlug })
    let group = index.get(groupKey)
    if (!group) {
      group = {
        kind: c.sourceKind,
        slug: c.sourceSlug,
        name: c.sourceName,
        isCurrent: currentList?.type === c.sourceKind && currentList.slug === c.sourceSlug,
        copies: [],
      }
      index.set(groupKey, group)
      out.push(group)
    }
    for (let copy = 0; copy < c.quantity; copy++) group.copies.push({ tile: c, copy })
  }
  return [...out.filter((g) => g.isCurrent), ...out.filter((g) => !g.isCurrent)]
}

/** Total copy count across every group. */
export function countFindPrintingsCopies(groups: FindPrintingsGroup[]): number {
  return groups.reduce((sum, g) => sum + g.copies.length, 0)
}
