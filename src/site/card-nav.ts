/**
 * Cross-list "navigate to a card" support. A caller (e.g. the Find Other
 * Printings modal) records a pending target with {@link requestCardNav} and then
 * navigates to the target's list (or is already on it); the list page consumes
 * the target once its cards are rendered via {@link useCardNavScroll}, scrolling
 * the matching tile into view and flashing a highlight on it.
 *
 * Targets are matched by the entry's persistent card ID (`data-card-id` on the
 * tile) when available, falling back to the card name (`data-name`). A target
 * that never finds its tile (filtered out, ID-less entry renamed, …) is simply
 * dropped when consumed — navigation to the list still happened.
 */

import { createEffect, createSignal, type Accessor } from 'solid-js'
import type { ListType } from '../list/list-type'

export interface CardNavTarget {
  type: ListType
  slug: string
  /** The specific entry's persistent card ID, when known. */
  cardId?: number
  /** Card name used to find the tile when no tile carries the card ID. */
  name: string
}

/** The list identity a page reports to {@link useCardNavScroll}. */
export interface CardNavListId {
  type: ListType
  slug: string
}

const [pending, setPending] = createSignal<CardNavTarget | null>(null)

/** The card awaiting scroll-into-view, or null. Exposed for tests. */
export const pendingCardNav: Accessor<CardNavTarget | null> = pending

/** Record a card to scroll to once its list's page has rendered. */
export function requestCardNav(target: CardNavTarget): void {
  setPending(target)
}

/** Drop any pending target (e.g. when the user navigates somewhere else). */
export function clearCardNav(): void {
  setPending(null)
}

/** Whether a pending target refers to the given list. Pure; exported for tests. */
export function cardNavMatchesList(
  target: CardNavTarget | null,
  list: CardNavListId | null,
): target is CardNavTarget {
  return target !== null && list !== null && target.type === list.type && target.slug === list.slug
}

/** How long the highlight class stays on the tile (matches the CSS animation). */
const HIGHLIGHT_MS = 2400

function findCardTile(target: CardNavTarget): Element | null {
  if (target.cardId !== undefined) {
    // cardId is a number, so unlike the name below it needs no CSS escaping.
    const byId = document.querySelector(`.card-item[data-card-id="${target.cardId}"]`)
    if (byId) return byId
  }
  return document.querySelector(`.card-item[data-name="${CSS.escape(target.name.toLowerCase())}"]`)
}

/**
 * Consume a pending {@link CardNavTarget} aimed at this page's list: once
 * `ready` reports the cards are rendered, scroll the matching tile into view
 * and flash the `card-nav-highlight` animation on it. Call from a list page
 * (read or edit mode) with the list it is displaying.
 */
export function useCardNavScroll(
  list: Accessor<CardNavListId | null>,
  ready: Accessor<boolean>,
): void {
  createEffect(() => {
    const pendingTarget = pending()
    if (!cardNavMatchesList(pendingTarget, list()) || !ready()) return
    // Fresh const so the narrowed type survives into the closure below.
    const target = pendingTarget
    setPending(null)
    // The effect runs after render, but wait a frame so freshly-mounted tiles
    // (e.g. right after the list's detail JSON resolves) are laid out first.
    requestAnimationFrame(() => {
      const el = findCardTile(target)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('card-nav-highlight')
      window.setTimeout(() => el.classList.remove('card-nav-highlight'), HIGHLIGHT_MS)
    })
  })
}
