import prompts, { type Choice } from 'prompts'
import type { PromptState } from './prompts-types'
import { getCardPrintings, isDigitalOnlySet } from '../scryfall'
import type { ScryfallCard, Finish, Condition } from '../types'
import { capitalize } from '../utils'
import { findPrinting } from '../card-printing'
import {
  VALID_FINISHES,
  VALID_CONDITIONS,
  CONDITION_LABELS,
  isFinish,
  isCondition,
} from '../finish-condition'
import { getCollectionsDir } from '../ritual-config'
import { listFileName, unusableFileNameMessage } from '../list-file-name'
import { ensureListFile } from './card-session'

export { VALID_FINISHES, VALID_CONDITIONS, CONDITION_LABELS, isFinish, isCondition }

type FinishPromptResponse = { finish?: string }
type ConditionPromptResponse = { condition?: string }

/**
 * Ensure the collections directory and named collection file exist.
 * Creates the file with a markdown heading if new.
 * Returns the resolved file path.
 */
export async function ensureCollectionFile(collectionName: string): Promise<string> {
  const fileName = listFileName(collectionName)
  if (fileName === null) {
    throw new Error(unusableFileNameMessage(collectionName))
  }
  return ensureListFile(getCollectionsDir(), fileName, `# ${collectionName}\n\n`, 'collection')
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

/** A printing surfaced in a strict-pin error, as a `set`/`collectorNumber` pair. */
export type AvailablePrinting = { set: string; collectorNumber: string }

/**
 * Result of matching a strict `--set`/`--collector-number` printing pin against
 * a card's known printings. A failed match carries a user-facing message that
 * lists (up to {@link MAX_LISTED_PRINTINGS}) available printings, plus the same
 * list as structured data for machine output.
 */
export type PrintingPinMatch =
  | { ok: true; printing: ScryfallCard }
  | { ok: false; message: string; available: AvailablePrinting[]; totalPrintings: number }

const MAX_LISTED_PRINTINGS = 10

/**
 * Match a strict printing pin. Unlike {@link resolveCardPrinting}'s soft set
 * filter (which falls back to all printings when nothing matches), a pin that
 * doesn't correspond to a real printing is an error. Set codes are compared
 * case-insensitively; collector numbers must match exactly.
 */
export function matchPrintingPin(
  cardName: string,
  printings: ScryfallCard[],
  set: string,
  collectorNumber: string,
): PrintingPinMatch {
  const printing = findPrinting(printings, set, collectorNumber)
  if (printing) return { ok: true, printing }

  const available: AvailablePrinting[] = printings.slice(0, MAX_LISTED_PRINTINGS).map((p) => ({
    set: p.set.toLowerCase(),
    collectorNumber: p.collector_number,
  }))
  if (printings.length === 0) {
    return {
      ok: false,
      message: `No printings of '${cardName}' found in the card cache.`,
      available,
      totalPrintings: 0,
    }
  }
  const listed = available.map((p) => `${p.set.toUpperCase()}:${p.collectorNumber}`).join(', ')
  const more =
    printings.length > MAX_LISTED_PRINTINGS
      ? `, and ${printings.length - MAX_LISTED_PRINTINGS} more`
      : ''
  return {
    ok: false,
    message: `No printing ${set.toUpperCase()}:${collectorNumber} of '${cardName}'. Available printings: ${listed}${more}.`,
    available,
    totalPrintings: printings.length,
  }
}

/**
 * The finishes a printing is actually offered in. Cache entries that carry no
 * usable finish data are treated as plain nonfoil, matching the default
 * {@link promptFinishAndCondition} falls back to.
 */
export function printingFinishes(printing: ScryfallCard): Finish[] {
  const available = (printing.finishes ?? []).filter(isFinish)
  return available.length > 0 ? available : ['nonfoil']
}

/** Result of validating a requested finish against a resolved printing. */
export type FinishPinMatch = { ok: true } | { ok: false; message: string; available: Finish[] }

/**
 * Validate that `finish` is one the printing is offered in. A valid-but-
 * unavailable finish is an error listing the finishes that do exist, rather
 * than a silent fallback to a prompt.
 */
export function matchFinishPin(
  cardName: string,
  printing: ScryfallCard,
  finish: Finish,
): FinishPinMatch {
  const available = printingFinishes(printing)
  if (available.includes(finish)) return { ok: true }
  return {
    ok: false,
    message: `Printing ${printing.set.toUpperCase()}:${printing.collector_number} of '${cardName}' is not available in ${finish}. Available finishes: ${available.join(', ')}.`,
    available,
  }
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
    })) as FinishPromptResponse
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
        ...VALID_CONDITIONS.map((c) => ({ title: CONDITION_LABELS[c], value: c })),
      ],
    })) as ConditionPromptResponse
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

export { formatCollectionLine } from '../card-line'
