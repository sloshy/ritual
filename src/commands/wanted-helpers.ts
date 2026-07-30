import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import { DEFAULT_SECTION, type Finish, type ScryfallCard } from '../types'
import { matchSectionHeader } from '../section-format'
import { finishChoices, finishRows, isFinish } from './collection-helpers'
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
  note?: string
  cardId?: number
  /** Section this entry belongs to. Defaults to `DEFAULT_SECTION` ("Main") when unsectioned. */
  section: string
}

export type WantedListParseResult = {
  entries: WantedListEntry[]
  /** Section names in first-seen order, including empty sections that have no entries. */
  sectionOrder: string[]
  warnings: string[]
}

/**
 * Matches a wanted-list card line: `- Lightning Bolt (LEA:161) [foil] {note} &12`.
 * Wanted lists do not carry a condition, otherwise mirrors the collection grammar.
 */
export const WANTED_CARD_LINE_RE =
  /^- (.+?)(?:\s\(([A-Za-z0-9]+):([^)]+)\))?(?:\s\[(nonfoil|foil|etched)\])?(?:\s\{(.*)\})?(?:\s&(\d+))?$/

export function parseWantedListFile(content: string): WantedListParseResult {
  const entries: WantedListEntry[] = []
  const sectionOrder: string[] = []
  const warnings: string[] = []
  let currentSection = DEFAULT_SECTION
  let titleSeen = false

  const registerSection = (name: string): void => {
    if (!sectionOrder.includes(name)) sectionOrder.push(name)
  }

  for (const line of content.split('\n')) {
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
      warnings.push(`Skipped malformed line: ${trimmed}`)
      continue
    }

    const name = match[1]!
    const setCode = match[2]
    const collectorNumber = match[3]
    const rawFinish = match[4]
    const finish = rawFinish !== undefined && isFinish(rawFinish) ? rawFinish : undefined
    const note = match[5]

    // A card before any explicit header pins the implicit Main section into the order list.
    registerSection(currentSection)
    entries.push({
      name,
      quantity: 1,
      set: setCode?.toLowerCase(),
      collectorNumber,
      finish,
      note,
      cardId: match[6] ? Number.parseInt(match[6], 10) : undefined,
      section: currentSection,
    })
  }
  return { entries, sectionOrder, warnings }
}

export async function ensureWantedListFile(name: string): Promise<string> {
  const fileName = listFileName(name)
  if (fileName === null) {
    throw new Error(unusableFileNameMessage(name))
  }
  return ensureListFile(getWantedDir(), fileName, `# ${name}\n\n`, 'wanted list')
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
      { label: 'No preference (any finish)', value: NO_PREFERENCE },
      ...finishRows(availableFinishes),
    ],
    printing,
  )

  let isExited = false
  const response = (await prompts({
    type: 'select',
    name: 'finish',
    message: 'Select Finish:',
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
