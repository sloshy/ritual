/**
 * The `ritual/no-untranslated-literal` baseline: parsing, the load-time check
 * the lint config runs, and the prune logic `scripts/untranslated-baseline.ts`
 * applies. Plain JS so `eslint.config.js` can import it; JSDoc gives the
 * TypeScript callers their types.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { isInScope } from './no-untranslated-literal.js'

/** Repo-relative path of the baseline file. */
export const BASELINE_FILE = 'eslint-rules/untranslated-baseline.json'

/**
 * Set by the prune script so the lint config loads while the baseline still
 * names a deleted file — the very state the script exists to repair.
 */
export const SKIP_CHECK_ENV = 'RITUAL_UNTRANSLATED_BASELINE_PRUNING'

/** @typedef {Record<string, Record<string, number>>} Baseline `{ file: { text: occurrences } }` */

/**
 * Set to `1` to let the baseline grow — only in the commit that changes the
 * rule's heuristics, so existing debt is re-keyed. Both
 * `--admit-new-debt` and the growth guard require it.
 */
export const ADMIT_REKEY_ENV = 'RITUAL_ADMIT_UNTRANSLATED_REKEY'

/**
 * @typedef {object} SplitBaseline
 * @property {Baseline} kept Entries for files the rule can lint.
 * @property {Baseline} orphans Entries for files it cannot (deleted, renamed, out of scope).
 */

/**
 * @typedef {object} PruneOptions
 * @property {boolean} admit Add uncovered occurrences instead of refusing them.
 * @property {Baseline} [orphans] Entries whose file the rule can no longer lint.
 * @property {Record<string, string>} [renames] `old path → new path`, as git reports them.
 */

/**
 * @typedef {object} PruneResult
 * @property {Baseline} baseline The new baseline, sorted, with empty files omitted.
 * @property {number} removed Occurrences dropped (converted strings, deleted files).
 * @property {string[]} unadmitted `file: text` for each occurrence the baseline does not cover.
 * @property {string[]} carried `old → new` for each renamed file whose entries moved.
 */

/**
 * Parse the baseline JSON, or describe why it is malformed.
 * @param {string} raw
 * @returns {Baseline | string}
 */
export function parseBaseline(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return `not valid JSON: ${error instanceof Error ? error.message : String(error)}`
  }
  if (!isPlainObject(parsed)) return 'the top level must be an object keyed by file'
  /** @type {Baseline} */
  const baseline = {}
  for (const [file, entries] of Object.entries(parsed)) {
    if (!isPlainObject(entries)) return `"${file}" must map to an object keyed by text`
    /** @type {Record<string, number>} */
    const counts = {}
    for (const [text, count] of Object.entries(entries)) {
      if (!Number.isInteger(count) || count < 1) {
        return `"${file}" → "${text}" must be a positive integer count`
      }
      counts[text] = count
    }
    baseline[file] = counts
  }
  return baseline
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether the rule can ever lint `file`: it exists, is TypeScript, and is in
 * the rule's default scope. An entry for any other file can never be matched
 * or reported stale by the rule itself.
 * @param {string} root
 * @param {string} file
 * @returns {boolean}
 */
export function isLintable(root, file) {
  return /\.tsx?$/.test(file) && isInScope(file) && existsSync(path.join(root, file))
}

/**
 * Split a baseline into the files the rule can lint and the orphans it cannot.
 * @param {Baseline} baseline
 * @param {(file: string) => boolean} lintable
 * @returns {SplitBaseline}
 */
export function splitBaseline(baseline, lintable) {
  /** @type {Baseline} */
  const kept = {}
  /** @type {Baseline} */
  const orphans = {}
  for (const [file, entries] of Object.entries(baseline)) {
    if (lintable(file)) kept[file] = entries
    else orphans[file] = entries
  }
  return { kept, orphans }
}

/**
 * The baseline `eslint.config.js` passes to the rule. Throws when the file is
 * malformed or names a file the rule can never lint (deleted, renamed, moved
 * out of scope) — the rule cannot report those entries stale itself.
 * @param {string} root
 * @returns {Baseline}
 */
export function loadUntranslatedBaseline(root) {
  if (process.env[SKIP_CHECK_ENV] === '1') return {}
  const parsed = parseBaseline(readFileSync(path.join(root, BASELINE_FILE), 'utf8'))
  if (typeof parsed === 'string') throw new Error(`${BASELINE_FILE} is malformed: ${parsed}`)
  const { kept, orphans } = splitBaseline(parsed, (file) => isLintable(root, file))
  const missing = Object.keys(orphans)
  if (missing.length > 0) {
    throw new Error(
      `${BASELINE_FILE} lists files the lint can no longer see: ${missing.join(', ')}. ` +
        'Run `bun run scripts/untranslated-baseline.ts` to prune them (a renamed file carries its entries over) — the baseline only shrinks.',
    )
  }
  return kept
}

/**
 * Clamp `previous` to what the code still contains (`current`, from a scan).
 *
 * Nothing is added unless `admit` is set. An orphan (a file the rule can no
 * longer lint) carries its entries to the path git reports as its rename
 * target — never to a file the baseline already covers, and never by guessing
 * from matching text. Other orphans are dropped.
 *
 * @param {Baseline} previous Lintable entries of the existing baseline.
 * @param {Baseline} current Every occurrence the scan found.
 * @param {PruneOptions} options
 * @returns {PruneResult}
 */
export function pruneBaseline(previous, current, options) {
  const orphans = options.orphans ?? {}
  const renames = options.renames ?? {}
  /** @type {Baseline} */
  const allowances = Object.fromEntries(
    Object.entries(previous).map(([file, entries]) => [file, { ...entries }]),
  )
  /** @type {string[]} */
  const carried = []
  let removed = 0

  for (const [orphan, entries] of Object.entries(orphans)) {
    const target = renames[orphan]
    if (target === undefined || target in allowances) {
      removed += total(entries)
      continue
    }
    allowances[target] = { ...entries }
    carried.push(`${orphan} → ${target}`)
  }

  /** @type {Baseline} */
  const next = {}
  /** @type {string[]} */
  const unadmitted = []
  for (const [file, entries] of Object.entries(current)) {
    for (const [text, count] of Object.entries(entries)) {
      const allowed = allowances[file]?.[text] ?? 0
      const kept = options.admit ? count : Math.min(count, allowed)
      if (kept > 0) (next[file] ??= {})[text] = kept
      if (count > allowed && !options.admit) unadmitted.push(`${file}: ${text}`)
    }
  }
  for (const [file, entries] of Object.entries(allowances)) {
    for (const [text, count] of Object.entries(entries)) {
      removed += Math.max(0, count - (next[file]?.[text] ?? 0))
    }
  }
  return { baseline: sortBaseline(next), removed, unadmitted, carried }
}

/**
 * Every `(file, text)` whose count in `next` exceeds the committed `previous`
 * — the baseline growing. A renamed file is compared against its old path's
 * entries.
 *
 * @param {Baseline} previous The baseline at `HEAD`.
 * @param {Baseline} next The baseline being committed.
 * @param {Record<string, string>} renames `old path → new path` since `HEAD`.
 * @returns {string[]} `file: text (was → now)` for each increase.
 */
export function baselineGrowth(previous, next, renames) {
  /** @type {Baseline} */
  const allowed = {}
  for (const [file, entries] of Object.entries(previous)) {
    const target = renames[file] ?? file
    const merged = (allowed[target] ??= {})
    for (const [text, count] of Object.entries(entries)) {
      merged[text] = (merged[text] ?? 0) + count
    }
  }
  /** @type {string[]} */
  const growth = []
  for (const [file, entries] of Object.entries(next)) {
    for (const [text, count] of Object.entries(entries)) {
      const was = allowed[file]?.[text] ?? 0
      if (count > was) growth.push(`${file}: ${text} (${was} → ${count})`)
    }
  }
  return growth
}

/**
 * The renames in `git diff --name-status -M` output: `old path → new path`.
 * @param {string} nameStatus
 * @returns {Record<string, string>}
 */
export function parseRenames(nameStatus) {
  /** @type {Record<string, string>} */
  const renames = {}
  for (const line of nameStatus.split('\n')) {
    const [status, from, to] = line.split('\t')
    if (status?.startsWith('R') && from && to) renames[from] = to
  }
  return renames
}

/** @param {Record<string, number>} entries */
function total(entries) {
  return Object.values(entries).reduce((sum, count) => sum + count, 0)
}

/** Code-unit order: stable across machines and locales, like the files on disk. */
function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Files and texts in a stable order, empty files omitted, so diffs stay minimal.
 * @param {Baseline} baseline
 * @returns {Baseline}
 */
export function sortBaseline(baseline) {
  /** @type {Baseline} */
  const out = {}
  for (const file of Object.keys(baseline).sort(byCodeUnit)) {
    const entries = baseline[file] ?? {}
    const texts = Object.keys(entries).sort(byCodeUnit)
    if (texts.length === 0) continue
    out[file] = Object.fromEntries(texts.map((text) => [text, entries[text] ?? 0]))
  }
  return out
}
