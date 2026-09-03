import fs from 'node:fs/promises'
import {
  type CardCategoriesResult,
  type CardCategory,
  foldCardCategory,
  foldCategoryCardName,
  normalizeCardCategories,
  parseCardCategoriesValue,
} from '../card/card-categories'
import { CATEGORY_ACTIONS, type ChangeEvent } from '../changes/change-event'
import { computeHash, hashPath, isRitualClean, saveHash } from '../changes/content-hash'
import { compareData } from '../i18n/collate'
import { getErrorMessage, hasErrorCode } from '../util/errors'
import { isRecord } from '../util/json'

/**
 * The categories sidecar: a per-list `<list>.categories.json` file holding the
 * list's category vocabulary (`order`) and each card *name*'s ordered category
 * list (`cards`).
 *
 * Unlike `<list>.art.json`, this sidecar carries a `.sha256` of its own and its
 * hand edits are recorded as changelog events, so it is a first-class part of
 * the list's history rather than untracked metadata. The hash discipline is
 * therefore the list file's: a sidecar Ritual did not itself last write keeps
 * its stale `.sha256` so `detect-changes` still records the edit.
 *
 * Keyed by card **name**, never by `&N`: one assignment covers every line of
 * that name in the list, whatever its printing, section or quantity. Categories
 * never follow a move — see `src/card/card-categories.ts` for why this is a
 * different kind from a label and a tag.
 *
 * The parse messages here are plain English on purpose: like the other engine
 * parsers this module is below the UI layer, and the surface that reports the
 * failure owns its wording.
 */

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

/**
 * What {@link saveCardCategories} did.
 *
 * `unchanged` — the serialized bytes matched what was already on disk, so
 * nothing was written, nothing was stamped and nothing is committed. Every list
 * save runs the categories commit (it always supplies `knownCardNames`), so this
 * is the common case rather than an edge one: without it, an unrelated save
 * would re-canonicalize and re-commit a hand-edited sidecar.
 */
export type CardCategoriesSaveAction = 'written' | 'removed' | 'unchanged' | 'absent'

export type CardCategoriesSaveResult = {
  path: string
  action: CardCategoriesSaveAction
  /**
   * The paths the save touched, for the caller's commit set: the sidecar and its
   * `.sha256` when they were written, the ones that were actually deleted for
   * `removed` (a deletion has to be staged like any other change), and empty for
   * `unchanged`/`absent` — a path that never existed cannot be `git add`ed.
   */
  writtenFiles: string[]
  /** False when a hand-edited sidecar was overwritten without refreshing its hash. */
  stamped: boolean
}

export type CardCategoriesPruneResult = {
  categories: CardCategoriesRecord
  /** Stored spellings of the names dropped, in {@link compareData} order. */
  pruned: string[]
  changed: boolean
}

export type CommitCategoryChangesOptions = {
  /** Surviving card names, folded. Omit to skip pruning. */
  knownCardNames?: ReadonlySet<string>
  /** Config vocabulary used to resolve the persisted `order`. */
  defaultCategories?: readonly CardCategory[]
  /**
   * Rewrite the sidecar in canonical form even when there is nothing to replay
   * and nothing to prune — what `ritual cleanup` wants for a list whose lines it
   * may not touch. Without it, a commit with no work short-circuits.
   */
  canonicalize?: boolean
}

export type CommitCategoryChangesResult = {
  writtenFiles: string[]
  pruned: string[]
  /** Sidecar warnings raised while loading (stale names). */
  warnings: CardCategoriesWarning[]
  /**
   * What the save did — the same answer {@link previewCategoriesSaveAction}
   * gives before the write, so a dry run and a real run never disagree. Absent
   * when the commit was skipped (nothing to do) or failed.
   */
  action?: CardCategoriesSaveAction
  /** Present when the sidecar could not be read — the write was skipped. */
  error?: string
}

/**
 * The filename convention for the categories sidecar, defined once. `git-diff`
 * classifies paths by this suffix rather than restating it.
 */
export const CATEGORIES_SIDECAR_SUFFIX = '.categories.json'

/** The path of a list's categories sidecar. */
export function categoriesSidecarPath(mdPath: string): string {
  return mdPath.replace(/\.md$/, CATEGORIES_SIDECAR_SUFFIX)
}

/** The path of the categories sidecar's own `.sha256`. */
export function categoriesHashPath(mdPath: string): string {
  return hashPath(categoriesSidecarPath(mdPath))
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
 */
export async function loadCardCategories(
  listFilePath: string,
  options: CardCategoriesParseOptions = {},
): Promise<CardCategoriesParseResult> {
  const sidecarPath = categoriesSidecarPath(listFilePath)
  let content: string
  try {
    content = await fs.readFile(sidecarPath, 'utf-8')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { ok: true, categories: emptyCardCategoriesRecord(), warnings: [] }
    }
    return { ok: false, message: `${sidecarPath}: ${getErrorMessage(error)}` }
  }
  const parsed = parseCardCategoriesSidecar(content, options)
  if (!parsed.ok) return { ok: false, message: `${sidecarPath}: ${parsed.message}` }
  return parsed
}

/** Remove a path, treating "it was not there" as success. */
async function unlinkIfPresent(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath)
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

/** The sidecar's current bytes, or `null` when it is not there. */
async function readSidecarContent(sidecarPath: string): Promise<string | null> {
  try {
    return await fs.readFile(sidecarPath, 'utf-8')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null
    throw error
  }
}

/** What a save would do, plus the bytes it would write. */
type CardCategoriesSaveDecision =
  | { action: 'absent' }
  | { action: 'removed' }
  | { action: 'unchanged' }
  | { action: 'written'; next: string }

/**
 * The one place the write decision lives, so a preview (`cleanup --dry-run`) and
 * the write itself can never answer differently for the same record.
 */
function decideCategoriesSave(
  prior: string | null,
  record: CardCategoriesRecord,
  defaults: readonly CardCategory[],
): CardCategoriesSaveDecision {
  if (isEmptyCardCategoriesRecord(record)) {
    return { action: prior === null ? 'absent' : 'removed' }
  }
  const next = serializeCardCategoriesSidecar(record, defaults)
  return prior === next ? { action: 'unchanged' } : { action: 'written', next }
}

/** True when the action writes to or deletes something on disk. */
export function categoriesSaveTouchesDisk(action: CardCategoriesSaveAction): boolean {
  return action === 'written' || action === 'removed'
}

/**
 * What {@link saveCardCategories} would do for this record, without doing it —
 * the answer `cleanup --dry-run` previews.
 */
export async function previewCategoriesSaveAction(
  listFilePath: string,
  record: CardCategoriesRecord,
  defaults: readonly CardCategory[] = [],
): Promise<CardCategoriesSaveAction> {
  const sidecarPath = categoriesSidecarPath(listFilePath)
  const prior = await readSidecarContent(sidecarPath)
  return decideCategoriesSave(prior, record, defaults).action
}

/**
 * Write a list's categories, and stamp the sidecar's `.sha256`.
 *
 * Idempotent by contract: a save whose canonical bytes match what is already on
 * disk writes nothing, stamps nothing and reports no written files, so an
 * ordinary save of a list never disturbs a categories sidecar it did not change.
 *
 * An empty record removes the sidecar and its hash instead of writing `{}`, so
 * clearing the last assignment leaves the list as it was before any category
 * was set.
 *
 * This is the one place the hash discipline lives: a hand-edited sidecar (one
 * whose stored hash does not match what is on disk) is overwritten *without*
 * refreshing the `.sha256`, so `detect-changes` still records the edit — the
 * same rule the list file's own writers follow.
 */
export async function saveCardCategories(
  listFilePath: string,
  record: CardCategoriesRecord,
  defaults: readonly CardCategory[] = [],
): Promise<CardCategoriesSaveResult> {
  const sidecarPath = categoriesSidecarPath(listFilePath)
  const prior = await readSidecarContent(sidecarPath)
  const decision = decideCategoriesSave(prior, record, defaults)

  if (decision.action === 'absent' || decision.action === 'unchanged') {
    return { path: sidecarPath, action: decision.action, writtenFiles: [], stamped: true }
  }

  if (decision.action === 'removed') {
    const removedSidecar = await unlinkIfPresent(sidecarPath)
    const removedHash = await unlinkIfPresent(hashPath(sidecarPath))
    return {
      path: sidecarPath,
      action: 'removed',
      writtenFiles: [
        ...(removedSidecar ? [sidecarPath] : []),
        ...(removedHash ? [hashPath(sidecarPath)] : []),
      ],
      stamped: true,
    }
  }

  const next = decision.next
  const stamped = prior === null ? true : await isRitualClean(sidecarPath, prior)
  await fs.writeFile(sidecarPath, next)
  if (!stamped) {
    return { path: sidecarPath, action: 'written', writtenFiles: [sidecarPath], stamped: false }
  }
  await saveHash(sidecarPath, computeHash(next))
  return {
    path: sidecarPath,
    action: 'written',
    writtenFiles: [sidecarPath, hashPath(sidecarPath)],
    stamped: true,
  }
}

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
    const categories = entry.categories.filter((name) => foldCardCategory(name) !== key)
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

/**
 * Apply a save's category events to the sidecar, prune the entries no card backs
 * any more, and write the result — the disk half of a categories edit.
 *
 * Never throws: it runs *after* the card lines were written, so a failure is
 * news to report rather than a save to undo. A sidecar that cannot be read is
 * left exactly as it is (overwriting one Ritual cannot parse would destroy
 * assignments the user still has).
 */
export async function commitCategoryChanges(
  listFilePath: string,
  changes: readonly ChangeEvent[],
  options: CommitCategoryChangesOptions = {},
): Promise<CommitCategoryChangesResult> {
  const categoryChanges = categoryChangesOf(changes)
  if (
    categoryChanges.length === 0 &&
    options.knownCardNames === undefined &&
    options.canonicalize !== true
  ) {
    return { writtenFiles: [], pruned: [], warnings: [] }
  }
  try {
    const loaded = await loadCardCategories(listFilePath, {
      knownCardNames: options.knownCardNames,
    })
    if (!loaded.ok) {
      return { writtenFiles: [], pruned: [], warnings: [], error: loaded.message }
    }
    let record = applyCategoryChangesToRecord(loaded.categories, categoryChanges)
    let pruned: string[] = []
    if (options.knownCardNames !== undefined) {
      const result = pruneCardCategories(record, options.knownCardNames)
      record = result.categories
      pruned = result.pruned
    }
    const saved = await saveCardCategories(listFilePath, record, options.defaultCategories ?? [])
    return {
      writtenFiles: saved.writtenFiles,
      pruned,
      warnings: loaded.warnings,
      action: saved.action,
    }
  } catch (error) {
    return { writtenFiles: [], pruned: [], warnings: [], error: getErrorMessage(error) }
  }
}
