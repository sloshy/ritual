import { Command, InvalidArgumentError, Option } from 'commander'
import prompts from 'prompts'
import type { PromptState } from '../cli/prompts'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import {
  getAllCardNames,
  getCardPrintings,
  getCardPrintingsResult,
  isDigitalOnlySet,
} from '../scryfall'
import { printingsAreComplete, dedupePrintingsByKey } from '../card/card-printing'
import {
  appendIntoOpenFence,
  applyDeckAdd,
  applyDeckAddToContent,
  type DeckAddOutcome,
  type DeckAddPlacement,
} from './line-mutate'
import {
  resolveCardPrinting,
  promptFinishAndCondition,
  promptWantedFinish,
} from './session/prompts'
import { formatCollectionLine } from '../card/card-line'
import { resolveAddedLanguage } from '../card/printing-pin'
import { resolvePrintingLanguage } from '../card/printing-language'
import type { CardLanguage } from '../card/card-language'
import {
  applyConditionUpdate,
  isCondition,
  isFinish,
  normalizeFinishValue,
  VALID_CONDITIONS,
  type Condition,
  type Finish,
} from '../card/finish-condition'
import { parseSetCode } from '../card/set-codes'
import { ensureCollectionFile, ensureWantedListFile } from '../list/ensure-list-file'
import { formatWantedListLine } from '../list/wanted-file'
import { isUsableFileName, unusableFileNameMessage, listFileName } from '../list/list-file-name'
import { emptyCacheAdvice, ensureFreshCardCache } from '../cache/freshness'
import {
  addRefreshOption,
  addDryRunOption,
  addScriptingOptions,
  type DryRunOptions,
} from '../cli/options'
import type { RefreshMode } from '../cache/refresh'
import { appendChangelog } from '../changes/changelog-writer'
import { createAddChange, type ConditionUpdate } from '../changes/change-event'
import { parseCardLabelsToken, type CardLabel } from '../card/card-labels'
import { allocateNextIdFromContent } from '../card/card-id'
import { endsInsideOpenFence } from '../list/markdown-fence'
import { appendFileWithHash } from '../changes/content-hash'
import {
  findCheapestPrinting,
  formatSpecificPrintingPrice,
  formatCheapestPrintingDisplay,
} from '../pricing/price-currency'
import type { ScryfallCard } from '../scryfall/types'
import type { ListType } from '../list/list-type'
import {
  matchesAllNameTerms,
  matchesNameTerms,
  normalizeCardName,
  rankNameMatches,
  splitNameTerms,
} from '../card/term-match'
import {
  formatResolveListError,
  isListArgumentConflict,
  isResolveListError,
  resolveList,
  resolveListArgument,
  type ListTypeFlags,
} from '../list/resolve-list'
import { cancelledError, listArgumentConflictError, runCommandAction } from '../cli/action'
import {
  ensureFinishAvailable,
  ensureLabelsSupported,
  parseLanguageFlag,
  resolveListTypeFlag,
  resolvePinnedPrinting,
  type EntryRef,
  type PrintingPin,
} from './card-target'
import { parsePositiveInteger } from '../util/parse-number'
import { inputRequiredError, promptsUnavailable } from '../util/no-input'
import { emitOutput, normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'
import { ExitCode, CardCommandError, localizedCommandError } from '../util/errors'
import { divertConsoleLogToStderr } from '../util/stdout-guard'
import {
  getCollectionsDir,
  getDefaultCurrency,
  getDefaultLanguage,
  getWantedDir,
} from '../config/ritual-config'
import { t } from '../i18n/t'

/**
 * Parse existing &N IDs from a file and allocate the next available ID.
 *
 * Also the gate on the append itself: flat-list adds append at end of file, and
 * an unclosed code fence runs to end of file, so appending into one would write
 * a card line — with an `&N` and a changelog entry — that no later parse can
 * see. Refuse instead.
 */
async function allocateNextIdFromFile(filePath: string): Promise<number> {
  let content = ''
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    // File may not exist yet
  }
  if (endsInsideOpenFence(content)) throw appendIntoOpenFence()
  const { nextId } = allocateNextIdFromContent(content)
  return nextId
}

type AddCardOptions = {
  quantity: number
  finish?: Finish
  condition?: ConditionUpdate
  /** Explicit `--language` override; otherwise the configured default applies. */
  language?: CardLanguage
  /** Label override the new card starts with, where the list type carries labels. */
  label?: CardLabel[]
  exact?: boolean
  set?: string
  collectorNumber?: string
  nameOnly?: boolean
  specific?: boolean
  section?: string
  commander?: boolean
  refresh: RefreshMode
} & ListTypeFlags &
  DryRunOptions &
  Partial<ScriptingOptions>

/**
 * A resolved target list for `add-card`. A collection or wanted list that does
 * not exist yet resolves to its would-be path with `requestedName` set: the file
 * is created at write time (see {@link ensureTargetFile}), so a run that fails
 * validation — or never writes at all under `--dry-run` — leaves no debris.
 */
type AddCardTarget = {
  type: ListType
  filePath: string
  name: string
  /** The name to create the list under, when it does not exist yet. */
  requestedName?: string
}

/** The JSON/NDJSON success payload. Set codes are lowercase (internal form). */
type AddCardSuccess = {
  type: ListType
  list: string
  cardName: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The recorded language; omitted for English (bare-line default). */
  language?: CardLanguage
  /** The label override the new line carries, where the list type carries labels. */
  labels?: CardLabel[]
  quantity?: number
  cardId: number
  /** Deck adds only: the section the card's line ended up in. */
  section?: string
  /** Present and true when `--dry-run` reported the add without writing it. */
  dryRun?: true
}

// ── Flag argParsers (reject invalid values at parse time, exit code 2) ────────

function parseFinishFlag(value: string): Finish {
  const result = normalizeFinishValue(value)
  if (!isFinish(result)) {
    throw new InvalidArgumentError(result)
  }
  return result
}

function parseConditionFlag(value: string): Condition | 'NONE' {
  const normalized = value.toUpperCase()
  if (normalized === 'NONE') return 'NONE'
  if (!isCondition(normalized)) {
    throw new InvalidArgumentError(
      t('cli.addCard.invalidCondition', { value, choices: VALID_CONDITIONS.join(', ') }),
    )
  }
  return normalized
}

function parseQuantityFlag(value: string): number {
  const parsed = parsePositiveInteger(value.trim())
  if (parsed === undefined) {
    throw new InvalidArgumentError(t('cli.addCard.quantityPositive'))
  }
  return parsed
}

function parseSetFlag(value: string): string {
  const result = parseSetCode(value)
  if (!result.ok) {
    throw new InvalidArgumentError(result.error)
  }
  return result.code
}

function parseCollectorNumberFlag(value: string): string {
  const normalized = value.trim()
  if (normalized === '') {
    throw new InvalidArgumentError(t('cli.addCard.collectorNumberEmpty'))
  }
  return normalized
}

/**
 * `--label` for a fresh add: a comma-separated label set. Unlike `set-card`'s
 * flag there is no `none` — absence already means "inherit the list default".
 */
function parseAddLabelFlag(value: string): CardLabel[] {
  const parsed = parseCardLabelsToken(value)
  if (!parsed.ok) throw new InvalidArgumentError(parsed.message)
  return parsed.labels
}

// ── Command registration ──────────────────────────────────────────────────────

export function registerAddCardCommand(program: Command): void {
  const command = program
    .command('add-card')
    .description(t('help.addCard.description'))
    .argument('<targetName>', t('help.listArg.crossType'))
    .argument('<cardName...>', t('help.addCard.cardName'))
    .option('--deck', t('help.listFlags.deck'))
    .option('--collection', t('help.addCard.collectionFlag'))
    .option('--wanted', t('help.addCard.wantedFlag'))
    .option('-q, --quantity <number>', t('help.addCard.quantity'), parseQuantityFlag, 1)
    .option('-f, --finish <finish>', t('help.addCard.finish'), parseFinishFlag)
    .option('-c, --condition <condition>', t('help.addCard.condition'), parseConditionFlag)
    .option('--language <code>', t('help.addCard.language'), (value: string) =>
      parseLanguageFlag(value),
    )
    .option('--label <labels>', t('help.addCard.label'), parseAddLabelFlag)
    .option('--section <name>', t('help.addCard.section'))
    .option('--commander', t('help.addCard.commander'))
    .option('-e, --exact', t('help.addCard.exact'), false)
    .option('--set <code>', t('help.addCard.set'), parseSetFlag)
    .option(
      '--collector-number <number>',
      t('help.addCard.collectorNumber'),
      parseCollectorNumberFlag,
    )
  command.addOption(
    new Option('--name-only', t('help.addCard.nameOnly')).conflicts([
      'specific',
      'set',
      'collectorNumber',
    ]),
  )
  command.addOption(new Option('--specific', t('help.addCard.specific')))
  addRefreshOption(command)
  addDryRunOption(command, t('help.addCard.dryRun'))
  addScriptingOptions(command).action(
    async (targetName: string, cardNameParts: string[], options: AddCardOptions) => {
      const scripting = normalizeScriptingOptions(options, 'text')
      if (scripting.output !== 'text') {
        // Machine output must stay clean: informational logging from shared
        // helpers (cache freshness prompts, Scryfall client) goes to stderr.
        divertConsoleLogToStderr()
      }
      const type = resolveListTypeFlag(options, scripting)
      if (type === 'conflict') return
      await runCommandAction(scripting, () =>
        runAddCard(
          { targetName, cardNameInput: cardNameParts.join(' '), type, options },
          scripting,
        ),
      )
    },
  )
}

type RunInput = {
  targetName: string
  cardNameInput: string
  type: ListType | undefined
  options: AddCardOptions
}

async function runAddCard(input: RunInput, scripting: ScriptingOptions): Promise<void> {
  const { options } = input
  const pin = resolvePrintingPinFlags(options.set, options.collectorNumber)

  // Same list-addressing convention as the sibling one-shot commands: an
  // optional `deck:`/`collection:`/`wanted:` prefix supplies the type, and
  // contradicting the type flag is a usage error rather than a silent override.
  const listArg = resolveListArgument(input.targetName, input.type)
  if (isListArgumentConflict(listArg)) throw listArgumentConflictError(listArg)
  const type = listArg.type

  // Every check that can refuse the run happens before anything is written —
  // the target list is only *resolved* here, never created (see
  // `ensureTargetFile`), so a doomed add leaves the workspace as it found it.
  if (type !== undefined) validateTargetFlags(type, pin, options)

  const cacheResult = await ensureFreshCardCache(options.refresh)
  if (!cacheResult.ready) {
    throw new CardCommandError(
      'runtime_error',
      emptyCacheAdvice(t('cli.addCard.cacheUnavailable')),
      ExitCode.RuntimeError,
      undefined,
      { key: 'cli.addCard.cacheUnavailable' },
    )
  }
  info(t('cli.addCard.loadedFromCache', { count: cacheResult.cardCount }), scripting)

  const target = await resolveAddCardTarget(listArg.name, type)
  if (type === undefined) validateTargetFlags(target.type, pin, options)

  const cardNames = await getAllCardNames()
  const selectedName = await resolveCardName(
    input.cardNameInput,
    options.exact ?? false,
    cardNames,
    scripting,
  )

  switch (target.type) {
    case 'deck':
      await addToDeck(target, selectedName, pin, options, scripting)
      break
    case 'collection':
      await addToCollection(target, selectedName, pin, options, scripting)
      break
    case 'wanted':
      await addToWanted(target, selectedName, pin, options, scripting)
      break
  }
}

// ── Flag validation ───────────────────────────────────────────────────────────

/** `--set` and `--collector-number` only pin a printing together. */
function resolvePrintingPinFlags(
  set: string | undefined,
  collectorNumber: string | undefined,
): PrintingPin | undefined {
  if (set === undefined && collectorNumber === undefined) return undefined
  if (set === undefined || collectorNumber === undefined) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.cardOps.pinNeedsBoth')
  }
  return { set, collectorNumber }
}

/**
 * Reject flags that don't apply to the resolved target type (instead of
 * silently ignoring them), and require an explicit specificity choice for
 * wanted-list adds when there is no terminal to ask on.
 */
function validateTargetFlags(
  type: ListType,
  pin: PrintingPin | undefined,
  options: AddCardOptions,
): void {
  if (type !== 'wanted' && (options.nameOnly || options.specific)) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.addCard.wantedOnlyFlags')
  }
  if (type === 'wanted' && options.condition !== undefined) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.cardOps.wantedNoCondition')
  }
  if (options.label !== undefined) ensureLabelsSupported(type, options.label)
  if (type !== 'deck' && (options.section !== undefined || options.commander)) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.addCard.deckOnlyFlags')
  }
  if (type !== 'deck' && options.quantity !== 1) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.addCard.quantityDeckOnly')
  }
  if (
    type === 'wanted' &&
    !options.nameOnly &&
    !options.specific &&
    pin === undefined &&
    promptsUnavailable()
  ) {
    throw inputRequiredError('cli.prompt.subject.wantedAdd')
  }
}

// ── Target list resolution ────────────────────────────────────────────────────

/**
 * Resolve `name` to an existing deck / collection / wanted list (via the shared
 * resolver), or — when a type flag (or `collection:`/`wanted:` prefix) pins the
 * type — to the path a missing collection or wanted list *would* have. Nothing
 * is created here: {@link ensureTargetFile} creates the file at write time, so a
 * run that fails afterwards (or never writes, under `--dry-run`) leaves no
 * half-made list behind.
 *
 * A workspace holding no lists of that type at all (`no-lists`) is the same
 * case as a single missing list — auto-creation matters most on the first run.
 * Decks are never auto-created; a missing deck is an error on both paths.
 */
async function resolveAddCardTarget(
  name: string,
  type: ListType | undefined,
): Promise<AddCardTarget> {
  if (name.endsWith('.changes') || name.endsWith('.changes.md')) {
    throw localizedCommandError(
      'usage_error',
      ExitCode.UsageError,
      'cli.addCard.changelogNotAList',
      { name },
    )
  }

  const resolved = await resolveList(name, type)
  if (!isResolveListError(resolved)) {
    return { type: resolved.type, filePath: resolved.filePath, name: resolved.name }
  }

  // Auto-create only when the type is known and no such list exists yet —
  // whether that is one missing list or an empty workspace.
  if ((resolved.kind === 'not-found' || resolved.kind === 'no-lists') && type) {
    if (type === 'deck') {
      throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.addCard.deckNotFound', {
        name,
      })
    }
    // The list is about to be created, so its name has to be usable as a file name.
    const fileName = listFileName(name)
    if (!isUsableFileName(name) || fileName === null) {
      throw new CardCommandError('usage_error', unusableFileNameMessage(name), ExitCode.UsageError)
    }
    const dir = type === 'collection' ? getCollectionsDir() : getWantedDir()
    const filePath = path.join(dir, fileName)
    return { type, filePath, name: path.basename(filePath, '.md'), requestedName: name }
  }

  throw new CardCommandError(
    resolved.kind === 'ambiguous' ? 'usage_error' : 'not_found',
    formatResolveListError(resolved, 'type-flags'),
    resolved.kind === 'ambiguous' ? ExitCode.UsageError : ExitCode.NotFound,
  )
}

/**
 * Create the target list file if the resolver found none. Called immediately
 * before the first write, so a failure anywhere earlier — and every `--dry-run`
 * — leaves the workspace untouched.
 */
async function ensureTargetFile(target: AddCardTarget): Promise<void> {
  if (target.requestedName === undefined) return
  if (target.type === 'collection') await ensureCollectionFile(target.requestedName)
  else if (target.type === 'wanted') await ensureWantedListFile(target.requestedName)
}

// ── Card name resolution ──────────────────────────────────────────────────────

/**
 * Attempt an exact match against cached card names.
 * Returns the canonical card name if exactly one match is found, null otherwise.
 */
function findExactMatch(inputName: string, cardNames: string[]): string | null {
  const normalized = normalizeCardName(inputName)
  const matches = cardNames.filter((name) => normalizeCardName(name) === normalized)
  if (matches.length === 1 && matches[0]) return matches[0]
  return null
}

/**
 * Count how many card names the input matches by term — the same rule the
 * autocomplete prompt filters by, so the count describes what selecting
 * interactively would have offered. Short-circuits at `limit` to avoid scanning
 * the full list unnecessarily.
 */
function countTermMatches(inputName: string, cardNames: string[], limit: number): number {
  const terms = splitNameTerms(inputName)
  let count = 0
  for (const name of cardNames) {
    if (matchesNameTerms(normalizeCardName(name), terms)) {
      count++
      if (count >= limit) return count
    }
  }
  return count
}

async function resolveCardName(
  cardNameInput: string,
  exact: boolean,
  cardNames: string[],
  scripting: ScriptingOptions,
): Promise<string> {
  if (exact) {
    const match = findExactMatch(cardNameInput, cardNames)
    if (!match) {
      const matchCount = countTermMatches(cardNameInput, cardNames, 100)
      const shown = matchCount >= 100 ? '100+' : String(matchCount)
      throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.addCard.noExactMatch', {
        name: cardNameInput,
        matches: t('cli.addCard.matchCount', { count: matchCount, shown }),
      })
    }
    info(t('cli.addCard.exactMatchFound', { name: match }), scripting)
    return match
  }

  if (promptsUnavailable()) {
    // The autocomplete prompt would silently auto-answer with its first
    // suggestion when stdin is not a terminal (and must not open at all under
    // --no-input) — accept only an exact name.
    const match = findExactMatch(cardNameInput, cardNames)
    if (match) return match
    if (countTermMatches(cardNameInput, cardNames, 1) === 0) {
      throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.addCard.noCardsMatching', {
        name: cardNameInput,
      })
    }
    throw inputRequiredError('cli.prompt.subject.fullCardName', { name: cardNameInput })
  }

  const selected = await selectCardAutocomplete(cardNames, cardNameInput)
  if (!selected) throw cancelledError()
  return selected
}

/**
 * Select a card name using an autocomplete prompt backed by the card cache.
 * When initialSearch is provided, pre-sorts matching cards to the top.
 */
async function selectCardAutocomplete(
  cardNames: string[],
  initialSearch: string,
): Promise<string | null> {
  // Pre-filter by term, matching what `suggest` does to what is typed next — a
  // substring pre-filter would drop names the prompt itself would have offered.
  let filteredNames = cardNames
  if (initialSearch) {
    filteredNames = cardNames.filter((name) => matchesAllNameTerms(name, initialSearch))

    if (filteredNames.length === 0) {
      throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.addCard.noCardsMatching', {
        name: initialSearch,
      })
    }

    console.log(
      t('cli.addCard.foundMatching', {
        counted: t('domain.count.cards', { count: filteredNames.length }),
        name: initialSearch,
      }),
    )

    filteredNames = rankNameMatches(filteredNames, initialSearch, (name) => name)
  }

  const choices = filteredNames.map((name) => ({ title: name, value: name }))

  let isExited = false
  const response = await prompts({
    type: 'autocomplete',
    name: 'cardName',
    message: t('cli.cardOps.promptSelectCard'),
    choices,
    limit: 15,
    suggest: async (rawInput, choices) => {
      const input = String(rawInput)
      if (!input) return choices.slice(0, 15)

      const matches = choices.filter((choice) => matchesAllNameTerms(choice.title, input))
      return rankNameMatches(matches, input, (choice) => choice.title)
    },
    onState: (state: PromptState) => {
      if (state.exited) isExited = true
    },
  })

  if (isExited || !response.cardName) return null
  return response.cardName as string
}

// ── Per-type add flows ────────────────────────────────────────────────────────

/**
 * The language a fresh add records. Adding never prompts for language: the
 * `--language` flag wins, then a language the printing picker's availability
 * confirm resolved (a printing that does not exist in the configured default),
 * then the configured `defaultLanguage`. `en` collapses to undefined — the
 * serializers omit the token for English, and a bare line always means `en`.
 */
function resolveAddLanguage(
  flag: CardLanguage | undefined,
  resolved: CardLanguage | undefined,
): CardLanguage | undefined {
  return resolveAddedLanguage(flag ?? resolved)
}

async function addToDeck(
  target: AddCardTarget,
  selectedName: string,
  pin: PrintingPin | undefined,
  options: AddCardOptions,
  scripting: ScriptingOptions,
): Promise<void> {
  const pinned = pin ? await resolvePinnedPrinting(selectedName, pin) : undefined
  // A finish is validated against the pinned printing when the add pins one.
  // Without a pin the deck line records no printing, so there is nothing to
  // validate against — a deliberate gap, documented in add-card.md.
  if (options.finish !== undefined && pinned) {
    ensureFinishAvailable(selectedName, pinned, options.finish)
  }
  const card: EntryRef = {
    name: selectedName,
    set: pinned?.set.toLowerCase(),
    collectorNumber: pinned?.collector_number,
    finish: options.finish,
    condition: applyConditionUpdate(options.condition, undefined),
    language: resolveAddLanguage(options.language, undefined),
    labels: options.label,
  }
  const placement: DeckAddPlacement = {
    section: options.section,
    commander: options.commander === true,
  }

  // Same engine as the editors and the admin save: copies merge onto an
  // existing same-printing line, and a new line is appended at the end of the
  // target section — one add change event per copy.
  const outcome = options.dryRun
    ? previewDeckAdd(await fs.readFile(target.filePath, 'utf-8'), card, options.quantity, placement)
    : await applyDeckAdd(target.filePath, card, options.quantity, placement)

  const printingLabel = pinned ? ` (${pinned.set.toUpperCase()}:${pinned.collector_number})` : ''
  const dryRun = options.dryRun ?? false
  emitSuccess(
    {
      type: 'deck',
      list: target.name,
      cardName: selectedName,
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: card.finish,
      condition: card.condition,
      language: card.language,
      labels: card.labels,
      quantity: options.quantity,
      cardId: outcome.cardId,
      section: outcome.section,
    },
    t('cli.addCard.addedToDeck', {
      mode: addMode(dryRun),
      card: `${options.quantity} ${selectedName}${printingLabel}`,
      file: path.basename(target.filePath),
      section: outcome.section,
    }),
    scripting,
    dryRun,
  )
}

/** The outcome a deck add would have, computed without writing anything. */
function previewDeckAdd(
  content: string,
  card: EntryRef,
  copies: number,
  placement: DeckAddPlacement,
): DeckAddOutcome {
  return applyDeckAddToContent(content, card, copies, placement).outcome
}

async function addToCollection(
  target: AddCardTarget,
  selectedName: string,
  pin: PrintingPin | undefined,
  options: AddCardOptions,
  scripting: ScriptingOptions,
): Promise<void> {
  const resolved = pin
    ? { printing: await resolvePinnedPrinting(selectedName, pin) }
    : await promptCollectionPrinting(selectedName)
  const printing = resolved.printing

  if (options.finish !== undefined) ensureFinishAvailable(selectedName, printing, options.finish)

  const finishAndCondition = await promptFinishAndCondition(
    printing,
    { finish: options.finish, condition: options.condition },
    false,
  )
  if (!finishAndCondition) throw cancelledError()

  const language = resolveAddLanguage(options.language, resolved.language)
  const cardId = await allocateNextIdFromFile(target.filePath)
  const line = formatCollectionLine({
    cardName: selectedName,
    set: printing.set,
    collectorNumber: printing.collector_number,
    finish: finishAndCondition.finish,
    condition: finishAndCondition.condition,
    language,
    labels: options.label,
    cardId,
  })
  if (!options.dryRun) {
    await ensureTargetFile(target)
    await appendFileWithHash(target.filePath, line)
    await appendChangelog(target.filePath, target.name, [
      createAddChange(selectedName, {
        set: printing.set.toLowerCase(),
        collectorNumber: printing.collector_number,
        finish: finishAndCondition.finish,
        condition: finishAndCondition.condition,
        language,
        labels: options.label,
        cardId,
      }),
    ])
  }

  emitSuccess(
    {
      type: 'collection',
      list: target.name,
      cardName: selectedName,
      set: printing.set.toLowerCase(),
      collectorNumber: printing.collector_number,
      finish: finishAndCondition.finish,
      condition: finishAndCondition.condition,
      language,
      labels: options.label,
      cardId,
    },
    t('cli.addCard.addedLine', { mode: addMode(options.dryRun ?? false), line: line.trim() }),
    scripting,
    options.dryRun ?? false,
  )
  info(
    formatSpecificPrintingPrice(printing, finishAndCondition.finish, getDefaultCurrency()),
    scripting,
  )
}

/**
 * A resolved add printing: the card object plus, when the printing does not
 * exist in the configured default language, the language the entry records
 * instead (see {@link PrintingResolution} in session/prompts).
 */
type AddPrintingResolution = {
  printing: ScryfallCard
  language?: CardLanguage
}

/**
 * Resolve a printing when no strict pin was given. Interactively this is the
 * shared printing picker; without a terminal the picker would silently
 * auto-answer with its first suggestion (and under `--no-input` it must not
 * open at all), so non-interactive runs only accept a card with a single
 * (paper) printing and otherwise fail with `makeFailure()`.
 */
async function resolveInteractivePrinting(
  cardName: string,
  makeFailure: () => CardCommandError,
): Promise<AddPrintingResolution> {
  if (promptsUnavailable()) {
    // Cache-only, and only when the cache holds the card's whole printing list:
    // a cache-miss `/cards/named` fallback always returns exactly one printing,
    // and accepting it would pin an arbitrary printing rather than the card's
    // only one. Without that list there is nothing to auto-accept.
    const result = await getCardPrintingsResult(cardName, { network: false })
    if (!printingsAreComplete(result)) throw makeFailure()
    const printings = result.printings.filter((p) => !isDigitalOnlySet(p.set))
    // One printing may span several language objects under an all_cards cache;
    // the dedupe keeps "single printing" meaning single set:cn, not single object.
    const distinct = dedupePrintingsByKey(printings)
    if (distinct.length !== 1) throw makeFailure()
    const printing = distinct[0]!
    // No terminal to confirm on: apply the silent-source rule (default if
    // available, else en, else the only available language).
    const resolved = resolvePrintingLanguage(
      printings,
      printing.set,
      printing.collector_number,
      getDefaultLanguage(),
    )
    return { printing, language: resolved.honoredPreferred ? undefined : resolved.language }
  }
  const result = await resolveCardPrinting(cardName, {}, true)
  if (result.kind === 'cancelled') throw cancelledError()
  if (result.kind === 'none') throw makeFailure()
  return { printing: result.printing, language: result.language }
}

/** Interactive printing selection for a collection add (no strict pin given). */
async function promptCollectionPrinting(cardName: string): Promise<AddPrintingResolution> {
  return resolveInteractivePrinting(cardName, () =>
    localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.addCard.noPrintingSelected',
      { name: cardName },
    ),
  )
}

type WantedAddMode = 'name-only' | 'specific'

async function addToWanted(
  target: AddCardTarget,
  selectedName: string,
  pin: PrintingPin | undefined,
  options: AddCardOptions,
  scripting: ScriptingOptions,
): Promise<void> {
  const mode = await resolveWantedMode(selectedName, pin, options)

  if (mode === 'name-only') {
    const language = resolveAddLanguage(options.language, undefined)
    const cardId = await allocateNextIdFromFile(target.filePath)
    const line = formatWantedListLine({
      name: selectedName,
      finish: options.finish,
      language,
      cardId,
    })
    if (!options.dryRun) {
      await ensureTargetFile(target)
      await appendFileWithHash(target.filePath, line)
      await appendChangelog(target.filePath, target.name, [
        createAddChange(selectedName, { finish: options.finish, language, cardId }),
      ])
    }
    emitSuccess(
      {
        type: 'wanted',
        list: target.name,
        cardName: selectedName,
        finish: options.finish,
        language,
        cardId,
      },
      t('cli.addCard.addedLine', { mode: addMode(options.dryRun ?? false), line: line.trim() }),
      scripting,
      options.dryRun ?? false,
    )
    await printCheapestPrinting(selectedName, scripting)
    return
  }

  // Specific printing flow
  const resolved = pin
    ? { printing: await resolvePinnedPrinting(selectedName, pin) }
    : await resolveWantedPrinting(selectedName)
  const printing = resolved.printing

  if (options.finish !== undefined) ensureFinishAvailable(selectedName, printing, options.finish)

  const finishResult = await promptWantedFinish(printing, options.finish)
  if (finishResult === 'cancelled') throw cancelledError()
  const finish = finishResult === 'nopreference' ? undefined : finishResult

  const language = resolveAddLanguage(options.language, resolved.language)
  const cardId = await allocateNextIdFromFile(target.filePath)
  const line = formatWantedListLine({
    name: selectedName,
    printing: { set: printing.set, collectorNumber: printing.collector_number },
    finish,
    language,
    cardId,
  })
  if (!options.dryRun) {
    await ensureTargetFile(target)
    await appendFileWithHash(target.filePath, line)
    await appendChangelog(target.filePath, target.name, [
      createAddChange(selectedName, {
        set: printing.set.toLowerCase(),
        collectorNumber: printing.collector_number,
        finish,
        language,
        cardId,
      }),
    ])
  }

  emitSuccess(
    {
      type: 'wanted',
      list: target.name,
      cardName: selectedName,
      set: printing.set.toLowerCase(),
      collectorNumber: printing.collector_number,
      finish,
      language,
      cardId,
    },
    t('cli.addCard.addedLine', { mode: addMode(options.dryRun ?? false), line: line.trim() }),
    scripting,
    options.dryRun ?? false,
  )
  info(formatSpecificPrintingPrice(printing, finish, getDefaultCurrency()), scripting)
}

/**
 * Decide the wanted-list specificity: `--name-only` wins, `--specific` or a
 * printing pin selects the specific flow, and with neither the user is asked
 * interactively (non-TTY runs were already rejected by `validateTargetFlags`).
 */
async function resolveWantedMode(
  selectedName: string,
  pin: PrintingPin | undefined,
  options: AddCardOptions,
): Promise<WantedAddMode> {
  if (options.nameOnly) return 'name-only'
  if (options.specific || pin !== undefined) return 'specific'

  const specificityResponse = await prompts({
    type: 'select',
    name: 'specificity',
    message: t('cli.addCard.promptSpecificity', { name: selectedName }),
    choices: [
      { title: t('cli.addCard.specificityNameOnly'), value: 'name-only' },
      { title: t('cli.addCard.specificityChoosePrinting'), value: 'specific' },
    ],
  })

  if (!specificityResponse.specificity) throw cancelledError()
  return specificityResponse.specificity as WantedAddMode
}

/**
 * Printing selection for the wanted 'specific' flow. A failed resolution (no
 * printings, prompt cancelled, or several candidates with no terminal to ask
 * on) is an explicit error rather than a silent fallback to a name-only entry.
 */
async function resolveWantedPrinting(cardName: string): Promise<AddPrintingResolution> {
  return resolveInteractivePrinting(cardName, () =>
    localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.addCard.noPrintingResolved',
      { name: cardName },
    ),
  )
}

// ── Output ────────────────────────────────────────────────────────────────────

/**
 * Informational chatter (cache counts, price lines): printed in text mode
 * unless `--quiet`; dropped entirely for machine output formats.
 */
function info(message: string, scripting: ScriptingOptions): void {
  if (scripting.output === 'text' && !scripting.quiet) console.log(message)
}

/**
 * Which branch of a success message a run selects: a dry run reports what
 * *would* happen, so the whole sentence — not a spliced verb — differs. The
 * catalog entries are `$select` tables keyed on this value.
 */
function addMode(dryRun: boolean): AddMode {
  return dryRun ? 'preview' : 'done'
}

/** The `$select` branch names the `cli.addCard.added*` messages offer. */
type AddMode = 'done' | 'preview'

function emitSuccess(
  payload: AddCardSuccess,
  textLine: string,
  scripting: ScriptingOptions,
  dryRun: boolean,
): void {
  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(dryRun ? t('cli.cardOps.dryRunLine', { line: textLine }) : textLine, scripting)
    }
    return
  }
  emitOutput(dryRun ? { ...payload, dryRun: true as const } : payload, scripting)
}

/** Text-mode price hint for a name-only wanted add: the cheapest printing. */
async function printCheapestPrinting(cardName: string, scripting: ScriptingOptions): Promise<void> {
  if (scripting.output !== 'text' || scripting.quiet) return
  const currency = getDefaultCurrency()
  const allPrintings = await getCardPrintings(cardName)
  console.log(formatCheapestPrintingDisplay(findCheapestPrinting(allPrintings, currency), currency))
}
