/**
 * Block-level model of a `.changes.md` changelog: the structural reader and
 * writer shared by the changelog writer, the changelog parser, and the
 * `history` command's compact-and-rewrite editor.
 *
 * A changelog is a header followed by an ordered list of change sets. Each set
 * is one `## <ISO timestamp>` entry holding, in this order:
 *
 * 1. its prose `- ` lines — rendered by `formatChangeCore` for humans, kept
 *    here as opaque text and **never re-read** for meaning;
 * 2. a fenced ` ```ritual-changes ` block of JSON Lines, one line per event in
 *    the same order as the prose lines (the i-th JSON line is the event the
 *    i-th prose line renders), decoded here into typed {@link ChangeEvent}s
 *    through the shared `decodeChangeEvent` validator;
 * 3. any hand-written text that followed (`trailing`), preserved verbatim.
 *
 * Round-tripping through {@link parseChangeSets} and {@link serializeChangeSets}
 * preserves every prose line, every event, and every trailing line, so the
 * editing operations here never corrupt or destroy the data they move around.
 * The one place events are *interpreted* is {@link combineSetsInto}: when two
 * sets merge, opposite typed events cancel (an add and a later remove of the
 * same card, set/unset-commander, add/remove-section), mirroring the live
 * changelog compaction in `editor/useCardChanges`. Surviving lines still keep
 * their exact original text — only cancelled pairs are dropped, prose line and
 * event together.
 *
 * An entry with no `ritual-changes` block is a **legacy** entry (written
 * before the block existed): its prose is carried verbatim, it yields zero
 * events, and the parse reports one {@link ChangelogAdvisory} for it — never
 * silence. Nothing here parses prose.
 *
 * **Persistence fence — this module must never import `src/i18n`.**
 */

import { type ChangeEvent, areOppositeChanges, formatChangeCore } from './change-event'
import { decodeChangeEvent, encodeChangeEvent } from './change-event-decode'
import { createFenceTracker } from '../list/markdown-fence'

/** The info string of the fenced block that carries an entry's events. */
export const CHANGES_BLOCK_INFO = 'ritual-changes'

/** One timestamped entry: its prose lines, its typed events, and any preserved prose. */
export type ChangeSet = {
  /** The raw timestamp text from the `## ` header (an ISO-8601 string). */
  timestamp: string
  /** Raw prose change lines, each including its leading `- `. Opaque text. */
  lines: string[]
  /**
   * The entry's typed events, from its `ritual-changes` block, in prose-line
   * order. Empty for a legacy entry (no block); otherwise the same length as
   * `lines` unless a hand edit desynchronized the two.
   */
  events: ChangeEvent[]
  /**
   * Hand-written non-change lines that followed this set's change lines in the
   * file (prose, notes — anything that is not a `- ` line, a `## ` header, or
   * the events block). Preserved through a parse→serialize round trip so
   * saving an edited history never destroys them — each line is kept as
   * written (indentation included), though blank lines between them are
   * dropped and the block is re-emitted after the set's events block. They
   * travel with their set through retime/combine, and are deleted with it.
   * Absent when the set has none.
   */
  trailing?: string[]
}

/** A changelog: the leading header text plus its change sets. */
export type Changelog = {
  /** Everything before the first `## ` header (e.g. `# Changelog for My Deck`). */
  header: string
  /** Change sets in the order they appeared in the file. */
  sets: ChangeSet[]
}

/**
 * Something a reader should know about an entry the parser could not fully
 * read. Small and structured (no raw content) so it costs baked site data
 * nothing to carry and a caller can name the file and entry in its own words.
 */
export type ChangelogAdvisory =
  | {
      /** The entry has prose lines but no `ritual-changes` block — a legacy entry, yielding zero events. */
      kind: 'missing-block'
      timestamp: string
    }
  | {
      /** The entry has prose lines and a `ritual-changes` block, but the block has no lines — zero events. */
      kind: 'empty-block'
      timestamp: string
    }
  | {
      /** A line inside the entry's `ritual-changes` block did not decode; it was dropped. */
      kind: 'invalid-event'
      timestamp: string
      /** The decoder's reason (English by contract, like every JSON-format diagnostic). */
      error: string
    }

/** What {@link parseChangeSets} reads: the changelog plus the advisories raised reading it. */
export type ParsedChangeSets = Changelog & {
  advisories: ChangelogAdvisory[]
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
 * Format one event as its prose changelog line — the `- ` line the writer
 * emits and the history editor shows. Persistence only, English by contract.
 */
export function formatChangelogLine(change: ChangeEvent): string {
  return `- ${formatChangeCore(change, { tense: 'past', quoteCardName: true })}`
}

/** A fresh set for `events`, its prose lines rendered from them. */
export function changeSetFromEvents(timestamp: string, events: readonly ChangeEvent[]): ChangeSet {
  return { timestamp, lines: events.map(formatChangelogLine), events: [...events] }
}

/** A legacy entry: prose lines and no block. Its events live only in the prose. */
export function isLegacyChangeSet(set: ChangeSet): boolean {
  return set.events.length === 0 && set.lines.length > 0
}

/** Whether the set's prose and events still pair up line for line. */
function isSynchronized(set: ChangeSet): boolean {
  return set.events.length === set.lines.length
}

/**
 * Whether two sets can be combined by {@link combineSetsInto}. Two well-formed
 * sets merge in lockstep (prose line i with event i); two legacy sets merge as
 * opaque prose. A legacy set and a modern one — or a hand-desynchronized set —
 * cannot: the merged prose and events would no longer pair, and the migration
 * could no longer tell which lines the block covers.
 */
export function canCombineSets(a: ChangeSet, b: ChangeSet): boolean {
  if (isLegacyChangeSet(a) && isLegacyChangeSet(b)) return true
  return isSynchronized(a) && isSynchronized(b)
}

/** The `id` a block-read event gets: the entry's header plus its position, so it is stable across reads. */
function blockEventId(timestamp: string, index: number): string {
  return `${timestamp}#${index}`
}

/**
 * Parse changelog file content into its sets. Lines before the first `## `
 * header become the header (falling back to `# Changelog for <name>` when
 * empty). Each `## ` line opens a new set; the `- ` lines beneath it are
 * captured verbatim, the `ritual-changes` block is decoded into events, and
 * any other non-blank text — a user's own fenced block included — is
 * preserved as the set's `trailing` lines. Only blank lines between sets are
 * dropped (they are re-created as canonical spacing on serialize).
 *
 * Each block-read event's `timestamp` is the entry's header time and its `id`
 * is derived from the header and its position: the block persists neither.
 */
export function parseChangeSets(content: string, fallbackName: string): ParsedChangeSets {
  const lines = content.split('\n')
  const headerLines: string[] = []
  const sets: ChangeSet[] = []
  const advisories: ChangelogAdvisory[] = []
  let current: ChangeSet | null = null
  let seenHeader = false
  let sawBlock = false
  /** Non-blank lines read from the current set's block, decodable or not. */
  let blockLineCount = 0
  const fence = createFenceTracker()
  /** Inside the current set's `ritual-changes` block (as opposed to a user's own fence). */
  let inChangesBlock = false

  const closeSet = (): void => {
    if (!current || current.lines.length === 0) return
    // An entry that yields no events is never silent: a block-less entry is a
    // legacy one, and an empty block is reported apart from it (an undecodable
    // block already raises `invalid-event` per line).
    if (!sawBlock) {
      advisories.push({ kind: 'missing-block', timestamp: current.timestamp })
    } else if (blockLineCount === 0) {
      advisories.push({ kind: 'empty-block', timestamp: current.timestamp })
    }
  }

  for (const line of lines) {
    const state = fence.feed(line)
    const trimmed = line.trim()

    if (state.role === 'open') {
      // Only the writer's own block is data; any other fence is opaque prose.
      const info = trimmed.replace(/^(`{3,}|~{3,})/, '').trim()
      if (current && info === CHANGES_BLOCK_INFO && !sawBlock) {
        inChangesBlock = true
        sawBlock = true
        continue
      }
    } else if (state.role === 'close' && inChangesBlock) {
      inChangesBlock = false
      continue
    } else if (state.role === 'content' && inChangesBlock && current) {
      if (trimmed === '') continue
      blockLineCount += 1
      const setTimestamp = current.timestamp
      let raw: unknown
      try {
        raw = JSON.parse(trimmed)
      } catch {
        advisories.push({
          kind: 'invalid-event',
          timestamp: setTimestamp,
          error: 'Not valid JSON.',
        })
        continue
      }
      const envelope = {
        id: blockEventId(setTimestamp, current.events.length),
        timestamp: timestampOrder(setTimestamp),
      }
      // The envelope is the reader's to synthesize: a line's own `id` or
      // `timestamp` is dropped rather than allowed to dictate either.
      let withEnvelope: unknown = raw
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        const { id: _id, timestamp: _ts, ...payload } = raw as Record<string, unknown>
        withEnvelope = { ...payload, ...envelope }
      }
      const event = decodeChangeEvent(withEnvelope, '')
      if (typeof event === 'string') {
        advisories.push({ kind: 'invalid-event', timestamp: setTimestamp, error: event.trim() })
        continue
      }
      current.events.push(event)
      continue
    }

    if (!state.opaque) {
      const headerMatch = trimmed.match(TIMESTAMP_HEADER)
      if (headerMatch) {
        closeSet()
        seenHeader = true
        sawBlock = false
        blockLineCount = 0
        current = { timestamp: headerMatch[1]!.trim(), lines: [], events: [] }
        sets.push(current)
        continue
      }
      if (current && CHANGE_LINE.test(trimmed)) {
        current.lines.push(trimmed)
        continue
      }
    }
    if (!seenHeader) {
      headerLines.push(line)
      continue
    }
    // Hand-written text inside or after a set (fenced content and fence
    // delimiters included) — keep it attached to the set, untrimmed, so
    // indentation (nested lists, code blocks) survives.
    if (current && trimmed !== '') {
      current.trailing = [...(current.trailing ?? []), line]
    }
  }
  closeSet()

  let header = headerLines.join('\n').trim() || `# Changelog for ${fallbackName}`
  // Drop sets that ended up with nothing — they carry no information and the
  // writer never emits them. Prose attached to a dropped set is reattached to
  // the previous surviving set (or the header) so it is never silently destroyed.
  const kept: ChangeSet[] = []
  for (const set of sets) {
    if (set.lines.length > 0 || set.events.length > 0) {
      kept.push(set)
      continue
    }
    const orphaned = set.trailing ?? []
    if (orphaned.length === 0) continue
    const previous = kept[kept.length - 1]
    if (previous) previous.trailing = [...(previous.trailing ?? []), ...orphaned]
    else header += `\n\n${orphaned.join('\n')}`
  }
  return { header, sets: kept, advisories }
}

/**
 * Serialize one set as the writer lays it out: a blank line, the `## ` header,
 * a blank line, the prose lines, then (when the set has events) a blank line
 * and the fenced `ritual-changes` block, then any trailing prose after a blank
 * line. Starts with the newline that separates it from what precedes it.
 */
export function serializeChangeSet(set: ChangeSet): string {
  let out = `\n## ${set.timestamp}\n`
  if (set.lines.length > 0) out += `\n${set.lines.join('\n')}\n`
  if (set.events.length > 0) {
    const jsonl = set.events.map(encodeChangeEvent).join('\n')
    out += `\n\`\`\`${CHANGES_BLOCK_INFO}\n${jsonl}\n\`\`\`\n`
  }
  if (set.trailing !== undefined && set.trailing.length > 0) {
    out += `\n${set.trailing.join('\n')}\n`
  }
  return out
}

/**
 * Serialize a {@link Changelog} back to file content, sorting sets oldest-first
 * (the on-disk convention, since the writer appends new sets at the bottom).
 * Empty sets are omitted. The output matches the changelog writer's layout so a
 * rewritten file is indistinguishable from an organically appended one.
 */
export function serializeChangeSets(log: Changelog): string {
  const ordered = [...log.sets]
    .filter((s) => s.lines.length > 0 || s.events.length > 0)
    .sort((a, b) => timestampOrder(a.timestamp) - timestampOrder(b.timestamp))

  let out = log.header.replace(/\n+$/, '') + '\n'
  for (const set of ordered) out += serializeChangeSet(set)
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
    events: [...set.events],
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

/** A prose line paired with the event it renders. */
type CompactItem = { line: string; event: ChangeEvent }

/** The actions that can annihilate an earlier opposite (see {@link areOppositeChanges}). */
const CANCELABLE_ACTIONS: ReadonlySet<ChangeEvent['action']> = new Set<ChangeEvent['action']>([
  'add',
  'remove',
  'set-commander',
  'unset-commander',
  'add-tag',
  'remove-tag',
  'add-section',
  'remove-section',
])

/**
 * Cancel opposite changes out of an ordered (oldest-first) item list, the way
 * the live editor does as a card is added then removed: walking oldest→newest,
 * an event that is the exact opposite of an earlier surviving one annihilates
 * that item and drops itself. Every other event passes through with its exact
 * original prose line. Returns the survivors in order.
 */
function compactItems(items: readonly CompactItem[]): CompactItem[] {
  const survivors: CompactItem[] = []
  for (const item of items) {
    if (CANCELABLE_ACTIONS.has(item.event.action)) {
      const oppositeIndex = survivors.findIndex((s) => areOppositeChanges(s.event, item.event))
      if (oppositeIndex !== -1) {
        survivors.splice(oppositeIndex, 1)
        continue
      }
    }
    survivors.push(item)
  }
  return survivors
}

/** The set's prose lines paired with their events; only meaningful on a synchronized set. */
function itemsOf(set: ChangeSet): CompactItem[] {
  return set.lines.map((line, i) => ({ line, event: set.events[i]! }))
}

/**
 * Merge the set at `otherIndex` into the set at `targetIndex`. The merged set keeps
 * the target's timestamp, but its lines are ordered so the older source set's
 * changes sit above the newer source set's — newest changes always end up at the
 * bottom, regardless of which set was the combine target. Opposite typed events
 * across the two sets then cancel out (see {@link compactItems}), mirroring the
 * live changelog in the card editor. Two legacy (block-less) sets merge as opaque
 * prose with nothing cancelled. The other set is removed; if compaction empties
 * the merged set, it is dropped too. Returns a new array. A no-op copy if the
 * indices are equal or out of range, or if the two sets cannot be combined
 * (see {@link canCombineSets}).
 */
export function combineSetsInto(
  sets: ChangeSet[],
  targetIndex: number,
  otherIndex: number,
): ChangeSet[] {
  const target = sets[targetIndex]
  const other = sets[otherIndex]
  if (!target || !other || targetIndex === otherIndex) return cloneSets(sets)
  if (!canCombineSets(target, other)) return cloneSets(sets)

  const otherIsOlder = timestampOrder(other.timestamp) < timestampOrder(target.timestamp)
  const [older, newer] = otherIsOlder ? [other, target] : [target, other]
  // Trailing prose merges older-first, matching the change-line ordering.
  const mergedTrailing = [...(older.trailing ?? []), ...(newer.trailing ?? [])]
  let mergedLines: string[]
  let mergedEvents: ChangeEvent[]
  if (isLegacyChangeSet(older)) {
    mergedLines = [...older.lines, ...newer.lines]
    mergedEvents = []
  } else {
    const survivors = compactItems([...itemsOf(older), ...itemsOf(newer)])
    mergedLines = survivors.map((item) => item.line)
    mergedEvents = survivors.map((item) => item.event)
  }
  const merged: ChangeSet = {
    timestamp: target.timestamp,
    lines: mergedLines,
    events: mergedEvents,
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
