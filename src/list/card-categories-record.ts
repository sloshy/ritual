/**
 * The categories **record**: the in-memory shape of a list's
 * `<list>.categories.json`, its JSON form, and every pure transform over it —
 * parse, resolve the display order, look one card up, prune, remove a category,
 * replay change events.
 *
 * Split from `card-categories-sidecar.ts` (which keeps the `node:fs` half: read,
 * write, hash, commit) so the browser bundles — the site pages and both editors —
 * import a leaf with no node imports at all, rather than relying on the bundler
 * to tree-shake one away. The sidecar module re-exports everything here, so
 * server-side importers are unaffected.
 *
 * The parse messages are plain English on purpose: like the other engine parsers
 * this module is below the UI layer, and the surface that reports the failure
 * owns its wording.
 */

import {
  type CardCategoriesResult,
  type CardCategory,
  foldCardCategory,
  foldCategoryCardName,
  normalizeCardCategories,
  parseCardCategoriesValue,
  withoutCardCategory,
} from '../card/card-categories'
import { CATEGORY_ACTIONS, type ChangeEvent } from '../changes/change-event'
import { compareData } from '../i18n/collate'
import { getErrorMessage } from '../util/errors'
import { isRecord } from '../util/json'

/** One card name's categories, in primary-first order, with the spelling the file stores. */
export type CardCategoryEntry = {
  /** The card name as the list writes it — the sidecar's own key spelling. */
  name: string
  /** The card's categories, primary first. Never empty (an empty list is no entry). */
  categories: CardCategory[]
}

/** A list's categories: its display vocabulary and its per-card assignments. */
export type CardCategoriesRecord = {
  /** The display order of the vocabulary. */
  order: CardCategory[]
  /** Keyed by {@link foldCategoryCardName} of the entry's stored name. */
  cards: Map<string, CardCategoryEntry>
}

/** The sidecar's own JSON shape (JSON has no map), and what an API body carries. */
export type CardCategoriesJson = {
  order: string[]
  cards: Record<string, string[]>
}

/**
 * Sidecar entries naming a card the list does not hold any more. The entries are
 * kept (dropping them is a save's decision, not a read's) and the stored
 * spellings are reported as-is.
 */
export type UnknownCardNamesWarning = {
  kind: 'unknown-card-names'
  names: string[]
}

export type CardCategoriesWarning = UnknownCardNamesWarning

/** Everything a caller may tell the parser about the list the sidecar belongs to. */
export type CardCategoriesParseOptions = {
  /**
   * The card names the list currently holds, folded through
   * {@link foldCategoryCardName}. Entries outside this set become an
   * {@link UnknownCardNamesWarning}. Omit to skip the check entirely.
   */
  knownCardNames?: ReadonlySet<string>
}

export type CardCategoriesParseSuccess = {
  ok: true
  categories: CardCategoriesRecord
  warnings: CardCategoriesWarning[]
}

export type CardCategoriesParseFailure = {
  ok: false
  message: string
}

export type CardCategoriesParseResult = CardCategoriesParseSuccess | CardCategoriesParseFailure

export type CardCategoriesPruneResult = {
  categories: CardCategoriesRecord
  /** Stored spellings of the names dropped, in {@link compareData} order. */
  pruned: string[]
  changed: boolean
}

/** A list with no categories at all. */
export function emptyCardCategoriesRecord(): CardCategoriesRecord {
  return { order: [], cards: new Map() }
}

/** True when a record would serialize to nothing worth keeping on disk. */
export function isEmptyCardCategoriesRecord(record: CardCategoriesRecord): boolean {
  return record.order.length === 0 && record.cards.size === 0
}

/** A deep-enough copy for the pure replay/prune helpers to return without aliasing. */
function cloneRecord(record: CardCategoriesRecord): CardCategoriesRecord {
  const cards = new Map<string, CardCategoryEntry>()
  for (const [key, entry] of record.cards) {
    cards.set(key, { name: entry.name, categories: [...entry.categories] })
  }
  return { order: [...record.order], cards }
}

/**
 * Parse a `.categories.json` sidecar. A malformed file fails as a whole rather
 * than dropping the entries it could read: the sidecar is machine-written, so a
 * bad entry means something is wrong that a silent partial load would hide (and
 * the next save would erase).
 */
export function parseCardCategoriesSidecar(
  content: string,
  options: CardCategoriesParseOptions = {},
): CardCategoriesParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (error) {
    return { ok: false, message: `not valid JSON: ${getErrorMessage(error)}` }
  }
  return parseCardCategoriesObject(raw, options)
}

/**
 * The record as a payload's JSON gives it (a baked detail, a load body), or the
 * empty record when there is none or it is malformed. A malformed one is not the
 * reader's to report — the payload's own `categoryWarnings` already says so.
 */
export function recordFromJson(raw: unknown): CardCategoriesRecord {
  if (raw === null || raw === undefined) return emptyCardCategoriesRecord()
  const parsed = parseCardCategoriesObject(raw)
  return parsed.ok ? parsed.categories : emptyCardCategoriesRecord()
}

/**
 * Parse an already-decoded sidecar object. The `unknown` half of
 * {@link parseCardCategoriesSidecar}, split out because the site ships the JSON
 * itself (a baked detail, a load body) and must reach a record without
 * re-serializing it.
 */
export function parseCardCategoriesObject(
  raw: unknown,
  options: CardCategoriesParseOptions = {},
): CardCategoriesParseResult {
  if (!isRecord(raw)) {
    return { ok: false, message: 'the file must contain a JSON object with "order" and "cards"' }
  }

  let order: CardCategory[] = []
  if (raw.order !== undefined) {
    const parsed: CardCategoriesResult = parseCardCategoriesValue(raw.order, '"order"')
    if (!parsed.ok) return { ok: false, message: parsed.message }
    order = parsed.categories
  }

  const cards = new Map<string, CardCategoryEntry>()
  const unknownNames: string[] = []
  if (raw.cards !== undefined) {
    if (!isRecord(raw.cards)) {
      return { ok: false, message: '"cards" must be an object keyed by card name' }
    }
    for (const [name, value] of Object.entries(raw.cards)) {
      if (name.trim() === '') {
        return { ok: false, message: 'a "cards" key must be a card name, not empty' }
      }
      const parsed = parseCardCategoriesValue(value, `"${name}"`)
      if (!parsed.ok) return { ok: false, message: parsed.message }
      if (parsed.categories.length === 0) {
        return { ok: false, message: `"${name}" has no categories — remove the key instead` }
      }
      const key = foldCategoryCardName(name)
      if (cards.has(key)) {
        return { ok: false, message: `"${name}" appears twice under different spellings` }
      }
      if (options.knownCardNames !== undefined && !options.knownCardNames.has(key)) {
        unknownNames.push(name)
      }
      cards.set(key, { name, categories: parsed.categories })
    }
  }

  const warnings: CardCategoriesWarning[] =
    unknownNames.length > 0 ? [{ kind: 'unknown-card-names', names: unknownNames }] : []
  return { ok: true, categories: { order, cards }, warnings }
}

/**
 * The list's display order, made self-describing: the stored `order` first, then
 * every category a card uses that it does not name — the configured defaults in
 * config order, then the rest by the pinned data collation. Deduped by fold.
 *
 * The tail sorts by {@link compareData}, never by display collation: this order
 * is written into the sidecar and hashed, so two machines with different UI
 * locales must produce identical bytes for the same record. Locale-aware
 * ordering belongs to the surfaces that *render* the vocabulary.
 */
export function resolveCategoryOrder(
  record: CardCategoriesRecord,
  defaults: readonly CardCategory[] = [],
): CardCategory[] {
  const resolved = normalizeCardCategories(record.order)
  const seen = new Set(resolved.map(foldCardCategory))

  const used = new Map<string, CardCategory>()
  for (const entry of record.cards.values()) {
    for (const category of entry.categories) {
      const key = foldCardCategory(category)
      if (seen.has(key) || used.has(key)) continue
      used.set(key, category)
    }
  }
  if (used.size === 0) return resolved

  for (const preferred of defaults) {
    const key = foldCardCategory(preferred)
    const category = used.get(key)
    if (category === undefined) continue
    used.delete(key)
    resolved.push(category)
  }
  for (const category of [...used.values()].sort(compareData)) {
    resolved.push(category)
  }
  return resolved
}

/**
 * A record's card entries in canonical order — by stored name under the pinned
 * data collation. The one ordering the serializer, the snapshot builder and the
 * sidecar diff all share, so none of them has to reach for a collator (two of
 * them sit inside the persistence fence and may not).
 */
export function orderedCategoryEntries(record: CardCategoriesRecord): CardCategoryEntry[] {
  return [...record.cards.values()].sort((a, b) => compareData(a.name, b.name))
}

/**
 * One card's categories in this list, looked up by the sidecar's own fold — the
 * answer every load body, bake and editor needs, so no caller re-derives
 * {@link foldCategoryCardName}. `undefined` when the card has none; never `[]`,
 * because absent means none everywhere this value is reported.
 */
export function cardCategoriesOf(
  record: CardCategoriesRecord,
  cardName: string,
): CardCategory[] | undefined {
  const entry = record.cards.get(foldCategoryCardName(cardName))
  return entry === undefined || entry.categories.length === 0 ? undefined : entry.categories
}

/**
 * A record in its JSON shape: the resolved order, and the card entries keyed by
 * their stored spelling in the pinned data collation, each keeping its own
 * primary-first order.
 */
export function cardCategoriesToJson(
  record: CardCategoriesRecord,
  defaults: readonly CardCategory[] = [],
): CardCategoriesJson {
  const cards: Record<string, string[]> = {}
  for (const entry of orderedCategoryEntries(record)) {
    cards[entry.name] = [...entry.categories]
  }
  return { order: resolveCategoryOrder(record, defaults), cards }
}

/** Serialize a list's categories in canonical bytes. */
export function serializeCardCategoriesSidecar(
  record: CardCategoriesRecord,
  defaults: readonly CardCategory[] = [],
): string {
  return JSON.stringify(cardCategoriesToJson(record, defaults), null, 2) + '\n'
}

/**
 * Read a list's categories. An absent sidecar is the normal case and yields an
 * empty record; a sidecar that exists but cannot be read or parsed is reported
 * rather than silently treated as "no categories" — that would make the next
 * save delete assignments the user still has on disk.

/**
 * Drop the entries naming a card the list does not hold any more. `order` is
 * left alone: a vocabulary entry with no cards is still the owner's vocabulary.
 * Pure.
 */
export function pruneCardCategories(
  record: CardCategoriesRecord,
  knownCardNames: ReadonlySet<string>,
): CardCategoriesPruneResult {
  const pruned: string[] = []
  const cards = new Map<string, CardCategoryEntry>()
  for (const [key, entry] of record.cards) {
    if (knownCardNames.has(key)) {
      cards.set(key, { name: entry.name, categories: [...entry.categories] })
      continue
    }
    pruned.push(entry.name)
  }
  if (pruned.length === 0) return { categories: cloneRecord(record), pruned: [], changed: false }
  pruned.sort(compareData)
  return { categories: { order: [...record.order], cards }, pruned, changed: true }
}

/**
 * The record with `category` gone from the vocabulary and from every card that
 * used it, orders otherwise preserved. A card left with no categories loses its
 * entry — the same thing an empty `set-categories` means. Matching is by
 * {@link foldCardCategory}, like every other comparison in the feature. Pure.
 *
 * It lives here beside {@link pruneCardCategories} rather than in the command
 * that first needed it, because "remove this category everywhere" is the record
 * transform every surface asks for.
 */
export function removeCategoryFromRecord(
  record: CardCategoriesRecord,
  category: CardCategory,
): CardCategoriesRecord {
  const key = foldCardCategory(category)
  const cards = new Map<string, CardCategoryEntry>()
  for (const [cardKey, entry] of record.cards) {
    const categories = withoutCardCategory(entry.categories, category)
    if (categories.length === 0) continue
    cards.set(cardKey, { name: entry.name, categories })
  }
  return {
    order: record.order.filter((name) => foldCardCategory(name) !== key),
    cards,
  }
}

const CATEGORY_ACTION_SET: ReadonlySet<string> = new Set(CATEGORY_ACTIONS)

/** Whether a change event is one of the three the categories sidecar answers to. */
export function isCategoryChange(change: ChangeEvent): boolean {
  return CATEGORY_ACTION_SET.has(change.action)
}

/** The category events in a batch — what `line-mutate` and the save tail commit. */
export function categoryChangesOf(changes: readonly ChangeEvent[]): ChangeEvent[] {
  return changes.filter(isCategoryChange)
}

/** Append a category to `order` when the vocabulary does not name it yet. */
function noteCategory(order: CardCategory[], seen: Set<string>, category: CardCategory): void {
  const key = foldCardCategory(category)
  if (seen.has(key)) return
  seen.add(key)
  order.push(category)
}

/**
 * Replay category events onto a record, purely — the in-memory half of applying
 * a save's changes, with {@link commitCategoryChanges} owning the disk half.
 * Every other action is ignored, so a whole save batch can be handed in.
 */
export function applyCategoryChangesToRecord(
  record: CardCategoriesRecord,
  changes: readonly ChangeEvent[],
): CardCategoriesRecord {
  let next = cloneRecord(record)
  for (const change of changes) {
    if (change.action === 'set-categories') {
      const key = foldCategoryCardName(change.cardName)
      const categories = normalizeCardCategories(change.categories)
      if (categories.length === 0) {
        next.cards.delete(key)
        continue
      }
      next.cards.set(key, { name: change.cardName, categories })
      const seen = new Set(next.order.map(foldCardCategory))
      for (const category of categories) noteCategory(next.order, seen, category)
      continue
    }
    if (change.action === 'rename-category') {
      const from = foldCardCategory(change.category)
      const to = change.newCategory
      const order: CardCategory[] = []
      const seen = new Set<string>()
      for (const category of next.order) {
        noteCategory(order, seen, foldCardCategory(category) === from ? to : category)
      }
      const cards = new Map<string, CardCategoryEntry>()
      for (const [cardKey, entry] of next.cards) {
        const renamed = entry.categories.map((category) =>
          foldCardCategory(category) === from ? to : category,
        )
        cards.set(cardKey, { name: entry.name, categories: normalizeCardCategories(renamed) })
      }
      next = { order, cards }
      continue
    }
    if (change.action === 'set-category-order') {
      next = { order: normalizeCardCategories(change.order), cards: next.cards }
    }
  }
  return next
}
