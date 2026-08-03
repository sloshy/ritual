import { Command, InvalidArgumentError, Option } from 'commander'
import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import {
  getAllCardNames,
  getCardPrintings,
  getCardPrintingsResult,
  isDigitalOnlySet,
} from '../scryfall'
import { printingsAreComplete } from '../card-printing'
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
  formatCollectionLine,
  ensureCollectionFile,
} from './collection-helpers'
import {
  applyConditionUpdate,
  isCondition,
  isFinish,
  normalizeFinishValue,
  VALID_CONDITIONS,
} from '../finish-condition'
import { parseSetCode } from '../set-codes'
import { ensureWantedListFile, formatWantedListLine, promptWantedFinish } from './wanted-helpers'
import { isUsableFileName, unusableFileNameMessage } from '../list-file-name'
import { emptyCacheAdvice, ensureFreshCardCache } from '../cache/freshness'
import { addRefreshOption, type RefreshMode } from '../refresh'
import { appendChangelog } from '../changelog-writer'
import { createAddChange, type ConditionUpdate } from '../change-event'
import { allocateNextIdFromContent } from '../card-id'
import { endsInsideOpenFence } from '../markdown-fence'
import { appendFileWithHash } from '../content-hash'
import {
  findCheapestPrinting,
  formatSpecificPrintingPrice,
  formatCheapestPrintingDisplay,
} from '../price-currency'
import type { Condition, Finish, ScryfallCard } from '../types'
import type { ListType } from '../list-type'
import {
  matchesAllNameTerms,
  matchesNameTerms,
  normalizeCardName,
  rankNameMatches,
  splitNameTerms,
} from '../term-match'
import {
  formatResolveListError,
  isListArgumentConflict,
  isResolveListError,
  resolveList,
  resolveListArgument,
  type ListTypeFlags,
} from '../resolve-list'
import {
  ensureFinishAvailable,
  resolveListTypeFlag,
  resolvePinnedPrinting,
  runCommandAction,
  type EntryRef,
  type PrintingPin,
} from './card-target'
import { parsePositiveInteger } from '../parse-number'
import { inputRequiredError, promptsUnavailable } from '../no-input'
import {
  addDryRunOption,
  addScriptingOptions,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type DryRunOptions,
  type ScriptingOptions,
} from './scripting'
import { divertConsoleLogToStderr } from '../mcp/stdout-guard'
import { CardCommandError } from '../errors'
import { getCollectionsDir, getDefaultCurrency, getWantedDir } from '../ritual-config'
import { listFileName } from '../list-file-name'

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
    .option('-f, --finish <finish>', 'Card finish: nonfoil, foil, etched', parseFinishFlag)
    .option(
      '-c, --condition <condition>',
      'Card condition: NM, LP, MP, HP, DMG, or NONE to record no condition (decks and collections only)',
      parseConditionFlag,
    )
    .option('--section <name>', 'Deck section to add to, created if missing (decks only)')
    .option('--commander', "Add the card to the deck's Commander section (decks only)")
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
  addDryRunOption(command, 'Report what would be added without writing anything')
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
  if (isListArgumentConflict(listArg)) {
    throw new CardCommandError('usage_error', listArg.message, ExitCode.UsageError)
  }
  const type = listArg.type

  // Every check that can refuse the run happens before anything is written —
  // the target list is only *resolved* here, never created (see
  // `ensureTargetFile`), so a doomed add leaves the workspace as it found it.
  if (type !== undefined) validateTargetFlags(type, pin, options)

  const cacheResult = await ensureFreshCardCache(options.refresh)
  if (!cacheResult.ready) {
    throw new CardCommandError(
      'runtime_error',
      emptyCacheAdvice('Card cache is not available.'),
      ExitCode.RuntimeError,
    )
  }
  info(`Loaded ${cacheResult.cardCount} cards from cache.`, scripting)

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
  if (type === 'wanted' && options.condition !== undefined) {
    throw new CardCommandError(
      'usage_error',
      'Wanted list entries do not track condition — --condition applies to decks and collections only.',
      ExitCode.UsageError,
    )
  }
  if (type !== 'deck' && (options.section !== undefined || options.commander)) {
    throw new CardCommandError(
      'usage_error',
      '--section and --commander apply only to deck targets.',
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
    throw inputRequiredError(
      'wanted-list adds are interactive by default — pass --name-only, --specific, or --set/--collector-number',
    )
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

  // Auto-create only when the type is known and no such list exists yet —
  // whether that is one missing list or an empty workspace.
  if ((resolved.kind === 'not-found' || resolved.kind === 'no-lists') && type) {
    if (type === 'deck') {
      throw new CardCommandError(
        'not_found',
        `No deck named '${name}' found. Create it first with 'ritual new deck'.`,
        ExitCode.NotFound,
      )
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
      const countLabel = matchCount >= 100 ? '100+' : String(matchCount)
      throw new CardCommandError(
        'not_found',
        `No exact match for '${cardNameInput}'. ${countLabel} card${matchCount !== 1 ? 's' : ''} match that name.`,
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
    if (countTermMatches(cardNameInput, cardNames, 1) === 0) {
      throw new CardCommandError(
        'not_found',
        `No cards found matching '${cardNameInput}'.`,
        ExitCode.NotFound,
      )
    }
    throw inputRequiredError(
      `pass the full card name — '${cardNameInput}' does not exactly match a cached card name, and the card picker cannot open`,
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
  // Pre-filter by term, matching what `suggest` does to what is typed next — a
  // substring pre-filter would drop names the prompt itself would have offered.
  let filteredNames = cardNames
  if (initialSearch) {
    filteredNames = cardNames.filter((name) => matchesAllNameTerms(name, initialSearch))

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

    filteredNames = rankNameMatches(filteredNames, initialSearch, (name) => name)
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
  emitSuccess(
    {
      type: 'deck',
      list: target.name,
      cardName: selectedName,
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: card.finish,
      condition: card.condition,
      quantity: options.quantity,
      cardId: outcome.cardId,
      section: outcome.section,
    },
    `${addVerb(options.dryRun ?? false)} '${options.quantity} ${selectedName}${printingLabel}' to ${path.basename(target.filePath)} (${outcome.section})`,
    scripting,
    options.dryRun ?? false,
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
  if (!options.dryRun) {
    await ensureTargetFile(target)
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
      cardId,
    },
    `${addVerb(options.dryRun ?? false)}: ${line.trim()}`,
    scripting,
    options.dryRun ?? false,
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
    // Cache-only, and only when the cache holds the card's whole printing list:
    // a cache-miss `/cards/named` fallback always returns exactly one printing,
    // and accepting it would pin an arbitrary printing rather than the card's
    // only one. Without that list there is nothing to auto-accept.
    const result = await getCardPrintingsResult(cardName, { network: false })
    if (!printingsAreComplete(result)) throw makeFailure()
    const printings = result.printings.filter((p) => !isDigitalOnlySet(p.set))
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
    if (!options.dryRun) {
      await ensureTargetFile(target)
      await appendFileWithHash(target.filePath, line)
      await appendChangelog(target.filePath, target.name, [
        createAddChange(selectedName, { finish: options.finish, cardId }),
      ])
    }
    emitSuccess(
      {
        type: 'wanted',
        list: target.name,
        cardName: selectedName,
        finish: options.finish,
        cardId,
      },
      `${addVerb(options.dryRun ?? false)}: ${line.trim()}`,
      scripting,
      options.dryRun ?? false,
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
  if (!options.dryRun) {
    await ensureTargetFile(target)
    await appendFileWithHash(target.filePath, line)
    await appendChangelog(target.filePath, target.name, [
      createAddChange(selectedName, {
        set: printing.set.toLowerCase(),
        collectorNumber: printing.collector_number,
        finish,
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
      cardId,
    },
    `${addVerb(options.dryRun ?? false)}: ${line.trim()}`,
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

/**
 * The verb a success line opens with: a dry run reports what *would* happen.
 * Callers build their own message so the tense reads naturally in each flow.
 */
function addVerb(dryRun: boolean): string {
  return dryRun ? 'Would add' : 'Added'
}

function emitSuccess(
  payload: AddCardSuccess,
  textLine: string,
  scripting: ScriptingOptions,
  dryRun: boolean,
): void {
  if (scripting.output === 'text') {
    if (!scripting.quiet) emitOutput(dryRun ? `[dry-run] ${textLine}` : textLine, scripting)
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
