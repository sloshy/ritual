/**
 * Block-level model of a `.changes.md` changelog, used by the `history`
 * command to compact and rewrite change history.
 *
 * Unlike {@link ./changelog-parser}, which decodes each line into structured
 * fields (and discards the `&N` card-ID suffix), this module treats each change
 * line as opaque text. A changelog is a header followed by an ordered list of
 * change sets, each a timestamp plus its raw `- ` lines (and any hand-written
 * `trailing` text that followed them). Round-tripping through
 * {@link parseChangeSets} and {@link serializeChangeSets} preserves every line
 * verbatim — including card IDs and non-change prose — so the editing
 * operations here never corrupt or destroy the data they move around.
 *
 * The one place lines are interpreted is {@link combineSetsInto}: when two sets
 * merge it parses each line just far enough to cancel opposite changes (an add
 * and a later remove of the same card, set/unset-commander, add/remove-section),
 * mirroring the live changelog compaction in `editor/useCardChanges`. Surviving
 * lines still keep their exact original text — only cancelled pairs are dropped.
 */

import type { Board } from '../list/deck'
import type { Condition, Finish } from '../card/finish-condition'
import { type ChangeEvent, areOppositeChanges } from './change-event'
import { parseChangeLine } from './changelog-parser'
import { readCardId } from '../card/card-line-id'

/** One timestamped block of raw change lines. */
export type ChangeSet = {
  /** The raw timestamp text from the `## ` header (an ISO-8601 string). */
  timestamp: string
  /** Raw change lines, each including its leading `- `. */
  lines: string[]
  /**
   * Hand-written non-change lines that followed this set's change lines in the
   * file (prose, notes — anything that is not a `- ` line or a `## ` header).
   * Preserved through a parse→serialize round trip so saving an edited history
   * never destroys them — each line is kept as written (indentation included),
   * though blank lines between them are dropped and the block is re-emitted
   * after the set's change lines. They travel with their set through
   * retime/combine, and are deleted with it. Absent when the set has none.
   */
  trailing?: string[]
}

/** A parsed changelog: the leading header text plus its change sets. */
export type Changelog = {
  /** Everything before the first `## ` header (e.g. `# Changelog for My Deck`). */
  header: string
  /** Change sets in the order they appeared in the file. */
  sets: ChangeSet[]
}

const TIMESTAMP_HEADER = /^##\s+(.*)$/
const CHANGE_LINE = /^-\s+/

/**
 * Whether a (trimmed) line is a `- ` change line in the changelog grammar.
 * Exported so validators (e.g. the admin history save route) test against the
 * exact grammar the parser uses, rather than a second copy of the regex.
 */
export function isChangeLine(trimmedLine: string): boolean {
  return CHANGE_LINE.test(trimmedLine)
}

/** Whether a (trimmed) line is a `## ` set header in the changelog grammar. */
export function isSetHeaderLine(trimmedLine: string): boolean {
  return TIMESTAMP_HEADER.test(trimmedLine)
}

/**
 * Validate an ISO-8601 date-time string. Requires a full calendar date and time
 * with an explicit zone (`Z` or `±HH:MM`); seconds and milliseconds are optional.
 * This matches the timestamps the changelog writer emits (`new Date().toISOString()`).
 */
export function isValidIso8601(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false
  }
  return !Number.isNaN(new Date(value).getTime())
}

function timestampOrder(timestamp: string): number {
  const ms = new Date(timestamp).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Parse changelog file content into a {@link Changelog}. Lines before the first
 * `## ` header become the header (falling back to `# Changelog for <name>` when
 * empty). Each `## ` line opens a new set; the `- ` lines beneath it are captured
 * verbatim, and any other non-blank text is preserved as the set's `trailing`
 * lines. Only blank lines between sets are dropped (they are re-created as
 * canonical spacing on serialize).
 */
export function parseChangeSets(content: string, fallbackName: string): Changelog {
  const lines = content.split('\n')
  const headerLines: string[] = []
  const sets: ChangeSet[] = []
  let current: ChangeSet | null = null
  let seenHeader = false

  for (const line of lines) {
    const trimmed = line.trim()
    const headerMatch = trimmed.match(TIMESTAMP_HEADER)
    if (headerMatch) {
      seenHeader = true
      current = { timestamp: headerMatch[1]!.trim(), lines: [] }
      sets.push(current)
      continue
    }
    if (current && CHANGE_LINE.test(trimmed)) {
      current.lines.push(trimmed)
      continue
    }
    if (!seenHeader) {
      headerLines.push(line)
      continue
    }
    // Hand-written text inside or after a set — keep it attached to the set,
    // untrimmed, so indentation (nested lists, code blocks) survives.
    if (current && trimmed !== '') {
      current.trailing = [...(current.trailing ?? []), line]
    }
  }

  let header = headerLines.join('\n').trim() || `# Changelog for ${fallbackName}`
  // Drop sets that ended up with no change lines — they carry no information
  // and the writer never emits them. Prose attached to a dropped set is
  // reattached to the previous surviving set (or the header) so it is never
  // silently destroyed.
  const kept: ChangeSet[] = []
  for (const set of sets) {
    if (set.lines.length > 0) {
      kept.push(set)
      continue
    }
    const orphaned = set.trailing ?? []
    if (orphaned.length === 0) continue
    const previous = kept[kept.length - 1]
    if (previous) previous.trailing = [...(previous.trailing ?? []), ...orphaned]
    else header += `\n\n${orphaned.join('\n')}`
  }
  return { header, sets: kept }
}

/**
 * Serialize a {@link Changelog} back to file content, sorting sets oldest-first
 * (the on-disk convention, since the writer appends new sets at the bottom).
 * Empty sets are omitted. The output matches the changelog writer's layout so a
 * rewritten file is indistinguishable from an organically appended one.
 */
export function serializeChangeSets(log: Changelog): string {
  const ordered = [...log.sets]
    .filter((s) => s.lines.length > 0)
    .sort((a, b) => timestampOrder(a.timestamp) - timestampOrder(b.timestamp))

  let out = log.header.replace(/\n+$/, '') + '\n'
  for (const set of ordered) {
    out += `\n## ${set.timestamp}\n\n${set.lines.join('\n')}\n`
    if (set.trailing !== undefined && set.trailing.length > 0) {
      out += `\n${set.trailing.join('\n')}\n`
    }
  }
  return out
}

/** Return a copy of `sets` sorted newest-first, for display in the editor. */
export function sortNewestFirst(sets: ChangeSet[]): ChangeSet[] {
  return [...sets].sort((a, b) => timestampOrder(b.timestamp) - timestampOrder(a.timestamp))
}

/** Deep-copy a set array so it can be pushed onto an undo stack safely. */
export function cloneSets(sets: ChangeSet[]): ChangeSet[] {
  return sets.map(cloneSet)
}

function cloneSet(set: ChangeSet): ChangeSet {
  return {
    timestamp: set.timestamp,
    lines: [...set.lines],
    ...(set.trailing !== undefined ? { trailing: [...set.trailing] } : {}),
  }
}

/** Remove the set at `index`, returning a new array. */
export function deleteSetAt(sets: ChangeSet[], index: number): ChangeSet[] {
  return sets.filter((_, i) => i !== index)
}

/** Replace the timestamp of the set at `index`, returning a new array. */
export function retimeSetAt(sets: ChangeSet[], index: number, timestamp: string): ChangeSet[] {
  return sets.map((s, i) => (i === index ? { ...cloneSet(s), timestamp } : s))
}

/**
 * Parse a raw change line into the {@link ChangeEvent} it represents, but only for
 * the actions that can cancel against an opposite (add/remove, set/unset-commander,
 * add/remove-section). Any other line — or one that doesn't parse — returns null and
 * is treated as opaque, so it can never be compacted away. The `id`/`timestamp` are
 * placeholders: only the discriminant and identity fields matter to
 * {@link areOppositeChanges}. The validated `finish`/`condition`/`board` strings are
 * cast back to their unions, matching how the writer produced them.
 */
function lineToCancelableEvent(line: string): ChangeEvent | null {
  const change = parseChangeLine(line)
  if (!change) return null
  // The shared entry-level reader: a changelog line's `&N` is written by
  // `formatChangeCore` with its leading space, so the boundary rule costs
  // nothing and keeps one spelling of the token in the codebase.
  const cardId = readCardId(line)
  const base = { id: '', timestamp: 0, cardName: change.cardName, cardId }
  const printing = {
    set: change.set,
    collectorNumber: change.collectorNumber,
    finish: change.finish as Finish | undefined,
    condition: change.condition as Condition | undefined,
    board: change.board as Board | undefined,
  }
  switch (change.action) {
    case 'Added':
      return { ...base, action: 'add', ...printing }
    case 'Removed':
      return { ...base, action: 'remove', ...printing }
    case 'Set as commander':
      return { ...base, action: 'set-commander' }
    case 'Unset as commander':
      return { ...base, action: 'unset-commander' }
    case 'Added section':
      return { id: '', timestamp: 0, action: 'add-section', section: change.section ?? '' }
    case 'Removed section':
      return { id: '', timestamp: 0, action: 'remove-section', section: change.section ?? '' }
    default:
      return null
  }
}

/** A raw change line paired with its parsed cancelable event (null when opaque). */
type CompactItem = { raw: string; event: ChangeEvent | null }

/**
 * Cancel opposite changes out of an ordered (oldest-first) line list, the way the
 * live editor does as a card is added then removed: walking oldest→newest, a line
 * whose change is the exact opposite of an earlier surviving line annihilates that
 * line and drops itself. Lines that aren't a cancelable change pass through and keep
 * their exact original text. Returns the surviving lines in order.
 */
function compactLines(lines: string[]): string[] {
  const survivors: CompactItem[] = []
  for (const raw of lines) {
    const event = lineToCancelableEvent(raw)
    if (event) {
      const oppositeIndex = survivors.findIndex(
        (item) => item.event !== null && areOppositeChanges(item.event, event),
      )
      if (oppositeIndex !== -1) {
        survivors.splice(oppositeIndex, 1)
        continue
      }
    }
    survivors.push({ raw, event })
  }
  return survivors.map((item) => item.raw)
}

/**
 * Merge the set at `otherIndex` into the set at `targetIndex`. The merged set keeps
 * the target's timestamp, but its lines are ordered so the older source set's
 * changes sit above the newer source set's — newest changes always end up at the
 * bottom, regardless of which set was the combine target. Opposite changes across
 * the two sets then cancel out (see {@link compactLines}), mirroring the live
 * changelog in the card editor. The other set is removed; if compaction empties the
 * merged set, it is dropped too. Returns a new array. A no-op copy if the indices
 * are equal or out of range.
 */
export function combineSetsInto(
  sets: ChangeSet[],
  targetIndex: number,
  otherIndex: number,
): ChangeSet[] {
  const target = sets[targetIndex]
  const other = sets[otherIndex]
  if (!target || !other || targetIndex === otherIndex) return cloneSets(sets)

  const otherIsOlder = timestampOrder(other.timestamp) < timestampOrder(target.timestamp)
  const [older, newer] = otherIsOlder ? [other, target] : [target, other]
  // Trailing prose merges older-first, matching the change-line ordering.
  const mergedTrailing = [...(older.trailing ?? []), ...(newer.trailing ?? [])]
  const merged: ChangeSet = {
    timestamp: target.timestamp,
    lines: compactLines([...older.lines, ...newer.lines]),
    ...(mergedTrailing.length > 0 ? { trailing: mergedTrailing } : {}),
  }

  const result: ChangeSet[] = []
  // Prose from a fully-cancelled combine reattaches to a neighbouring set
  // rather than vanishing — the same rescue rule parseChangeSets applies.
  let orphaned: string[] = []
  for (let i = 0; i < sets.length; i++) {
    if (i === otherIndex) continue
    if (i === targetIndex) {
      // A combine that fully cancels out leaves nothing to keep — drop the set,
      // but never its hand-written prose.
      if (merged.lines.length > 0) result.push(merged)
      else orphaned = mergedTrailing
    } else {
      result.push(cloneSet(sets[i]!))
    }
  }
  if (orphaned.length > 0 && result.length > 0) {
    const last = result[result.length - 1]!
    last.trailing = [...(last.trailing ?? []), ...orphaned]
  }
  return result
}
