/**
 * @fileoverview How Archidekt's categories map onto Ritual's two concepts.
 *
 * Archidekt has one mechanism — a card relation's `categories` — for two things
 * Ritual keeps apart: **boards** (Commander, Sideboard, Maybeboard, extras) and
 * the card's **role** in the deck (Ramp, Removal). Ritual models the first as a
 * deck section and the second as a card category (`src/card/card-categories.ts`),
 * so every Archidekt surface — the URL import, `deck-sync pull`, and
 * `deck-sync push` — splits a relation's categories through the one rule here:
 *
 * - a category whose name is a section alias (`sectionRole`, exact match) is a
 *   board — except `Tokens`, which Archidekt decks routinely use as a *role*
 *   (token makers) and is a board only when the deck excludes it from the count;
 * - a category the deck flags `isPremier` is the command zone;
 * - a category the deck flags `includedInDeck: false` is outside the deck — an
 *   extras board (`Maybeboard` unless its name says otherwise);
 * - every other category is a Ritual category, in the relation's order, the
 *   first being primary.
 *
 * A push composes the reverse. A relation's board follows the local file: a
 * card the local file holds in another board is re-boarded by swapping the
 * relation's board categories for the target board's
 * ({@link archidektBoardCategory}, {@link reboardArchidektCategories}), its
 * role categories untouched. Under `--sync-categories` the role categories
 * then become the local file's while the (possibly new) board categories stay
 * ({@link composeArchidektCategories}). Only board categories ever decide a
 * board; role categories never move a card.
 */

import {
  foldCategoryCardName,
  normalizeCardCategories,
  parseCardCategory,
  parseCardCategoryNames,
  type CardCategory,
  type LenientCardCategories,
} from '../card/card-categories'
import type { CardCategoryEntry } from '../list/card-categories-record'
import {
  canonicalSectionName,
  isMainBoardSection,
  sectionRole,
  type SectionRole,
} from '../list/deck-format'
import type { Board } from '../list/deck'
import type { ArchidektCategory } from './archidekt-types'

/** A deck's category definitions, keyed by lowercased, trimmed name. */
export type ArchidektCategoryIndex = ReadonlyMap<string, ArchidektCategory>

function categoryKey(name: string): string {
  return name.trim().toLowerCase()
}

/** Index a deck's `categories` array by name. Later duplicates never override the first. */
export function indexArchidektCategories(
  definitions: readonly ArchidektCategory[] | null | undefined,
): ArchidektCategoryIndex {
  const index = new Map<string, ArchidektCategory>()
  for (const definition of definitions ?? []) {
    const key = categoryKey(definition.name)
    if (!index.has(key)) index.set(key, definition)
  }
  return index
}

/**
 * The board an Archidekt category names, or `undefined` when it is a role
 * category. See the module overview for the rule.
 */
export function archidektCategoryBoard(
  name: string,
  index: ArchidektCategoryIndex,
): SectionRole | undefined {
  const definition = index.get(categoryKey(name))
  const role = sectionRole(name)
  const excluded = definition?.includedInDeck === false
  if (role === 'tokens') return excluded ? 'tokens' : undefined
  if (role !== 'main') return role
  if (isMainBoardSection(name)) return 'main'
  if (definition?.isPremier === true) return 'commander'
  if (excluded) return 'maybeboard'
  return undefined
}

/**
 * Which board wins when one relation names several: the command zone first,
 * then the other out-of-main boards. `main` is last because it is also the
 * default.
 */
const BOARD_PRIORITY: readonly SectionRole[] = [
  'commander',
  'oathbreaker',
  'companion',
  'sideboard',
  'maybeboard',
  'tokens',
  'main',
]

/** The Ritual section a relation with these categories belongs in. */
export function archidektEntrySection(
  categoryNames: readonly string[] | null | undefined,
  index: ArchidektCategoryIndex,
): string {
  const boards = new Set<SectionRole>()
  for (const name of categoryNames ?? []) {
    const board = archidektCategoryBoard(name, index)
    if (board !== undefined) boards.add(board)
  }
  const role = BOARD_PRIORITY.find((candidate) => boards.has(candidate)) ?? 'main'
  return canonicalSectionName(role)
}

/**
 * The first category the deck defines (in deck order) that `accepts` takes,
 * by its name as Archidekt spells it.
 */
function findDeckCategory(
  index: ArchidektCategoryIndex,
  accepts: (definition: ArchidektCategory) => boolean,
): string | undefined {
  for (const definition of index.values()) if (accepts(definition)) return definition.name
  return undefined
}

/**
 * The Archidekt category that puts a relation on a deck-sync board, or
 * `undefined` for the main board, which on Archidekt is the absence of any
 * board category. The deck's own category is preferred so a push reuses what
 * the deck already has rather than minting a near-duplicate:
 *
 * - **Commander:** the deck's `isPremier` (command-zone) category, else one
 *   named as a commander alias, else `Commander`.
 * - **Sideboard:** the deck's category named `Sideboard`, else `Sideboard`.
 * - **Maybeboard:** the deck's category named `Maybeboard`; else any other
 *   category the deck excludes from its count that reads as a maybeboard
 *   (a "Considering" or "Tokens & Extras"-style one, never one named
 *   `Tokens`); else `Maybeboard`.
 *
 * Each fallback is a section alias, so {@link archidektCategoryBoard} reads it
 * back as the same board whether or not the deck defines it yet. A deck-sync
 * board folds Ritual's finer sections (see `normalizeBoard`): a local
 * `## Tokens` card is on the Maybeboard board, and so is a remote relation in
 * an excluded Tokens category, so neither side ever reads the other as moved.
 */
export function archidektBoardCategory(
  board: Board,
  index: ArchidektCategoryIndex,
): string | undefined {
  const named = (role: SectionRole): string | undefined =>
    findDeckCategory(index, (definition) => sectionRole(definition.name) === role)
  switch (board) {
    case 'Main':
      return undefined
    case 'Commander':
      return (
        findDeckCategory(
          index,
          (definition) =>
            definition.isPremier === true &&
            archidektCategoryBoard(definition.name, index) === 'commander',
        ) ??
        named('commander') ??
        canonicalSectionName('commander')
      )
    case 'Sideboard':
      return named('sideboard') ?? canonicalSectionName('sideboard')
    case 'Maybeboard':
      return (
        named('maybeboard') ??
        findDeckCategory(
          index,
          (definition) => archidektCategoryBoard(definition.name, index) === 'maybeboard',
        ) ??
        canonicalSectionName('maybeboard')
      )
    default: {
      const unreachable: never = board
      return unreachable
    }
  }
}

/** The categories among a relation's that are not boards — roles, refused names included. */
export function archidektNonBoardCategories(
  categoryNames: readonly string[] | null | undefined,
  index: ArchidektCategoryIndex,
): string[] {
  return (categoryNames ?? []).filter((name) => archidektCategoryBoard(name, index) === undefined)
}

/**
 * A relation's categories moved onto `board`: every board category it holds is
 * replaced by the target board's ({@link archidektBoardCategory}) — or by none
 * at all for the main board — and every other category is kept in order. The
 * board comes first, the way {@link composeArchidektCategories} orders it.
 * Never holds a null.
 */
export function reboardArchidektCategories(
  categoryNames: readonly string[] | null | undefined,
  board: Board,
  index: ArchidektCategoryIndex,
): string[] {
  const target = archidektBoardCategory(board, index)
  const rest = archidektNonBoardCategories(categoryNames, index)
  return target === undefined ? rest : [target, ...rest]
}

/** The role categories among a relation's categories, canonical and in relation order. */
export function archidektRoleCategories(
  categoryNames: readonly string[] | null | undefined,
  index: ArchidektCategoryIndex,
): LenientCardCategories {
  return parseCardCategoryNames(
    (categoryNames ?? []).filter((name) => archidektCategoryBoard(name, index) === undefined),
  )
}

/** One Archidekt relation as the category collector reads it. */
export type ArchidektCategorizedEntry = {
  cardName: string
  categories: readonly string[] | null | undefined
}

/** Every card's role categories in a deck, name-keyed as Ritual stores them. */
export type ArchidektDeckCategories = {
  /** One entry per card name with at least one role category, in first-seen order. */
  cards: CardCategoryEntry[]
  /** Category names Ritual's name rule refused, deduplicated, in first-seen order. */
  refused: string[]
  /**
   * Every card name the deck holds, folded — categorized or not. A pull speaks
   * only for these: a local card Archidekt does not hold (a removal an
   * `--only additions` run kept) has no remote categories to adopt.
   */
  held: Set<string>
}

/**
 * Collect a deck's role categories per card name. Archidekt holds a card once
 * per printing and finish, and those relations may disagree: the result is
 * their union in relation order, so the first relation's primary stays primary.
 */
export function collectArchidektCategories(
  entries: readonly ArchidektCategorizedEntry[],
  index: ArchidektCategoryIndex,
): ArchidektDeckCategories {
  const byName = new Map<string, CardCategoryEntry>()
  const refused = new Set<string>()
  const held = new Set<string>()
  for (const entry of entries) {
    const key = foldCategoryCardName(entry.cardName)
    held.add(key)
    const role = archidektRoleCategories(entry.categories, index)
    for (const name of role.refused) refused.add(name)
    if (role.categories.length === 0) continue
    const existing = byName.get(key)
    if (existing === undefined) {
      byName.set(key, { name: entry.cardName, categories: role.categories })
      continue
    }
    existing.categories = normalizeCardCategories([...existing.categories, ...role.categories])
  }
  return { cards: [...byName.values()], refused: [...refused], held }
}

/**
 * The categories a push sends for one relation: what the local file cannot
 * speak for, kept as Archidekt has it, then the local role categories. Never
 * holds a null — `modifyCards/v2/` rejects the whole batch over one.
 *
 * Kept from `remote`: its **board** categories — the board the relation is
 * on after any board move the push planned, which the caller has already
 * applied with {@link reboardArchidektCategories} — and any role category
 * Ritual's name rule refused on the pull, which the local file therefore
 * never held and must not be read as having dropped. Skipped from the local list: a category Archidekt would read
 * as a board (`Sideboard`, or one the deck excludes from its count), since
 * sending it would move the card — a pull never produces one, so it can only
 * have come from another source.
 *
 * Comparison is exact and order-sensitive ({@link sameArchidektCategories}),
 * so a relation that lists a board after a role is rewritten once with its
 * boards first; after that it is stable.
 */
export function composeArchidektCategories(
  remote: readonly string[] | null | undefined,
  index: ArchidektCategoryIndex,
  local: readonly CardCategory[],
): string[] {
  const kept = (remote ?? []).filter(
    (name) => archidektCategoryBoard(name, index) !== undefined || !parseCardCategory(name).ok,
  )
  const seen = new Set(kept.map(categoryKey))
  const result = [...kept]
  for (const category of local) {
    const key = categoryKey(category)
    if (seen.has(key) || archidektCategoryBoard(category, index) !== undefined) continue
    seen.add(key)
    result.push(category)
  }
  return result
}

/** True when two relation category lists are the same, order included. */
export function sameArchidektCategories(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean {
  const left = a ?? []
  const right = b ?? []
  return left.length === right.length && left.every((name, i) => name === right[i])
}
