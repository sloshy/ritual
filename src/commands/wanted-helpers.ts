import * as fs from 'node:fs/promises'
import path from 'node:path'
import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import { DEFAULT_SECTION, type Finish, type ScryfallCard } from '../types'
import { matchSectionHeader } from '../section-format'
import { capitalize } from '../utils'
import { getAllCardNames } from '../scryfall'
import { isFinish, VALID_FINISHES, type SessionConfig } from './collection-helpers'
import { writeFileWithHash } from '../content-hash'
import { getWantedDir } from '../ritual-config'
import { parseSetCodesInput } from '../set-codes'

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

  const registerSection = (name: string): void => {
    if (!sectionOrder.includes(name)) sectionOrder.push(name)
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    const header = matchSectionHeader(trimmed)
    if (header) {
      currentSection = header
      registerSection(header)
      continue
    }

    if (!trimmed.startsWith('- ')) continue

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
  const wantedListsDir = getWantedDir()
  await fs.mkdir(wantedListsDir, { recursive: true })
  const filePath = path.join(wantedListsDir, `${name}.md`)
  if (!(await Bun.file(filePath).exists())) {
    await writeFileWithHash(filePath, `# ${name}\n\n`)
    console.log(`Created new wanted list file: ${name}.md`)
  } else {
    console.log(`Using wanted list file: ${name}.md`)
  }
  return filePath
}

export type WantedListSessionConfig = Omit<SessionConfig, 'condition'>

export type WantedFinishResult = Finish | 'nopreference' | 'cancelled'

type FinishChoice = { title: string; value: string }
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

  const choices: FinishChoice[] = [
    { title: 'No preference (any finish)', value: '__NONE__' },
    ...availableFinishes.map((f) => ({ title: capitalize(f), value: f })),
  ]

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
  if (response.finish === '__NONE__') return 'nopreference'
  return isFinish(response.finish) ? response.finish : 'cancelled'
}

export async function promptWantedListConfigUpdate(
  sessionConfig: WantedListSessionConfig,
  excludeDigitalOnly: boolean,
): Promise<string[]> {
  const configResponse = await prompts([
    {
      type: 'text',
      name: 'sets',
      message: 'Filter by Set Codes (comma separated, e.g. "ECL, ECC"):',
      initial: sessionConfig.sets ? sessionConfig.sets.join(', ') : '',
      format: (val: string) => parseSetCodesInput(val),
    },
    {
      type: 'select',
      name: 'finish',
      message: 'Default Finish:',
      choices: [
        { title: 'None (Always Prompt)', value: '' },
        { title: 'Nonfoil', value: 'nonfoil' },
        { title: 'Foil', value: 'foil' },
        { title: 'Etched', value: 'etched' },
      ],
      initial: sessionConfig.finish
        ? (['', ...VALID_FINISHES] as readonly string[]).indexOf(sessionConfig.finish)
        : 0,
    },
  ])

  if (configResponse.sets !== undefined) {
    sessionConfig.sets = configResponse.sets.length > 0 ? configResponse.sets : undefined
  }

  if (configResponse.finish !== undefined) {
    sessionConfig.finish = configResponse.finish === '' ? undefined : configResponse.finish
  }

  console.log('Reloading card database with new filters...')
  const cardNames = await getAllCardNames({ sets: sessionConfig.sets, excludeDigitalOnly })
  console.log(`Loaded ${cardNames.length} cards.`)
  console.log('Session filters updated.')
  return cardNames
}

export { isFinish }

export { formatWantedListLine, type CardPrinting } from '../card-line'
