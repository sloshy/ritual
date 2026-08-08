import prompts, { type Choice } from 'prompts'
import type { PromptState } from './prompts-types'
import { getCardPrintings, isDigitalOnlySet } from '../scryfall'
import type { ScryfallCard, Finish, Condition } from '../types'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'
import type { ConditionUpdate } from '../change-event'
import {
  dedupePrintingsByKey,
  findPrinting,
  hasSpecificPrinting,
  printingLanguages,
} from '../card-printing'
import {
  CARD_LANGUAGES,
  displayLanguage,
  formatLanguageList,
  isCardLanguage,
  languageDisplayName,
  storedLanguage,
  type CardLanguage,
} from '../card-language'
import { resolvePrintingLanguage } from '../printing-language'
import {
  VALID_FINISHES,
  VALID_CONDITIONS,
  applyConditionUpdate,
  conditionLabel,
  isFinish,
  isCondition,
  printingFinishes,
} from '../finish-condition'
import {
  formatFinishPriceCell,
  formatPriceColumn,
  formatPrintingFinishCell,
  printingFinishColumns,
  type PriceColumnChoice,
  type PriceCurrency,
} from '../price-currency'
import { getCollectionsDir, getDefaultCurrency, getDefaultLanguage } from '../ritual-config'
import { listFileName, unusableFileNameMessage } from '../list-file-name'
import { ensureListFile } from './card-session'
import { requireInteractive } from '../no-input'

export { VALID_FINISHES, VALID_CONDITIONS, conditionLabel, isFinish, isCondition, printingFinishes }

type FinishPromptResponse = { finish?: string }
type ConditionPromptResponse = { condition?: string }
// Loose string like the finish/condition responses: `prompts()` is untyped, so
// the value is proven with `isCardLanguage` at the read, never asserted.
type LanguagePromptResponse = { value?: string }
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
  return ensureListFile(
    getCollectionsDir(),
    fileName,
    `# ${collectionName}\n\n`,
    t('cli.edit.listNoun', { type: 'collection' }),
  )
}

/**
 * A finish's display name. A key table rather than `capitalize(finish)`: the
 * slugs are file-format vocabulary that must never move, and capitalising one
 * leaves a translator with no string to translate at all (plan §7.3).
 */
const FINISH_LABELS = {
  nonfoil: 'cli.session.finishNonfoil',
  foil: 'cli.session.finishFoil',
  etched: 'cli.session.finishEtched',
} as const satisfies Record<Finish, MessageKey>

/** A finish's display name in the active UI locale. */
export function finishLabel(finish: Finish): string {
  return t(FINISH_LABELS[finish])
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
 *
 * `language` is set only when the picked printing is not available in the
 * configured default language and the user confirmed taking it in a language
 * that does exist (see {@link resolveCardPrinting}). It is the language the
 * entry must record — an explicit `'en'` here means "record English despite a
 * non-English default", which serializes as a bare line. Absent, the caller
 * applies its own default.
 */
export type PrintingResolution =
  | { kind: 'picked'; printing: ScryfallCard; language?: CardLanguage }
  | { kind: 'cancelled' }
  | { kind: 'none' }

/**
 * The language a freshly added entry records: the language the printing
 * resolution decided (the picker's availability confirm, or an explicit
 * `--language` flag folded in by the caller), else the configured
 * `defaultLanguage`. `en` collapses to undefined via {@link storedLanguage} —
 * the serializers omit the token for English, and a bare line always means
 * `en`. Adding never prompts for language.
 */
export function resolveAddedLanguage(resolved: CardLanguage | undefined): CardLanguage | undefined {
  return storedLanguage(resolved ?? getDefaultLanguage())
}

/**
 * Choices for the printing picker: each printing's identity plus its price in the
 * given currency, aligned into right-hand columns. No finish has been chosen at
 * this point in the flow, so a printing is quoted in every finish it is offered
 * in — one column per finish any of the listed printings has, so a foil or etched
 * variant lines up to the right of the nonfoil price rather than replacing it.
 *
 * Under an `all_cards` cache the input holds one object per language, so rows
 * are deduped to one per `set:cn` printing (preferring the default-language
 * object), and a printing that does not exist in the configured default
 * language is badged with the languages it does exist in (e.g. `(ja only)`).
 */
export function printingChoices(
  printings: ScryfallCard[],
  currency: PriceCurrency = getDefaultCurrency(),
  defaultLanguage: CardLanguage = getDefaultLanguage(),
): PriceColumnChoice<ScryfallCard>[] {
  const distinct = dedupePrintingsByKey(printings)
  const finishes = printingFinishColumns(distinct, currency)
  return formatPriceColumn(
    distinct.map((p) => {
      const languages = printingLanguages(printings, p.set, p.collector_number)
      const languageBadge =
        languages.length > 0 && !languages.includes(defaultLanguage)
          ? ` ${t('cli.printing.languageBadge', { languages: languages.join(', ') })}`
          : ''
      const row = t('cli.printing.row', {
        setName: p.set_name,
        set: p.set.toUpperCase(),
        number: p.collector_number,
        rarity: p.rarity,
      })
      return {
        label: `${row}${languageBadge}`,
        prices: finishes.map((finish) => formatPrintingFinishCell(p, finish, currency)),
        value: p,
      }
    }),
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
    label: f === current ? t('cli.edit.current', { label: finishLabel(f) }) : finishLabel(f),
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
): PriceColumnChoice<T>[] {
  return formatPriceColumn(
    items.map((item) => ({
      label: item.label,
      prices: [
        item.finish === undefined ? null : formatFinishPriceCell(printing, item.finish, currency),
      ],
      value: item.value,
    })),
  )
}

/**
 * Filter the printing picker's choices by typed input: a lone term that prefixes
 * a set code lists those printings first, and every other term must appear in the
 * printing's identity. Matching is on the card's own fields rather than the
 * rendered title, whose price columns would otherwise make `12` match every
 * printing costing $12.xx as well as collector number 12, and `foil` match every
 * printing with a foil column.
 */
export function suggestPrintings(input: string, choices: readonly Choice[]): Choice[] {
  if (!input) return [...choices]

  const terms = input.toLowerCase().split(/\s+/).filter(Boolean)
  const codeMatches: Choice[] = []
  const otherMatches: Choice[] = []

  for (const choice of choices) {
    // `Choice.value` is `any` at the prompts boundary; printingChoices only ever
    // puts a ScryfallCard there.
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

/** How the language-availability confirm resolved: take the printing, pick again, or abort. */
type LanguageConfirmOutcome = 'confirm' | 'back' | 'cancelled'
// Loose string like the finish/condition responses (see {@link LanguagePromptResponse}).
type LanguageConfirmResponse = { choice?: string }

/**
 * Confirm taking a printing that does not exist in the configured default
 * language: name the language(s) it is available in and offer to go back to
 * the picker instead.
 */
async function promptLanguageFallback(
  printing: ScryfallCard,
  available: readonly CardLanguage[],
  defaultLanguage: CardLanguage,
  stamp: CardLanguage,
): Promise<LanguageConfirmOutcome> {
  const availableNames = formatLanguageList(available)
  let isExited = false
  const response = (await prompts({
    type: 'select',
    name: 'choice',
    message: t('cli.printing.languageUnavailable', {
      printing: `${printing.set.toUpperCase()}:${printing.collector_number}`,
      language: languageDisplayName(defaultLanguage),
      available: availableNames,
    }),
    choices: [
      {
        title: t('cli.printing.useLanguage', {
          language: languageDisplayName(stamp),
          code: stamp,
        }),
        value: 'confirm',
      },
      { title: `← ${t('cli.printing.pickAnother')}`, value: 'back' },
    ],
    onState: (state: PromptState) => {
      if (state.exited) isExited = true
    },
  })) as LanguageConfirmResponse
  if (isExited || (response.choice !== 'confirm' && response.choice !== 'back')) return 'cancelled'
  return response.choice
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
      console.warn(t('cli.printing.noSetFilterMatch', { sets: config.sets.join(', ') }))
    }
  }

  // One row per printing: an `all_cards` cache lists each language as its own
  // object, and the picker must offer printings rather than language objects.
  const distinct = dedupePrintingsByKey(printings)
  if (distinct.length === 0) {
    return { kind: 'none' }
  }

  const defaultLanguage = getDefaultLanguage()

  while (true) {
    let selectedPrinting = distinct[0]!
    if (distinct.length > 1) {
      const choices = printingChoices(printings)

      let printingExited = false
      const printingResponse = (await prompts({
        type: 'autocomplete',
        name: 'printing',
        message: t('cli.printing.promptSelect'),
        choices,
        limit: 15,
        suggest: async (rawInput, choices) => suggestPrintings(String(rawInput), choices),
        onState: (state: PromptState) => {
          if (state.exited) printingExited = true
        },
      })) as PrintingPromptResponse

      if (printingExited || !printingResponse.printing) return { kind: 'cancelled' }
      selectedPrinting = printingResponse.printing
    }

    // A printing the cache does not hold in the configured default language
    // needs an explicit decision: the entry would otherwise claim a language
    // the printing was never made in. Confirming stamps the entry with the
    // language that does exist (possibly `en`, i.e. a bare line).
    const resolved = resolvePrintingLanguage(
      printings,
      selectedPrinting.set,
      selectedPrinting.collector_number,
      defaultLanguage,
    )
    if (resolved.honoredPreferred) {
      return { kind: 'picked', printing: selectedPrinting }
    }
    const languages = printingLanguages(
      printings,
      selectedPrinting.set,
      selectedPrinting.collector_number,
    )
    const stamp = resolved.language
    const outcome = await promptLanguageFallback(
      selectedPrinting,
      languages,
      defaultLanguage,
      stamp,
    )
    if (outcome === 'confirm') {
      return { kind: 'picked', printing: selectedPrinting, language: stamp }
    }
    if (outcome === 'cancelled' || distinct.length === 1) {
      // With a single printing there is nothing else to go back to.
      return { kind: 'cancelled' }
    }
    // 'back': loop to the picker for another printing.
  }
}

/**
 * Pick a language for an existing entry, marking the current one and starting
 * the cursor on it. English leads the list (it is the bare-line default);
 * the rest follow in canonical order. Returns null when cancelled.
 */
export async function promptLanguageChoice(
  current: CardLanguage | undefined,
): Promise<CardLanguage | null> {
  const resolved = displayLanguage(current)
  const currentIndex = Math.max(0, CARD_LANGUAGES.indexOf(resolved))
  let isExited = false
  const response = (await prompts({
    type: 'select',
    name: 'value',
    message: t('cli.printing.promptLanguage'),
    choices: CARD_LANGUAGES.map((code) => {
      const row = t('cli.printing.languageRow', { name: languageDisplayName(code), code })
      return {
        title: code === resolved ? t('cli.edit.current', { label: row }) : row,
        value: code,
      }
    }),
    initial: currentIndex,
    onState: (state: PromptState) => {
      if (state.exited) isExited = true
    },
  })) as LanguagePromptResponse
  if (isExited || response.value === undefined || !isCardLanguage(response.value)) return null
  return response.value
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
      message: t('cli.printing.noneCached', { name: cardName }),
      available,
      totalPrintings: 0,
    }
  }
  const listed = available.map((p) => `${p.set.toUpperCase()}:${p.collectorNumber}`).join(', ')
  const more =
    printings.length > MAX_LISTED_PRINTINGS
      ? t('cli.printing.andMore', { count: printings.length - MAX_LISTED_PRINTINGS })
      : ''
  return {
    ok: false,
    message: t('cli.printing.pinNotFound', {
      printing: `${set.toUpperCase()}:${collectorNumber}`,
      name: cardName,
      listed,
      more,
    }),
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
    message: t('cli.printing.finishUnavailable', {
      printing: `${printing.set.toUpperCase()}:${printing.collector_number}`,
      name: cardName,
      finish,
      available: available.join(', '),
    }),
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
      message: t('cli.printing.promptFinish'),
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
      message: t('cli.printing.promptCondition'),
      choices: [
        { title: t('cli.session.conditionDontCare'), value: '' },
        ...VALID_CONDITIONS.map((c) => ({ title: conditionLabel(c), value: c })),
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
