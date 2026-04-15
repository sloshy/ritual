/**
 * Parser for `.changes.md` changelog files.
 *
 * Changelog format:
 * ```
 * # Changelog for Deck Name
 *
 * ## 2026-03-07T22:01:21.452Z
 *
 * - Added Demonic Tutor (UMA:75) [foil]
 * - Removed Misty Rainforest
 * - Set Avacyn as commander
 * ```
 */

export type ChangelogAction =
  | 'Added'
  | 'Removed'
  | 'Set as commander'
  | 'Unset as commander'
  | 'Set finish'

export type ChangelogChange = {
  action: ChangelogAction
  cardName: string
  set?: string
  collectorNumber?: string
  finish?: string
  condition?: string
}

export type ChangelogPage = {
  timestamp: string
  changes: ChangelogChange[]
}

const CHANGE_LINE_REGEX =
  /^-\s+(Added|Removed|Set|Unset)\s+(.+?)(?:\s+\(([^)]+)\))?(?:\s+\[([^\]]+)\])?(?:\s+\[([^\]]+)\])?(?:\s+&\d+)?\s*$/

const FINISH_VALUES = new Set(['foil', 'nonfoil', 'etched'])
const CONDITION_VALUES = new Set(['NM', 'LP', 'MP', 'HP', 'DMG'])

function parseChangeLine(line: string): ChangelogChange | null {
  const match = line.match(CHANGE_LINE_REGEX)
  if (!match) return null

  const [, action, rawCardName, setCn, bracket1, bracket2] = match
  if (!action || !rawCardName) return null

  let cardName = rawCardName
  let resolvedAction: ChangelogAction | undefined

  // Handle "Set X as commander" / "Unset X as commander" / "Set X finish to foil"
  if (action === 'Set' || action === 'Unset') {
    const asCommander = rawCardName.match(/^(.+?)\s+as\s+commander$/i)
    if (asCommander?.[1]) {
      const changeAction = action === 'Unset' ? 'Unset as commander' : 'Set as commander'
      return { action: changeAction, cardName: asCommander[1] }
    }
    if (action === 'Set') {
      const finishMatch = rawCardName.match(/^(.+?)\s+finish\s+to\s+(\w+)$/i)
      if (finishMatch?.[1] && finishMatch[2]) {
        return { action: 'Set finish', cardName: finishMatch[1], finish: finishMatch[2] }
      }
    }
    // Fallback: just use the raw name
    cardName = rawCardName
  }

  if (action === 'Added') resolvedAction = 'Added'
  else if (action === 'Removed') resolvedAction = 'Removed'
  if (!resolvedAction) return null

  let set: string | undefined
  let collectorNumber: string | undefined
  if (setCn) {
    const parts = setCn.split(':')
    if (parts.length === 2 && parts[0] && parts[1]) {
      set = parts[0].toLowerCase()
      collectorNumber = parts[1]
    }
  }

  let finish: string | undefined
  let condition: string | undefined

  for (const bracket of [bracket1, bracket2]) {
    if (!bracket) continue
    if (FINISH_VALUES.has(bracket.toLowerCase())) {
      finish = bracket.toLowerCase()
    } else if (CONDITION_VALUES.has(bracket.toUpperCase())) {
      condition = bracket.toUpperCase()
    }
  }

  return { action: resolvedAction, cardName, set, collectorNumber, finish, condition }
}

/**
 * Parse a `.changes.md` file into structured changelog pages.
 * Returns pages sorted most-recent-first.
 */
export function parseChangelog(content: string): ChangelogPage[] {
  const lines = content.split('\n')
  const pages: ChangelogPage[] = []
  let currentPage: ChangelogPage | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    // Timestamp header: ## 2026-03-07T22:01:21.452Z
    if (trimmed.startsWith('## ')) {
      const timestamp = trimmed.slice(3).trim()
      if (currentPage && currentPage.changes.length > 0) {
        pages.push(currentPage)
      }
      currentPage = { timestamp, changes: [] }
      continue
    }

    // Change line: - Added/Removed/Set ...
    if (trimmed.startsWith('- ') && currentPage) {
      const change = parseChangeLine(trimmed)
      if (change) {
        currentPage.changes.push(change)
      }
    }
  }

  // Push final page
  if (currentPage && currentPage.changes.length > 0) {
    pages.push(currentPage)
  }

  // Reverse so most recent is first (file appends newest at the bottom)
  pages.reverse()
  return pages
}

/**
 * Extract all unique card names referenced in a changelog.
 */
export function extractChangelogCardNames(pages: ChangelogPage[]): string[] {
  const names = new Set<string>()
  for (const page of pages) {
    for (const change of page.changes) {
      names.add(change.cardName)
    }
  }
  return Array.from(names)
}
