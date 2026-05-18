import prompts, { type Choice } from 'prompts'
import type { PromptState } from './prompts-types'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getCardsBySet, getAllCardNames, getCardPrintings, isDigitalOnlySet } from '../scryfall'
import type { ScryfallCard, Finish, Condition } from '../types'
import { capitalize } from '../utils'
import { VALID_FINISHES, VALID_CONDITIONS, isFinish, isCondition } from '../finish-condition'
import { writeFileWithHash, saveHash, computeHash } from '../content-hash'
import { getCollectionsDir } from '../ritual-config'
import { parseSetCodesInput } from '../set-codes'

export { VALID_FINISHES, VALID_CONDITIONS, isFinish, isCondition }

/**
 * Ensure the collections directory and named collection file exist.
 * Creates the file with a markdown heading if new.
 * Returns the resolved file path.
 */
export async function ensureCollectionFile(collectionName: string): Promise<string> {
  const collectionsDir = getCollectionsDir()
  await fs.mkdir(collectionsDir, { recursive: true })
  const filePath = path.join(collectionsDir, `${collectionName}.md`)
  try {
    const content = `# ${collectionName}\n\n`
    await fs.writeFile(filePath, content, { flag: 'wx' })
    await saveHash(filePath, computeHash(content))
    console.log(`Created new collection file: ${collectionName}.md`)
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    console.log(`Using collection file: ${collectionName}.md`)
  }
  return filePath
}

export type SessionConfig = {
  sets?: string[]
  finish?: Finish
  condition?: Condition | 'NONE'
  entryMode: 'name' | 'collector'
  collectorSets: string[]
  activeSetIndex: number
  setCardMaps: Map<string, Map<string, ScryfallCard>>
}

/** Minimal config used when filtering card printings by set. */
export type PrintingFilterConfig = {
  sets?: string[]
}

/** Minimal config used when resolving finish and condition defaults. */
export type FinishConditionConfig = {
  finish?: Finish
  condition?: Condition | 'NONE'
}

type CollectorSessionConfig = Pick<
  SessionConfig,
  'collectorSets' | 'activeSetIndex' | 'setCardMaps'
>

type PrintingResult = {
  cardName: string
  printing: ScryfallCard
} | null

export async function resolveCardPrinting(
  cardName: string,
  config: PrintingFilterConfig,
  excludeDigitalOnly: boolean,
): Promise<PrintingResult> {
  let printings = await getCardPrintings(cardName)

  if (excludeDigitalOnly) {
    printings = printings.filter((p) => !isDigitalOnlySet(p.set))
  }

  if (config.sets && config.sets.length > 0) {
    const filtered = printings.filter((p) => config.sets!.includes(p.set.toLowerCase()))
    if (filtered.length > 0) {
      printings = filtered
    } else {
      console.warn(
        `No printings found matching set filters [${config.sets.join(', ')}]. Showing all printings.`,
      )
    }
  }

  if (printings.length === 0) {
    return null
  }

  let selectedPrinting = printings[0]!
  if (printings.length > 1) {
    const printingChoices = printings.map((p) => ({
      title: `${p.set_name} (${p.set.toUpperCase()}) #${p.collector_number} [${p.rarity}]`,
      value: p,
    }))

    let printingExited = false
    const printingResponse = await prompts({
      type: 'autocomplete',
      name: 'printing',
      message: 'Select Printing:',
      choices: printingChoices,
      limit: 15,
      suggest: async (rawInput, choices) => {
        const input = String(rawInput)
        if (!input) return choices

        const terms = input.toLowerCase().split(/\s+/).filter(Boolean)
        const codeMatches: Choice[] = []
        const otherMatches: Choice[] = []

        for (const choice of choices) {
          const card = choice.value as ScryfallCard
          const title = choice.title.toLowerCase()
          if (terms.length === 1 && card?.set?.toLowerCase().startsWith(terms[0]!)) {
            codeMatches.push(choice)
          } else if (terms.every((term) => title.includes(term))) {
            otherMatches.push(choice)
          }
        }

        return [...codeMatches, ...otherMatches]
      },
      onState: (state: PromptState) => {
        if (state.exited) printingExited = true
      },
    })

    if (printingExited || !printingResponse.printing) return null
    selectedPrinting = printingResponse.printing
  }

  return { cardName, printing: selectedPrinting }
}

type FinishAndConditionResult = {
  finish: Finish
  condition: Condition | undefined
} | null

export async function promptFinishAndCondition(
  selectedPrinting: ScryfallCard,
  config: FinishConditionConfig,
  forcePrompts: boolean,
): Promise<FinishAndConditionResult> {
  // Prompt for Finish
  let selectedFinish: Finish = 'nonfoil'
  const availableFinishes = (selectedPrinting.finishes ?? []).filter(isFinish)

  if (!forcePrompts && config.finish && availableFinishes.includes(config.finish)) {
    selectedFinish = config.finish
  } else if (availableFinishes.length > 1) {
    const finishChoices = availableFinishes.map((f) => ({
      title: capitalize(f),
      value: f,
    }))
    const finishResponse = (await prompts({
      type: 'select',
      name: 'finish',
      message: 'Select Finish:',
      choices: finishChoices,
    })) as { finish?: string }
    const chosenFinish = finishResponse.finish
    if (!chosenFinish || !isFinish(chosenFinish)) return null
    selectedFinish = chosenFinish
  } else {
    const only = availableFinishes[0]
    if (only !== undefined) selectedFinish = only
  }

  // Prompt for Condition
  let selectedCondition: Condition | undefined
  if (!forcePrompts && config.condition !== undefined) {
    selectedCondition = config.condition === 'NONE' ? undefined : config.condition
  } else {
    const conditionResponse = (await prompts({
      type: 'select',
      name: 'condition',
      message: 'Condition:',
      choices: [
        { title: "Don't Care", value: '' },
        { title: 'Near Mint', value: 'NM' },
        { title: 'Lightly Played', value: 'LP' },
        { title: 'Moderately Played', value: 'MP' },
        { title: 'Heavily Played', value: 'HP' },
        { title: 'Damaged', value: 'DMG' },
      ],
    })) as { condition?: string }
    if (conditionResponse.condition === undefined) return null
    selectedCondition =
      conditionResponse.condition === ''
        ? undefined
        : isCondition(conditionResponse.condition)
          ? conditionResponse.condition
          : undefined
  }

  return { finish: selectedFinish, condition: selectedCondition }
}

export function formatCollectionLine(
  cardName: string,
  set: string,
  collectorNumber: string,
  finish: Finish,
  condition: Condition | undefined,
  note?: string,
  cardId?: number,
): string {
  let line = `- ${cardName} (${set.toUpperCase()}:${collectorNumber})`

  if (finish !== 'nonfoil') {
    line += ` [${finish}]`
  }

  if (condition) {
    line += ` [${condition}]`
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

/**
 * Shared shape for the most recently added/edited card, tracked in CLI session loops.
 */
export type LastAddedCard = { name: string; line: string; hasNote: boolean; cardId?: number }

/**
 * Given an existing card line and a new card ID, strip the old &ID suffix (if any) and
 * return a new line ending with the given cardId. Preserves the trailing newline.
 *
 * This is the core of the "Add Another Copy" flow — each copy gets a unique ID while
 * keeping all other line content identical.
 */
export function buildCopyLine(existingLine: string, cardId: number): string {
  const withoutId = existingLine.trimEnd().replace(/\s*&\d+$/, '')
  return `${withoutId} &${cardId}\n`
}

export type ReplaceLastLineResult = { replaced: boolean }

/**
 * Atomically replace the last line of a file if it matches the expected line.
 * Returns whether the replacement was performed.
 */
export async function replaceLastLine(
  filePath: string,
  expectedLine: string,
  newLine: string,
): Promise<ReplaceLastLineResult> {
  const fileContent = await fs.readFile(filePath, 'utf-8')
  const lines = fileContent.trimEnd().split('\n')
  if ((lines[lines.length - 1] ?? '').trim() === expectedLine.trim()) {
    lines[lines.length - 1] = newLine.trimEnd()
    await writeFileWithHash(filePath, lines.join('\n') + '\n')
    return { replaced: true }
  }
  return { replaced: false }
}

export async function promptConfigUpdate(
  sessionConfig: SessionConfig,
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
        ? ['', 'nonfoil', 'foil', 'etched'].indexOf(sessionConfig.finish)
        : 0,
    },
    {
      type: 'select',
      name: 'condition',
      message: 'Default Condition:',
      choices: [
        { title: 'None (Always Prompt)', value: '' },
        { title: "Don't Care", value: 'NONE' },
        { title: 'Near Mint', value: 'NM' },
        { title: 'Lightly Played', value: 'LP' },
        { title: 'Moderately Played', value: 'MP' },
        { title: 'Heavily Played', value: 'HP' },
        { title: 'Damaged', value: 'DMG' },
      ],
      initial: 0,
    },
  ])

  if (configResponse.sets !== undefined) {
    sessionConfig.sets = configResponse.sets.length > 0 ? configResponse.sets : undefined
  }

  if (configResponse.finish !== undefined) {
    sessionConfig.finish = configResponse.finish === '' ? undefined : configResponse.finish
  }

  if (configResponse.condition !== undefined) {
    sessionConfig.condition = configResponse.condition === '' ? undefined : configResponse.condition
  }

  // Reload card names with new filters
  console.log('Reloading card database with new filters...')
  const cardNames = await getAllCardNames({ sets: sessionConfig.sets, excludeDigitalOnly })
  console.log(`Loaded ${cardNames.length} cards.`)
  console.log('Session filters updated.')
  return cardNames
}

export async function manageSetCodes(sessionConfig: CollectorSessionConfig): Promise<void> {
  while (true) {
    const setChoices: Choice[] = sessionConfig.collectorSets.map((code, idx) => ({
      title: `${idx === sessionConfig.activeSetIndex ? '→ ' : '  '}${code.toUpperCase()}${idx === sessionConfig.activeSetIndex ? ' (active)' : ''}`,
      value: { type: 'toggle', index: idx },
    }))

    setChoices.push(
      { title: '+ Add Set Code', value: { type: 'add' } },
      { title: '- Remove Set Code', value: { type: 'remove' } },
      { title: '← Back', value: { type: 'back' } },
    )

    const response = await prompts({
      type: 'select',
      name: 'action',
      message: 'Manage Set Codes:',
      choices: setChoices,
    })

    if (!response.action || response.action.type === 'back') {
      break
    }

    if (response.action.type === 'toggle') {
      sessionConfig.activeSetIndex = response.action.index
      console.log(
        `Active set changed to: ${sessionConfig.collectorSets[sessionConfig.activeSetIndex]?.toUpperCase()}`,
      )
      break
    }

    if (response.action.type === 'add') {
      const addResponse = (await prompts({
        type: 'text',
        name: 'code',
        message: 'Enter set code to add:',
        validate: (val: string) => (val.trim().length > 0 ? true : 'Set code cannot be empty'),
      })) as { code?: string }

      if (addResponse.code) {
        const newCode = addResponse.code.trim().toLowerCase()
        if (!sessionConfig.collectorSets.includes(newCode)) {
          console.log(`Loading ${newCode.toUpperCase()}...`)
          const cardMap = await getCardsBySet(newCode)
          sessionConfig.setCardMaps.set(newCode, cardMap)
          sessionConfig.collectorSets.push(newCode)
          console.log(`  ${cardMap.size} cards loaded`)
        } else {
          console.log(`Set ${newCode.toUpperCase()} already added.`)
        }
      }
    }

    if (response.action.type === 'remove') {
      if (sessionConfig.collectorSets.length === 0) {
        console.log('No sets to remove.')
        continue
      }

      const removeResponse = (await prompts({
        type: 'select',
        name: 'code',
        message: 'Select set to remove:',
        choices: sessionConfig.collectorSets.map((code) => ({
          title: code.toUpperCase(),
          value: code,
        })),
      })) as { code?: string }

      if (removeResponse.code) {
        const idx = sessionConfig.collectorSets.indexOf(removeResponse.code)
        if (idx !== -1) {
          sessionConfig.collectorSets.splice(idx, 1)
          sessionConfig.setCardMaps.delete(removeResponse.code)
          if (sessionConfig.activeSetIndex >= sessionConfig.collectorSets.length) {
            sessionConfig.activeSetIndex = Math.max(0, sessionConfig.collectorSets.length - 1)
          }
          console.log(`Removed ${removeResponse.code.toUpperCase()}`)
        }
      }
    }
  }
}
