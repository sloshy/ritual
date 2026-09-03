import type { Choice } from 'prompts'
import { ask } from '../../cli/prompts'
import { t } from '../../i18n/t'
import { getCardPrintings, isDigitalOnlySet } from '../../scryfall'
import type { ScryfallCard } from '../../scryfall/types'
import {
  type Finish,
  type Condition,
  VALID_FINISHES,
  VALID_CONDITIONS,
  applyConditionUpdate,
  conditionLabel,
  declaredFinishes,
  finishLabel,
  isFinish,
  isCondition,
} from '../../card/finish-condition'
import type { ConditionUpdate } from '../../changes/change-event'
import {
  formatCardCategories,
  parseCardCategoriesInput,
  parseCardCategory,
  sameCardCategories,
  type CardCategory,
} from '../../card/card-categories'
import { dedupePrintingsByKey, printingLanguages } from '../../card/card-printing'
import {
  CARD_LANGUAGES,
  displayLanguage,
  formatLanguageList,
  isCardLanguage,
  languageDisplayName,
  type CardLanguage,
} from '../../card/card-language'
import {
  cardLabelChoicesFor,
  cardLabelDefaultChoicesFor,
  formatCardLabels,
  type CardLabel,
  type CardLabelChoice,
} from '../../card/card-labels'
import {
  formatCardTags,
  parseCardTagsInput,
  sameCardTags,
  type CardTag,
} from '../../card/card-tags'
import type { ListType } from '../../list/list-type'
import { resolvePrintingLanguage } from '../../card/printing-language'
import {
  formatFinishPriceCell,
  formatPriceColumn,
  formatPrintingFinishCell,
  printingFinishColumns,
  type PriceColumnChoice,
  type PriceCurrency,
} from '../../pricing/price-currency'
import { getDefaultCurrency, getDefaultLanguage } from '../../config/ritual-config'
import { requireInteractive, type PromptSubjectKey } from '../../util/no-input'
import { printingLabel } from '../../card/card-line-tail'

/**
 * The prompts shared by every list type's card-entry session: the edit-mode
 * action menu and note editor, and the printing / finish / condition / language
 * / label pickers the add and edit flows drive.
 */

/** The edit-mode prompts shared by every list type's card-entry session. */

// ── Edit-mode action menu ───────────────────────────────────────────

/** One option in an edit-mode per-entry action menu. */
export type EditActionChoice = { title: string; value: string }

const CANCEL_ACTION = '__CANCEL__'

/**
 * Prompt for the edit action to run on the selected entry. Returns the chosen
 * action value, or null when cancelled/escaped.
 */
export async function promptEditAction(
  entryLabel: string,
  actions: EditActionChoice[],
): Promise<string | null> {
  const action = await ask<string>({
    type: 'select',
    message: t('cli.session.promptEditEntry', { entry: entryLabel }),
    subjectKey: 'cli.prompt.subject.editAction',
    choices: [...actions, { title: `← ${t('cli.menu.cancel')}`, value: CANCEL_ACTION }],
  })
  if (!action || action === CANCEL_ACTION) return null
  return action
}

/** A confirmed note edit: the new (trimmed) note and the value it replaces. */
export type NoteEdit = { note: string; before: string }

/**
 * Prompt for an existing entry's note (empty input clears it). Returns null when
 * the prompt is cancelled or the note is unchanged.
 */
export async function promptNoteEdit(currentNote: string | undefined): Promise<NoteEdit | null> {
  const answer = await ask<string>({
    type: 'text',
    message: t('cli.session.promptNoteEdit'),
    subjectKey: 'cli.prompt.subject.noteText',
    initial: currentNote ?? '',
  })
  if (answer === undefined) return null
  const note = answer.trim()
  const before = currentNote ?? ''
  return note === before ? null : { note, before }
}

/** What a text prompt's parser answers: a value, or the sentence that refuses it. */
type TextParse<T> = { ok: true; value: T } | { ok: false; message: string }

/** How to ask one free-text question whose answer is parsed. */
type ParsedTextPrompt = {
  /** The rendered question. */
  message: string
  /** What the question wanted, for the `--no-input` refusal. */
  subjectKey: PromptSubjectKey
  /** Prefill — the current value as a person reads it. */
  initial: string
  /** Renders a parser refusal for the console. */
  invalid: (reason: string) => string
}

/**
 * Ask a free-text question until its answer parses, or the user cancels.
 *
 * The rule this owns is "re-offer what was typed rather than dropping it": a
 * refusal reports the parser's own sentence and puts the typed text back in the
 * field, so the fix is an edit and not a retype. Every parsed text prompt in
 * this module goes through it, so the rule is uniform instead of copied.
 *
 * Returns null on cancel; the caller decides what "unchanged" means.
 */
async function promptParsedText<T>(
  how: ParsedTextPrompt,
  parse: (raw: string) => TextParse<T>,
): Promise<T | null> {
  let initial = how.initial
  for (;;) {
    const answer = await ask<string>({
      type: 'text',
      message: how.message,
      subjectKey: how.subjectKey,
      initial,
    })
    if (answer === undefined) return null
    const parsed = parse(answer)
    if (parsed.ok) return parsed.value
    console.error(how.invalid(parsed.message))
    initial = answer
  }
}

/**
 * Prompt for an existing entry's tag set, prefilled with its current tags as
 * a person reads them (`Card Draw, Ramp`). The input grammar is
 * {@link parseCardTagsInput} — comma-separated, spaces kept — and
 * an input the grammar refuses is reported and asked again rather than
 * dropped. Empty input clears every tag. Returns the canonical set, or null
 * when the prompt is cancelled or the set is unchanged.
 */
export async function promptTagsEdit(
  currentTags: readonly CardTag[] | undefined,
): Promise<CardTag[] | null> {
  const tags = await promptParsedText<CardTag[]>(
    {
      message: t('cli.session.promptTagsEdit'),
      subjectKey: 'cli.prompt.subject.tagsText',
      initial: formatCardTags(currentTags),
      invalid: (reason) => t('cli.edit.tagsInvalid', { reason }),
    },
    (raw) => {
      const parsed = parseCardTagsInput(raw)
      return parsed.ok ? { ok: true, value: parsed.tags } : { ok: false, message: parsed.message }
    },
  )
  if (tags === null) return null
  return sameCardTags(tags, currentTags) ? null : tags
}

/**
 * Prompt for a card's categories in this list, prefilled with the ones it has
 * as a person reads them (`Ramp, Artifacts`). The input grammar is
 * {@link parseCardCategoriesInput} — comma-separated, spaces and case kept —
 * and an input the grammar refuses is reported and asked again rather than
 * dropped. Empty input clears every category. Returns the canonical list,
 * primary first, or null when the prompt is cancelled or nothing changed.
 *
 * `vocabulary` is printed once above the prompt rather than offered as
 * completions: a category set is a comma-separated multi-value and `ask`'s
 * autocomplete is single-select, so the honest affordance is a visible hint.
 */
export async function promptCategoriesEdit(
  current: readonly CardCategory[],
  vocabulary: readonly CardCategory[],
): Promise<CardCategory[] | null> {
  if (vocabulary.length > 0) {
    console.log(
      t('cli.edit.categoriesVocabulary', { categories: formatCardCategories(vocabulary) }),
    )
  }
  const next = await promptParsedText<CardCategory[]>(
    {
      message: t('cli.session.promptCategoriesEdit'),
      subjectKey: 'cli.prompt.subject.categoriesText',
      initial: formatCardCategories(current),
      invalid: (reason) => t('cli.edit.categoriesInvalid', { reason }),
    },
    (raw) => {
      const parsed = parseCardCategoriesInput(raw)
      return parsed.ok
        ? { ok: true, value: parsed.categories }
        : { ok: false, message: parsed.message }
    },
  )
  if (next === null) return null
  return sameCardCategories(next, current) ? null : next
}

/** The category to rename and its new name. */
export type CategoryRename = { from: CardCategory; to: CardCategory }

/**
 * Pick a category from the list's vocabulary and type its new name. Returns
 * null when either step is cancelled.
 */
export async function promptCategoryRename(
  vocabulary: readonly CardCategory[],
): Promise<CategoryRename | null> {
  const index = await ask<number>({
    type: 'select',
    message: t('cli.session.promptCategoryRenameFrom'),
    subjectKey: 'cli.prompt.subject.categoryChoice',
    choices: vocabulary.map((category, i) => ({ title: category, value: i })),
  })
  if (typeof index !== 'number') return null
  const from = vocabulary[index]
  if (from === undefined) return null

  const to = await promptParsedText<CardCategory>(
    {
      message: t('cli.session.promptCategoryRenameTo', { category: from }),
      subjectKey: 'cli.prompt.subject.categoryName',
      initial: from,
      invalid: (reason) => t('cli.edit.categoriesInvalid', { reason }),
    },
    (raw) => {
      const parsed = parseCardCategory(raw)
      return parsed.ok
        ? { ok: true, value: parsed.category }
        : { ok: false, message: parsed.message }
    },
  )
  return to === null ? null : { from, to }
}

/**
 * Prompt for the list's category display order, prefilled with the vocabulary
 * as it stands. An empty answer is refused and asked again — clearing the order
 * is not what "reorder" means, and `ritual categories remove` is how a name
 * leaves. Returns null when cancelled or when the order is unchanged.
 */
export async function promptCategoryOrder(
  vocabulary: readonly CardCategory[],
): Promise<CardCategory[] | null> {
  const order = await promptParsedText<CardCategory[]>(
    {
      message: t('cli.session.promptCategoryOrder'),
      subjectKey: 'cli.prompt.subject.categoryOrderText',
      initial: formatCardCategories(vocabulary),
      invalid: (reason) => t('cli.edit.categoriesInvalid', { reason }),
    },
    (raw) => {
      const parsed = parseCardCategoriesInput(raw)
      if (!parsed.ok) return { ok: false, message: parsed.message }
      // The one refusal this prompt adds over the vocabulary's own grammar:
      // an empty answer parses fine (it is a clear elsewhere), but clearing the
      // order is not what "reorder" means.
      if (parsed.categories.length === 0) {
        return { ok: false, message: t('cli.edit.categoryOrderEmpty') }
      }
      return { ok: true, value: parsed.categories }
    },
  )
  if (order === null) return null
  return sameCardCategories(order, vocabulary) ? null : order
}

// ── Printing, finish, condition, language and label pickers ─────────

/** Minimal config used when filtering card printings by set. */
export type PrintingFilterConfig = {
  sets?: string[]
  /**
   * The language the picker should prefer — a session's own current language,
   * which starts at the configured `defaultLanguage` and moves with the
   * `🌐 Card Language` menu action. Absent (a one-shot caller with no session)
   * falls back to the configured value. It is what the availability check runs
   * against, so the language an add is *stamped* with is the language the
   * picker actually verified.
   */
  language?: CardLanguage
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

/** How the language-availability confirm resolved: take the printing, pick again, or abort. */
type LanguageConfirmOutcome = 'confirm' | 'back' | 'cancelled'

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
  // A loose string: the prompt is untyped, so the value is proven at the read.
  const choice = await ask<string>({
    type: 'select',
    message: t('cli.printing.languageUnavailable', {
      printing: printingLabel(printing.set, printing.collector_number),
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
    subjectKey: 'cli.prompt.subject.languageFallback',
  })
  if (choice !== 'confirm' && choice !== 'back') return 'cancelled'
  return choice
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

  // The session's language when it has one, so the badge, the availability
  // check and the fallback confirm all judge the language that will be stamped.
  const preferredLanguage = config.language ?? getDefaultLanguage()

  while (true) {
    let selectedPrinting = distinct[0]!
    if (distinct.length > 1) {
      const choices = printingChoices(printings, getDefaultCurrency(), preferredLanguage)

      // The picker resolves to one of {@link printingChoices}' card values.
      const picked = await ask<ScryfallCard>({
        type: 'autocomplete',
        message: t('cli.printing.promptSelect'),
        subjectKey: 'cli.prompt.subject.printing',
        choices,
        limit: 15,
        suggest: async (rawInput, choices) => suggestPrintings(String(rawInput), choices),
      })

      if (!picked) return { kind: 'cancelled' }
      selectedPrinting = picked
    }

    // A printing the cache does not hold in the preferred language needs an
    // explicit decision: the entry would otherwise claim a language the printing
    // was never made in. Confirming stamps the entry with the language that does
    // exist (possibly `en`, i.e. a bare line).
    const resolved = resolvePrintingLanguage(
      printings,
      selectedPrinting.set,
      selectedPrinting.collector_number,
      preferredLanguage,
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
      preferredLanguage,
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
  // A loose string: the prompt is untyped, so the value is proven with
  // `isCardLanguage` at the read, never asserted.
  const value = await ask<string>({
    type: 'select',
    message: t('cli.printing.promptLanguage'),
    subjectKey: 'cli.prompt.subject.language',
    choices: CARD_LANGUAGES.map((code) => {
      const row = t('cli.printing.languageRow', { name: languageDisplayName(code), code })
      return {
        title: code === resolved ? t('cli.edit.current', { label: row }) : row,
        value: code,
      }
    }),
    initial: currentIndex,
  })
  if (value === undefined || !isCardLanguage(value)) return null
  return value
}

/**
 * Pick a label state from `choices`, marking the current one and starting the
 * cursor on it. Returns null when cancelled. Choices round-trip through their
 * canonical serialized form (`''` for the clear row) — a real domain value,
 * like {@link promptLanguageChoice}'s, rather than an array index. Shared by
 * the per-card override picker and the list-default picker, for every list type
 * that carries labels.
 */
async function promptLabelChoiceFrom(
  choices: readonly CardLabelChoice[],
  current: readonly CardLabel[] | undefined,
  message: string,
  subjectKey: PromptSubjectKey,
): Promise<CardLabel[] | null> {
  const currentKey = formatCardLabels(current ?? [])
  const currentIndex = choices.findIndex((choice) => formatCardLabels(choice.labels) === currentKey)
  const key = await ask<string>({
    type: 'select',
    message,
    subjectKey,
    choices: choices.map((choice, i) => ({
      title:
        i === currentIndex ? t('cli.edit.current', { label: t(choice.label) }) : t(choice.label),
      value: formatCardLabels(choice.labels),
    })),
    initial: Math.max(0, currentIndex),
  })
  if (key === undefined) return null
  const picked = choices.find((choice) => formatCardLabels(choice.labels) === key)
  return picked ? [...picked.labels] : null
}

/**
 * Pick a label override for an existing entry: the label states `type` carries
 * plus "Use list default" (clear, encoded as `[]`).
 */
export async function promptCardLabelChoice(
  type: ListType,
  current: readonly CardLabel[] | undefined,
): Promise<CardLabel[] | null> {
  return promptLabelChoiceFrom(
    cardLabelChoicesFor(type),
    current,
    t('cli.labels.promptOverride'),
    'cli.prompt.subject.cardLabel',
  )
}

/**
 * Pick the list's *default* labels: the label states `type` carries plus a
 * leading "No default" clear row.
 */
export async function promptDefaultLabelsChoice(
  type: ListType,
  current: readonly CardLabel[] | undefined,
): Promise<CardLabel[] | null> {
  return promptLabelChoiceFrom(
    cardLabelDefaultChoicesFor(type),
    current,
    t('cli.labels.promptDefault'),
    'cli.prompt.subject.defaultLabels',
  )
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
  const availableFinishes = declaredFinishes(selectedPrinting)

  if (!forcePrompts && config.finish && availableFinishes.includes(config.finish)) {
    selectedFinish = config.finish
  } else if (availableFinishes.length > 1) {
    requireInteractive(`--finish <${availableFinishes.join('|')}>`)
    const choices = finishChoices(finishRows(availableFinishes), selectedPrinting)
    const chosenFinish = await ask<string>({
      type: 'select',
      message: t('cli.printing.promptFinish'),
      choices,
    })
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
    const chosenCondition = await ask<string>({
      type: 'select',
      message: t('cli.printing.promptCondition'),
      choices: [
        { title: t('cli.session.conditionDontCare'), value: '' },
        ...VALID_CONDITIONS.map((c) => ({ title: conditionLabel(c), value: c })),
      ],
    })
    if (chosenCondition === undefined) return null
    selectedCondition =
      chosenCondition === ''
        ? undefined
        : isCondition(chosenCondition)
          ? chosenCondition
          : undefined
  }

  return { finish: selectedFinish, condition: selectedCondition }
}

// ── Wanted-list finish pickers ──────────────────────────────────────

export type WantedFinishResult = Finish | 'nopreference' | 'cancelled'

/**
 * The wanted pickers' "any finish will do" sentinel. Exported so the add prompt
 * here and the edit prompt in `wanted-strategy` name one value instead of two
 * spellings the compiler can't reconcile.
 */
export const NO_PREFERENCE = '__NONE__'

/** What a wanted finish picker's rows resolve to: a finish, or "no preference". */
export type WantedFinishChoiceValue = Finish | typeof NO_PREFERENCE

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
  const availableFinishes = declaredFinishes(printing)

  if (defaultFinish && availableFinishes.includes(defaultFinish)) {
    return defaultFinish
  }

  if (availableFinishes.length === 0) return 'nopreference'

  if (availableFinishes.length === 1) {
    const only = availableFinishes[0]
    return only !== undefined ? only : 'nopreference'
  }

  requireInteractive(`--finish <${availableFinishes.join('|')}>`)

  const answer = await askWantedFinish(
    [
      { label: t('cli.wanted.noPreferenceAny'), value: NO_PREFERENCE },
      ...finishRows(availableFinishes),
    ],
    printing,
    { message: t('cli.printing.promptFinish') },
  )
  return answer.kind === 'finish'
    ? answer.finish
    : answer.kind === 'none'
      ? 'nopreference'
      : 'cancelled'
}

/** What a wanted finish picker resolved to, before each caller's own return convention. */
type WantedFinishAnswer =
  | { kind: 'finish'; finish: Finish }
  | { kind: 'none' }
  | { kind: 'cancelled' }

/** How a wanted finish picker asks: its message, and the edit picker's subject/cursor. */
type WantedFinishAsk = { message: string; subjectKey?: PromptSubjectKey; initial?: number }

/**
 * The one wanted finish select behind {@link promptWantedFinish} (add) and
 * {@link promptWantedFinishChoice} (edit): `rows` already carry the caller's
 * "no preference" wording; the select is priced against `printing`.
 */
async function askWantedFinish(
  rows: readonly FinishChoiceItem<WantedFinishChoiceValue>[],
  printing: ScryfallCard | undefined,
  how: WantedFinishAsk,
): Promise<WantedFinishAnswer> {
  const finish = await ask<string>({
    type: 'select',
    choices: finishChoices(rows, printing),
    ...how,
  })
  if (finish === undefined) return { kind: 'cancelled' }
  if (finish === NO_PREFERENCE) return { kind: 'none' }
  return isFinish(finish) ? { kind: 'finish', finish } : { kind: 'cancelled' }
}

// ── Edit-mode field pickers ─────────────────────────────────────────

/**
 * Pick a finish for an existing entry, defaulting the cursor to the current one.
 * `printing` prices the choices; it is undefined when the entry's pinned printing
 * isn't in the card cache.
 */
export async function promptFinishChoice(
  current: Finish,
  printing: ScryfallCard | undefined,
): Promise<Finish | null> {
  const choices = finishChoices(finishRows(VALID_FINISHES, current), printing)
  const value = await ask<string>({
    type: 'select',
    message: t('cli.printing.promptFinishShort'),
    subjectKey: 'cli.prompt.subject.finish',
    choices,
    initial: Math.max(0, VALID_FINISHES.indexOf(current)),
  })
  return isFinish(value) ? value : null
}

/** Pick a condition for an existing entry, defaulting the cursor to the current one. */
export async function promptConditionChoice(current: Condition): Promise<Condition | null> {
  const value = await ask<string>({
    type: 'select',
    message: t('cli.printing.promptCondition'),
    subjectKey: 'cli.prompt.subject.condition',
    choices: VALID_CONDITIONS.map((c) => ({
      title:
        c === current ? t('cli.edit.current', { label: conditionLabel(c) }) : conditionLabel(c),
      value: c,
    })),
    initial: Math.max(0, VALID_CONDITIONS.indexOf(current)),
  })
  return isCondition(value) ? value : null
}

/** Ask whether a wanted entry should be name-only or pinned to a specific printing. */
export async function promptSpecificity(
  cardName: string,
): Promise<'name-only' | 'specific' | null> {
  const specificity = await ask<'name-only' | 'specific'>({
    type: 'select',
    message: t('cli.wanted.promptSpecificity', { name: cardName }),
    subjectKey: 'cli.prompt.subject.specificity',
    choices: [
      { title: t('cli.wanted.specificityNameOnly'), value: 'name-only' },
      { title: t('cli.wanted.specificitySpecific'), value: 'specific' },
    ],
  })
  return specificity ?? null
}

/**
 * Pick a finish for an existing wanted entry, including "No preference" (which
 * clears the finish back off the line). Returns undefined for no preference and
 * null on cancel. `printing` prices the choices; it is undefined when the entry's
 * pinned printing isn't in the card cache.
 */
export async function promptWantedFinishChoice(
  current: Finish | undefined,
  printing: ScryfallCard | undefined,
): Promise<Finish | undefined | null> {
  const answer = await askWantedFinish(
    [
      {
        label:
          current === undefined
            ? t('cli.edit.current', { label: t('cli.wanted.noPreference') })
            : t('cli.wanted.noPreferenceAny'),
        value: NO_PREFERENCE,
      },
      ...finishRows(VALID_FINISHES, current),
    ],
    printing,
    {
      message: t('cli.printing.promptFinishShort'),
      subjectKey: 'cli.prompt.subject.wantedFinish',
      initial: current === undefined ? 0 : Math.max(0, VALID_FINISHES.indexOf(current) + 1),
    },
  )
  return answer.kind === 'finish' ? answer.finish : answer.kind === 'none' ? undefined : null
}
