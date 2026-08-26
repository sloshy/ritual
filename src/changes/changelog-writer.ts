import fs from 'node:fs/promises'
import type { ChangeEvent } from './change-event'
import { formatChangeCore } from './change-event'

/**
 * Format a single change event as a markdown changelog line.
 */
function formatChangelogLine(change: ChangeEvent): string {
  return `- ${formatChangeCore(change, { tense: 'past', quoteCardName: true })}`
}

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

/** The final block's `- ` change lines and its other non-blank (prose) lines. */
type LastBlockContent = {
  changeLines: string[]
  /** Hand-written non-change lines — preserved, re-emitted after the change lines. */
  proseLines: string[]
}

/** Split the changelog's final block into change lines and preserved prose. */
function lastBlockContent(content: string): LastBlockContent {
  const headerIndex = content.lastIndexOf('\n## ')
  if (headerIndex === -1) return { changeLines: [], proseLines: [] }
  const changeLines: string[] = []
  const proseLines: string[] = []
  // Skip the `## ` header itself (the first line of the slice).
  for (const line of content.slice(headerIndex).split('\n').slice(1)) {
    if (line.startsWith('- ')) changeLines.push(line)
    else if (line.trim() !== '' && !line.trim().startsWith('## ')) proseLines.push(line)
  }
  return { changeLines, proseLines }
}

/**
 * Append change events to a `.changes.md` changelog file.
 *
 * Derives the changelog path from the entity's main `.md` file path.
 * Creates the changelog file with a header if it doesn't exist yet.
 *
 * With `continueSession`, a follow-up save merges into the most recent block
 * (appending its lines and refreshing the timestamp) so repeated saves in one
 * editing session form a single changelog entry rather than many.
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
  const changeLines = changes.map(formatChangelogLine)

  let existingContent: string | null
  try {
    existingContent = await fs.readFile(changelogPath, 'utf-8')
  } catch {
    existingContent = null
  }

  if (options.continueSession && existingContent) {
    const headerIndex = existingContent.lastIndexOf('\n## ')
    if (headerIndex !== -1) {
      // Rewrite the final block in place: keep its prior lines, append the new
      // ones, and bump the header timestamp to now. Hand-written prose in the
      // block survives, re-emitted after the merged change lines (the same
      // placement the history editor's `trailing` preservation uses).
      const preceding = existingContent.slice(0, headerIndex)
      const { changeLines: priorLines, proseLines } = lastBlockContent(existingContent)
      const mergedLines = [...priorLines, ...changeLines]
      const proseBlock = proseLines.length > 0 ? `\n${proseLines.join('\n')}\n` : ''
      const mergedBlock = `\n## ${timestamp}\n\n${mergedLines.join('\n')}\n${proseBlock}`
      await fs.writeFile(changelogPath, preceding + mergedBlock)
      return changelogPath
    }
  }

  const baseContent = existingContent ?? `# Changelog for ${entityName}\n`
  const changelogEntry = `\n## ${timestamp}\n\n${changeLines.join('\n')}\n`
  await fs.writeFile(changelogPath, baseContent + changelogEntry)
  return changelogPath
}
