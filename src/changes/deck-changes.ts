import type { Card } from '../card/card'
import type { DeckData } from '../list/deck'
import type { ChangeInput, PrintingTuple, SetPrintingChange } from './change-event'
import type { CardLabel } from '../card/card-labels'
import type { ApplyChangeOptions } from './apply-batch'
import { isSamePrinting } from './change-event'
import {
  COMMANDER_SECTION,
  findOrCreateSection,
  isCommanderSection,
  resolveDefaultAddSection,
} from '../list/deck-format'
import { normalizedOverride, sameCardLabels } from '../card/card-labels'
import {
  normalizedTags,
  sameCardTags,
  withCardTag,
  withoutCardTag,
  type CardTag,
} from '../card/card-tags'
import { canSetFinish, finishMatchesPrinting, hasSpecificPrinting } from '../card/card-printing'
import { applyConditionUpdate } from '../card/finish-condition'
import { noteOrUndefined } from '../card/note-helpers'
import { storedLanguage } from '../card/card-language'

/** The card fields commander targeting matches on. */
type CommanderTarget = { cardId?: number; name: string }

/**
 * Whether an `add` of this name, printing and label override folds into `card`
 * rather than starting a line of its own.
 *
 * A card whose printing differs (e.g. after a partial "change printing" split)
 * stays its own entry instead of merging into a same-named entry with a
 * different set/finish/condition — and a `[proxy]` copy stays off the line
 * holding the real card, which would otherwise either lose its label or hand it
 * to copies that are not proxies.
 */
function mergesOntoCard(
  card: Card,
  cardName: string,
  printing: PrintingTuple,
  labels: readonly CardLabel[] | undefined,
  tags: readonly CardTag[] | undefined,
): boolean {
  return (
    card.name === cardName &&
    isSamePrinting(card, printing) &&
    sameCardLabels(card.labels, labels) &&
    // A line's tags describe every copy on it, so a differently-tagged copy
    // starts its own line rather than inheriting (or overwriting) the tags.
    sameCardTags(card.tags, tags)
  )
}

/**
 * The `&N` an `add` would land on because it merges into a line the deck
 * already has, or `undefined` when it would start a new one (or the line it
 * merges into carries no id yet).
 *
 * Deliberately ignores `change.cardId`: the caller is an editing session asking
 * *before* it applies the add, and the id it allocated is by definition one no
 * line carries. What the answer is for is aiming per-line metadata — custom art
 * — at the line the copies will actually share, rather than at an id that
 * evaporates when {@link applyChangeToDeck} folds the copy in.
 */
export function findDeckAddMergeTargetId(deck: DeckData, change: ChangeInput): number | undefined {
  if (change.action !== 'add') return undefined
  for (const section of deck.sections) {
    const found = section.cards.find((c) =>
      mergesOntoCard(c, change.cardName, change, change.labels, change.tags),
    )
    if (found) return found.cardId
  }
  return undefined
}

/**
 * Apply one change to a deck, returning a new deck (the input is not mutated).
 *
 * A card-targeting change (`remove`, `set-*`, `set-commander`, `unset-commander`,
 * `move-from`) whose target does not exist returns the deck **unchanged** and
 * reports the miss through `options.onMiss` — write paths that must not silently drop a
 * change (MCP mutations, one-shot CLI mutations) pass a callback and surface the
 * failure; preview/overlay callers may omit it. Matching is exact and
 * case-sensitive on name, with `cardId` taking priority.
 *
 * Section-structural changes (`add-section`, `remove-section`,
 * `rename-section`) are deliberately outside the miss contract:
 * `remove-section` on a non-empty section is a safety refusal, and the others
 * are treated as idempotent. Extending reporting to them is tracked for a
 * later phase.
 */
export function applyChangeToDeck(
  deck: DeckData,
  change: ChangeInput,
  options?: ApplyChangeOptions,
): DeckData {
  const sections = deck.sections.map((s) => ({
    ...s,
    cards: s.cards.map((c) => ({ ...c })),
  }))

  // Section-meta changes carry no card; guard the reads so the closures type-check.
  const changeCardId = 'cardId' in change ? change.cardId : undefined
  const changeCardName = 'cardName' in change ? change.cardName : ''

  // Find a card by cardId first (precise), then fall back to name match
  const findCard = (sectionList: typeof sections) => {
    if (changeCardId !== undefined) {
      for (const section of sectionList) {
        const idx = section.cards.findIndex((c) => c.cardId === changeCardId)
        if (idx !== -1) return { section, idx, card: section.cards[idx]! }
      }
    }
    for (const section of sectionList) {
      const idx = section.cards.findIndex((c) => c.name === changeCardName)
      if (idx !== -1) return { section, idx, card: section.cards[idx]! }
    }
    return null
  }

  // For adds, an existing entry is matched by cardId first, then by the
  // merge rule ({@link mergesOntoCard}) — name AND identical printing AND the
  // same label override.
  const changeLabels = 'labels' in change ? change.labels : undefined
  const changeTags = 'tags' in change ? change.tags : undefined
  const findCardForAdd = (sectionList: typeof sections, printing: PrintingTuple) => {
    if (changeCardId !== undefined) {
      for (const section of sectionList) {
        const idx = section.cards.findIndex((c) => c.cardId === changeCardId)
        if (idx !== -1) return { section, idx, card: section.cards[idx]! }
      }
    }
    for (const section of sectionList) {
      const idx = section.cards.findIndex((c) =>
        mergesOntoCard(c, changeCardName, printing, changeLabels, changeTags),
      )
      if (idx !== -1) return { section, idx, card: section.cards[idx]! }
    }
    return null
  }

  switch (change.action) {
    case 'add': {
      // Find existing card to increment quantity
      const found = findCardForAdd(sections, change)
      if (found) {
        found.card.quantity += 1
        return { ...deck, sections }
      }

      // No existing entry — add to the explicitly requested section if given, otherwise the
      // first non-commander, non-sideboard section.
      const targetSection = change.section
        ? findOrCreateSection(sections, change.section)
        : resolveDefaultAddSection(sections)
      targetSection.cards.push({
        quantity: 1,
        name: change.cardName,
        // Normalized on the way into in-memory state, per the set-code rule.
        set: change.set?.toLowerCase(),
        collectorNumber: change.collectorNumber,
        finish: change.finish,
        // `AddChange.condition` is a plain grade (adds have no `NONE` clear),
        // so it is recorded as-is.
        condition: change.condition,
        // The written value: `undefined` means `en` and serializes bare.
        language: change.language,
        // An empty override is no override — the deck's front-matter default
        // applies, exactly as on a collection.
        labels: normalizedOverride(change.labels),
        tags: normalizedTags(change.tags),
        cardId: change.cardId,
      })
      return { ...deck, sections }
    }

    case 'remove': {
      const found = findCard(sections)
      if (found) {
        found.card.quantity -= 1
        if (found.card.quantity <= 0) {
          found.section.cards.splice(found.idx, 1)
        }
        return { ...deck, sections }
      }
      options?.onMiss?.('no-target')
      return { ...deck, sections }
    }

    case 'set-commander': {
      // One predicate for both the move and the miss check — targeting by
      // cardId when the change carries one, by exact name otherwise. A looser
      // miss check (findCard's name fallback) would let a stale cardId with a
      // valid name report success while moving nothing.
      const matches = (c: CommanderTarget): boolean =>
        change.cardId !== undefined ? c.cardId === change.cardId : c.name === changeCardName
      // The commander section is created lazily, once the card is actually
      // found — a missed change must not leave an empty section behind.
      const commanderSection = sections.find((s) => isCommanderSection(s.name))

      for (const section of sections) {
        const idx = section.cards.findIndex(matches)
        if (idx !== -1 && section !== commanderSection) {
          const [removed] = section.cards.splice(idx, 1)
          if (removed) {
            if (commanderSection) {
              commanderSection.cards.push(removed)
            } else {
              sections.unshift({ name: COMMANDER_SECTION, cards: [removed] })
            }
          }
          return { ...deck, sections }
        }
      }

      // Reaching here means either the card is already in the commander section
      // (an idempotent success) or it does not exist at all (a miss).
      if (!sections.some((s) => s.cards.some(matches))) options?.onMiss?.('no-target')
      return { ...deck, sections }
    }

    case 'unset-commander': {
      // Same targeting predicate as set-commander, and the same idempotence:
      // a card that exists but is already outside the commander section is the
      // requested end state, not a miss. Only a card that does not exist at
      // all misses.
      const matches = (c: CommanderTarget): boolean =>
        change.cardId !== undefined ? c.cardId === change.cardId : c.name === changeCardName
      const commanderSection = sections.find((s) => isCommanderSection(s.name))
      const idx = commanderSection ? commanderSection.cards.findIndex(matches) : -1
      if (!commanderSection || idx === -1) {
        if (!sections.some((s) => s.cards.some(matches))) options?.onMiss?.('no-target')
        return { ...deck, sections }
      }

      const [removed] = commanderSection.cards.splice(idx, 1)
      if (!removed) return { ...deck, sections }

      resolveDefaultAddSection(sections).cards.push(removed)
      return { ...deck, sections }
    }

    case 'set-finish': {
      const found = findCard(sections)
      if (found) {
        // A foil/etched token is a claim about a printing, so a name-only line
        // cannot take one — the caller must pin a printing first.
        if (!canSetFinish(found.card, change.finish)) {
          options?.onMiss?.('needs-printing')
          return { ...deck, sections }
        }
        found.card.finish = change.finish
        return { ...deck, sections }
      }
      options?.onMiss?.('no-target')
      return { ...deck, sections }
    }

    case 'set-printing': {
      const found = findCard(sections)
      if (found) {
        // This action writes the printing and the finish together, so the pair
        // has to hold together: clearing the printing off a line while writing
        // `[foil]` would produce exactly what `set-finish` refuses.
        if (!finishMatchesPrinting(change)) {
          options?.onMiss?.('needs-printing')
          return { ...deck, sections }
        }
        writePrinting(found.card, change)
        return { ...deck, sections }
      }
      options?.onMiss?.('no-target')
      return { ...deck, sections }
    }

    case 'set-language': {
      const found = findCard(sections)
      if (found) {
        // `en` clears the stored value so the line serializes bare (the
        // serializer omits the token for `en` either way; clearing keeps the
        // in-memory shape matching what a re-parse would produce).
        found.card.language = storedLanguage(change.language)
        return { ...deck, sections }
      }
      options?.onMiss?.('no-target')
      return { ...deck, sections }
    }

    case 'set-note': {
      const found = findCard(sections)
      if (found) {
        found.card.note = noteOrUndefined(change.note)
        return { ...deck, sections }
      }
      options?.onMiss?.('no-target')
      return { ...deck, sections }
    }

    case 'set-label': {
      const found = findCard(sections)
      if (!found) {
        options?.onMiss?.('no-target')
        return { ...deck, sections }
      }
      // A deck carries `proxy` alone; validating the vocabulary is the write
      // surfaces' job (CLI flags, HTTP bodies), exactly as for a collection.
      // An empty set clears the override — the line falls back to the deck's
      // front-matter default.
      found.card.labels = normalizedOverride(change.labels)
      return { ...deck, sections }
    }

    case 'add-tag':
    case 'remove-tag': {
      const found = findCard(sections)
      if (!found) {
        options?.onMiss?.('no-target')
        return { ...deck, sections }
      }
      // A deck line's tags describe every copy on it, exactly like its labels.
      found.card.tags =
        change.action === 'add-tag'
          ? withCardTag(found.card.tags, change.tag)
          : withoutCardTag(found.card.tags, change.tag)
      return { ...deck, sections }
    }

    case 'add-section': {
      findOrCreateSection(sections, change.section)
      return { ...deck, sections }
    }

    case 'remove-section': {
      // Only remove an empty section; a non-empty one is left intact as a safety guard.
      const idx = sections.findIndex((s) => s.name === change.section && s.cards.length === 0)
      if (idx !== -1) sections.splice(idx, 1)
      return { ...deck, sections }
    }

    case 'rename-section': {
      const target = sections.find((s) => s.name === change.section)
      if (target) target.name = change.newSection
      return { ...deck, sections }
    }

    case 'set-categories':
    case 'rename-category':
    case 'set-category-order': {
      // Categories are keyed by card NAME and live in the list's
      // `.categories.json` sidecar, never on a card line — so the entries are
      // untouched and this is not a miss. The record travelling beside them is
      // replayed by `applyCategoryChangesToRecord` and written to disk by
      // `commitCategoryChanges` at save time.
      return { ...deck, sections }
    }

    case 'set-section': {
      const found = findCard(sections)
      if (!found) {
        options?.onMiss?.('no-target')
        return { ...deck, sections }
      }
      if (found.section.name === change.section) return { ...deck, sections }
      const [moved] = found.section.cards.splice(found.idx, 1)
      if (!moved) return { ...deck, sections }
      findOrCreateSection(sections, change.section).cards.push(moved)
      return { ...deck, sections }
    }

    case 'move-from':
      // A move out of this deck removes one copy here; the destination write is
      // handled at save time (admin) or on import of the destination's change file.
      return applyChangeToDeck(
        deck,
        {
          action: 'remove',
          cardName: change.cardName,
          cardId: change.cardId,
          set: change.set,
          collectorNumber: change.collectorNumber,
          finish: change.finish,
          condition: change.condition,
          language: change.language,
        },
        options,
      )

    case 'move-to': {
      // A copy pinning a name-only line the deck already holds (the swap
      // wizard's "set printing from another list"): see `pinDeckLine`.
      if (change.replacesCardId !== undefined) {
        if (pinDeckLine(sections, change, change.replacesCardId)) return { ...deck, sections }
        options?.onMiss?.('no-target')
        return { ...deck, sections }
      }
      // A move into this deck adds the card (e.g. when importing a destination list's changes).
      return applyChangeToDeck(
        deck,
        {
          action: 'add',
          cardName: change.cardName,
          cardId: change.cardId,
          set: change.set,
          collectorNumber: change.collectorNumber,
          finish: change.finish,
          condition: change.condition,
          language: change.language,
          tags: change.tags,
          section: change.section,
        },
        options,
      )
    }
  }
}

/** Where a line sits: its section and index within it. */
type DeckLinePosition = { section: DeckData['sections'][number]; idx: number }

/** A `move-to` change input (the pinning variant carries `replacesCardId`, see `MoveToChange`). */
type PinningMoveTo = Extract<ChangeInput, { action: 'move-to' }>

/**
 * Apply a `move-to` that pins the name-only line `replacesCardId` (mutates
 * `sections`; returns false when no line carries that id).
 *
 * In place (`change.cardId === replacesCardId`): the line takes the event's
 * printing and keeps its `&N` and quantity. A deck line's fill is one event
 * per copy, all naming the same line, so only the first changes anything —
 * a later copy finds the line already pinned and leaves it alone.
 *
 * Split (`change.cardId` names another line): one copy comes off the
 * name-only line (the line goes at zero) and lands as an add would — on the
 * line `cardId` names, else on the line the merge rule folds it onto, else on
 * a fresh line inserted right after the one it came from, so a partially
 * filled card stays next to its unpinned remainder.
 */
function pinDeckLine(
  sections: DeckData['sections'],
  change: PinningMoveTo,
  replacesCardId: number,
): boolean {
  let found: DeckLinePosition | null = null
  for (const section of sections) {
    const idx = section.cards.findIndex((c) => c.cardId === replacesCardId)
    if (idx !== -1) {
      found = { section, idx }
      break
    }
  }
  if (!found) return false
  const line = found.section.cards[found.idx]!
  // The pair has to hold together, exactly as `set-printing` requires.
  if (!finishMatchesPrinting(change)) return false

  if (change.cardId === replacesCardId) {
    // Copies 2..n of a deck line's fill find it already pinned by the first
    // and change nothing — but only when it is THIS printing: a pinned id
    // that resolved to some other line (an import's name fallback) is a miss.
    if (hasSpecificPrinting(line)) return isSamePrinting(line, change)
    writePrinting(line, change)
    return true
  }
  // A split needs the id the copy lands on: an id-less line would be one the
  // art/effects plan never allocated.
  if (change.cardId === undefined) return false

  line.quantity -= 1
  if (line.quantity <= 0) found.section.cards.splice(found.idx, 1)
  const cards = sections.flatMap((s) => s.cards)
  const landing =
    cards.find((c) => c.cardId === change.cardId) ??
    // The copy is one of the fill's own, so it keeps the fill's override and
    // tags: it lands on a line that shares them, or starts one that does.
    cards.find((c) => mergesOntoCard(c, change.cardName, change, line.labels, line.tags))
  if (landing) {
    landing.quantity += 1
    return true
  }
  const insertAt = line.quantity <= 0 ? found.idx : found.idx + 1
  const fresh: Card = {
    quantity: 1,
    name: change.cardName,
    cardId: change.cardId,
    labels: line.labels,
    tags: line.tags,
  }
  writePrinting(fresh, change)
  found.section.cards.splice(insertAt, 0, fresh)
  return true
}

/**
 * Write a change's printing onto a line — the one rule `set-printing` and a
 * pinning `move-to` share: set/collector number/finish are written wholesale,
 * the condition through `applyConditionUpdate`, and an absent language leaves
 * the line's alone (language changes have their own event).
 */
function writePrinting(
  card: Card,
  change: Pick<SetPrintingChange, 'set' | 'collectorNumber' | 'finish' | 'condition' | 'language'>,
): void {
  card.set = change.set?.toLowerCase()
  card.collectorNumber = change.collectorNumber
  card.finish = change.finish
  card.condition = applyConditionUpdate(change.condition, card.condition)
  if (change.language !== undefined) card.language = change.language
}
