import type { Card } from '../card/card'
import type { DeckData, DeckSection } from '../list/deck'
import type { ChangeInput, PrintingTuple, SetPrintingChange } from './change-event'
import type { CardLabel, SignedCardLabel } from '../card/card-labels'
import type { ApplyChangeOptions } from './apply-batch'
import { isSamePrinting } from './change-event'
import {
  COMMANDER_SECTION,
  findOrCreateSection,
  resolveSectionName,
  isCommanderSection,
  resolveDefaultAddSection,
} from '../list/deck-format'
import {
  arrivalLabels,
  effectiveLabels,
  normalizedOverride,
  sameCardLabels,
} from '../card/card-labels'
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

/** What one copy landing on a deck brings: its printing, override, tags and section. */
export type DeckAdd = PrintingTuple & {
  labels?: readonly SignedCardLabel[]
  tags?: readonly CardTag[]
  section?: string
}

/**
 * What a deck must know to land a copy: its own front-matter default labels,
 * which decide the minimal override an arriving copy is written with and which
 * lines count as carrying the same labels. Required-but-nullable on every seam
 * that lands a copy, so one that forgot the default cannot compile.
 */
export type DeckLandingOptions = { listLabels: readonly CardLabel[] | undefined }

/**
 * What {@link applyChangeToDeck} takes: the shared apply options with the
 * deck's default labels required-but-nullable — an `add` merges by effective
 * labels and a `move-to` lands against them, so a caller that forgot the
 * default must not compile.
 */
export type DeckApplyOptions = ApplyChangeOptions & DeckLandingOptions

/**
 * Where a merge search looks: every section, or — for a `move-to` or an `add`
 * that names its destination section — that section alone (the deck's own
 * section that name means, per `resolveSectionName`). The one scope rule every
 * path that lands a copy follows (`ritual move`, `add-card`, a save's replay,
 * an import, a `ritual edit` destination), so the same change writes the same
 * bytes on all of them. An `add` naming no section searches every section.
 */
export type DeckMergeScope = DeckLandingOptions & { section?: string }

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
  copy: DeckAdd,
  listLabels: readonly CardLabel[] | undefined,
): boolean {
  return (
    card.name === cardName &&
    isSamePrinting(card, copy) &&
    // Labels are compared as each side's EFFECTIVE labels against the deck's
    // default: a line with a redundant `[proxy]` override in a `proxy`-default
    // deck carries the same labels as a copy that inherits them.
    sameCardLabels(
      effectiveLabels(card.labels, listLabels),
      effectiveLabels(copy.labels, listLabels),
    ) &&
    // A line's tags describe every copy on it, so a differently-tagged copy
    // starts its own line rather than inheriting (or overwriting) the tags.
    sameCardTags(card.tags, copy.tags)
  )
}

/**
 * The line an `add` / `move-to` folds onto under the reducer's merge rule (in
 * the change's section), or `null` when it would start a line of its own (a
 * line with no id yet is still the line). Any other action is `null`.
 *
 * Deliberately ignores `change.cardId`: the caller asks *before* it applies the
 * copy, and the id it would carry is one no line holds yet. What the answer is
 * for is aiming the copy — its id and per-line metadata such as custom art — at
 * the line it will actually share, rather than at an id that evaporates when
 * {@link applyChangeToDeck} folds it in.
 */
export function findDeckAddMergeLine(
  deck: DeckData,
  change: ChangeInput,
  options: DeckLandingOptions,
): DeckLineAt | null {
  if (change.action !== 'add' && change.action !== 'move-to') return null
  const copy = change.action === 'add' ? change : arrivingCopy(change, options.listLabels)
  return findDeckMergeLine(deck.sections, change.cardName, copy, {
    ...options,
    section: change.section,
  })
}

/** Where a line sits: its section, its index within it, and the line itself. */
export type DeckLineAt = { section: DeckSection; idx: number; card: Card }

/**
 * The line a copy of `cardName` folds onto under {@link mergesOntoCard}, in
 * `scope` ({@link DeckMergeScope}), or `null` when it would start a line of its
 * own. Ignores ids: the one merge-line finder behind the reducer's add, the
 * merge-target probe, the dropped-note probe and the on-disk move engine's
 * staged add, so none of them can disagree.
 */
export function findDeckMergeLine(
  sections: readonly DeckSection[],
  cardName: string,
  copy: DeckAdd,
  scope: DeckMergeScope,
): DeckLineAt | null {
  const scoped =
    scope.section === undefined
      ? undefined
      : resolveSectionName(
          sections.map((s) => s.name),
          scope.section,
        )
  for (const section of sections) {
    if (scoped !== undefined && section.name !== scoped) continue
    const idx = section.cards.findIndex((c) => mergesOntoCard(c, cardName, copy, scope.listLabels))
    if (idx !== -1) return { section, idx, card: section.cards[idx]! }
  }
  return null
}

/** The line carrying `cardId`, in any section, or `null`. */
function findLineById(sections: readonly DeckSection[], cardId: number): DeckLineAt | null {
  for (const section of sections) {
    const idx = section.cards.findIndex((c) => c.cardId === cardId)
    if (idx !== -1) return { section, idx, card: section.cards[idx]! }
  }
  return null
}

/**
 * The line a copy lands on: the one carrying `cardId` first, then the line the
 * merge rule folds it onto in `scope` — the reducer's own order, shared by the
 * add, the dropped-note probe and a pin's split.
 */
function findLandingLine(
  sections: readonly DeckSection[],
  cardId: number | undefined,
  cardName: string,
  copy: DeckAdd,
  scope: DeckMergeScope,
): DeckLineAt | null {
  return (
    (cardId !== undefined ? findLineById(sections, cardId) : null) ??
    findDeckMergeLine(sections, cardName, copy, scope)
  )
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
  options: DeckApplyOptions,
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
  // same label override and tags.
  const findCardForAdd = (add: DeckAdd, scope: DeckMergeScope): DeckLineAt | null =>
    findLandingLine(sections, changeCardId, changeCardName, add, scope)

  // Land one copy: onto the line it merges with in `scope` (that line keeps its
  // own note — one line, one note slot), else on a fresh line carrying `note`.
  const addCopy = (add: DeckAdd, note: string | undefined, scope: DeckMergeScope): DeckData => {
    const found = findCardForAdd(add, scope)
    if (found) {
      found.card.quantity += 1
      return { ...deck, sections }
    }

    // No existing entry — add to the explicitly requested section if given, otherwise the
    // first non-commander, non-sideboard section.
    const targetSection = add.section
      ? findOrCreateSection(sections, add.section)
      : resolveDefaultAddSection(sections)
    targetSection.cards.push({
      quantity: 1,
      name: changeCardName,
      // Normalized on the way into in-memory state, per the set-code rule.
      set: add.set?.toLowerCase(),
      collectorNumber: add.collectorNumber,
      finish: add.finish,
      // An add's condition is a plain grade (adds have no `NONE` clear), so it
      // is recorded as-is.
      condition: add.condition,
      // The written value: `undefined` means `en` and serializes bare.
      language: add.language,
      // An empty override is no override — the deck's front-matter default
      // applies, exactly as on a collection.
      labels: normalizedOverride(add.labels),
      tags: normalizedTags(add.tags),
      note: noteOrUndefined(note),
      cardId: changeCardId,
    })
    return { ...deck, sections }
  }

  switch (change.action) {
    case 'add':
      // An add that names its section merges only within it, the scope a
      // `move-to` arrival already uses: a copy added to the Sideboard must not
      // fold onto a same-printing Main line. Deck sync relies on this to replay
      // a partial board move (copies removed from a line, then added to a new
      // one in the target section) — unscoped, the adds would land straight
      // back on the line they left.
      return addCopy(change, undefined, {
        listLabels: options?.listLabels,
        section: change.section,
      })

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
      // Exact: an explicitly added section is a new heading, never an alias for
      // one the deck already has (`findOrCreateSection` would resolve `Main` to
      // `## Creatures`).
      if (!sections.some((s) => s.name === change.section)) {
        sections.push({ name: change.section, cards: [] })
      }
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
      // Resolved before comparing: a request that means the card's own section
      // (`main` for `## Main`, `Main` for `## Creatures`) leaves it in place
      // rather than moving it to that section's end.
      const target = findOrCreateSection(sections, change.section)
      if (target === found.section) return { ...deck, sections }
      const [moved] = found.section.cards.splice(found.idx, 1)
      if (!moved) return { ...deck, sections }
      target.cards.push(moved)
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
        if (pinDeckLine(sections, change, change.replacesCardId, options?.listLabels)) {
          return { ...deck, sections }
        }
        options?.onMiss?.('no-target')
        return { ...deck, sections }
      }
      // A move into this deck adds the card (e.g. when importing a destination
      // list's changes), keeping its tags, its note and the labels a deck
      // accepts (see `arrivingCopy`).
      return addCopy(arrivingCopy(change, options?.listLabels), change.note, {
        listLabels: options?.listLabels,
        section: change.section,
      })
    }
  }
}

/**
 * Whether a copy pinning the name-only `line` may convert it in place: its
 * carried labels, landed against the deck default (`arrivalLabels`, with its
 * source type), must be the line's effective labels. `proxy` is a physical
 * fact, so a pin never silently turns a proxy into a real card or the reverse;
 * a copy that differs splits off as its own arrival instead. The one rule the
 * reducer (`pinDeckLine`) and the swap planner's probe share.
 */
export function pinConvertsInPlace(
  line: Pick<Card, 'labels'>,
  change: Pick<MoveToInput, 'labels' | 'from'>,
  listLabels: readonly CardLabel[] | undefined,
): boolean {
  const landed = arrivalLabels('deck', change.labels, listLabels, change.from.type)
  return sameCardLabels(
    effectiveLabels(landed, listLabels),
    effectiveLabels(line.labels, listLabels),
  )
}

/** A `move-to` change input (the pinning variant carries `replacesCardId`, see `MoveToChange`). */
export type MoveToInput = Extract<ChangeInput, { action: 'move-to' }>

/**
 * What a `move-to` lands on a deck as: its printing, tags and section, and the
 * override {@link arrivalLabels} writes for the labels it carries — the part a
 * deck line can express (`proxy`), omitted when that equals the deck's own
 * default `listLabels`. That override is also what decides which line it merges
 * onto.
 */
function arrivingCopy(change: MoveToInput, listLabels: readonly CardLabel[] | undefined): DeckAdd {
  return {
    set: change.set,
    collectorNumber: change.collectorNumber,
    finish: change.finish,
    condition: change.condition,
    language: change.language,
    labels: arrivalLabels('deck', change.labels, listLabels, change.from.type),
    tags: change.tags,
    section: change.section,
  }
}

/**
 * The note a `move-to` would discard landing on this deck: the copy lands on an
 * existing line (one line, one note slot) whose note differs from the copy's,
 * so the line keeps its own. The landing line is found the way the reducer
 * finds it — the line carrying the event's `cardId` first, then the merge rule.
 * `undefined` when the copy carries no note, starts a line of its own, lands on
 * a line with the same note, or pins a line (`replacesCardId`: a pinning move
 * applies no note). What lets a save or an editor report the loss the way
 * `ritual move` does.
 */
export function droppedMoveNote(
  deck: DeckData,
  change: MoveToInput,
  options: DeckLandingOptions,
): string | undefined {
  if (!change.note || change.replacesCardId !== undefined) return undefined
  const line = findLandingLine(
    deck.sections,
    change.cardId,
    change.cardName,
    arrivingCopy(change, options.listLabels),
    { ...options, section: change.section },
  )
  if (line === null || line.card.note === change.note) return undefined
  return change.note
}

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
 * name-only line (the line goes at zero) and lands as a normal arrival would —
 * its carried labels landed against the deck default (`arrivingCopy`), its
 * tags and note — on the line `cardId` names, else on the line the merge rule
 * folds it onto (in the move's section, like the merge-target probe), else on a
 * fresh line inserted right after the one it came from, so a partially filled
 * card stays next to its unpinned remainder.
 *
 * In place is legal only when {@link pinConvertsInPlace} says the copy's landed
 * labels equal the line's effective ones: `proxy` is a physical fact, so a pin
 * never silently turns a proxy into a real card or the reverse. An in-place
 * event that fails it is refused (a miss), never applied with the wrong labels.
 */
function pinDeckLine(
  sections: DeckSection[],
  change: MoveToInput,
  replacesCardId: number,
  listLabels: readonly CardLabel[] | undefined,
): boolean {
  const found = findLineById(sections, replacesCardId)
  if (!found) return false
  const line = found.card
  // The pair has to hold together, exactly as `set-printing` requires.
  if (!finishMatchesPrinting(change)) return false

  if (change.cardId === replacesCardId) {
    if (!pinConvertsInPlace(line, change, listLabels)) return false
    // Copies 2..n of a deck line's fill find it already pinned by the first
    // and change nothing — but only when it is THIS printing: a pinned id
    // that resolved to some other line (an import's name fallback) is a miss.
    if (hasSpecificPrinting(line)) return isSamePrinting(line, change)
    writePrinting(line, change)
    return true
  }
  // The copy lands as a normal arrival: its own landed labels and tags, merged
  // by the rule (and in the scope) the merge-target probe uses — judged before
  // the copy leaves its line.
  const copy = arrivingCopy(change, listLabels)
  const landing = findLandingLine(sections, change.cardId, change.cardName, copy, {
    listLabels,
    section: change.section,
  })?.card
  // A split that starts a line needs the id for it: an id-less line would be
  // one the art/effects plan never allocated. Landing on a line needs none.
  if (!landing && change.cardId === undefined) return false
  // The copy would land back on the line it leaves (that line already wears
  // the printing): nothing moves. Taking it off first would splice a last copy
  // out and then count it onto the detached line, losing the card.
  if (landing === line) return true

  line.quantity -= 1
  if (line.quantity <= 0) found.section.cards.splice(found.idx, 1)
  if (landing) {
    landing.quantity += 1
    return true
  }
  const insertAt = line.quantity <= 0 ? found.idx : found.idx + 1
  const fresh: Card = {
    quantity: 1,
    name: change.cardName,
    cardId: change.cardId,
    labels: normalizedOverride(copy.labels),
    tags: normalizedTags(copy.tags),
    note: noteOrUndefined(change.note),
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
