import fs from 'node:fs/promises'
import type { ChangeEvent } from './change-event'

/**
 * Format a single change event as a markdown changelog line.
 */
function formatChangelogLine(change: ChangeEvent): string {
  const idInfo = change.cardId !== undefined ? ` &${change.cardId}` : ''

  let desc = ''
  switch (change.action) {
    case 'add':
    case 'remove': {
      const printingInfo =
        change.set && change.collectorNumber
          ? ` (${change.set.toUpperCase()}:${change.collectorNumber})`
          : ''
      const finishInfo = change.finish && change.finish !== 'nonfoil' ? ` [${change.finish}]` : ''
      const conditionInfo =
        change.condition && change.condition !== 'NM' ? ` [${change.condition}]` : ''
      const verb = change.action === 'add' ? 'Added' : 'Removed'
      desc = `${verb} ${change.cardName}${printingInfo}${finishInfo}${conditionInfo}${idInfo}`
      break
    }
    case 'set-commander':
      desc = `Set ${change.cardName} as commander${idInfo}`
      break
    case 'unset-commander':
      desc = `Unset ${change.cardName} as commander${idInfo}`
      break
    case 'set-finish':
      desc = `Set ${change.cardName} finish to ${change.finish}${idInfo}`
      break
  }
  return `- ${desc}`
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
