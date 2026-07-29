import type { Card, Condition, DeckData, Finish } from '../types'

/**
 * What a save did to individual card lines, computed by diffing the list as it
 * was on disk against the list as it was written.
 *
 * This exists because `&N` ids are allocated at serialization time, inside the
 * save routes: a client that adds a card cannot know the id its line got until
 * the response says so. Reporting the diff is what removes the round trip an
 * agent (or the MCP `apply_changes` tool) would otherwise make to re-read the
 * list just to learn one number.
 *
 * Pure and deterministic: both sides are keyed by `cardId`, which every entry
 * has — the *after* side because it is post-assignment, the *before* side
 * because `ensureCardIdsForAllLists()` backfills every list file before any
 * command runs. The id alone is not enough to pair two lines, though: the pool
 * hands a freed `&N` to a new entry inside the very same save, so the card name
 * decides whether a shared id means "one entry, edited" or "one entry gone,
 * another arrived in its place".
 */

/** How one line changed. */
export type SaveEffectAction = 'added' | 'removed' | 'updated'

/** The printing identity of an affected line, as far as it is specified. */
export interface SaveEffectPrinting {
  /** Lowercase, per the project's set-code rule for data payloads. */
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
}

/** One entry a save created, dropped, or changed — reported post-write, ids resolved. */
export interface SaveEffect {
  action: SaveEffectAction
  cardId: number
  name: string
  section?: string
  /** Copies on the line after the save (always 1 for a collection or wanted entry). */
  quantity: number
  printing?: SaveEffectPrinting
  /**
   * The id this line carried *before* the save renumbered it. Only ever set on an
   * `updated` effect, and only when the serializer had to hand the line a fresh
   * id because another entry arrived claiming the same `&N` (a cross-list move
   * carrying its source id, a replayed change bundle). Without it the line would
   * read as an `added` card the caller has in fact had all along.
   */
  previousCardId?: number
}

/**
 * The part of a card-id assignment (`DeckCardIdAssignment` / `EntryIdAssignment`
 * in `card-id.ts`) the effects diff reads. Declared structurally rather than
 * imported so this module stays a pure function of its inputs.
 */
export interface EffectIdAssignment {
  cardId: number
  /** The id the entry arrived with, when that differed from the one it got. */
  previousCardId?: number
}

/** The fields a flat (collection | wanted) entry contributes to a save effect. */
export interface EffectEntry {
  cardId?: number
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  note?: string
  section?: string
}

/** One indexed line, flattened out of whichever list shape it came from. */
interface EffectLine {
  cardId: number
  name: string
  section?: string
  quantity: number
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  note?: string
}

function flattenDeck(deck: DeckData): EffectLine[] {
  const lines: EffectLine[] = []
  for (const section of deck.sections) {
    for (const card of section.cards) {
      if (card.cardId === undefined) continue
      lines.push(toLine(card, card.cardId, section.name))
    }
  }
  return lines
}

function toLine(card: Card, cardId: number, section: string | undefined): EffectLine {
  return {
    cardId,
    name: card.name,
    section,
    quantity: card.quantity,
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
    note: card.note,
  }
}

function flattenEntries(entries: readonly EffectEntry[]): EffectLine[] {
  const lines: EffectLine[] = []
  for (const entry of entries) {
    if (entry.cardId === undefined) continue
    lines.push({
      cardId: entry.cardId,
      name: entry.name,
      section: entry.section,
      // Flat lists hold one physical copy per line.
      quantity: 1,
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
      note: entry.note,
    })
  }
  return lines
}

/**
 * Everything that makes two versions of a line different. `note` participates so
 * a `set-note` change reports an effect, but it is not echoed in the payload —
 * the caller supplied it and the id is what they were missing.
 *
 * JSON-encoded rather than joined on a delimiter: `name`, `section`, and `note`
 * all legitimately contain arbitrary text, so a delimiter-joined key lets two
 * adjacent field edits cancel out and drop an `updated` entirely. The set code
 * is lowercased on both sides, per the project's set-code rule — comparing raw
 * would report every line in a file as changed the first time a case-only
 * normalization ran through it.
 */
function signature(line: EffectLine): string {
  return JSON.stringify([
    line.name,
    line.set?.toLowerCase() ?? '',
    line.collectorNumber ?? '',
    line.finish ?? '',
    line.condition ?? '',
    line.section ?? '',
    line.note ?? '',
    line.quantity,
  ])
}

/**
 * What makes a line *the same card*, as opposed to merely the same id.
 *
 * The card name, and deliberately nothing else. Two lines sharing an id but
 * naming different cards are not one edited entry — they are a removal and an
 * addition that happened to reuse the freed `&N`, which is exactly what the id
 * pool does within a single save. Printing is *not* part of this: a
 * `set-printing` edit rewrites set and collector number on an entry that very
 * much stayed itself, and folding printing in here would report every one of
 * those as a card leaving the list. No edit renames a line in place — a rename
 * is a remove plus an add — so the name is the whole of the identity.
 */
function identity(line: EffectLine): string {
  return line.name
}

function printingOf(line: EffectLine): SaveEffectPrinting | undefined {
  const printing: SaveEffectPrinting = {}
  if (line.set !== undefined) printing.set = line.set.toLowerCase()
  if (line.collectorNumber !== undefined) printing.collectorNumber = line.collectorNumber
  if (line.finish !== undefined) printing.finish = line.finish
  if (line.condition !== undefined) printing.condition = line.condition
  return Object.keys(printing).length > 0 ? printing : undefined
}

function toEffect(action: SaveEffectAction, line: EffectLine): SaveEffect {
  const effect: SaveEffect = {
    action,
    cardId: line.cardId,
    name: line.name,
    quantity: line.quantity,
  }
  if (line.section !== undefined) effect.section = line.section
  const printing = printingOf(line)
  if (printing !== undefined) effect.printing = printing
  return effect
}

/** What one `after` line was paired with on the `before` side, if anything. */
interface LinePairing {
  previous: EffectLine
  /** Set when the save renumbered the line: the id it used to carry. */
  previousCardId?: number
}

/**
 * Pair each `after` line with the `before` line it continues, consuming each
 * `before` line at most once.
 *
 * Two passes, and the order matters. A line the serializer *renumbered* claims
 * its old entry first — but only when the two are the same card, because the
 * entry that lost the fight for an id is just as often a different card that
 * happened to arrive carrying that number. Everything else pairs on the id it
 * kept, identity included or not: a same-id pair whose identity changed is
 * classified as a removal plus an addition by {@link diffLines}.
 */
function pairLines(
  before: readonly EffectLine[],
  after: readonly EffectLine[],
  assignments: readonly EffectIdAssignment[],
): Map<number, LinePairing> {
  const beforeById = new Map<number, EffectLine>()
  for (const line of before) beforeById.set(line.cardId, line)

  const renumbered = new Map<number, number>()
  for (const assignment of assignments) {
    if (assignment.previousCardId !== undefined) {
      renumbered.set(assignment.cardId, assignment.previousCardId)
    }
  }

  const pairings = new Map<number, LinePairing>()
  const consumed = new Set<number>()

  after.forEach((line, index) => {
    const previousCardId = renumbered.get(line.cardId)
    if (previousCardId === undefined || consumed.has(previousCardId)) return
    const previous = beforeById.get(previousCardId)
    if (previous === undefined || identity(previous) !== identity(line)) return
    consumed.add(previousCardId)
    pairings.set(index, { previous, previousCardId })
  })

  after.forEach((line, index) => {
    if (pairings.has(index) || consumed.has(line.cardId)) return
    const previous = beforeById.get(line.cardId)
    if (previous === undefined) return
    consumed.add(line.cardId)
    pairings.set(index, { previous })
  })

  return pairings
}

/**
 * Diff two flattened line lists into effects, in a fixed order: everything
 * `added`, then everything `updated`, then everything `removed`, each in list
 * order. Deterministic output is what makes the response pinnable by tests.
 */
function diffLines(
  before: readonly EffectLine[],
  after: readonly EffectLine[],
  assignments: readonly EffectIdAssignment[],
): SaveEffect[] {
  const pairings = pairLines(before, after, assignments)
  const matched = new Set<EffectLine>()

  const added: SaveEffect[] = []
  const updated: SaveEffect[] = []
  const replaced: EffectLine[] = []

  after.forEach((line, index) => {
    const pairing = pairings.get(index)
    if (pairing === undefined) {
      added.push(toEffect('added', line))
      return
    }
    matched.add(pairing.previous)
    if (identity(pairing.previous) !== identity(line)) {
      // The id was reused inside this save: the entry that held it is gone, and
      // a different card now answers to the number. Reporting one `updated`
      // would never tell the caller the first card left the list.
      replaced.push(pairing.previous)
      added.push(toEffect('added', line))
      return
    }
    if (pairing.previousCardId !== undefined) {
      updated.push({ ...toEffect('updated', line), previousCardId: pairing.previousCardId })
      return
    }
    if (signature(pairing.previous) !== signature(line)) updated.push(toEffect('updated', line))
  })

  const removed: SaveEffect[] = []
  for (const line of before) {
    if (!matched.has(line)) removed.push(toEffect('removed', line))
  }
  for (const line of replaced) removed.push(toEffect('removed', line))

  return [...added, ...updated, ...removed]
}

/** {@link computeDeckSaveEffects}' inputs: the two deck snapshots plus what the save renumbered. */
export interface DeckSaveEffectsInput {
  /** The deck as it stood on disk, before this save. */
  before: DeckData
  /** The deck as it was written, ids already assigned. */
  after: DeckData
  /** `assignDeckCardIds`' report, so a renumbered line is not mistaken for a new one. */
  assignments?: readonly EffectIdAssignment[]
}

/** What a deck save did, diffing the on-disk deck against the one written. */
export function computeDeckSaveEffects(input: DeckSaveEffectsInput): SaveEffect[] {
  return diffLines(flattenDeck(input.before), flattenDeck(input.after), input.assignments ?? [])
}

/** {@link computeEntrySaveEffects}' inputs: the two entry snapshots plus what the save renumbered. */
export interface EntrySaveEffectsInput {
  /** The entries as they stood on disk, before this save. */
  before: readonly EffectEntry[]
  /** The entries as they were written, ids already assigned. */
  after: readonly EffectEntry[]
  /** `assignEntryIds`' report, so a renumbered line is not mistaken for a new one. */
  assignments?: readonly EffectIdAssignment[]
}

/** What a flat-list save did, diffing the on-disk entries against those written. */
export function computeEntrySaveEffects(input: EntrySaveEffectsInput): SaveEffect[] {
  return diffLines(
    flattenEntries(input.before),
    flattenEntries(input.after),
    input.assignments ?? [],
  )
}
