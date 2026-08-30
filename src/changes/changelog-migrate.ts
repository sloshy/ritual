/**
 * **Migration-only** conversion of a `.changes.md` changelog's legacy entries
 * — prose `- ` lines with no fenced `ritual-changes` block — into entries that
 * carry the block, so the live reader (`changelog-parser.ts`, which parses no
 * prose) sees their events again.
 *
 * `ritual cleanup` is the only caller. The conversion is deliberately timid:
 *
 * - an entry whose block holds events is never touched, whatever its content
 *   (a present-but-empty block leaves nothing to disagree with, so such an
 *   entry converts from its prose like any other legacy entry);
 * - a legacy entry converts only when *every* prose line parses through
 *   `changelog-legacy-parser.ts` — one unreadable line leaves the whole entry
 *   as it was, so history is never half-converted or dropped;
 * - a hand-desynchronized entry (a block whose line count no longer matches its
 *   prose) is left as it was, since the migration cannot tell which lines the
 *   block covers;
 * - a file whose block holds an undecodable line is not rewritten at all: a
 *   re-serialize would drop that line, and the migration never deletes bytes it
 *   could not read;
 * - prose is re-emitted **verbatim** (never re-rendered from the events), so the
 *   round trip only ever adds the block beneath the lines it already had.
 *
 * A file with nothing to convert is reported as unchanged and its content is
 * returned byte-for-byte, so a second run writes nothing.
 *
 * Delete this module (with `changelog-legacy-parser.ts`) once every workspace
 * has been migrated. **Persistence fence — never import `src/i18n`.**
 */

import {
  isLegacyChangeSet,
  parseChangeSets,
  serializeChangeSets,
  type ChangeSet,
} from './changelog-blocks'
import { parseLegacyChangeLines } from './changelog-legacy-parser'

/** Why one entry was left as it was. */
export type ChangelogEntrySkipReason =
  /** A legacy entry with at least one prose line the legacy grammar did not accept. */
  | 'unparsed-lines'
  /** An entry whose block's event count no longer matches its prose line count. */
  | 'desynchronized'

/** One entry the migration left verbatim, and why. */
export type ChangelogEntrySkip = {
  timestamp: string
  reason: ChangelogEntrySkipReason
  /** The offending prose lines for `unparsed-lines`; empty otherwise. */
  lines: string[]
}

/** What converting one changelog produced. */
export type ChangelogMigration = {
  /** The file content to write; identical to the input when `converted` is 0. */
  content: string
  /** Entries that gained a block. */
  converted: number
  /** Entries left verbatim, with the reason. */
  skipped: ChangelogEntrySkip[]
  /**
   * True when the file's existing block holds a line the decoder refused. The
   * file is then returned unchanged (`converted` is 0 even if legacy entries
   * were convertible): a rewrite would drop the unreadable line.
   */
  undecodable: boolean
}

/**
 * Convert every convertible legacy entry of `content` (see the module comment
 * for what "convertible" means), returning the rewritten content and a record
 * of what was converted and what was left alone.
 */
export function migrateLegacyChangelog(content: string, fallbackName: string): ChangelogMigration {
  const parsed = parseChangeSets(content, fallbackName)
  const skipped: ChangelogEntrySkip[] = []
  // Entries whose block held an undecodable line: the file-level `undecodable`
  // report already covers them, and their dropped line would otherwise make
  // them look legacy (every line dropped) or desynchronized (some dropped).
  const undecodableTimestamps = new Set(
    parsed.advisories
      .filter((advisory) => advisory.kind === 'invalid-event')
      .map((advisory) => advisory.timestamp),
  )
  const undecodable = undecodableTimestamps.size > 0
  let converted = 0
  const sets: ChangeSet[] = []
  for (const set of parsed.sets) {
    if (undecodableTimestamps.has(set.timestamp)) {
      sets.push(set)
      continue
    }
    if (isLegacyChangeSet(set)) {
      const { events, unparsedLines } = parseLegacyChangeLines(set.lines)
      if (unparsedLines.length > 0) {
        skipped.push({ timestamp: set.timestamp, reason: 'unparsed-lines', lines: unparsedLines })
        sets.push(set)
        continue
      }
      converted += 1
      sets.push({ ...set, events })
      continue
    }
    if (set.events.length !== set.lines.length) {
      skipped.push({ timestamp: set.timestamp, reason: 'desynchronized', lines: [] })
    }
    sets.push(set)
  }
  if (undecodable || converted === 0) {
    return { content, converted: 0, skipped, undecodable }
  }
  return {
    content: serializeChangeSets({ header: parsed.header, sets }),
    converted,
    skipped,
    undecodable,
  }
}
