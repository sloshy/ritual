import * as fs from 'node:fs/promises'
import path from 'node:path'
import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import type { Finish, ScryfallCard } from '../types'
import { capitalize } from '../utils'
import { getAllCardNames } from '../scryfall'
import { isFinish, VALID_FINISHES, type SessionConfig } from './collection-helpers'
import { getBaseDir } from '../base-dir'
import { writeFileWithHash } from '../content-hash'

export type WantedListEntry = {
  name: string
  quantity: number
  set?: string
  collectorNumber?: string
  finish?: Finish
  note?: string
  cardId?: number
}

export type CardPrinting = { set: string; collectorNumber: string }

export type WantedListParseResult = {
  entries: WantedListEntry[]
  warnings: string[]
}

/**
 * Matches a wanted-list card line: `- Lightning Bolt (LEA:161) [foil] {note} &12`.
 * Wanted lists do not carry a condition, otherwise mirrors the collection grammar.
 */
export const WANTED_CARD_LINE_RE =
  /^- (.+?)(?:\s\(([A-Za-z0-9]+):([^)]+)\))?(?:\s\[(nonfoil|foil|etched)\])?(?:\s\{(.+)\})?(?:\s&(\d+))?$/

export function parseWantedListFile(content: string): WantedListParseResult {
  const entries: WantedListEntry[] = []
  const warnings: string[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
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

    entries.push({
      name,
      quantity: 1,
      set: setCode?.toLowerCase(),
      collectorNumber,
      finish,
      note,
      cardId: match[6] ? Number.parseInt(match[6], 10) : undefined,
    })
  }
  return { entries, warnings }
}

export function formatWantedListLine(
  name: string,
  printing?: CardPrinting,
  finish?: Finish,
  note?: string,
  cardId?: number,
): string {
  let line = `- ${name}`

  if (printing) {
    line += ` (${printing.set.toUpperCase()}:${printing.collectorNumber})`
  }

  if (finish && finish !== 'nonfoil') {
    line += ` [${finish}]`
  }

  if (note) {
    line += ` {${note}}`
  }

  if (cardId !== undefined) {
    line += ` &${cardId}`
  }

  line += '\n'
  return line
}

export async function ensureWantedListFile(name: string): Promise<string> {
  const wantedListsDir = path.join(getBaseDir(), 'wanted')
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

  const choices: Array<{ title: string; value: string }> = [
    { title: 'No preference (any finish)', value: '__NONE__' },
    ...availableFinishes.map((f) => ({ title: capitalize(f), value: f })),
  ]

  let isExited = false
  const response = await prompts({
    type: 'select',
    name: 'finish',
    message: 'Select Finish:',
    choices,
    onState: (state: PromptState) => {
      if (state.exited) isExited = true
    },
  })

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
      format: (val) =>
        val
          .split(',')
          .map((s: string) => s.trim().toLowerCase())
          .filter((s: string) => s.length > 0),
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
