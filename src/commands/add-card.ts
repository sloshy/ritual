import { Command, InvalidArgumentError, Option } from 'commander'
import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { getAllCardNames, getCardPrintings, isDigitalOnlySet } from '../scryfall'
import { addCardToDeckFile } from '../deck-file'
import {
  resolveCardPrinting,
  promptFinishAndCondition,
  formatCollectionLine,
  ensureCollectionFile,
} from './collection-helpers'
import { isCondition, isFinish, normalizeFinishValue, VALID_CONDITIONS } from '../finish-condition'
import { parseSetCode } from '../set-codes'
import { ensureWantedListFile, formatWantedListLine, promptWantedFinish } from './wanted-helpers'
import { isUsableFileName, unusableFileNameMessage } from '../list-file-name'
import { emptyCacheAdvice, ensureFreshCardCache } from '../cache/freshness'
import { addRefreshOption, type RefreshMode } from '../refresh'
import { appendChangelog } from '../changelog-writer'
import { createAddChange } from '../change-event'
import { allocateNextIdFromContent } from '../card-id'
import { appendFileWithHash } from '../content-hash'
import {
  findCheapestPrinting,
  formatSpecificPrintingPrice,
  formatCheapestPrintingDisplay,
} from '../price-currency'
import { getDefaultCurrency } from '../ritual-config'
import type { Card, Condition, Finish, ScryfallCard } from '../types'
import type { ListType } from '../list-type'
import { matchesAllNameTerms, normalizeCardName, promoteFullNameMatches } from '../term-match'
import {
  formatResolveListError,
  isResolveListError,
  parseListArgument,
  resolveList,
  type ListTypeFlags,
} from '../resolve-list'
import {
  ensureFinishAvailable,
  parsePositiveInteger,
  promptsUnavailable,
  resolveListTypeFlag,
  resolvePinnedPrinting,
  runCommandAction,
  type PrintingPin,
} from './card-target'
import {
  addScriptingOptions,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'
import { divertConsoleLogToStderr } from '../mcp/stdout-guard'
import { CardCommandError, getErrorMessage } from '../errors'

/** Parse existing &N IDs from a file and allocate the next available ID. */
async function allocateNextIdFromFile(filePath: string): Promise<number> {
  let content = ''
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    // File may not exist yet
  }
  const { nextId } = allocateNextIdFromContent(content)
  return nextId
}

type AddCardOptions = {
  quantity: number
  finish?: Finish
  condition?: Condition | 'NONE'
  exact?: boolean
  set?: string
  collectorNumber?: string
  nameOnly?: boolean
  specific?: boolean
  refresh: RefreshMode
} & ListTypeFlags &
  Partial<ScriptingOptions>

/** A resolved (or freshly created) target list for `add-card`. */
type AddCardTarget = { type: ListType; filePath: string; name: string }

/** The JSON/NDJSON success payload. Set codes are lowercase (internal form). */
type AddCardSuccess = {
  type: ListType
  list: string
  cardName: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  quantity?: number
  cardId: number
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
      `Invalid condition '${value}'. Use one of: ${VALID_CONDITIONS.join(', ')}, or NONE to record no condition.`,
    )
  }
  return normalized
}

function parseQuantityFlag(value: string): number {
  const parsed = parsePositiveInteger(value.trim())
  if (parsed === undefined) {
    throw new InvalidArgumentError('Quantity must be a positive integer.')
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
    throw new InvalidArgumentError('Collector number cannot be empty.')
  }
  return normalized
}

// ── Command registration ──────────────────────────────────────────────────────

export function registerAddCardCommand(program: Command): void {
  const command = program
    .command('add-card')
    .description('Add a card to a deck, collection, or wanted list by name')
    .argument(
      '<targetName>',
      'Name of the deck, collection, or wanted list (resolved across all types unless a type flag is given)',
    )
    .argument('<cardName...>', 'Name of the card to search for')
    .option('--deck', 'Resolve the name as a deck')
    .option('--collection', 'Resolve the name as a collection (created if missing)')
    .option('--wanted', 'Resolve the name as a wanted list (created if missing)')
    .option('-q, --quantity <number>', 'Number of copies to add (deck only)', parseQuantityFlag, 1)
    .option(
      '-f, --finish <finish>',
      'Card finish: nonfoil, foil, etched (collection/wanted only)',
      parseFinishFlag,
    )
    .option(
      '-c, --condition <condition>',
      'Card condition: NM, LP, MP, HP, DMG, or NONE to record no condition (collection only)',
      parseConditionFlag,
    )
    .option('-e, --exact', 'Use exact matching (skip interactive selection if name matches)', false)
    .option(
      '--set <code>',
      'Pin an exact printing by set code (requires --collector-number)',
      parseSetFlag,
    )
    .option(
      '--collector-number <number>',
      'Pin an exact printing by collector number (requires --set)',
      parseCollectorNumberFlag,
    )
  command.addOption(
    new Option(
      '--name-only',
      'Wanted lists: add the card by name without choosing a printing',
    ).conflicts(['specific', 'set', 'collectorNumber']),
  )
  command.addOption(
    new Option(
      '--specific',
      'Wanted lists: record a specific printing (via --set/--collector-number or interactive selection)',
    ),
  )
  addRefreshOption(command)
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
  // optional `deck:`/`collection:`/`wanted:` prefix overrides the type flag.
  const listArg = parseListArgument(input.targetName)
  const type = listArg.type ?? input.type

  // With a known target type, validate before the resolver auto-creates a
  // missing collection/wanted file for a doomed run.
  if (type !== undefined) validateTargetFlags(type, pin, options)
  const target = await resolveAddCardTarget(listArg.name, type)
  if (type === undefined) validateTargetFlags(target.type, pin, options)

  const cacheResult = await ensureFreshCardCache(options.refresh)
  if (!cacheResult.ready) {
    throw new CardCommandError(
      'runtime_error',
      emptyCacheAdvice('Card cache is not available.'),
      ExitCode.RuntimeError,
    )
  }
  info(`Loaded ${cacheResult.cardCount} cards from cache.`, scripting)

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
    throw new CardCommandError(
      'usage_error',
      '--set and --collector-number must be given together.',
      ExitCode.UsageError,
    )
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
    throw new CardCommandError(
      'usage_error',
      '--name-only and --specific apply only to wanted list targets.',
      ExitCode.UsageError,
    )
  }
  if (type === 'deck' && options.finish !== undefined) {
    throw new CardCommandError(
      'usage_error',
      '--finish applies only to collection and wanted list targets.',
      ExitCode.UsageError,
    )
  }
  if (type !== 'collection' && options.condition !== undefined) {
    throw new CardCommandError(
      'usage_error',
      '--condition applies only to collection targets.',
      ExitCode.UsageError,
    )
  }
  if (type !== 'deck' && options.quantity !== 1) {
    throw new CardCommandError(
      'usage_error',
      '--quantity applies only to deck targets (collection and wanted entries are one physical card per line).',
      ExitCode.UsageError,
    )
  }
  if (
    type === 'wanted' &&
    !options.nameOnly &&
    !options.specific &&
    pin === undefined &&
    promptsUnavailable()
  ) {
    throw new CardCommandError(
      'usage_error',
      'Wanted-list adds are interactive by default. Pass --name-only, --specific, or --set/--collector-number when prompts are unavailable (stdin is not a terminal, or --no-input).',
      ExitCode.UsageError,
    )
  }
}

// ── Target list resolution ────────────────────────────────────────────────────

/**
 * Resolve `name` to an existing deck / collection / wanted list (via the shared
 * resolver), or — when a type flag pins the type — create a missing collection or
 * wanted list on the fly. Decks are never auto-created; a missing deck is an error.
 */
async function resolveAddCardTarget(
  name: string,
  type: ListType | undefined,
): Promise<AddCardTarget> {
  if (name.endsWith('.changes') || name.endsWith('.changes.md')) {
    throw new CardCommandError(
      'usage_error',
      `'${name}' is a changelog file and cannot be used as a list.`,
      ExitCode.UsageError,
    )
  }

  const resolved = await resolveList(name, type)
  if (!isResolveListError(resolved)) {
    return { type: resolved.type, filePath: resolved.filePath, name: resolved.name }
  }

  // Auto-create only when the type is known and the list simply doesn't exist yet.
  if (resolved.kind === 'not-found' && type) {
    if (type === 'deck') {
      throw new CardCommandError(
        'not_found',
        `No deck named '${name}' found. Create it first with 'ritual new deck'.`,
        ExitCode.NotFound,
      )
    }
    // The list is about to be created, so its name has to be usable as a file name.
    if (!isUsableFileName(name)) {
      throw new CardCommandError('usage_error', unusableFileNameMessage(name), ExitCode.UsageError)
    }
    const filePath =
      type === 'collection' ? await ensureCollectionFile(name) : await ensureWantedListFile(name)
    return { type, filePath, name: path.basename(filePath, '.md') }
  }

  throw new CardCommandError(
    resolved.kind === 'ambiguous' ? 'usage_error' : 'not_found',
    formatResolveListError(resolved),
    resolved.kind === 'ambiguous' ? ExitCode.UsageError : ExitCode.NotFound,
  )
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
 * Count how many card names contain the input as a normalized substring.
 * Short-circuits at `limit` to avoid scanning the full list unnecessarily.
 */
function countSubstringMatches(inputName: string, cardNames: string[], limit: number): number {
  const normalized = normalizeCardName(inputName)
  let count = 0
  for (const name of cardNames) {
    if (normalizeCardName(name).includes(normalized)) {
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
      const matchCount = countSubstringMatches(cardNameInput, cardNames, 100)
      const countLabel = matchCount >= 100 ? '100+' : String(matchCount)
      throw new CardCommandError(
        'not_found',
        `No exact match for '${cardNameInput}'. ${countLabel} card${matchCount !== 1 ? 's' : ''} contain that name.`,
        ExitCode.NotFound,
      )
    }
    info(`Exact match found: ${match}`, scripting)
    return match
  }

  if (promptsUnavailable()) {
    // The autocomplete prompt would silently auto-answer with its first
    // suggestion when stdin is not a terminal (and must not open at all under
    // --no-input) — accept only an exact name.
    const match = findExactMatch(cardNameInput, cardNames)
    if (match) return match
    if (countSubstringMatches(cardNameInput, cardNames, 1) === 0) {
      throw new CardCommandError(
        'not_found',
        `No cards found matching '${cardNameInput}'.`,
        ExitCode.NotFound,
      )
    }
    throw new CardCommandError(
      'usage_error',
      `Interactive card selection needs a terminal with prompts enabled, and '${cardNameInput}' does not exactly match a cached card name. Pass the full card name.`,
      ExitCode.UsageError,
    )
  }

  const selected = await selectCardAutocomplete(cardNames, cardNameInput)
  if (!selected) {
    throw new CardCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
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
  // Pre-filter: only include cards whose normalized name contains the normalized search as a substring
  let filteredNames = cardNames
  if (initialSearch) {
    const normalizedSearch = normalizeCardName(initialSearch)
    filteredNames = cardNames.filter((name) => normalizeCardName(name).includes(normalizedSearch))

    if (filteredNames.length === 0) {
      throw new CardCommandError(
        'not_found',
        `No cards found matching '${initialSearch}'.`,
        ExitCode.NotFound,
      )
    }

    console.log(
      `Found ${filteredNames.length} card${filteredNames.length !== 1 ? 's' : ''} matching '${initialSearch}'.`,
    )

    filteredNames = promoteFullNameMatches(filteredNames, initialSearch, (name) => name)
  }

  const choices = filteredNames.map((name) => ({ title: name, value: name }))

  let isExited = false
  const response = await prompts({
    type: 'autocomplete',
    name: 'cardName',
    message: 'Select a card:',
    choices,
    limit: 15,
    suggest: async (rawInput, choices) => {
      const input = String(rawInput)
      if (!input) return choices.slice(0, 15)

      const matches = choices.filter((choice) => matchesAllNameTerms(choice.title, input))
      return promoteFullNameMatches(matches, input, (choice) => choice.title)
    },
    onState: (state: PromptState) => {
      if (state.exited) isExited = true
    },
  })

  if (isExited || !response.cardName) return null
  return response.cardName as string
}

// ── Per-type add flows ────────────────────────────────────────────────────────

async function addToDeck(
  target: AddCardTarget,
  selectedName: string,
  pin: PrintingPin | undefined,
  options: AddCardOptions,
  scripting: ScriptingOptions,
): Promise<void> {
  const pinned = pin ? await resolvePinnedPrinting(selectedName, pin) : undefined
  const card: Card = {
    quantity: options.quantity,
    name: selectedName,
    set: pinned?.set.toLowerCase(),
    collectorNumber: pinned?.collector_number,
  }

  let cardId: number
  try {
    cardId = await addCardToDeckFile(target.filePath, card)
  } catch (e) {
    throw new CardCommandError(
      'runtime_error',
      `Failed to update deck file: ${getErrorMessage(e)}`,
      ExitCode.RuntimeError,
    )
  }

  await appendChangelog(target.filePath, target.name, [
    createAddChange(selectedName, {
      set: card.set,
      collectorNumber: card.collectorNumber,
      cardId,
    }),
  ])

  const printingLabel = pinned ? ` (${pinned.set.toUpperCase()}:${pinned.collector_number})` : ''
  emitSuccess(
    {
      type: 'deck',
      list: target.name,
      cardName: selectedName,
      set: card.set,
      collectorNumber: card.collectorNumber,
      quantity: options.quantity,
      cardId,
    },
    `Added '${options.quantity} ${selectedName}${printingLabel}' to ${path.basename(target.filePath)}`,
    scripting,
  )
}

async function addToCollection(
  target: AddCardTarget,
  selectedName: string,
  pin: PrintingPin | undefined,
  options: AddCardOptions,
  scripting: ScriptingOptions,
): Promise<void> {
  const printing = pin
    ? await resolvePinnedPrinting(selectedName, pin)
    : await promptCollectionPrinting(selectedName)

  if (options.finish !== undefined) ensureFinishAvailable(selectedName, printing, options.finish)

  const finishAndCondition = await promptFinishAndCondition(
    printing,
    { finish: options.finish, condition: options.condition },
    false,
  )
  if (!finishAndCondition) {
    throw new CardCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }

  const cardId = await allocateNextIdFromFile(target.filePath)
  const line = formatCollectionLine(
    selectedName,
    printing.set,
    printing.collector_number,
    finishAndCondition.finish,
    finishAndCondition.condition,
    undefined,
    cardId,
  )
  await appendFileWithHash(target.filePath, line)

  await appendChangelog(target.filePath, target.name, [
    createAddChange(selectedName, {
      set: printing.set.toLowerCase(),
      collectorNumber: printing.collector_number,
      finish: finishAndCondition.finish,
      condition: finishAndCondition.condition,
      cardId,
    }),
  ])

  emitSuccess(
    {
      type: 'collection',
      list: target.name,
      cardName: selectedName,
      set: printing.set.toLowerCase(),
      collectorNumber: printing.collector_number,
      finish: finishAndCondition.finish,
      condition: finishAndCondition.condition,
      cardId,
    },
    `Added: ${line.trim()}`,
    scripting,
  )
  info(
    formatSpecificPrintingPrice(printing, finishAndCondition.finish, getDefaultCurrency()),
    scripting,
  )
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
): Promise<ScryfallCard> {
  if (promptsUnavailable()) {
    const printings = (await getCardPrintings(cardName)).filter((p) => !isDigitalOnlySet(p.set))
    if (printings.length === 1) return printings[0]!
    throw makeFailure()
  }
  const result = await resolveCardPrinting(cardName, {}, true)
  if (result.kind === 'cancelled') {
    throw new CardCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
  if (result.kind === 'none') throw makeFailure()
  return result.printing
}

/** Interactive printing selection for a collection add (no strict pin given). */
async function promptCollectionPrinting(cardName: string): Promise<ScryfallCard> {
  return resolveInteractivePrinting(
    cardName,
    () =>
      new CardCommandError(
        'runtime_error',
        `No printing selected for '${cardName}'. Pass --set and --collector-number to pin one.`,
        ExitCode.RuntimeError,
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
    const cardId = await allocateNextIdFromFile(target.filePath)
    const line = formatWantedListLine(selectedName, undefined, options.finish, undefined, cardId)
    await appendFileWithHash(target.filePath, line)
    await appendChangelog(target.filePath, target.name, [
      createAddChange(selectedName, { finish: options.finish, cardId }),
    ])
    emitSuccess(
      {
        type: 'wanted',
        list: target.name,
        cardName: selectedName,
        finish: options.finish,
        cardId,
      },
      `Added: ${line.trim()}`,
      scripting,
    )
    await printCheapestPrinting(selectedName, scripting)
    return
  }

  // Specific printing flow
  const printing = pin
    ? await resolvePinnedPrinting(selectedName, pin)
    : await resolveWantedPrinting(selectedName)

  if (options.finish !== undefined) ensureFinishAvailable(selectedName, printing, options.finish)

  const finishResult = await promptWantedFinish(printing, options.finish)
  if (finishResult === 'cancelled') {
    throw new CardCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
  const finish = finishResult === 'nopreference' ? undefined : finishResult

  const cardId = await allocateNextIdFromFile(target.filePath)
  const line = formatWantedListLine(
    selectedName,
    { set: printing.set, collectorNumber: printing.collector_number },
    finish,
    undefined,
    cardId,
  )
  await appendFileWithHash(target.filePath, line)

  await appendChangelog(target.filePath, target.name, [
    createAddChange(selectedName, {
      set: printing.set.toLowerCase(),
      collectorNumber: printing.collector_number,
      finish,
      cardId,
    }),
  ])

  emitSuccess(
    {
      type: 'wanted',
      list: target.name,
      cardName: selectedName,
      set: printing.set.toLowerCase(),
      collectorNumber: printing.collector_number,
      finish,
      cardId,
    },
    `Added: ${line.trim()}`,
    scripting,
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
    message: `How specific for ${selectedName}?`,
    choices: [
      { title: 'Name only (any copy)', value: 'name-only' },
      { title: 'Choose specific printing', value: 'specific' },
    ],
  })

  if (!specificityResponse.specificity) {
    throw new CardCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
  return specificityResponse.specificity as WantedAddMode
}

/**
 * Printing selection for the wanted 'specific' flow. A failed resolution (no
 * printings, prompt cancelled, or several candidates with no terminal to ask
 * on) is an explicit error rather than a silent fallback to a name-only entry.
 */
async function resolveWantedPrinting(cardName: string): Promise<ScryfallCard> {
  return resolveInteractivePrinting(
    cardName,
    () =>
      new CardCommandError(
        'runtime_error',
        `Could not resolve a printing for '${cardName}'. Pass --set and --collector-number, or use --name-only.`,
        ExitCode.RuntimeError,
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

function emitSuccess(payload: AddCardSuccess, textLine: string, scripting: ScriptingOptions): void {
  if (scripting.output === 'text') {
    if (!scripting.quiet) emitOutput(textLine, scripting)
    return
  }
  emitOutput(payload, scripting)
}

/** Text-mode price hint for a name-only wanted add: the cheapest printing. */
async function printCheapestPrinting(cardName: string, scripting: ScriptingOptions): Promise<void> {
  if (scripting.output !== 'text' || scripting.quiet) return
  const currency = getDefaultCurrency()
  const allPrintings = await getCardPrintings(cardName)
  console.log(formatCheapestPrintingDisplay(findCheapestPrinting(allPrintings, currency), currency))
}
