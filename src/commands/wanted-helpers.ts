import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import { DEFAULT_SECTION, type Finish, type ScryfallCard } from '../types'
import { matchSectionHeader } from '../section-format'
import { createFenceTracker } from '../markdown-fence'
import { quantityPrefixAdvisory } from '../card-line'
import {
  isCardLanguage,
  LANGUAGE_TOKEN_PATTERN,
  malformedLanguageTokenHint,
  type CardLanguage,
} from '../card-language'
import { finishChoices, finishRows, isFinish } from './collection-helpers'
import { t } from '../i18n/t'
import { parseFlatListFrontMatter, type FlatListFrontMatter } from '../flat-list-front-matter'
import { getWantedDir } from '../ritual-config'
import { listFileName, unusableFileNameMessage } from '../list-file-name'
import { ensureListFile, type SessionConfig } from './card-session'
import { requireInteractive } from '../no-input'

export type WantedListEntry = {
  name: string
  quantity: number
  set?: string
  collectorNumber?: string
  finish?: Finish
  /** The wanted printing's language, from a `[ja]`-style token. Absent means `en`. */
  language?: CardLanguage
  note?: string
  cardId?: number
  /** Section this entry belongs to. Defaults to `DEFAULT_SECTION` ("Main") when unsectioned. */
  section: string
}

export type WantedListParseResult = {
  entries: WantedListEntry[]
  /** Section names in first-seen order, including empty sections that have no entries. */
  sectionOrder: string[]
  /**
   * The file's front-matter block, when it opens with one. Round-trips verbatim
   * on save. Wanted lists define no front-matter keys of their own (card labels
   * are a collection concept), so the block is carried, never interpreted.
   */
  frontMatter?: FlatListFrontMatter
  warnings: string[]
  /**
   * Lines belonging to fenced code blocks (delimiters included). Fenced content
   * is prose: it yields no entries and no warnings. See {@link unreadableLines}
   * for why the whole-file save gates still care.
   */
  fencedLines: number
  /**
   * Non-fatal per-line advisories: content the parser *did* read, but about
   * which the user deserves a word — today, a card name that kept a deck's
   * quantity prefix ({@link quantityPrefixAdvisory}). Wanted lists hold one
   * line per copy, exactly like collections, so the same trap applies.
   *
   * Deliberately **not** part of `warnings`: nothing was lost and a
   * re-serialize preserves the line, so these must not trip the
   * whole-file-rewrite gates ({@link unreadableLines}).
   */
  advisories: string[]
}

/**
 * Matches a wanted-list card line: `- Lightning Bolt (LEA:161) [foil] [ja] {note} &12`.
 * Wanted lists do not carry a condition, otherwise mirrors the collection grammar
 * (the optional `&N` id stays the final capture group).
 */
export const WANTED_CARD_LINE_RE = new RegExp(
  `^- (.+?)(?:\\s\\(([A-Za-z0-9]+):([^)]+)\\))?(?:\\s\\[(nonfoil|foil|etched)\\])?(?:\\s\\[(${LANGUAGE_TOKEN_PATTERN})\\])?(?:\\s\\{(.*)\\})?(?:\\s&(\\d+))?$`,
)

/** The {@link WANTED_CARD_LINE_RE} capture group holding the language token body. */
export const WANTED_LINE_LANGUAGE_GROUP = 5

export function parseWantedListFile(content: string): WantedListParseResult {
  const entries: WantedListEntry[] = []
  const sectionOrder: string[] = []
  const warnings: string[] = []
  const advisories: string[] = []
  let currentSection = DEFAULT_SECTION
  let titleSeen = false
  // Fenced code blocks are prose: a bullet or `## Heading` inside one is an
  // example, not list data, and is not an unreadable line either.
  const fence = createFenceTracker()
  let fencedLines = 0

  const registerSection = (name: string): void => {
    if (!sectionOrder.includes(name)) sectionOrder.push(name)
  }

  const lines = content.split('\n')
  const front = parseFlatListFrontMatter(lines, { validateLabels: false })
  advisories.push(...front.advisories)

  for (let lineIndex = front.bodyStart; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!
    if (fence.feed(line).opaque) {
      fencedLines++
      continue
    }
    const trimmed = line.trim()
    if (trimmed === '') continue

    const header = matchSectionHeader(trimmed)
    if (header) {
      currentSection = header
      registerSection(header)
      continue
    }

    // The first `# Title` H1 is the list's title; any other non-bullet line is
    // content a re-serializing save would delete, so it must warn — the
    // unreadable-lines gates (sync, cleanup, admin saves) all key off these.
    if (!trimmed.startsWith('- ')) {
      if (trimmed.startsWith('# ') && !titleSeen) {
        titleSeen = true
        continue
      }
      warnings.push(`Skipped malformed line: ${trimmed}`)
      continue
    }

    const match = trimmed.match(WANTED_CARD_LINE_RE)
    if (!match) {
      // A recognizable-but-misspelled language token ([JA], [jp]) names its fix.
      warnings.push(`Skipped malformed line: ${trimmed}${malformedLanguageTokenHint(trimmed)}`)
      continue
    }

    const name = match[1]!
    const setCode = match[2]
    const collectorNumber = match[3]
    const rawFinish = match[4]
    const finish = rawFinish !== undefined && isFinish(rawFinish) ? rawFinish : undefined
    const rawLanguage = match[WANTED_LINE_LANGUAGE_GROUP]
    // Set only when the token is present — a bare line means `en` and stays bare.
    const language = rawLanguage && isCardLanguage(rawLanguage) ? rawLanguage : undefined
    const note = match[6]

    const advisory = quantityPrefixAdvisory(name, trimmed)
    if (advisory) advisories.push(advisory)

    // A card before any explicit header pins the implicit Main section into the order list.
    registerSection(currentSection)
    entries.push({
      name,
      quantity: 1,
      set: setCode?.toLowerCase(),
      collectorNumber,
      finish,
      language,
      note,
      cardId: match[7] ? Number.parseInt(match[7], 10) : undefined,
      section: currentSection,
    })
  }
  return {
    entries,
    sectionOrder,
    frontMatter: front.frontMatter,
    warnings,
    fencedLines,
    advisories,
  }
}

export async function ensureWantedListFile(name: string): Promise<string> {
  const fileName = listFileName(name)
  if (fileName === null) {
    throw new Error(unusableFileNameMessage(name))
  }
  return ensureListFile(
    getWantedDir(),
    fileName,
    `# ${name}\n\n`,
    t('cli.edit.listNoun', { type: 'wanted' }),
  )
}

export type WantedListSessionConfig = Omit<SessionConfig, 'condition'>

export type WantedFinishResult = Finish | 'nopreference' | 'cancelled'

/**
 * The wanted pickers' "any finish will do" sentinel. Exported so the add prompt
 * here and the edit prompt in `wanted-strategy` name one value instead of two
 * spellings the compiler can't reconcile.
 */
export const NO_PREFERENCE = '__NONE__'

/** What a wanted finish picker's rows resolve to: a finish, or "no preference". */
export type WantedFinishChoiceValue = Finish | typeof NO_PREFERENCE

type FinishPromptResponse = { finish?: string }

/**
 * Prompt the user to select a finish for a wanted list entry.
 * Returns:
 *  - A specific `Finish` value if selected
 *  - `'nopreference'` if the user chose "No preference"
 *  - `'cancelled'` if the user cancelled
 *
 * If `defaultFinish` is provided and available on the card, it is used
 * without prompting.
 */
export async function promptWantedFinish(
  printing: ScryfallCard,
  defaultFinish?: Finish,
): Promise<WantedFinishResult> {
  const availableFinishes = (printing.finishes ?? []).filter(isFinish)

  if (defaultFinish && availableFinishes.includes(defaultFinish)) {
    return defaultFinish
  }

  if (availableFinishes.length === 0) return 'nopreference'

  if (availableFinishes.length === 1) {
    const only = availableFinishes[0]
    return only !== undefined ? only : 'nopreference'
  }

  requireInteractive(`--finish <${availableFinishes.join('|')}>`)

  const choices = finishChoices<WantedFinishChoiceValue>(
    [
      { label: t('cli.wanted.noPreferenceAny'), value: NO_PREFERENCE },
      ...finishRows(availableFinishes),
    ],
    printing,
  )

  let isExited = false
  const response = (await prompts({
    type: 'select',
    name: 'finish',
    message: t('cli.printing.promptFinish'),
    choices,
    onState: (state: PromptState) => {
      if (state.exited) isExited = true
    },
  })) as FinishPromptResponse

  if (isExited || response.finish === undefined) return 'cancelled'
  if (response.finish === NO_PREFERENCE) return 'nopreference'
  return isFinish(response.finish) ? response.finish : 'cancelled'
}

export { isFinish }

export { formatWantedListLine, type CardPrinting } from '../card-line'
