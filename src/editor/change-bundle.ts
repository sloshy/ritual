import type { ChangeEvent } from '../change-event'
import { CHANGE_ACTIONS } from '../change-event'
import {
  checkLabelsForListType,
  parseCardLabelsValue,
  unsupportedLabelsMessage,
} from '../card-labels'
import { isCardLanguage } from '../card-language'
import { isCondition, isFinish } from '../finish-condition'
import type { ListType } from '../list-type'
import { LIST_TYPES } from '../list-type'

/**
 * One list's worth of changes inside a {@link ChangeBundle}. A single-list
 * export is simply a bundle with one entry.
 */
export type ChangeBundleList = {
  /** Which list type these changes target. */
  kind: ListType
  /** Slug of the source list (best-effort target hint for import). */
  slug: string
  /** Display name of the source list, for human-friendly import prompts. */
  name: string
  /** Content hash of the source list at export time, when known. */
  baseContentHash?: string
  /** The ordered edit events to replay. */
  changes: ChangeEvent[]
}

/**
 * The exported/imported edit-session envelope: one or more lists' pending
 * changes, exported together. A public-site visitor edits their lists and
 * exports this; it is later applied by the CLI (`ritual import-changes`), the
 * admin Import Changes page, or loaded into an editor as pending edits
 * (re-targeted to the current card IDs). The `format` marker guards against
 * importing unrelated JSON, and each list's `baseContentHash` lets an importer
 * warn when the underlying list has changed since export.
 */
export type ChangeBundle = {
  /** Format marker + version. Bump only on incompatible shape changes. */
  format: 'ritual-change-bundle'
  version: 1
  /** ISO timestamp the bundle was exported. */
  exportedAt: string
  /** One entry per edited list, in export order. */
  lists: ChangeBundleList[]
}

type BuildChangeBundleInput = {
  lists: ChangeBundleList[]
  /** ISO timestamp; injected by the caller so this stays pure/testable. */
  exportedAt: string
}

/** Build a {@link ChangeBundle} from the per-list edit sessions. */
export function buildChangeBundle(input: BuildChangeBundleInput): ChangeBundle {
  return {
    format: 'ritual-change-bundle',
    version: 1,
    exportedAt: input.exportedAt,
    lists: input.lists,
  }
}

/** Serialize a {@link ChangeBundle} to pretty JSON suitable for download/clipboard. */
export function serializeChangeBundle(bundle: ChangeBundle): string {
  return JSON.stringify(bundle, null, 2)
}

/** Filename for a downloaded multi-list change bundle (every edited list). */
export const CHANGE_BUNDLE_FILENAME = 'ritual-all-edits.json'

/** Filename for a bundle scoped to the current combined view's member lists. */
export const COMBINED_BUNDLE_FILENAME = 'ritual-combined-edits.json'

/** Total change count across every list in a bundle. */
export function bundleChangeCount(bundle: ChangeBundle): number {
  return bundle.lists.reduce((sum, list) => sum + list.changes.length, 0)
}

/**
 * Format a count with a simple pluralized noun (`1 change`, `3 lists`).
 *
 * **Being retired.** A runtime noun with an English `s` glued on has no string
 * a translator can edit, and is wrong in every language with more than two
 * plural categories — which is why `ritual/no-inline-plural` flags the body.
 * The browser surfaces now render `ui.count.changes` / `ui.count.lists`
 * instead; the one remaining caller is `src/admin/api/import-changes.ts`, whose
 * server-authored prose is restructured in Phase 5 (plan §7.7). This function
 * goes away with it.
 */
export function countLabel(count: number, noun: string): string {
  // eslint-disable-next-line ritual/no-inline-plural -- see the retirement note above
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * Validate a raw `changes` value as an ordered {@link ChangeEvent} array. Returns
 * the array on success or a human-readable error string prefixed with the list's
 * position (e.g. `List #2: `). This is the parse boundary for externally-authored
 * JSON, so set codes are normalized to lowercase here — every in-memory
 * representation downstream assumes it.
 */
function validateChanges(raw: unknown, where: string, kind: ListType): ChangeEvent[] | string {
  if (!Array.isArray(raw)) return `${where}Missing or invalid "changes" array.`
  const changes: ChangeEvent[] = []
  for (const [i, change] of raw.entries()) {
    if (typeof change !== 'object' || change === null) {
      return `${where}Change #${i + 1} is not an object.`
    }
    const obj = change as Record<string, unknown>
    if (
      typeof obj.action !== 'string' ||
      !(CHANGE_ACTIONS as readonly string[]).includes(obj.action)
    ) {
      return `${where}Change #${i + 1} has an unknown action: ${String(obj.action)}.`
    }
    if (obj.set !== undefined && typeof obj.set !== 'string') {
      return `${where}Change #${i + 1} has an invalid "set".`
    }
    // A labels payload is a closed vocabulary with an exclusivity rule —
    // imported JSON must not smuggle garbage into a serialize. The parsed form
    // is normalized (deduped, canonical order). On a set-label an empty array
    // (a clear) is valid; an add (or the record of the line a remove took away)
    // either carries an override or omits the field.
    let normalized = typeof obj.set === 'string' ? { ...obj, set: obj.set.toLowerCase() } : obj
    // Languages are a closed vocabulary: normalize to lowercase and reject
    // unknown codes the way unknown actions are rejected — an invalid code must
    // never reach a serializer. `set-language` requires the field; every other
    // change may carry it optionally (add/remove/set-printing/move-from/move-to).
    if (obj.language !== undefined) {
      const language = typeof obj.language === 'string' ? obj.language.toLowerCase() : null
      if (language === null || !isCardLanguage(language)) {
        return `${where}Change #${i + 1} has an unknown language: ${JSON.stringify(obj.language)}.`
      }
      normalized = { ...normalized, language }
    } else if (obj.action === 'set-language') {
      return `${where}Change #${i + 1} (set-language) is missing its "language".`
    }
    // Finish and condition are closed vocabularies too — an invalid value must
    // be refused here, not serialized into a list file.
    if (obj.finish !== undefined) {
      if (typeof obj.finish !== 'string' || !isFinish(obj.finish)) {
        return `${where}Change #${i + 1} has an unknown finish: ${JSON.stringify(obj.finish)}.`
      }
    }
    if (obj.condition !== undefined) {
      // `set-printing` alone accepts the `NONE` clear sentinel (ConditionUpdate).
      const clearAllowed = obj.action === 'set-printing' && obj.condition === 'NONE'
      if (!clearAllowed && (typeof obj.condition !== 'string' || !isCondition(obj.condition))) {
        return `${where}Change #${i + 1} has an unknown condition: ${JSON.stringify(obj.condition)}.`
      }
    }
    if (
      obj.action === 'set-label' ||
      ((obj.action === 'add' || obj.action === 'remove') && obj.labels !== undefined)
    ) {
      const labels = parseCardLabelsValue(obj.labels, 'labels')
      if (!labels.ok) return `${where}Change #${i + 1}: ${labels.message}`
      // Which labels are legal depends on the list the change lands in: a deck
      // carries `proxy` alone, a wanted list none at all — and an empty set is
      // a clear, which still says nothing on a list with no labels. The same
      // decision the CLI, the save routes, and the MCP schemas make.
      const check = checkLabelsForListType(kind, labels.labels)
      if (!check.ok) {
        return `${where}Change #${i + 1}: ${unsupportedLabelsMessage(kind, check.unsupported)}`
      }
      normalized = { ...normalized, labels: labels.labels }
    }
    changes.push(normalized as ChangeEvent)
  }
  return changes
}

/** Validate one entry of a bundle's `lists` array, or return an error string. */
function validateList(obj: Record<string, unknown>, where: string): ChangeBundleList | string {
  if (typeof obj.kind !== 'string' || !(LIST_TYPES as readonly string[]).includes(obj.kind)) {
    return `${where}Invalid list kind: ${String(obj.kind)} (expected deck, collection, or wanted).`
  }
  if (typeof obj.slug !== 'string') return `${where}Missing or invalid "slug".`
  if (typeof obj.name !== 'string') return `${where}Missing or invalid "name".`
  if (obj.baseContentHash !== undefined && typeof obj.baseContentHash !== 'string') {
    return `${where}Invalid "baseContentHash".`
  }
  const kind = obj.kind as ListType
  const changes = validateChanges(obj.changes, where, kind)
  if (typeof changes === 'string') return changes
  return {
    kind,
    slug: obj.slug,
    name: obj.name,
    baseContentHash: obj.baseContentHash,
    changes,
  }
}

/**
 * Parse and validate a {@link ChangeBundle} from JSON text. Returns the bundle
 * on success or a human-readable error string describing why it was rejected —
 * the caller surfaces it to the importer. Card IDs referenced by the changes are
 * NOT resolved here; re-targeting against the live lists happens at import time.
 *
 * The rejection strings are **English by contract**: they name JSON field names
 * and index positions in a file the user is expected to inspect, and the same
 * text is what `ritual import-changes` and the MCP import tool report. They are
 * a diagnostic vocabulary for a data format, like the format marker itself, not
 * UI prose — see the plan's §4.9 carve-out list.
 */
export function parseChangeBundle(text: string): ChangeBundle | string {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return 'Not valid JSON.'
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return 'Expected a JSON object.'
  }
  const obj = raw as Record<string, unknown>
  if (obj.format !== 'ritual-change-bundle') {
    return 'Not a ritual change bundle (missing "format": "ritual-change-bundle").'
  }
  if (obj.version !== 1) return `Unsupported change-bundle version: ${String(obj.version)}.`
  if (typeof obj.exportedAt !== 'string') return 'Missing or invalid "exportedAt".'
  if (!Array.isArray(obj.lists)) return 'Missing or invalid "lists" array.'
  const lists: ChangeBundleList[] = []
  for (const [i, entry] of obj.lists.entries()) {
    if (typeof entry !== 'object' || entry === null) return `List #${i + 1} is not an object.`
    const list = validateList(entry as Record<string, unknown>, `List #${i + 1}: `)
    if (typeof list === 'string') return list
    lists.push(list)
  }
  return {
    format: 'ritual-change-bundle',
    version: 1,
    exportedAt: obj.exportedAt,
    lists,
  }
}
