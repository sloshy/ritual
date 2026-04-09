import { createChangeEvent, type ChangeEvent } from '../change-event'
import type { DeckSection } from '../types'

export type CardSummary = {
  name: string
  totalQuantity: number
  isCommander: boolean
}

export type QuantityChange = {
  name: string
  oldQty: number
  newQty: number
  isCommander: boolean
}

export type NameDiff = {
  added: CardSummary[]
  removed: CardSummary[]
  quantityChanged: QuantityChange[]
}

/**
 * Flatten deck sections into a map of card name (lowercase) → summary.
 * Quantities are summed across all sections.
 */
export function summarizeCards(sections: DeckSection[]): Map<string, CardSummary> {
  const map = new Map<string, CardSummary>()
  for (const section of sections) {
    const isCommander = section.name.toLowerCase() === 'commander'
    for (const card of section.cards) {
      const key = card.name.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        existing.totalQuantity += card.quantity
        if (isCommander) existing.isCommander = true
      } else {
        map.set(key, {
          name: card.name,
          totalQuantity: card.quantity,
          isCommander,
        })
      }
    }
  }
  return map
}

/**
 * Diff two sets of deck sections by card name only.
 * Ignores set, collectorNumber, finish, condition, and categories.
 */
export function diffByCardName(oldSections: DeckSection[], newSections: DeckSection[]): NameDiff {
  const oldMap = summarizeCards(oldSections)
  const newMap = summarizeCards(newSections)

  const added: CardSummary[] = []
  const removed: CardSummary[] = []
  const quantityChanged: NameDiff['quantityChanged'] = []

  for (const [key, newCard] of newMap) {
    const oldCard = oldMap.get(key)
    if (!oldCard) {
      added.push(newCard)
    } else if (oldCard.totalQuantity !== newCard.totalQuantity) {
      quantityChanged.push({
        name: newCard.name,
        oldQty: oldCard.totalQuantity,
        newQty: newCard.totalQuantity,
        isCommander: newCard.isCommander,
      })
    }
  }

  for (const [key, oldCard] of oldMap) {
    if (!newMap.has(key)) {
      removed.push(oldCard)
    }
  }

  return { added, removed, quantityChanged }
}

/**
 * Convert a NameDiff into ChangeEvent[] for changelog recording.
 * Each copy added/removed is a separate event (matching existing convention).
 */
export function diffToChangeEvents(diff: NameDiff): ChangeEvent[] {
  const changes: ChangeEvent[] = []

  for (const card of diff.added) {
    for (let i = 0; i < card.totalQuantity; i++) {
      changes.push(createChangeEvent('add', card.name))
    }
  }

  for (const card of diff.removed) {
    for (let i = 0; i < card.totalQuantity; i++) {
      changes.push(createChangeEvent('remove', card.name))
    }
  }

  for (const entry of diff.quantityChanged) {
    const delta = entry.newQty - entry.oldQty
    if (delta > 0) {
      for (let i = 0; i < delta; i++) {
        changes.push(createChangeEvent('add', entry.name))
      }
    } else {
      for (let i = 0; i < -delta; i++) {
        changes.push(createChangeEvent('remove', entry.name))
      }
    }
  }

  return changes
}

/** Check whether a NameDiff contains any changes. */
export function isDiffEmpty(diff: NameDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.quantityChanged.length === 0
}

/**
 * Apply a NameDiff (remote = new, local = old) to local deck sections.
 * Adds new cards to Commander or Main section based on their Archidekt category.
 * Adjusts quantities in-place. Removes cards when they're gone from remote.
 */
export function applyDownloadDiff(sections: DeckSection[], diff: NameDiff): DeckSection[] {
  const result = sections.map((s) => ({
    name: s.name,
    cards: s.cards.map((c) => ({ ...c })),
  }))

  // Remove cards
  for (const card of diff.removed) {
    for (const section of result) {
      section.cards = section.cards.filter((c) => c.name.toLowerCase() !== card.name.toLowerCase())
    }
  }

  // Adjust quantities
  for (const entry of diff.quantityChanged) {
    const delta = entry.newQty - entry.oldQty
    for (const section of result) {
      const card = section.cards.find((c) => c.name.toLowerCase() === entry.name.toLowerCase())
      if (card) {
        card.quantity = Math.max(1, card.quantity + delta)
        break
      }
    }
  }

  // Add new cards
  for (const card of diff.added) {
    const targetSection = card.isCommander ? 'Commander' : 'Main'
    let section = result.find((s) => s.name === targetSection)
    if (!section) {
      section = { name: targetSection, cards: [] }
      result.push(section)
    }
    section.cards.push({ name: card.name, quantity: card.totalQuantity })
  }

  return result
}
