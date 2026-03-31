import { createChangeEvent, type ChangeEvent, type CardPrintingOptions } from './change-event'
import type { Card, DeckSection, Finish, Condition } from './types'
import type { CollectionEntry } from './commands/price-collection'
import type { WantedListEntry } from './commands/wanted-helpers'

// ── Shared helpers ───────────────────────────────────────────────────

type CardIdentity = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  cardId?: number
}

function compositeKey(c: CardIdentity): string {
  return [
    c.name,
    c.set?.toLowerCase() ?? '',
    c.collectorNumber ?? '',
    c.finish ?? '',
    c.condition ?? '',
  ].join('|')
}

function identityKey(c: CardIdentity): string {
  if (c.cardId !== undefined) return `id:${c.cardId}`
  return compositeKey(c)
}

function printingOptions(c: CardIdentity): CardPrintingOptions {
  return {
    set: c.set,
    collectorNumber: c.collectorNumber,
    finish: c.finish,
    condition: c.condition,
    cardId: c.cardId,
  }
}

// ── Deck diffing ─────────────────────────────────────────────────────

function isCommanderSection(name: string): boolean {
  return name.toLowerCase() === 'commander'
}

type FlatCard = Readonly<Card> & { readonly isCommander: boolean }

function flattenSections(sections: DeckSection[]): FlatCard[] {
  const cards: FlatCard[] = []
  for (const section of sections) {
    const commander = isCommanderSection(section.name)
    for (const card of section.cards) {
      cards.push({ ...card, isCommander: commander })
    }
  }
  return cards
}

type CardBucket = {
  // Mutable accumulator — cards array grows during bucketing
  cards: FlatCard[]
  totalQty: number
}

function bucketByIdentity(cards: FlatCard[]): Map<string, CardBucket> {
  const map = new Map<string, CardBucket>()
  for (const card of cards) {
    const key = identityKey(card)
    const existing = map.get(key)
    if (existing) {
      existing.cards.push(card)
      existing.totalQty += card.quantity
    } else {
      map.set(key, { cards: [card], totalQty: card.quantity })
    }
  }
  return map
}

/**
 * Diff two sets of deck sections and produce change events.
 *
 * Detects:
 * - Cards added / removed (including quantity changes)
 * - Commander status changes
 * - Finish changes (only when setting TO a finish — removal of finish
 *   metadata is not tracked because the changelog system has no
 *   `unset-finish` action)
 */
export function diffDeckCards(
  oldSections: DeckSection[],
  newSections: DeckSection[],
): ChangeEvent[] {
  const changes: ChangeEvent[] = []
  const oldFlat = flattenSections(oldSections)
  const newFlat = flattenSections(newSections)
  const oldBuckets = bucketByIdentity(oldFlat)
  const newBuckets = bucketByIdentity(newFlat)

  const allKeys = new Set([...oldBuckets.keys(), ...newBuckets.keys()])

  for (const key of allKeys) {
    const oldBucket = oldBuckets.get(key)
    const newBucket = newBuckets.get(key)

    if (!oldBucket && newBucket) {
      for (const card of newBucket.cards) {
        for (let i = 0; i < card.quantity; i++) {
          changes.push(createChangeEvent('add', card.name, printingOptions(card)))
          if (card.isCommander) {
            changes.push(createChangeEvent('set-commander', card.name, { cardId: card.cardId }))
          }
        }
      }
      continue
    }

    if (oldBucket && !newBucket) {
      for (const card of oldBucket.cards) {
        for (let i = 0; i < card.quantity; i++) {
          changes.push(createChangeEvent('remove', card.name, printingOptions(card)))
        }
      }
      continue
    }

    if (oldBucket && newBucket) {
      const oldCard = oldBucket.cards[0]
      const newCard = newBucket.cards[0]
      if (!oldCard || !newCard) continue

      // Quantity changes
      const qtyDiff = newBucket.totalQty - oldBucket.totalQty
      if (qtyDiff > 0) {
        for (let i = 0; i < qtyDiff; i++) {
          changes.push(createChangeEvent('add', newCard.name, printingOptions(newCard)))
        }
      } else if (qtyDiff < 0) {
        for (let i = 0; i < -qtyDiff; i++) {
          changes.push(createChangeEvent('remove', oldCard.name, printingOptions(oldCard)))
        }
      }

      // Commander status: check ANY card in the bucket, not just the first,
      // because the same card can appear in both a regular and commander section
      const wasCommander = oldBucket.cards.some((c) => c.isCommander)
      const isCommander = newBucket.cards.some((c) => c.isCommander)

      if (!wasCommander && isCommander) {
        changes.push(createChangeEvent('set-commander', newCard.name, { cardId: newCard.cardId }))
      } else if (wasCommander && !isCommander) {
        changes.push(createChangeEvent('unset-commander', oldCard.name, { cardId: oldCard.cardId }))
      }

      // Finish change (only when setting TO a finish — no unset-finish action exists)
      if (oldCard.finish !== newCard.finish && newCard.finish) {
        changes.push(
          createChangeEvent('set-finish', newCard.name, {
            finish: newCard.finish,
            cardId: newCard.cardId,
          }),
        )
      }
    }
  }

  return changes
}

// ── Collection / Wanted diffing ──────────────────────────────────────

/**
 * Generic entry-level diff. Detects additions and removals of distinct
 * printings. Quantity changes within the same printing are NOT tracked —
 * only presence/absence matters.
 */
function diffEntries<T extends CardIdentity & { name: string }>(
  oldEntries: T[],
  newEntries: T[],
): ChangeEvent[] {
  const changes: ChangeEvent[] = []
  const oldMap = new Map<string, T>()
  const newMap = new Map<string, T>()

  for (const e of oldEntries) oldMap.set(identityKey(e), e)
  for (const e of newEntries) newMap.set(identityKey(e), e)

  for (const [key, old] of oldMap) {
    if (!newMap.has(key)) {
      changes.push(createChangeEvent('remove', old.name, printingOptions(old)))
    }
  }

  for (const [key, entry] of newMap) {
    if (!oldMap.has(key)) {
      changes.push(createChangeEvent('add', entry.name, printingOptions(entry)))
    }
  }

  return changes
}

/**
 * Diff two collection entry lists and produce change events.
 * Quantity changes within the same printing are NOT tracked.
 */
export function diffCollectionEntries(
  oldEntries: CollectionEntry[],
  newEntries: CollectionEntry[],
): ChangeEvent[] {
  return diffEntries(oldEntries, newEntries)
}

/**
 * Diff two wanted list entry lists and produce change events.
 * Quantity changes within the same printing are NOT tracked.
 */
export function diffWantedEntries(
  oldEntries: WantedListEntry[],
  newEntries: WantedListEntry[],
): ChangeEvent[] {
  return diffEntries(oldEntries, newEntries)
}
