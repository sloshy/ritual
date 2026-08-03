import prompts, { type Choice } from 'prompts'
import type { PromptState } from './prompts-types'
import { getCardPrintings, isDigitalOnlySet } from '../scryfall'
import type { ScryfallCard, Finish, Condition } from '../types'
import { capitalize } from '../utils'
import type { ConditionUpdate } from '../change-event'
import { findPrinting, hasSpecificPrinting } from '../card-printing'
import {
  VALID_FINISHES,
  VALID_CONDITIONS,
  CONDITION_LABELS,
  applyConditionUpdate,
  isFinish,
  isCondition,
  printingFinishes,
} from '../finish-condition'
import {
  formatFinishPriceCell,
  formatPriceColumn,
  formatPrintingPriceCell,
  type PriceColumnCell,
  type PriceCurrency,
} from '../price-currency'
import { getCollectionsDir, getDefaultCurrency } from '../ritual-config'
import { listFileName, unusableFileNameMessage } from '../list-file-name'
import { ensureListFile } from './card-session'
import { requireInteractive } from '../no-input'

export {
  VALID_FINISHES,
  VALID_CONDITIONS,
  CONDITION_LABELS,
  isFinish,
  isCondition,
  printingFinishes,
}

type FinishPromptResponse = { finish?: string }
type ConditionPromptResponse = { condition?: string }
/** The printing picker resolves to one of {@link printingChoices}' card values. */
type PrintingPromptResponse = { printing?: ScryfallCard }

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
  condition?: ConditionUpdate
}

/**
 * How an interactive printing resolution ended. `none` (the card has no known
 * printings after filtering) and `cancelled` (the user aborted the picker with
 * Esc/Ctrl-C) are distinct outcomes: a cancel must never fall through to a
 * caller's no-printings fallback (e.g. adding a name-only card).
 */
export type PrintingResolution =
  | { kind: 'picked'; printing: ScryfallCard }
  | { kind: 'cancelled' }
  | { kind: 'none' }

/**
 * Choices for the printing picker: each printing's identity plus its price in the
 * given currency, aligned into a right-hand column. No finish has been chosen at
 * this point in the flow, so each printing is quoted at its default finish.
 */
export function printingChoices(
  printings: ScryfallCard[],
  currency: PriceCurrency = getDefaultCurrency(),
): PriceColumnCell<ScryfallCard>[] {
  return formatPriceColumn(
    printings.map((p) => ({
      label: `${p.set_name} (${p.set.toUpperCase()}) #${p.collector_number} [${p.rarity}]`,
      price: formatPrintingPriceCell(p, currency),
      value: p,
    })),
  )
}

/** A finish picker row: its label, the finish priced beside it, and what it resolves to. */
export type FinishChoiceItem<T> = {
  label: string
  /** Omitted for rows that pick no particular finish (e.g. "No preference"). */
  finish?: Finish
  value: T
}

/**
 * Rows for a finish picker, one per finish, labelled by name and marking `current`
 * where given. The shape every finish prompt feeds {@link finishChoices}: the add
 * flows pass the finishes a printing offers, the edit flows pass every finish.
 */
export function finishRows(
  finishes: readonly Finish[],
  current?: Finish,
): FinishChoiceItem<Finish>[] {
  return finishes.map((f) => ({
    label: f === current ? `${capitalize(f)} (current)` : capitalize(f),
    finish: f,
    value: f,
  }))
}

/**
 * Choices for a finish picker over one printing: each label plus that finish's
 * price, aligned into a right-hand column. `printing` is undefined when an
 * existing entry's pinned printing isn't in the card cache, which leaves the
 * price column blank rather than dropping the prompt.
 */
export function finishChoices<T>(
  items: readonly FinishChoiceItem<T>[],
  printing: ScryfallCard | undefined,
  currency: PriceCurrency = getDefaultCurrency(),
): PriceColumnCell<T>[] {
  return formatPriceColumn(
    items.map((item) => ({
      label: item.label,
      price:
        item.finish === undefined ? null : formatFinishPriceCell(printing, item.finish, currency),
      value: item.value,
    })),
  )
}

/** An existing list entry, as far as resolving the printing it pins is concerned. */
export type PinnedPrintingRef = {
  name: string
  set?: string
  collectorNumber?: string
}

/**
 * The cached printing an entry pins, or undefined when the entry is name-only or
 * the printing isn't cached. Used to price the finish picker for an existing entry,
 * which carries a set/collector number rather than a resolved {@link ScryfallCard}.
 */
export async function lookupPinnedPrinting(
  entry: PinnedPrintingRef,
): Promise<ScryfallCard | undefined> {
  if (!hasSpecificPrinting(entry)) return undefined
  return findPrinting(await getCardPrintings(entry.name), entry.set, entry.collectorNumber)
}

export async function resolveCardPrinting(
  cardName: string,
  config: PrintingFilterConfig,
  excludeDigitalOnly: boolean,
): Promise<PrintingResolution> {
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
    return { kind: 'none' }
  }

  let selectedPrinting = printings[0]!
  if (printings.length > 1) {
    const choices = printingChoices(printings)

    let printingExited = false
    const printingResponse = (await prompts({
      type: 'autocomplete',
      name: 'printing',
      message: 'Select Printing:',
      choices,
      limit: 15,
      suggest: async (rawInput, choices) => {
        const input = String(rawInput)
        if (!input) return choices

        const terms = input.toLowerCase().split(/\s+/).filter(Boolean)
        const codeMatches: Choice[] = []
        const otherMatches: Choice[] = []

        for (const choice of choices) {
          // `Choice.value` is `any` at the prompts boundary; printingChoices only
          // ever puts a ScryfallCard there. Match on the card's own fields rather
          // than the rendered title, whose price column would make `12` match
          // every printing costing $12.xx as well as collector number 12.
          const card = choice.value as ScryfallCard
          const haystack =
            `${card.set_name} ${card.set} #${card.collector_number} ${card.rarity}`.toLowerCase()
          if (terms.length === 1 && card.set.toLowerCase().startsWith(terms[0]!)) {
            codeMatches.push(choice)
          } else if (terms.every((term) => haystack.includes(term))) {
            otherMatches.push(choice)
          }
        }

        return [...codeMatches, ...otherMatches]
      },
      onState: (state: PromptState) => {
        if (state.exited) printingExited = true
      },
    })) as PrintingPromptResponse

    if (printingExited || !printingResponse.printing) return { kind: 'cancelled' }
    selectedPrinting = printingResponse.printing
  }

  return { kind: 'picked', printing: selectedPrinting }
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
    requireInteractive(`--finish <${availableFinishes.join('|')}>`)
    const choices = finishChoices(finishRows(availableFinishes), selectedPrinting)
    const finishResponse = (await prompts({
      type: 'select',
      name: 'finish',
      message: 'Select Finish:',
      choices,
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
    selectedCondition = applyConditionUpdate(config.condition, undefined)
  } else {
    // There is no non-interactive default: a run that cannot answer this must
    // say so, not exit 0 with the prompt unanswered and nothing written.
    requireInteractive(`--condition <${[...VALID_CONDITIONS, 'NONE'].join('|')}>`)
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
