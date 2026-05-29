/**
 * Lossless block-level model of a `.changes.md` changelog, used by the `history`
 * command to compact and rewrite change history.
 *
 * Unlike {@link ./changelog-parser}, which decodes each line into structured
 * fields (and discards the `&N` card-ID suffix), this module treats each change
 * line as opaque text. A changelog is a header followed by an ordered list of
 * change sets, each a timestamp plus its raw `- ` lines. Round-tripping through
 * {@link parseChangeSets} and {@link serializeChangeSets} preserves every line
 * verbatim — including card IDs — so the editing operations here never corrupt
 * the data they move around.
 */

/** One timestamped block of raw change lines. */
export type ChangeSet = {
  /** The raw timestamp text from the `## ` header (an ISO-8601 string). */
  timestamp: string
  /** Raw change lines, each including its leading `- `. */
  lines: string[]
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
 * verbatim. Non-change lines between sets (blank lines, stray text) are dropped.
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
    if (!seenHeader) headerLines.push(line)
  }

  const header = headerLines.join('\n').trim() || `# Changelog for ${fallbackName}`
  // Drop sets that ended up with no change lines — they carry no information and
  // the writer never emits them.
  return { header, sets: sets.filter((s) => s.lines.length > 0) }
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
  }
  return out
}

/** Return a copy of `sets` sorted newest-first, for display in the editor. */
export function sortNewestFirst(sets: ChangeSet[]): ChangeSet[] {
  return [...sets].sort((a, b) => timestampOrder(b.timestamp) - timestampOrder(a.timestamp))
}

/** Deep-copy a set array so it can be pushed onto an undo stack safely. */
export function cloneSets(sets: ChangeSet[]): ChangeSet[] {
  return sets.map((s) => ({ timestamp: s.timestamp, lines: [...s.lines] }))
}

/** Remove the set at `index`, returning a new array. */
export function deleteSetAt(sets: ChangeSet[], index: number): ChangeSet[] {
  return sets.filter((_, i) => i !== index)
}

/** Replace the timestamp of the set at `index`, returning a new array. */
export function retimeSetAt(sets: ChangeSet[], index: number, timestamp: string): ChangeSet[] {
  return sets.map((s, i) => (i === index ? { ...s, lines: [...s.lines], timestamp } : s))
}

/**
 * Merge the set at `otherIndex` into the set at `targetIndex`: the target keeps
 * its timestamp and gains the other set's lines appended; the other set is
 * removed. Returns a new array. A no-op (returns a copy) if the indices are equal
 * or out of range.
 */
export function combineSetsInto(
  sets: ChangeSet[],
  targetIndex: number,
  otherIndex: number,
): ChangeSet[] {
  const target = sets[targetIndex]
  const other = sets[otherIndex]
  if (!target || !other || targetIndex === otherIndex) return cloneSets(sets)

  const merged: ChangeSet = {
    timestamp: target.timestamp,
    lines: [...target.lines, ...other.lines],
  }
  const result: ChangeSet[] = []
  for (let i = 0; i < sets.length; i++) {
    if (i === otherIndex) continue
    result.push(
      i === targetIndex ? merged : { timestamp: sets[i]!.timestamp, lines: [...sets[i]!.lines] },
    )
  }
  return result
}
