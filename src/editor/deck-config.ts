import { batch } from 'solid-js'
import type { Card, DeckData, Finish } from '../types'
import type { CardLabel } from '../card-labels'
import type { CardLanguage } from '../card-language'
import { type PrintingTuple, isSamePrinting } from '../change-event'
import type { CardContextInfo } from './context-menu'
import type { ChangePrintingContext } from './useEditor'
import { applyChangeToDeck } from './deck-changes'

/**
 * Deck-specific helpers wiring a deck into the shared {@link useEditor} engine.
 * Pure functions over {@link DeckData}, shared by the admin deck editor and the
 * public deck editor so the two stay behaviorally identical.
 */

/**
 * Find one deck card by card ID, falling back to its name. The id match wins
 * outright for the reason {@link findDeckCardLanguage} spells out: a combined
 * `(id || name)` predicate answers for the first same-name card, so a deck
 * holding the card twice resolves the wrong copy — a `[ja]` line behind an
 * English line of the same card would resolve `en`, and a ja→en change would
 * consolidate into a no-op. The id must also *agree* with the name, for the
 * reason `findEntryByIdOrName` (entry-targeting.ts) spells out: `&N` is released
 * to a reuse pool on removal, so the same id can name a different card in the
 * on-disk baseline than it does in the edited data — and every one of these
 * lookups resolves against both.
 */
export function findDeckCard(deck: DeckData, cardName: string, cardId?: number): Card | undefined {
  const allCards = deck.sections.flatMap((s) => s.cards)
  if (cardId !== undefined) {
    const byId = allCards.find((c) => c.cardId === cardId && c.name === cardName)
    if (byId) return byId
  }
  return allCards.find((c) => c.name === cardName)
}

/** Find a targeted card's finish, falling back to 'nonfoil' for a bare line. */
export function findDeckFinish(deck: DeckData, cardName: string, cardId?: number): Finish {
  return findDeckCard(deck, cardName, cardId)?.finish ?? 'nonfoil'
}

/**
 * Find a card's language by card ID (falling back to name), for set-language
 * consolidation and the language picker's current-value mark. Returns the
 * written value: undefined means a bare line, which reads as `en`.
 */
export function findDeckCardLanguage(
  deck: DeckData,
  cardName: string,
  cardId?: number,
): CardLanguage | undefined {
  return findDeckCard(deck, cardName, cardId)?.language
}

/**
 * Find a card's label override by card ID (falling back to name), for
 * set-label consolidation — restoring a line's on-disk override cancels the
 * pending change outright. `undefined` means the line carries no override and
 * inherits the deck's front-matter default. Resolves by id first for the same
 * reason {@link findDeckCardLanguage} does.
 */
export function findDeckCardLabels(
  deck: DeckData | null,
  cardName: string,
  cardId?: number,
): CardLabel[] | undefined {
  return deck ? findDeckCard(deck, cardName, cardId)?.labels : undefined
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

  // `language` rides along when the picker resolved one (a printing unavailable
  // in the default language); absent, the set-printing leaves the entry's
  // language alone.
  const newPrinting: PrintingTuple = {
    set: options.set,
    collectorNumber: options.collectorNumber,
    finish: options.finish,
    condition: options.condition,
    language: options.language,
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
            language: newPrinting.language,
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
              language: options.language,
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
