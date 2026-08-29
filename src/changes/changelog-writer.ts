import fs from 'node:fs/promises'
import type { ChangeEvent } from './change-event'
import {
  changeSetFromEvents,
  isLegacyChangeSet,
  parseChangeSets,
  serializeChangeSet,
  type ChangeSet,
} from './changelog-blocks'
import { createFenceTracker } from '../list/markdown-fence'

/** Options controlling how {@link appendChangelog} writes a block. */
export type AppendChangelogOptions = {
  /**
   * When true and the changelog already ends with a block, merge the new change
   * lines into that last block and bump its timestamp instead of starting a new
   * one. Used to group every save within a single editing session under one
   * changelog entry. The caller must guarantee the last block belongs to the
   * current session (the CLI owns the file for its whole session; the admin
   * editor relies on its content-hash baseline to prove the file is unchanged
   * since this session's previous save).
   */
  continueSession?: boolean
}

/** The changelog split at its final `## ` header: everything before it, and that entry parsed. */
type LastEntry = {
  /** The file content up to (not including) the newline that precedes the final header. */
  preceding: string
  /** The final entry, or null when the file has no `## ` header. */
  set: ChangeSet | null
}

/**
 * Split the changelog at its final `## ` header. Fence-aware: a `## ` inside a
 * fenced block (the events block cannot hold one, but a user's own code block
 * can) is content, not a header.
 */
function lastEntry(content: string): LastEntry {
  const lines = content.split('\n')
  const fence = createFenceTracker()
  let headerIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const state = fence.feed(lines[i]!)
    if (!state.opaque && /^##\s+/.test(lines[i]!.trim())) headerIndex = i
  }
  if (headerIndex === -1) return { preceding: content, set: null }
  const preceding = lines.slice(0, headerIndex).join('\n')
  const set = parseChangeSets(lines.slice(headerIndex).join('\n'), '').sets[0] ?? null
  return { preceding, set }
}

/**
 * Append change events to a `.changes.md` changelog file.
 *
 * Derives the changelog path from the entity's main `.md` file path.
 * Creates the changelog file with a header if it doesn't exist yet. Each entry
 * carries its prose `- ` lines followed by the fenced `ritual-changes` block
 * that persists the typed events (see `changelog-blocks.ts`).
 *
 * With `continueSession`, a follow-up save merges into the most recent block
 * (appending its lines and events in lockstep and refreshing the timestamp) so
 * repeated saves in one editing session form a single changelog entry rather
 * than many. A legacy final entry (prose with no events block) is never merged
 * into — its prose and the new events could not be paired — so the new
 * changes open a fresh entry beneath it instead.
 *
 * @returns The path to the changelog file (for auto-commit use).
 */
export async function appendChangelog(
  filePath: string,
  entityName: string,
  changes: readonly ChangeEvent[],
  options: AppendChangelogOptions = {},
): Promise<string> {
  const changelogPath = filePath.replace(/\.md$/, '.changes.md')

  if (changes.length === 0) return changelogPath

  const timestamp = new Date().toISOString()
  const fresh = changeSetFromEvents(timestamp, changes)

  let existingContent: string | null
  try {
    existingContent = await fs.readFile(changelogPath, 'utf-8')
  } catch {
    existingContent = null
  }

  if (options.continueSession && existingContent) {
    const { preceding, set } = lastEntry(existingContent)
    if (set && !isLegacyChangeSet(set) && set.events.length === set.lines.length) {
      // Rewrite the final block in place: keep its prior lines and events,
      // append the new ones, and bump the header timestamp to now. Hand-written
      // prose in the block survives, re-emitted after the merged events block
      // (the same placement the history editor's `trailing` preservation uses).
      const merged: ChangeSet = {
        timestamp,
        lines: [...set.lines, ...fresh.lines],
        events: [...set.events, ...fresh.events],
        ...(set.trailing !== undefined ? { trailing: set.trailing } : {}),
      }
      await fs.writeFile(changelogPath, preceding + serializeChangeSet(merged))
      return changelogPath
    }
  }

  const baseContent = existingContent ?? `# Changelog for ${entityName}\n`
  await fs.writeFile(changelogPath, baseContent + serializeChangeSet(fresh))
  return changelogPath
}
