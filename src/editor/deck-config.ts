import { batch } from 'solid-js'
import type { DeckData, Finish } from '../types'
import { type PrintingTuple, isSamePrinting } from '../change-event'
import type { CardContextInfo } from './context-menu'
import type { ChangePrintingContext } from './useEditor'
import { applyChangeToDeck } from './deck-changes'

/**
 * Deck-specific helpers wiring a deck into the shared {@link useEditor} engine.
 * Pure functions over {@link DeckData}, shared by the admin deck editor and the
 * public deck editor so the two stay behaviorally identical.
 */

/** Find a card's finish by iterating deck sections. */
export function findDeckFinish(deck: DeckData, cardName: string): Finish {
  for (const section of deck.sections) {
    const card = section.cards.find((c) => c.name === cardName)
    if (card?.finish) return card.finish
  }
  return 'nonfoil'
}

/** Find the original finish for a card, falling back to 'nonfoil'. */
export function findOriginalDeckFinish(deck: DeckData, cardName: string): Finish {
  for (const section of deck.sections) {
    const card = section.cards.find((c) => c.name === cardName)
    if (card !== undefined) return card.finish ?? 'nonfoil'
  }
  return 'nonfoil'
}

/** Find a card's on-disk printing by card ID, for change-printing revert detection. */
export function findOriginalDeckPrinting(
  deck: DeckData | null,
  cardId: number,
): PrintingTuple | undefined {
  if (!deck) return undefined
  for (const section of deck.sections) {
    const card = section.cards.find((c) => c.cardId === cardId)
    if (card) {
      return {
        set: card.set,
        collectorNumber: card.collectorNumber,
        finish: card.finish,
        condition: card.condition,
      }
    }
  }
  return undefined
}

/**
 * Apply a "change printing" action to a deck. When every copy changes, the entry
 * is retargeted in place (a single set-printing change). When only some copies
 * change, the entry's quantity is decreased and that many copies of the new
 * printing are added under a fresh card ID — logged as a quantity decrease plus
 * a new add, per the deck's quantity semantics.
 */
export function applyDeckChangePrinting(ctx: ChangePrintingContext<DeckData>): void {
  const { target, count, options, tools, setData, original } = ctx
  const cardId = target.cardIds[0]
  if (cardId === undefined) return

  const newPrinting: PrintingTuple = {
    set: options.set,
    collectorNumber: options.collectorNumber,
    finish: options.finish,
    condition: options.condition,
  }
  const currentPrinting: PrintingTuple = {
    set: target.set,
    collectorNumber: target.collectorNumber,
    finish: target.finish,
    condition: target.condition,
  }
  if (isSamePrinting(newPrinting, currentPrinting)) return

  const total = target.quantity
  const n = Math.min(Math.max(count, 1), total)

  if (n >= total) {
    const origPrinting = findOriginalDeckPrinting(original, cardId) ?? currentPrinting
    tools.setPrinting(target.cardName, newPrinting, origPrinting, cardId)
    setData((prev) =>
      prev
        ? applyChangeToDeck(prev, {
            action: 'set-printing',
            cardName: target.cardName,
            set: newPrinting.set,
            collectorNumber: newPrinting.collectorNumber,
            finish: newPrinting.finish,
            condition: newPrinting.condition,
            cardId,
          })
        : prev,
    )
    return
  }

  // Decrement the original entry by n, then add n copies of the new printing
  // under a fresh card ID. Batched so the deck view repaints once, not 2n times.
  batch(() => {
    for (let i = 0; i < n; i++) {
      tools.decrementCard(target.cardName, cardId)
      setData((prev) =>
        prev
          ? applyChangeToDeck(prev, { action: 'remove', cardName: target.cardName, cardId })
          : prev,
      )
    }
    const newId = tools.allocateId()
    for (let i = 0; i < n; i++) {
      tools.addCard(target.cardName, { ...options, cardId: newId })
      setData((prev) =>
        prev
          ? applyChangeToDeck(prev, {
              action: 'add',
              cardName: target.cardName,
              set: options.set,
              collectorNumber: options.collectorNumber,
              finish: options.finish,
              condition: options.condition,
              cardId: newId,
            })
          : prev,
      )
    }
  })
}

/** Find a card's ID from deck sections by name. */
export function findDeckCardId(deck: DeckData, cardName: string): number | undefined {
  for (const section of deck.sections) {
    const card = section.cards.find((c) => c.name === cardName)
    if (card?.cardId !== undefined) return card.cardId
  }
  return undefined
}

/** Find a card's ID with an optional section filter (commander vs non-commander). */
export function findDeckCardIdInSection(
  deck: DeckData,
  cardName: string,
  inCommanderSection: boolean,
): number | undefined {
  for (const section of deck.sections) {
    const isCmd = section.name.toLowerCase().includes('commander')
    if (inCommanderSection !== isCmd) continue
    const card = section.cards.find((c) => c.name === cardName)
    if (card?.cardId !== undefined) return card.cardId
  }
  return undefined
}

/** Extract all card IDs from a deck. */
export function getDeckCardIds(deck: DeckData): number[] {
  const ids: number[] = []
  for (const section of deck.sections) {
    for (const card of section.cards) {
      if (card.cardId !== undefined) ids.push(card.cardId)
    }
  }
  return ids
}

/** Number of distinct card lines per section, for the section manager. */
export function deckCountsBySection(deck: DeckData): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const section of deck.sections) counts[section.name] = section.cards.length
  return counts
}

/** Find the section a targeted card currently lives in (by card ID, then name). */
export function findDeckCardSection(deck: DeckData, target: CardContextInfo): string | undefined {
  const cardId = target.cardIds[0]
  for (const section of deck.sections) {
    if (
      section.cards.some(
        (c) => (cardId !== undefined && c.cardId === cardId) || c.name === target.cardName,
      )
    ) {
      return section.name
    }
  }
  return undefined
}
