/**
 * **Migration-only** parser for the legacy `.changes.md` prose format —
 * entries written before the fenced `ritual-changes` events block existed,
 * whose only record of each change is its `- ` line.
 *
 * The live reader (`changelog-parser.ts`) never parses prose: an entry without
 * a block yields zero events and an advisory. This module exists so `ritual
 * cleanup` can convert those entries once — reading each prose line back into
 * the {@link ChangeEvent} it rendered — and it is the ONLY caller besides its
 * own tests. **Delete this module (and its test) once every workspace has
 * been migrated.** Nothing new may depend on it.
 *
 * Legacy format (card names are written quoted; older unquoted lines are
 * still accepted):
 * ```
 * ## 2026-03-07T22:01:21.452Z
 *
 * - Added "Demonic Tutor" (UMA:75) [foil]
 * - Removed "Misty Rainforest"
 * - Added "Cavern-Hoard Dragon" to Maybeboard
 * - Set "Avacyn" as commander
 * ```
 *
 * What prose cannot carry, the events it yields lack: an add's `labels` and
 * `section`, a remove's `labels`, a move-to's `section` / `sourceCardId` /
 * `replacesCardId` / `replacement`; default values (`nonfoil`, `NM`, `en`,
 * `Main`) read as absent. Every event's `id` is `''` and `timestamp` is `0` —
 * the caller stamps them from the entry header if it needs them.
 *
 * **Persistence fence — this module must never import `src/i18n`.**
 */

import { isCardLanguage, normalizeLanguageValue, type CardLanguage } from '../card/card-language'
import { LABEL_TOKEN_PATTERN } from '../card/card-labels'
import { readCardId } from '../card/card-line-id'
import type { AddChange, ChangeEvent, ListRef } from './change-event'
import type { ListType } from '../list/list-type'
import type { Board } from '../list/deck'
import type { CardLabel } from '../card/card-labels'
import { isCondition, isFinish } from '../card/finish-condition'

/** The persisted verb vocabulary of a legacy prose line. */
type LegacyAction =
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

/** A legacy prose line decoded into loose fields, before it becomes a {@link ChangeEvent}. */
type LegacyLine = {
  action: LegacyAction
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

/**
 * Split a `SET:CN` group into its lowercased set code and collector number, or
 * null when the captured group is not one. On the unquoted legacy grammars the
 * `(...)` group is only a printing by convention — `Added Erase (Not the Urza's
 * Legacy One)` captures half a card name there — so an unreadable group fails
 * the line rather than silently dropping the text it held.
 */
function parseSetCn(setCn: string | undefined): Pick<LegacyLine, 'set' | 'collectorNumber'> | null {
  if (!setCn) return {}
  const parts = setCn.split(':')
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { set: parts[0].toLowerCase(), collectorNumber: parts[1] }
  }
  return null
}

/**
 * Parse one `- ` legacy line into its loose fields. Returns null for a line no
 * grammar accepts — callers keep those verbatim rather than dropping them.
 *
 * The `&N` is read here, off the line end, for every shape that writes it last.
 * The three grammars that write it mid-line — `Set note on "X" &5 to "…"`,
 * `Set labels on "X" &5 to […]`, and the cross-list `Moved "X" &5 to Deck '…'`
 * — capture it in their own regex instead, so a stray `&N` inside a note or a
 * list name (`to "see &5"`, both of which end in a quote, not the id) is never
 * mistaken for the line's id.
 */
function parseLegacyLine(line: string): LegacyLine | null {
  const change = parseChangeLineBody(line)
  if (!change || change.cardId !== undefined) return change
  const cardId = readCardId(line)
  return cardId === undefined ? change : { ...change, cardId }
}

function parseChangeLineBody(line: string): LegacyLine | null {
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
    const printing = parseSetCn(setCn)
    if (!printing) return null
    return {
      action: direction === 'to' ? 'Moved to list' : 'Moved from list',
      cardName: stripQuotes(rawCardName),
      cardId: parseOptionalId(rawCardId),
      ...printing,
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
  let resolvedAction: LegacyAction | undefined

  // Handle "Set X as commander" / "Unset X as commander" / "Set X finish to foil"
  if (action === 'Set' || action === 'Unset') {
    const asCommander = rawCardName.match(/^(.+?)\s+as\s+commander$/i)
    if (asCommander?.[1]) {
      const changeAction = action === 'Unset' ? 'Unset as commander' : 'Set as commander'
      return { action: changeAction, cardName: stripQuotes(asCommander[1]) }
    }
    if (action === 'Set') {
      const finishMatch = rawCardName.match(/^(.+?)\s+finish\s+to\s+(\w+)$/i)
      if (finishMatch?.[1] && isFinish(finishMatch[2])) {
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
  const printing = parseSetCn(setCn)
  if (!printing) return null

  return {
    action: resolvedAction,
    cardName,
    ...printing,
    ...classifyBracketTokens([bracket1, bracket2, bracket3]),
    board: normalizedBoard,
  }
}

/** Placeholder envelope: the caller stamps `id` / `timestamp` from the entry header if it needs them. */
const LEGACY_ENVELOPE = { id: '', timestamp: 0 } as const

/** The printing tuple of an event, narrowed to its vocabularies. */
type LegacyPrinting = Pick<
  AddChange,
  'set' | 'collectorNumber' | 'finish' | 'condition' | 'language'
>

/** A loose line's card identity: its name and, when the line carried one, its `&N`. */
type LegacyCard = Pick<AddChange, 'cardName' | 'cardId'>

/** The printing fields a loose line carries, narrowed to their vocabularies (validated by the classifiers above). */
function printingOf(line: LegacyLine): LegacyPrinting {
  return {
    ...(line.set !== undefined ? { set: line.set } : {}),
    ...(line.collectorNumber !== undefined ? { collectorNumber: line.collectorNumber } : {}),
    ...(isFinish(line.finish) ? { finish: line.finish } : {}),
    ...(isCondition(line.condition) ? { condition: line.condition } : {}),
    ...(line.language !== undefined ? { language: line.language } : {}),
  }
}

function cardOf(line: LegacyLine): LegacyCard {
  return {
    cardName: line.cardName,
    ...(line.cardId !== undefined ? { cardId: line.cardId } : {}),
  }
}

/**
 * Parse one legacy `- ` prose line into the {@link ChangeEvent} it rendered, or
 * null when no grammar accepts it. The event's `id` is `''` and `timestamp` `0`.
 */
export function parseLegacyChangeLine(rawLine: string): ChangeEvent | null {
  const line = parseLegacyLine(rawLine)
  if (!line) return null
  const card = cardOf(line)
  switch (line.action) {
    case 'Added':
    case 'Removed': {
      // The board alternation in CHANGE_LINE_REGEX is the Board vocabulary.
      const board = line.board !== undefined ? { board: line.board as Board } : {}
      const fields = { ...LEGACY_ENVELOPE, ...card, ...printingOf(line), ...board }
      return line.action === 'Added'
        ? { ...fields, action: 'add' }
        : { ...fields, action: 'remove' }
    }
    case 'Set as commander':
      return { ...LEGACY_ENVELOPE, action: 'set-commander', ...card }
    case 'Unset as commander':
      return { ...LEGACY_ENVELOPE, action: 'unset-commander', ...card }
    case 'Set finish':
      // The finish was validated by isFinish when the line matched.
      return isFinish(line.finish)
        ? { ...LEGACY_ENVELOPE, action: 'set-finish', ...card, finish: line.finish }
        : null
    case 'Set printing':
      return { ...LEGACY_ENVELOPE, action: 'set-printing', ...card, ...printingOf(line) }
    case 'Set language':
      return line.language !== undefined
        ? { ...LEGACY_ENVELOPE, action: 'set-language', ...card, language: line.language }
        : null
    case 'Set note':
      return { ...LEGACY_ENVELOPE, action: 'set-note', ...card, note: line.note ?? '' }
    case 'Cleared note':
      return { ...LEGACY_ENVELOPE, action: 'set-note', ...card, note: '' }
    case 'Set labels':
      // SET_LABELS_LINE_REGEX is built from the CardLabel vocabulary.
      return {
        ...LEGACY_ENVELOPE,
        action: 'set-label',
        ...card,
        labels: (line.labels ?? []) as CardLabel[],
      }
    case 'Cleared labels':
      return { ...LEGACY_ENVELOPE, action: 'set-label', ...card, labels: [] }
    case 'Added section':
      return { ...LEGACY_ENVELOPE, action: 'add-section', section: line.section ?? '' }
    case 'Removed section':
      return { ...LEGACY_ENVELOPE, action: 'remove-section', section: line.section ?? '' }
    case 'Renamed section':
      return {
        ...LEGACY_ENVELOPE,
        action: 'rename-section',
        section: line.section ?? '',
        newSection: line.newSection ?? '',
      }
    case 'Moved to section':
      return { ...LEGACY_ENVELOPE, action: 'set-section', ...card, section: line.section ?? '' }
    case 'Moved to list':
      return line.to
        ? { ...LEGACY_ENVELOPE, action: 'move-from', ...card, ...printingOf(line), to: line.to }
        : null
    case 'Moved from list':
      return line.from
        ? { ...LEGACY_ENVELOPE, action: 'move-to', ...card, ...printingOf(line), from: line.from }
        : null
    default:
      line.action satisfies never
      return null
  }
}

/** What a legacy entry's prose converted to: its events, and the lines no grammar accepted. */
export type LegacyParseResult = {
  /** One event per parsed line, in line order. */
  events: ChangeEvent[]
  /** The `- ` lines no grammar accepted, verbatim, in line order. */
  unparsedLines: string[]
}

/**
 * Convert a legacy entry's prose `- ` lines into events. A line that parses
 * contributes an event; one that does not is returned verbatim so the
 * migration can leave the entry alone (and say why) rather than convert it
 * partially.
 */
export function parseLegacyChangeLines(lines: readonly string[]): LegacyParseResult {
  const events: ChangeEvent[] = []
  const unparsedLines: string[] = []
  for (const line of lines) {
    const event = parseLegacyChangeLine(line)
    if (event) events.push(event)
    else unparsedLines.push(line)
  }
  return { events, unparsedLines }
}
