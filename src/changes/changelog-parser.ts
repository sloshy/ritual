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

import { isCardLanguage, normalizeLanguageValue, type CardLanguage } from '../card/card-language'
import { LABEL_TOKEN_PATTERN } from '../card/card-labels'
import { readCardId } from '../card/card-line-id'
import type { ListRef } from './change-event'
import type { ListType } from '../list/list-type'

export type ChangelogAction =
  | 'Added'
  | 'Removed'
  | 'Set as commander'
  | 'Unset as commander'
  | 'Set finish'
  | 'Set printing'
  | 'Set language'
  | 'Set note'
  | 'Cleared note'
  | 'Set labels'
  | 'Cleared labels'
  | 'Added section'
  | 'Removed section'
  | 'Renamed section'
  | 'Moved to section'
  /** A cross-list move as the SOURCE list records it (`move-from`): `Moved "X" &5 to Deck 'Y'`. */
  | 'Moved to list'
  /** A cross-list move as the DESTINATION list records it (`move-to`): `Moved "X" &5 from Deck 'Y'`. */
  | 'Moved from list'

export type ChangelogChange = {
  action: ChangelogAction
  cardName: string
  /** The line's `&N`; absent on legacy lines and on the section-structural actions. */
  cardId?: number
  set?: string
  collectorNumber?: string
  finish?: string
  condition?: string
  /**
   * Language code for `Set language` lines and `[ja]`-annotated printing
   * descriptors. Unlike `finish` this is a narrowed {@link CardLanguage} —
   * both producers validate the code before assigning it. Absent means
   * English — `en` is never annotated.
   */
  language?: CardLanguage
  note?: string
  /** Label tokens for `Set labels` lines (loose strings, like `finish`). */
  labels?: string[]
  /** Deck board for add/remove lines that target a non-main board (e.g. `Sideboard`). */
  board?: string
  /** Section name for section-structural lines (add/remove/rename section, move to section). */
  section?: string
  /** New section name for `Renamed section "X" to "Y"` lines. */
  newSection?: string
  /** The destination list of a `Moved to list` line. */
  to?: ListRef
  /** The source list of a `Moved from list` line. */
  from?: ListRef
}

export type ChangelogPage = {
  timestamp: string
  changes: ChangelogChange[]
}

/** What {@link parseChangelog} reads: the pages plus an advisory count of the lines it could not. */
export type ParsedChangelog = {
  /** Pages sorted most-recent-first. */
  pages: ChangelogPage[]
  /**
   * How many `- ` lines matched no change grammar and were dropped. Never
   * silent: a writer/parser drift would otherwise render an emptier history
   * with no error. Kept as a count (not the raw lines) so it costs the baked
   * site data nothing.
   */
  unparsedLineCount: number
}

// The board alternation must stay in sync with `BOARDS` in `../list/deck.ts`. Three
// optional bracket groups: finish, condition, and language can all be
// annotated on one line (`(NEO:234) [foil] [LP] [ja]`); each token is
// classified by value-set membership, not position.
const CHANGE_LINE_REGEX =
  /^-\s+(Added|Removed|Set|Unset)\s+(.+?)(?:\s+\(([^)]+)\))?(?:\s+\[([^\]]+)\])?(?:\s+\[([^\]]+)\])?(?:\s+\[([^\]]+)\])?(?:\s+(?:to|from)\s+(Commander|Main|Sideboard|Maybeboard))?(?:\s+&\d+)?\s*$/

/**
 * Matches `Set note on Card Name &5 to "the note text"`. Card-name group is non-greedy
 * so the optional `&N` is captured separately. The note recovery regex relies on the
 * line ending exactly with `"` — never append trailing content (timestamps, tags) after
 * the closing quote in changelog writers, or the greedy `(.*)"` will overshoot.
 */
const SET_NOTE_LINE_REGEX = /^-\s+Set\s+note\s+on\s+(.+?)(?:\s+&(\d+))?\s+to\s+"(.*)"\s*$/
/** Matches `Cleared note on Card Name &5`. */
const CLEARED_NOTE_LINE_REGEX = /^-\s+Cleared\s+note\s+on\s+(.+?)(?:\s+&\d+)?\s*$/
/**
 * Matches `Set labels on "Card Name" &5 to [sale,trade]`. The bracketed token
 * body is the canonical card-line vocabulary, so the alternation mirrors it.
 */
const SET_LABELS_LINE_REGEX = new RegExp(
  `^-\\s+Set\\s+labels\\s+on\\s+(.+?)(?:\\s+&(\\d+))?\\s+to\\s+\\[(${LABEL_TOKEN_PATTERN}(?:,${LABEL_TOKEN_PATTERN})*)\\]\\s*$`,
)
/** Matches `Cleared labels on "Card Name" &5`. */
const CLEARED_LABELS_LINE_REGEX = /^-\s+Cleared\s+labels\s+on\s+(.+?)(?:\s+&\d+)?\s*$/
/**
 * Matches `Set "Card Name" printing to M10:146 [foil] [LP] &5` and
 * `Set "Card Name" printing to no specific printing &5`. Card-name group is
 * non-greedy so the trailing `&N` and the printing descriptor are captured separately.
 */
const SET_PRINTING_LINE_REGEX = /^-\s+Set\s+(.+?)\s+printing\s+to\s+(.+?)(?:\s+&\d+)?\s*$/
/**
 * Matches `Set language of "Card Name" to Japanese &5`. The card name is
 * anchored on the writer's quotes so a name containing ` to ` (`Ashes to
 * Ashes`) cannot split early; a legacy unquoted name falls back to a
 * non-greedy group. The language group is non-greedy so the trailing `&N`
 * stays separate; multi-word names (`Simplified Chinese`) still parse because
 * the language
 * group runs to the end of the line.
 */
const SET_LANGUAGE_LINE_REGEX =
  /^-\s+Set\s+language\s+of\s+(?:"([^"]*)"|(.+?))\s+to\s+(.+?)(?:\s+&\d+)?\s*$/
/** Matches the `SET:CN [finish] [condition]` descriptor inside a set-printing line. */
const PRINTING_DESCRIPTOR_REGEX = /^([^\s:]+):([^\s[]+)((?:\s*\[[^\]]+\])*)\s*$/

/** Matches `Added section "X"` / `Removed section "X"`. */
const SECTION_ADD_REMOVE_LINE_REGEX = /^-\s+(Added|Removed)\s+section\s+"(.*)"\s*$/
/** Matches `Renamed section "X" to "Y"`. Both names are quoted; groups are non-greedy. */
const SECTION_RENAME_LINE_REGEX = /^-\s+Renamed\s+section\s+"(.*?)"\s+to\s+"(.*)"\s*$/
/** Matches `Moved "Card Name" to section "X" &5`. Card name is non-greedy so `&N` is separate. */
const MOVE_TO_SECTION_LINE_REGEX = /^-\s+Moved\s+(.+?)\s+to\s+section\s+"(.*)"(?:\s+&\d+)?\s*$/
/**
 * Matches the cross-list move lines `formatChangeCore` writes for `move-from` /
 * `move-to`: `Moved "Card Name" (SET:CN) [foil] [LP] [ja] &5 to Deck 'Burn'` and
 * `Moved "Card Name" &5 from Collection 'Main'`. Same printing/bracket tail as
 * {@link CHANGE_LINE_REGEX}; the `&N` sits BEFORE the list reference (unlike
 * every other line, where it is last), so it is captured here rather than read
 * off the line end. The list name is greedy inside the quotes because names
 * may contain apostrophes (`Deck 'Ryan's Burn'`). Must be tried AFTER
 * {@link MOVE_TO_SECTION_LINE_REGEX}: both start with `Moved`, and only the
 * section form ends with `"` (or `&N`) rather than `'`.
 */
const CROSS_LIST_MOVE_LINE_REGEX =
  /^-\s+Moved\s+(.+?)(?:\s+\(([^)]+)\))?(?:\s+\[([^\]]+)\])?(?:\s+\[([^\]]+)\])?(?:\s+\[([^\]]+)\])?(?:\s+&(\d+))?\s+(to|from)\s+(Deck|Collection|Wanted list)\s+'(.*)'\s*$/

/** The list-type word `listRefLabel` writes, back to its {@link ListType}. */
const LIST_TYPE_BY_LABEL: Record<string, ListType> = {
  Deck: 'deck',
  Collection: 'collection',
  'Wanted list': 'wanted',
}

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

/** The finish / condition / language a line's bracketed tokens carry, classified by value set. */
type BracketTokens = {
  finish?: string
  condition?: string
  language?: CardLanguage
}

/**
 * Classify bracketed tokens by value-set membership, not position: finish,
 * condition and language can all be annotated on one line in any order.
 */
function classifyBracketTokens(tokens: readonly (string | undefined)[]): BracketTokens {
  const result: BracketTokens = {}
  for (const token of tokens) {
    if (!token) continue
    const lower = token.toLowerCase()
    if (FINISH_VALUES.has(lower)) result.finish = lower
    else if (CONDITION_VALUES.has(token.toUpperCase())) result.condition = token.toUpperCase()
    else if (isCardLanguage(lower)) result.language = lower
  }
  return result
}

/** The digits of a captured `&N` group, or undefined when the line carried none. */
function parseOptionalId(digits: string | undefined): number | undefined {
  return digits === undefined ? undefined : Number.parseInt(digits, 10)
}

/** Split a `SET:CN` group into its lowercased set code and collector number. */
function parseSetCn(setCn: string | undefined): Pick<ChangelogChange, 'set' | 'collectorNumber'> {
  if (!setCn) return {}
  const parts = setCn.split(':')
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { set: parts[0].toLowerCase(), collectorNumber: parts[1] }
  }
  return {}
}

/**
 * Parse one `- ` changelog line. Returns null for a line no grammar accepts —
 * callers count those rather than dropping them silently (see
 * {@link ParsedChangelog.unparsedLineCount}).
 *
 * The `&N` is read here, off the line end, for every shape that writes it last.
 * The three grammars that write it mid-line — `Set note on "X" &5 to "…"`,
 * `Set labels on "X" &5 to […]`, and the cross-list `Moved "X" &5 to Deck '…'`
 * — capture it in their own regex instead, so a stray `&N` inside a note or a
 * list name (`to "see &5"`, both of which end in a quote, not the id) is never
 * mistaken for the line's id.
 */
export function parseChangeLine(line: string): ChangelogChange | null {
  const change = parseChangeLineBody(line)
  if (!change || change.cardId !== undefined) return change
  const cardId = readCardId(line)
  return cardId === undefined ? change : { ...change, cardId }
}

function parseChangeLineBody(line: string): ChangelogChange | null {
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
  const crossListMove = line.match(CROSS_LIST_MOVE_LINE_REGEX)
  if (crossListMove) {
    const [
      ,
      rawCardName,
      setCn,
      bracket1,
      bracket2,
      bracket3,
      rawCardId,
      direction,
      typeLabel,
      listName,
    ] = crossListMove
    const type = typeLabel !== undefined ? LIST_TYPE_BY_LABEL[typeLabel] : undefined
    if (!rawCardName || !type || listName === undefined) return null
    const ref: ListRef = { type, name: listName }
    return {
      action: direction === 'to' ? 'Moved to list' : 'Moved from list',
      cardName: stripQuotes(rawCardName),
      cardId: parseOptionalId(rawCardId),
      ...parseSetCn(setCn),
      ...classifyBracketTokens([bracket1, bracket2, bracket3]),
      ...(direction === 'to' ? { to: ref } : { from: ref }),
    }
  }

  // "Set note on X to ..." has free-form quoted content that the generic regex can't safely
  // strip — match it directly first so the card name is recovered cleanly.
  const setNote = line.match(SET_NOTE_LINE_REGEX)
  if (setNote?.[1] !== undefined && setNote[3] !== undefined) {
    return {
      action: 'Set note',
      cardName: stripQuotes(setNote[1]),
      cardId: parseOptionalId(setNote[2]),
      note: setNote[3],
    }
  }
  const clearedNote = line.match(CLEARED_NOTE_LINE_REGEX)
  if (clearedNote?.[1]) {
    return { action: 'Cleared note', cardName: stripQuotes(clearedNote[1]) }
  }

  // "Set labels on X to [sale,trade]" carries a bracketed token the generic
  // regex would misread as a finish/condition — match it directly first.
  const setLabels = line.match(SET_LABELS_LINE_REGEX)
  if (setLabels?.[1] && setLabels[3]) {
    return {
      action: 'Set labels',
      cardName: stripQuotes(setLabels[1]),
      cardId: parseOptionalId(setLabels[2]),
      labels: setLabels[3].split(','),
    }
  }
  const clearedLabels = line.match(CLEARED_LABELS_LINE_REGEX)
  if (clearedLabels?.[1]) {
    return { action: 'Cleared labels', cardName: stripQuotes(clearedLabels[1]) }
  }

  // "Set language of X to Japanese" carries a free-form language name the
  // generic regex would misread as part of the card name — match it directly first.
  const setLanguage = line.match(SET_LANGUAGE_LINE_REGEX)
  if (setLanguage) {
    // The quoted alternative captures the name unwrapped; the legacy unquoted
    // fallback still normalizes through stripQuotes.
    const cardName = setLanguage[1] ?? stripQuotes(setLanguage[2] ?? '')
    const language = setLanguage[3] !== undefined ? normalizeLanguageValue(setLanguage[3]) : null
    // A descriptor naming no known language is a malformed line — fail rather
    // than silently discarding the language the line was meant to carry.
    if (language === null) return null
    return { action: 'Set language', cardName, language }
  }

  // "Set X printing to ..." carries an unparenthesized `SET:CN` descriptor that the
  // generic regex (which expects `(SET:CN)`) can't read — match it directly first.
  const setPrinting = line.match(SET_PRINTING_LINE_REGEX)
  if (setPrinting?.[1] && setPrinting[2]) {
    const cardName = stripQuotes(setPrinting[1])
    const descriptor = setPrinting[2].trim()
    const printing = descriptor.match(PRINTING_DESCRIPTOR_REGEX)
    if (printing?.[1] && printing[2]) {
      const tokens = Array.from(
        (printing[3] ?? '').matchAll(/\[([^\]]+)\]/g),
        (bracketMatch) => bracketMatch[1],
      )
      return {
        action: 'Set printing',
        cardName,
        set: printing[1].toLowerCase(),
        collectorNumber: printing[2],
        ...classifyBracketTokens(tokens),
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

  const [, action, rawCardName, setCn, bracket1, bracket2, bracket3, board] = match
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

  const normalizedBoard = board && board.toLowerCase() !== 'main' ? board : undefined

  return {
    action: resolvedAction,
    cardName,
    ...parseSetCn(setCn),
    ...classifyBracketTokens([bracket1, bracket2, bracket3]),
    board: normalizedBoard,
  }
}

/**
 * Parse a `.changes.md` file into structured changelog pages (most-recent-first),
 * counting every `- ` line no grammar accepted so a drift between writer and
 * parser can never shrink a history invisibly.
 */
export function parseChangelog(content: string): ParsedChangelog {
  const lines = content.split('\n')
  const pages: ChangelogPage[] = []
  let currentPage: ChangelogPage | null = null
  let unparsedLineCount = 0

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
    if (trimmed.startsWith('- ')) {
      const change = currentPage ? parseChangeLine(trimmed) : null
      if (change && currentPage) currentPage.changes.push(change)
      else unparsedLineCount++
    }
  }

  // Push final page
  if (currentPage && currentPage.changes.length > 0) {
    pages.push(currentPage)
  }

  // Reverse so most recent is first (file appends newest at the bottom)
  pages.reverse()
  return { pages, unparsedLineCount }
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
