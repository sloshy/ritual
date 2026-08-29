/**
 * Reader for `.changes.md` changelog files, for the surfaces that show history
 * (the public site's changelog modal, the site build's card-name collection,
 * the admin card-data loader).
 *
 * Changelog format — each entry is its prose lines, written for humans and
 * never re-read, followed by the fenced `ritual-changes` block that persists
 * the typed events (see `changelog-blocks.ts`, which owns the grammar):
 * ```
 * # Changelog for Deck Name
 *
 * ## 2026-03-07T22:01:21.452Z
 *
 * - Added "Demonic Tutor" (UMA:75) [foil] &3
 * - Removed "Misty Rainforest" &4
 *
 * ```ritual-changes
 * {"action":"add","cardName":"Demonic Tutor","cardId":3,"set":"uma","collectorNumber":"75","finish":"foil"}
 * {"action":"remove","cardName":"Misty Rainforest","cardId":4}
 * ```
 * ```
 *
 * The parser reads **only** the block. An entry without one (a legacy entry,
 * written before the block existed) yields zero events and one advisory —
 * there is no prose fallback; `ritual cleanup` converts such entries through
 * `changelog-legacy-parser.ts`.
 *
 * **Persistence fence — this module must never import `src/i18n`.**
 */

import type { ChangeEvent } from './change-event'
import { parseChangeSets, type ChangelogAdvisory } from './changelog-blocks'

export type { ChangelogAdvisory } from './changelog-blocks'

/** One timestamped entry's typed events. */
export type ChangelogPage = {
  timestamp: string
  changes: ChangeEvent[]
}

/** What {@link parseChangelog} reads: the pages plus what it could not read. */
export type ParsedChangelog = {
  /** Pages sorted most-recent-first. Entries that yielded no events are omitted. */
  pages: ChangelogPage[]
  /**
   * One advisory per legacy (block-less) entry and per undecodable block line.
   * Never silent: a writer/parser drift would otherwise render an emptier
   * history with no error. Small structured records (no raw content) so they
   * cost the baked site data nothing.
   */
  advisories: ChangelogAdvisory[]
}

/**
 * Parse a `.changes.md` file into structured changelog pages (most-recent-first),
 * reporting every entry whose events could not be read.
 */
export function parseChangelog(content: string): ParsedChangelog {
  const { sets, advisories } = parseChangeSets(content, '')
  const pages: ChangelogPage[] = []
  for (const set of sets) {
    if (set.events.length > 0) pages.push({ timestamp: set.timestamp, changes: set.events })
  }
  // Reverse so most recent is first (file appends newest at the bottom)
  pages.reverse()
  return { pages, advisories }
}

/**
 * Extract all unique card names referenced in a changelog. Section-structural
 * events name no card and contribute nothing.
 */
export function extractChangelogCardNames(pages: ChangelogPage[]): string[] {
  const names = new Set<string>()
  for (const page of pages) {
    for (const change of page.changes) {
      if ('cardName' in change) names.add(change.cardName)
    }
  }
  return Array.from(names)
}
