import fs from 'node:fs/promises'
import type { ChangeEvent } from './change-event'
import { formatChangeCore } from './change-event'

/**
 * Format a single change event as a markdown changelog line.
 */
function formatChangelogLine(change: ChangeEvent): string {
  return `- ${formatChangeCore(change, { tense: 'past' })}`
}

/**
 * Append change events to a `.changes.md` changelog file.
 *
 * Derives the changelog path from the entity's main `.md` file path.
 * Creates the changelog file with a header if it doesn't exist yet.
 *
 * @returns The path to the changelog file (for auto-commit use).
 */
export async function appendChangelog(
  filePath: string,
  entityName: string,
  changes: ChangeEvent[],
): Promise<string> {
  const changelogPath = filePath.replace(/\.md$/, '.changes.md')

  if (changes.length === 0) return changelogPath

  const timestamp = new Date().toISOString()
  const changeLines = changes.map(formatChangelogLine)
  const changelogEntry = `\n## ${timestamp}\n\n${changeLines.join('\n')}\n`

  let existingContent = ''
  try {
    existingContent = await fs.readFile(changelogPath, 'utf-8')
  } catch {
    existingContent = `# Changelog for ${entityName}\n`
  }

  await fs.writeFile(changelogPath, existingContent + changelogEntry)
  return changelogPath
}
