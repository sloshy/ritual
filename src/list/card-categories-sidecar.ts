import fs from 'node:fs/promises'
import type { CardCategory } from '../card/card-categories'
import type { ChangeEvent } from '../changes/change-event'
import { computeHash, hashPath, isRitualClean, saveHash } from '../changes/content-hash'
import { getErrorMessage, hasErrorCode } from '../util/errors'
import {
  applyCategoryChangesToRecord,
  categoryChangesOf,
  emptyCardCategoriesRecord,
  isEmptyCardCategoriesRecord,
  parseCardCategoriesSidecar,
  pruneCardCategories,
  serializeCardCategoriesSidecar,
  type CardCategoriesParseOptions,
  type CardCategoriesParseResult,
  type CardCategoriesWarning,
  type CardCategoriesRecord,
} from './card-categories-record'

/**
 * The pure record half, re-exported so every existing importer of this module —
 * and every server-side caller that wants the file *and* the transforms — keeps
 * one import site. Browser bundles import `./card-categories-record` directly.
 */
export * from './card-categories-record'

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
 * The pure transforms over the record live in `./card-categories-record`, which
 * this module re-exports: the sidecar is the `node:fs` half (read, write, hash,
 * commit), and the browser bundles import the record leaf on its own.
 */

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
