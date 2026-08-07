import {
  createAddChange,
  createRemoveChange,
  createSetCommanderChange,
  createUnsetCommanderChange,
  createSetFinishChange,
  type CardChange,
  type CardPrintingOptions,
} from './change-event'
import type { Card, DeckSection, Finish, Condition } from './types'
import { displayLanguage, type CardLanguage } from './card-language'

// ── Shared helpers ───────────────────────────────────────────────────

type CardIdentity = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  language?: CardLanguage
  cardId?: number
}

// Notes and label overrides are deliberately NOT part of the key, and neither
// has a diff rule: a hand-edited `{note}` or `[keep]` produces no changelog
// entry from detect-changes — it is absorbed on the next hash stamp. In-app
// edits record those changes through their own set-note / set-label events.
// The language folds a missing token to `en`, so adding/removing a redundant
// `[en]` is not a change. A hand-edited `[ja]` likewise produces no
// detect-changes entries when the line carries an `&N` id (the id
// short-circuits the composite key); only on an id-less line does it read as
// remove+add.
function compositeKey(c: CardIdentity): string {
  return [
    c.name,
    c.set?.toLowerCase() ?? '',
    c.collectorNumber ?? '',
    c.finish ?? '',
    c.condition ?? '',
    displayLanguage(c.language),
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
    language: c.language,
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
): CardChange[] {
  const changes: CardChange[] = []
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
          changes.push(createAddChange(card.name, printingOptions(card)))
          if (card.isCommander) {
            changes.push(createSetCommanderChange(card.name, { cardId: card.cardId }))
          }
        }
      }
      continue
    }

    if (oldBucket && !newBucket) {
      for (const card of oldBucket.cards) {
        for (let i = 0; i < card.quantity; i++) {
          changes.push(createRemoveChange(card.name, printingOptions(card)))
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
          changes.push(createAddChange(newCard.name, printingOptions(newCard)))
        }
      } else if (qtyDiff < 0) {
        for (let i = 0; i < -qtyDiff; i++) {
          changes.push(createRemoveChange(oldCard.name, printingOptions(oldCard)))
        }
      }

      // Commander status: check ANY card in the bucket, not just the first,
      // because the same card can appear in both a regular and commander section
      const wasCommander = oldBucket.cards.some((c) => c.isCommander)
      const isCommander = newBucket.cards.some((c) => c.isCommander)

      if (!wasCommander && isCommander) {
        changes.push(createSetCommanderChange(newCard.name, { cardId: newCard.cardId }))
      } else if (wasCommander && !isCommander) {
        changes.push(createUnsetCommanderChange(oldCard.name, { cardId: oldCard.cardId }))
      }

      // Finish change (only when setting TO a finish — no unset-finish action exists)
      if (oldCard.finish !== newCard.finish && newCard.finish) {
        changes.push(
          createSetFinishChange(newCard.name, { finish: newCard.finish, cardId: newCard.cardId }),
        )
      }
    }
  }

  return changes
}

// ── Collection / Wanted diffing ──────────────────────────────────────

type DiffEntriesOptions = {
  trackFinish?: boolean
  trackQuantity?: boolean
}

/**
 * Generic entry-level diff. Always detects additions and removals of distinct
 * printings. Optionally detects finish changes and quantity changes for entries
 * matched by the same identity key (requires card IDs for finish-change
 * detection when finish is part of the composite key).
 */
type DiffableEntry = CardIdentity & { name: string; quantity?: number }

function diffEntries<T extends DiffableEntry>(
  oldEntries: T[],
  newEntries: T[],
  options: DiffEntriesOptions = {},
): CardChange[] {
  const changes: CardChange[] = []
  const oldMap = new Map<string, T>()
  const newMap = new Map<string, T>()

  for (const e of oldEntries) oldMap.set(identityKey(e), e)
  for (const e of newEntries) newMap.set(identityKey(e), e)

  for (const [key, old] of oldMap) {
    if (!newMap.has(key)) {
      changes.push(createRemoveChange(old.name, printingOptions(old)))
    }
  }

  for (const [key, entry] of newMap) {
    if (!oldMap.has(key)) {
      changes.push(createAddChange(entry.name, printingOptions(entry)))
    }
  }

  if (options.trackFinish || options.trackQuantity) {
    for (const [key, newEntry] of newMap) {
      const oldEntry = oldMap.get(key)
      if (!oldEntry) continue

      if (options.trackFinish && oldEntry.finish !== newEntry.finish && newEntry.finish) {
        changes.push(
          createSetFinishChange(newEntry.name, {
            finish: newEntry.finish,
            cardId: newEntry.cardId,
          }),
        )
      }

      if (options.trackQuantity) {
        const oldQty = oldEntry.quantity ?? 1
        const newQty = newEntry.quantity ?? 1
        const qtyDiff = newQty - oldQty
        if (qtyDiff > 0) {
          for (let i = 0; i < qtyDiff; i++) {
            changes.push(createAddChange(newEntry.name, printingOptions(newEntry)))
          }
        } else if (qtyDiff < 0) {
          for (let i = 0; i < -qtyDiff; i++) {
            changes.push(createRemoveChange(oldEntry.name, printingOptions(oldEntry)))
          }
        }
      }
    }
  }

  return changes
}

/**
 * Diff two collection entry lists and produce change events.
 *
 * Detects:
 * - Cards added / removed
 * - Finish changes (only when setting TO a finish — matched by card ID when available)
 *
 * Quantity changes within the same printing are NOT tracked.
 */
export function diffCollectionEntries(
  oldEntries: DiffableEntry[],
  newEntries: DiffableEntry[],
): CardChange[] {
  return diffEntries(oldEntries, newEntries, { trackFinish: true })
}

/**
 * Diff two wanted list entry lists and produce change events.
 *
 * Detects:
 * - Cards added / removed (including quantity changes)
 * - Finish changes (only when setting TO a finish — matched by card ID when available)
 */
export function diffWantedEntries(
  oldEntries: DiffableEntry[],
  newEntries: DiffableEntry[],
): CardChange[] {
  return diffEntries(oldEntries, newEntries, { trackFinish: true, trackQuantity: true })
}
