import * as fs from 'node:fs/promises'
import path from 'node:path'
import prompts from 'prompts'
import type { Finish, ScryfallCard } from '../types'
import { isFinish, VALID_FINISHES } from './collection-helpers'

export type WantedListEntry = {
  name: string
  quantity: number
  set?: string
  collectorNumber?: string
  finish?: Finish
  note?: string
}

export type CardPrinting = { set: string; collectorNumber: string }

export type WantedListParseResult = {
  entries: WantedListEntry[]
  warnings: string[]
}

export function parseWantedListFile(content: string): WantedListParseResult {
  const entries: WantedListEntry[] = []
  const warnings: string[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) continue

    const match = trimmed.match(
      /^- (.+?)(?:\s\(([A-Za-z0-9]+):([^)]+)\))?(?:\s\[(nonfoil|foil|etched)\])?(?:\s\{(.+)\})?$/,
    )
    if (!match) {
      warnings.push(`Skipped malformed line: ${trimmed}`)
      continue
    }

    const name = match[1]!
    const setCode = match[2]
    const collectorNumber = match[3]
    const finish = match[4] as Finish | undefined
    const note = match[5]

    entries.push({
      name,
      quantity: 1,
      set: setCode,
      collectorNumber,
      finish,
      note,
    })
  }
  return { entries, warnings }
}

export function formatWantedListLine(
  name: string,
  printing?: CardPrinting,
  finish?: Finish,
  note?: string,
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

  line += '\n'
  return line
}

export async function ensureWantedListFile(name: string): Promise<string> {
  const wantedListsDir = path.join(process.cwd(), 'wanted')
  await fs.mkdir(wantedListsDir, { recursive: true })
  const filePath = path.join(wantedListsDir, `${name}.md`)
  if (!(await Bun.file(filePath).exists())) {
    await fs.writeFile(filePath, `# ${name}\n\n`)
    console.log(`Created new wanted list file: ${name}.md`)
  } else {
    console.log(`Using wanted list file: ${name}.md`)
  }
  return filePath
}

export type WantedListSessionConfig = {
  sets?: string[]
  finish?: Finish
  entryMode: 'name' | 'collector'
  collectorSets: string[]
  activeSetIndex: number
  setCardMaps: Map<string, Map<string, ScryfallCard>>
}

export async function promptWantedListConfigUpdate(
  sessionConfig: WantedListSessionConfig,
  excludeDigitalOnly: boolean,
): Promise<string[]> {
  const { getAllCardNames } = await import('../scryfall')

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
