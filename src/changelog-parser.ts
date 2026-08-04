/**
 * Parser for `.changes.md` changelog files.
 *
 * Changelog format (card names are written quoted; legacy unquoted lines are still
 * accepted on read):
 * ```
 * # Changelog for Deck Name
 *
 * ## 2026-03-07T22:01:21.452Z
 *
 * - Added "Demonic Tutor" (UMA:75) [foil]
 * - Removed "Misty Rainforest"
 * - Added "Cavern-Hoard Dragon" to Maybeboard
 * - Set "Avacyn" as commander
 * ```
 */

export type ChangelogAction =
  | 'Added'
  | 'Removed'
  | 'Set as commander'
  | 'Unset as commander'
  | 'Set finish'
  | 'Set printing'
  | 'Set note'
  | 'Cleared note'
  | 'Set labels'
  | 'Cleared labels'
  | 'Added section'
  | 'Removed section'
  | 'Renamed section'
  | 'Moved to section'

export type ChangelogChange = {
  action: ChangelogAction
  cardName: string
  set?: string
  collectorNumber?: string
  finish?: string
  condition?: string
  note?: string
  /** Label tokens for `Set labels` lines (loose strings, like `finish`). */
  labels?: string[]
  /** Deck board for add/remove lines that target a non-main board (e.g. `Sideboard`). */
  board?: string
  /** Section name for section-structural lines (add/remove/rename section, move to section). */
  section?: string
  /** New section name for `Renamed section "X" to "Y"` lines. */
  newSection?: string
}

export type ChangelogPage = {
  timestamp: string
  changes: ChangelogChange[]
}

// The board alternation must stay in sync with `BOARDS` in `types.ts`.
const CHANGE_LINE_REGEX =
  /^-\s+(Added|Removed|Set|Unset)\s+(.+?)(?:\s+\(([^)]+)\))?(?:\s+\[([^\]]+)\])?(?:\s+\[([^\]]+)\])?(?:\s+(?:to|from)\s+(Commander|Main|Sideboard|Maybeboard))?(?:\s+&\d+)?\s*$/

/**
 * Matches `Set note on Card Name &5 to "the note text"`. Card-name group is non-greedy
 * so the optional `&N` is captured separately. The note recovery regex relies on the
 * line ending exactly with `"` — never append trailing content (timestamps, tags) after
 * the closing quote in changelog writers, or the greedy `(.*)"` will overshoot.
 */
const SET_NOTE_LINE_REGEX = /^-\s+Set\s+note\s+on\s+(.+?)(?:\s+&\d+)?\s+to\s+"(.*)"\s*$/
/** Matches `Cleared note on Card Name &5`. */
const CLEARED_NOTE_LINE_REGEX = /^-\s+Cleared\s+note\s+on\s+(.+?)(?:\s+&\d+)?\s*$/
/**
 * Matches `Set labels on "Card Name" &5 to [sale,trade]`. The bracketed token
 * body is the canonical card-line vocabulary, so the alternation mirrors it.
 */
const SET_LABELS_LINE_REGEX =
  /^-\s+Set\s+labels\s+on\s+(.+?)(?:\s+&\d+)?\s+to\s+\[((?:sale|trade|keep)(?:,(?:sale|trade|keep))*)\]\s*$/
/** Matches `Cleared labels on "Card Name" &5`. */
const CLEARED_LABELS_LINE_REGEX = /^-\s+Cleared\s+labels\s+on\s+(.+?)(?:\s+&\d+)?\s*$/
/**
 * Matches `Set "Card Name" printing to M10:146 [foil] [LP] &5` and
 * `Set "Card Name" printing to no specific printing &5`. Card-name group is
 * non-greedy so the trailing `&N` and the printing descriptor are captured separately.
 */
const SET_PRINTING_LINE_REGEX = /^-\s+Set\s+(.+?)\s+printing\s+to\s+(.+?)(?:\s+&\d+)?\s*$/
/** Matches the `SET:CN [finish] [condition]` descriptor inside a set-printing line. */
const PRINTING_DESCRIPTOR_REGEX = /^([^\s:]+):([^\s[]+)((?:\s*\[[^\]]+\])*)\s*$/

/** Matches `Added section "X"` / `Removed section "X"`. */
const SECTION_ADD_REMOVE_LINE_REGEX = /^-\s+(Added|Removed)\s+section\s+"(.*)"\s*$/
/** Matches `Renamed section "X" to "Y"`. Both names are quoted; groups are non-greedy. */
const SECTION_RENAME_LINE_REGEX = /^-\s+Renamed\s+section\s+"(.*?)"\s+to\s+"(.*)"\s*$/
/** Matches `Moved "Card Name" to section "X" &5`. Card name is non-greedy so `&N` is separate. */
const MOVE_TO_SECTION_LINE_REGEX = /^-\s+Moved\s+(.+?)\s+to\s+section\s+"(.*)"(?:\s+&\d+)?\s*$/

const FINISH_VALUES = new Set(['foil', 'nonfoil', 'etched'])
const CONDITION_VALUES = new Set(['NM', 'LP', 'MP', 'HP', 'DMG'])

/**
 * Strip the surrounding double quotes the writer wraps card names in. Legacy lines
 * predate quoting, so an unquoted name is returned unchanged — every card name is
 * normalized through here regardless of whether the source file used quotes.
 */
function stripQuotes(name: string): string {
  const match = name.match(/^"(.*)"$/s)
  return match?.[1] ?? name
}

export function parseChangeLine(line: string): ChangelogChange | null {
  // Section-structural lines carry the literal word `section` and quoted section names that the
  // generic add/remove/move regexes would misread as a card name — match them directly first.
  const sectionAddRemove = line.match(SECTION_ADD_REMOVE_LINE_REGEX)
  if (sectionAddRemove?.[1] && sectionAddRemove[2] !== undefined) {
    const action = sectionAddRemove[1] === 'Added' ? 'Added section' : 'Removed section'
    return { action, cardName: '', section: sectionAddRemove[2] }
  }
  const sectionRename = line.match(SECTION_RENAME_LINE_REGEX)
  if (sectionRename?.[1] !== undefined && sectionRename[2] !== undefined) {
    return {
      action: 'Renamed section',
      cardName: '',
      section: sectionRename[1],
      newSection: sectionRename[2],
    }
  }
  const moveToSection = line.match(MOVE_TO_SECTION_LINE_REGEX)
  if (moveToSection?.[1] && moveToSection[2] !== undefined) {
    return {
      action: 'Moved to section',
      cardName: stripQuotes(moveToSection[1]),
      section: moveToSection[2],
    }
  }

  // "Set note on X to ..." has free-form quoted content that the generic regex can't safely
  // strip — match it directly first so the card name is recovered cleanly.
  const setNote = line.match(SET_NOTE_LINE_REGEX)
  if (setNote?.[1] !== undefined && setNote[2] !== undefined) {
    return { action: 'Set note', cardName: stripQuotes(setNote[1]), note: setNote[2] }
  }
  const clearedNote = line.match(CLEARED_NOTE_LINE_REGEX)
  if (clearedNote?.[1]) {
    return { action: 'Cleared note', cardName: stripQuotes(clearedNote[1]) }
  }

  // "Set labels on X to [sale,trade]" carries a bracketed token the generic
  // regex would misread as a finish/condition — match it directly first.
  const setLabels = line.match(SET_LABELS_LINE_REGEX)
  if (setLabels?.[1] && setLabels[2]) {
    return {
      action: 'Set labels',
      cardName: stripQuotes(setLabels[1]),
      labels: setLabels[2].split(','),
    }
  }
  const clearedLabels = line.match(CLEARED_LABELS_LINE_REGEX)
  if (clearedLabels?.[1]) {
    return { action: 'Cleared labels', cardName: stripQuotes(clearedLabels[1]) }
  }

  // "Set X printing to ..." carries an unparenthesized `SET:CN` descriptor that the
  // generic regex (which expects `(SET:CN)`) can't read — match it directly first.
  const setPrinting = line.match(SET_PRINTING_LINE_REGEX)
  if (setPrinting?.[1] && setPrinting[2]) {
    const cardName = stripQuotes(setPrinting[1])
    const descriptor = setPrinting[2].trim()
    const printing = descriptor.match(PRINTING_DESCRIPTOR_REGEX)
    if (printing?.[1] && printing[2]) {
      let finish: string | undefined
      let condition: string | undefined
      for (const bracketMatch of (printing[3] ?? '').matchAll(/\[([^\]]+)\]/g)) {
        const value = bracketMatch[1]!
        if (FINISH_VALUES.has(value.toLowerCase())) finish = value.toLowerCase()
        else if (CONDITION_VALUES.has(value.toUpperCase())) condition = value.toUpperCase()
      }
      return {
        action: 'Set printing',
        cardName,
        set: printing[1].toLowerCase(),
        collectorNumber: printing[2],
        finish,
        condition,
      }
    }
    // The only valid descriptor without a SET:CN is the explicit name-only marker.
    if (descriptor === 'no specific printing') {
      return { action: 'Set printing', cardName }
    }
    // Any other descriptor is a malformed line — fail rather than silently
    // discarding the printing data it was meant to carry.
    return null
  }

  const match = line.match(CHANGE_LINE_REGEX)
  if (!match) return null

  const [, action, rawCardName, setCn, bracket1, bracket2, board] = match
  if (!action || !rawCardName) return null

  let cardName = stripQuotes(rawCardName)
  let resolvedAction: ChangelogAction | undefined

  // Handle "Set X as commander" / "Unset X as commander" / "Set X finish to foil"
  if (action === 'Set' || action === 'Unset') {
    const asCommander = rawCardName.match(/^(.+?)\s+as\s+commander$/i)
    if (asCommander?.[1]) {
      const changeAction = action === 'Unset' ? 'Unset as commander' : 'Set as commander'
      return { action: changeAction, cardName: stripQuotes(asCommander[1]) }
    }
    if (action === 'Set') {
      const finishMatch = rawCardName.match(/^(.+?)\s+finish\s+to\s+(\w+)$/i)
      if (finishMatch?.[1] && finishMatch[2]) {
        return {
          action: 'Set finish',
          cardName: stripQuotes(finishMatch[1]),
          finish: finishMatch[2],
        }
      }
    }
    // Fallback: just use the raw name
    cardName = stripQuotes(rawCardName)
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

  const normalizedBoard = board && board.toLowerCase() !== 'main' ? board : undefined

  return {
    action: resolvedAction,
    cardName,
    set,
    collectorNumber,
    finish,
    condition,
    board: normalizedBoard,
  }
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
