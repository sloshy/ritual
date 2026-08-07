/**
 * Shared list/card targeting for one-shot card commands (`note`, `remove-card`,
 * `set-card`, ...). Each command brings its own flags and apply step, but the
 * work of locating the target list and finding the right card entry is
 * identical: resolve the list (with `deck:`/`collection:`/`wanted:` prefix and
 * type-flag support), then resolve the entry by `--card-id`, fuzzy name, or an
 * interactive picker.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { InvalidArgumentError, type Command } from 'commander'
import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import { importFromTextFile } from '../importers/text-file'
import { parseCollectionFile } from '../collection-file'
import { parseWantedListFile } from './wanted-helpers'
import { emitError, ExitCode, type ScriptingOptions } from './scripting'
import { matchByNormalizedName } from '../term-match'
import { type ListType } from '../list-type'
import {
  formatResolveListError,
  isListArgumentConflict,
  isResolveListError,
  listLocations,
  listTypeFromFlags,
  resolveList,
  resolveListArgument,
  type ListTypeFlags,
  type ResolveListError,
} from '../resolve-list'
import { formatPrintingAnnotation } from '../change-event'
import { requireInteractive } from '../no-input'
import { matchFinishPin, matchPrintingPin } from './collection-helpers'
import {
  fetchPrintingByCollectorNumber,
  getCardPrintingsResult,
  getFrontFaceName,
} from '../scryfall'
import {
  findPrinting,
  hasSpecificPrinting,
  printingLanguages,
  printingsAreComplete,
  type CardPrintingsResult,
  type PrintingFields,
} from '../card-printing'
import { readRecordedCardBulkType } from '../cache/bulk-provenance'
import { CardCommandError, getErrorMessage } from '../errors'
import { parsePositiveInteger } from '../parse-number'
import type { CardLabel } from '../card-labels'
import {
  displayLanguage,
  formatLanguageList,
  invalidLanguageMessage,
  languageDisplayName,
  normalizeLanguageValue,
  type CardLanguage,
} from '../card-language'
import type { Condition, Finish, ScryfallCard } from '../types'

/** Unified summary for a card entry across all list types. */
export type EntryRef = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The line's language token, when present. Absent means `en` (a bare line means English). */
  language?: CardLanguage
  /** Label override — collections only; deck and wanted entries never carry labels. */
  labels?: CardLabel[]
  note?: string
  cardId?: number
  /** Line quantity — decks only; flat-list entries are one physical card each. */
  quantity?: number
}

/**
 * Run a one-shot command's action body, mapping a thrown
 * {@link CardCommandError} to the scripting error channel and process exit
 * code — the standard action-handler shell shared by every one-shot command.
 * Anything else propagates untouched.
 */
export async function runCommandAction(
  scripting: ScriptingOptions,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run()
  } catch (err) {
    if (err instanceof CardCommandError) {
      emitError(err.code, err.message, scripting, err.details)
      process.exitCode = err.exitCode
      return
    }
    throw err
  }
}

export type ResolveTargetInput = {
  cardId: number | undefined
  cardName: string | undefined
}

/** Fields every one-shot card command's JSON success payload shares. */
export type CardCommandResultBase = {
  type: ListType
  list: string
  cardName: string
  cardId: number | undefined
}

/**
 * Parse a `--card-id` flag value into a positive integer. Rejects floats,
 * negatives, zero, and non-digit input.
 */
export function parseCardIdFlag(raw: string): number {
  const parsed = parsePositiveInteger(raw)
  if (parsed === undefined) {
    throw new CardCommandError(
      'usage_error',
      `--card-id must be a positive integer (got '${raw}').`,
      ExitCode.UsageError,
    )
  }
  return parsed
}

/**
 * Parse a `--language` flag value: a Scryfall language code or one of the
 * usual aliases (e.g. `jp`), refused via {@link invalidLanguageMessage}.
 * `hint` is an extra clause appended to the `for --language` context
 * (`set-card` passes `(en clears the token)`). Wrap in an arrow when handing
 * to Commander — an argParser's second argument is the previous value, which
 * must not land here as the hint.
 */
export function parseLanguageFlag(value: string, hint?: string): CardLanguage {
  const result = normalizeLanguageValue(value)
  if (result === null) {
    throw new InvalidArgumentError(
      invalidLanguageMessage(value, hint ? `for --language ${hint}` : 'for --language'),
    )
  }
  return result
}

// ── List resolution ─────────────────────────────────────────────────────────

/** A located list and the type it was resolved to. */
export type ResolvedList = { type: ListType; filePath: string }

/** Options for {@link resolveListSelection}'s interactive fallback. */
export type ResolveListSelectionOptions = {
  /**
   * Which list types the interactive picker offers (a command that would
   * refuse a type after picking should not offer it). Explicit names still
   * resolve across every type in scope, so the refusal path keeps its message.
   */
  pickerTypes?: readonly ListType[]
}

/**
 * Register the shared `--deck`/`--collection`/`--wanted` type flags every
 * list-resolving command offers, with the standard help text.
 */
export function addListTypeFlags(command: Command): Command {
  return command
    .option('--deck', 'Resolve the name as a deck')
    .option('--collection', 'Resolve the name as a collection')
    .option('--wanted', 'Resolve the name as a wanted list')
}

/**
 * Resolve the mutually-exclusive `--deck`/`--collection`/`--wanted` flags for a
 * one-shot card command's action handler. A conflict is reported through the
 * scripting error channel and sets the usage-error exit code — the caller only
 * has to check for `'conflict'` and return.
 */
export function resolveListTypeFlag(
  flags: ListTypeFlags,
  scripting: ScriptingOptions,
): ListType | undefined | 'conflict' {
  const type = listTypeFromFlags(flags)
  if (type === 'conflict') {
    emitError('usage_error', 'Specify only one of --deck, --collection, or --wanted.', scripting)
    process.exitCode = ExitCode.UsageError
  }
  return type
}

function resolveErrorToCommandError(error: ResolveListError): CardCommandError {
  // Every one-shot card command registers --deck/--collection/--wanted.
  const message = formatResolveListError(error, 'type-flags')
  if (error.kind === 'ambiguous') {
    return new CardCommandError('usage_error', message, ExitCode.UsageError)
  }
  return new CardCommandError('not_found', message, ExitCode.NotFound)
}

/**
 * Resolve the target list for a card command. When `listName` is given it is
 * matched via the shared resolver — an optional `deck:`/`collection:`/`wanted:`
 * prefix supplies `type` when no type flag was passed and is a usage error when
 * it contradicts one, matching is case-insensitive, and ambiguity is a usage
 * error. When `listName` is omitted, the user picks interactively from the lists
 * in scope.
 *
 * **Precondition:** the calling command registers `--deck`/`--collection`/`--wanted`
 * — the ambiguity error advises those flags. Every one-shot card command
 * (`add-card`, `remove-card`, `set-card`, `note`, `rename`, `delete`) does; a
 * flagless command must not use this helper without changing that advice.
 */
export async function resolveListSelection(
  listName: string | undefined,
  type: ListType | undefined,
  options?: ResolveListSelectionOptions,
): Promise<ResolvedList> {
  if (listName !== undefined) {
    const arg = resolveListArgument(listName, type)
    if (isListArgumentConflict(arg)) {
      throw new CardCommandError('usage_error', arg.message, ExitCode.UsageError)
    }
    const resolved = await resolveList(arg.name, arg.type)
    if (isResolveListError(resolved)) throw resolveErrorToCommandError(resolved)
    return { type: resolved.type, filePath: resolved.filePath }
  }

  requireInteractive('a list name')
  const allLocations = await listLocations(type)
  const locations = options?.pickerTypes
    ? allLocations.filter((loc) => options.pickerTypes!.includes(loc.type))
    : allLocations
  if (locations.length === 0) {
    throw new CardCommandError(
      'not_found',
      type
        ? `No ${listTypeLabel(type).toLowerCase()} files found. Create one first.`
        : 'No decks, collections, or wanted lists found. Create one first.',
      ExitCode.NotFound,
    )
  }

  let exited = false
  const resp = await prompts({
    type: 'autocomplete',
    name: 'index',
    message: 'Select a list:',
    choices: locations.map((loc, i) => ({
      title: `${loc.name} — ${listTypeLabel(loc.type)}`,
      value: i,
    })),
    limit: 15,
    onState: (state: PromptState) => {
      if (state.exited) exited = true
    },
  })
  if (exited || typeof resp.index !== 'number') {
    throw new CardCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
  const chosen = locations[resp.index]
  if (!chosen) {
    throw new CardCommandError('runtime_error', 'Selection out of range.', ExitCode.RuntimeError)
  }
  return { type: chosen.type, filePath: chosen.filePath }
}

// ── Entry loading + target resolution ─────────────────────────────────────────

/** Load every card entry of a list as a type-agnostic {@link EntryRef}. */
export async function loadEntryRefs(type: ListType, filePath: string): Promise<EntryRef[]> {
  if (type === 'deck') {
    const deck = await importFromTextFile(filePath)
    const entries: EntryRef[] = []
    for (const section of deck.sections) {
      for (const card of section.cards) {
        entries.push({
          name: card.name,
          set: card.set,
          collectorNumber: card.collectorNumber,
          finish: card.finish,
          condition: card.condition,
          language: card.language,
          note: card.note,
          cardId: card.cardId,
          quantity: card.quantity,
        })
      }
    }
    return entries
  }
  if (type === 'collection') {
    const content = await fs.readFile(filePath, 'utf-8')
    const { entries } = parseCollectionFile(content)
    return entries.map((e) => ({
      name: e.name,
      set: e.set,
      collectorNumber: e.collectorNumber,
      finish: e.finish,
      condition: e.condition,
      language: e.language,
      labels: e.labels,
      note: e.note,
      cardId: e.cardId,
    }))
  }
  const content = await fs.readFile(filePath, 'utf-8')
  const { entries } = parseWantedListFile(content)
  return entries.map((e) => ({
    name: e.name,
    set: e.set,
    collectorNumber: e.collectorNumber,
    finish: e.finish,
    language: e.language,
    note: e.note,
    cardId: e.cardId,
  }))
}

export async function resolveTarget(
  type: ListType,
  filePath: string,
  input: ResolveTargetInput,
): Promise<EntryRef> {
  const entries = await loadEntryRefs(type, filePath)
  if (entries.length === 0) {
    throw new CardCommandError('not_found', `${listTypeLabel(type)} is empty.`, ExitCode.NotFound)
  }

  if (input.cardId !== undefined) {
    const matches = entries.filter((e) => e.cardId === input.cardId)
    if (matches.length === 0) {
      throw new CardCommandError(
        'not_found',
        `No card with id ${input.cardId} found in ${path.basename(filePath)}.`,
        ExitCode.NotFound,
      )
    }
    // Card IDs are unique per file, so we expect exactly one match.
    const matched = matches[0]!
    ensureCardIdMatchesName({
      cardId: input.cardId,
      entryName: matched.name,
      requestedName: input.cardName,
    })
    return matched
  }

  if (input.cardName !== undefined) {
    // Exact-name matches beat substring matches (see matchByNormalizedName).
    const matched = matchByNormalizedName(entries, input.cardName, (e) => e.name)
    if (matched.length === 0) {
      throw new CardCommandError(
        'not_found',
        `No card matching '${input.cardName}' found in ${path.basename(filePath)}.`,
        ExitCode.NotFound,
      )
    }
    if (matched.length === 1) return matched[0]!
    throw new CardCommandError(
      'usage_error',
      formatAmbiguityMessage(input.cardName, matched),
      ExitCode.UsageError,
      {
        matches: matched.map((e) => ({
          name: e.name,
          cardId: e.cardId,
          set: e.set,
          collectorNumber: e.collectorNumber,
          finish: e.finish,
          condition: e.condition,
          language: e.language,
        })),
      },
    )
  }

  return promptCardSelection(entries)
}

/**
 * Cross-check a `--card-id` against a card name given alongside it: the two
 * selectors must agree. IDs are pool-allocated and reused after a removal, so a
 * script (or an agent) holding a stale ID would otherwise silently mutate — or
 * destroy — whichever card now carries it, reported as success.
 *
 * Matching is the same two-tier rule the name-only path uses
 * ({@link matchByNormalizedName}), so a partial name that would have found the
 * card also passes here. Pure-ID and pure-name invocations never reach this.
 */
export function ensureCardIdMatchesName(check: CardIdNameCheck): void {
  const { cardId, entryName, requestedName } = check
  if (requestedName === undefined) return
  if (matchByNormalizedName([entryName], requestedName, (name) => name).length > 0) return
  throw new CardCommandError(
    'usage_error',
    `--card-id ${cardId} is '${entryName}', which does not match '${requestedName}'. Pass one selector or the other.`,
    ExitCode.UsageError,
    { cardId, entryName, requestedName },
  )
}

/** The two selectors {@link ensureCardIdMatchesName} cross-checks. */
export type CardIdNameCheck = {
  /** The `--card-id` value that selected the entry. */
  cardId: number
  /** The name of the entry that id resolved to. */
  entryName: string
  /** The card name the user passed alongside the id, if any. */
  requestedName: string | undefined
}

function formatAmbiguityMessage(search: string, matches: EntryRef[]): string {
  const lines = matches
    .slice(0, 10)
    .map((m) => `  - ${describeEntry(m)}`)
    .join('\n')
  const suffix = matches.length > 10 ? `\n  ... and ${matches.length - 10} more` : ''
  return `Multiple cards match '${search}'. Pick one with --card-id <id> or run interactively:\n${lines}${suffix}`
}

/** One-line human description of an entry: name, printing annotation, `&id`. */
export function describeEntry(entry: EntryRef): string {
  const annotation = formatPrintingAnnotation(entry)
  const id = entry.cardId !== undefined ? ` &${entry.cardId}` : ''
  return `${entry.name}${annotation}${id}`
}

async function promptCardSelection(entries: EntryRef[]): Promise<EntryRef> {
  requireInteractive('a card name or --card-id <id>')
  const choices = entries.map((e, i) => ({
    title: describeEntry(e) + (e.note ? ` — note: "${e.note}"` : ''),
    value: i,
  }))
  let exited = false
  const resp = await prompts({
    type: 'autocomplete',
    name: 'index',
    message: 'Select a card:',
    choices,
    limit: 15,
    suggest: async (rawInput, suggestChoices) => {
      const input = String(rawInput).toLowerCase().trim()
      if (!input) return suggestChoices.slice(0, 15)
      const terms = input.split(/\s+/).filter(Boolean)
      return suggestChoices.filter((c) => {
        const title = c.title.toLowerCase()
        return terms.every((t) => title.includes(t))
      })
    },
    onState: (state: PromptState) => {
      if (state.exited) exited = true
    },
  })
  if (exited || typeof resp.index !== 'number') {
    throw new CardCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
  const target = entries[resp.index]
  if (!target) {
    throw new CardCommandError('runtime_error', 'Selection out of range.', ExitCode.RuntimeError)
  }
  return target
}

export function listTypeLabel(type: ListType): string {
  if (type === 'deck') return 'Deck'
  if (type === 'collection') return 'Collection'
  return 'Wanted list'
}

// ── Printing pins ─────────────────────────────────────────────────────────────

/** A strict `--set`/`--collector-number` printing pin (set code lowercase). */
export type PrintingPin = { set: string; collectorNumber: string }

/** Case-insensitive name match tolerating a front-face-only spelling. */
function sameCardName(a: string, b: string): boolean {
  if (a.toLowerCase() === b.toLowerCase()) return true
  return getFrontFaceName(a).toLowerCase() === getFrontFaceName(b).toLowerCase()
}

/**
 * Verify a pin the local cache cannot vouch for by asking Scryfall for that
 * exact printing.
 *
 * Without this, a workspace whose cache has never been bulk-downloaded
 * validates pins against a single-card `/cards/named` fallback — so every real
 * printing but the one Scryfall happened to return is rejected, under a message
 * asserting it is the card's only "available printing".
 */
async function verifyPinAgainstScryfall(cardName: string, pin: PrintingPin): Promise<ScryfallCard> {
  const advice = `The card cache holds no printing list for '${cardName}'. Run 'ritual cache preload-all' to download it.`
  let printing: ScryfallCard | null
  try {
    printing = await fetchPrintingByCollectorNumber(pin.set, pin.collectorNumber)
  } catch (err) {
    throw new CardCommandError(
      'runtime_error',
      `Failed to verify printing ${pin.set.toUpperCase()}:${pin.collectorNumber}: ${getErrorMessage(err)}. ${advice}`,
      ExitCode.RuntimeError,
    )
  }
  if (!printing) {
    throw new CardCommandError(
      'usage_error',
      `Could not verify printing ${pin.set.toUpperCase()}:${pin.collectorNumber} of '${cardName}' with Scryfall. ${advice}`,
      ExitCode.UsageError,
    )
  }
  if (!sameCardName(printing.name, cardName)) {
    throw new CardCommandError(
      'usage_error',
      `${pin.set.toUpperCase()}:${pin.collectorNumber} is '${printing.name}', not '${cardName}'.`,
      ExitCode.UsageError,
    )
  }
  return printing
}

/**
 * Resolve a strict `--set`/`--collector-number` pin against the card's known
 * printings. A failed cache lookup is a runtime error; a pin that matches no
 * printing is a usage error listing the printings that do exist — deliberately
 * not routed through `resolveCardPrinting`'s soft set filter, which falls back
 * to all printings instead of failing.
 *
 * The listing is only trustworthy when it came from the card cache. When the
 * cache holds no entry for the name, the pin is verified against Scryfall
 * directly rather than against the one printing a fallback fetch returned.
 */
export async function resolvePinnedPrinting(
  cardName: string,
  pin: PrintingPin,
): Promise<ScryfallCard> {
  let printings: ScryfallCard[]
  try {
    // Cache-only: a `/cards/named` fallback could not be trusted to validate the
    // pin anyway, so the miss goes straight to verifying the pinned printing
    // itself — one request instead of two.
    const result = await getCardPrintingsResult(cardName, { network: false })
    if (!printingsAreComplete(result)) return await verifyPinAgainstScryfall(cardName, pin)
    printings = result.printings
  } catch (err) {
    if (err instanceof CardCommandError) throw err
    throw new CardCommandError(
      'runtime_error',
      `Failed to look up printings for '${cardName}': ${getErrorMessage(err)}`,
      ExitCode.RuntimeError,
    )
  }
  const match = matchPrintingPin(cardName, printings, pin.set, pin.collectorNumber)
  if (!match.ok) {
    throw new CardCommandError('usage_error', match.message, ExitCode.UsageError, {
      available: match.available,
      totalPrintings: match.totalPrintings,
    })
  }
  return match.printing
}

/** Why {@link ensureFinishAvailableForEntry} could not check a finish. */
export type FinishCheckSkip =
  /** The entry carries no `(SET:CN)` printing — there is nothing to check against. */
  | 'no-printing'
  /** The card cache holds no complete printing list for the name. */
  | 'cache-miss'
  /** The cache knows the card but not this printing. */
  | 'printing-unknown'

/** Either the finish was checked, or the reason it could not be. */
export type FinishCheckResult = { checked: true } | { checked: false; reason: FinishCheckSkip }

/**
 * Validate a finish against the printing an entry **already** carries.
 *
 * Cache-only, deliberately: a `/cards/named` fallback returns a single arbitrary
 * printing, and rejecting a finish against a list that is not the card's whole
 * printing set fabricates a refusal. When the cache cannot vouch for the
 * printing, the check is skipped and the reason reported — a missing local cache
 * must never turn into a wrong answer, and no in-place edit performs a hidden
 * network fetch to grade a finish.
 */
export async function ensureFinishAvailableForEntry(
  cardName: string,
  entry: PrintingFields,
  finish: Finish,
): Promise<FinishCheckResult> {
  if (!hasSpecificPrinting(entry)) return { checked: false, reason: 'no-printing' }
  let result: CardPrintingsResult
  try {
    result = await getCardPrintingsResult(cardName, { network: false })
  } catch (err) {
    if (err instanceof CardCommandError) throw err
    throw new CardCommandError(
      'runtime_error',
      `Failed to look up printings for '${cardName}': ${getErrorMessage(err)}`,
      ExitCode.RuntimeError,
    )
  }
  if (!printingsAreComplete(result)) return { checked: false, reason: 'cache-miss' }
  const printing = findPrinting(result.printings, entry.set, entry.collectorNumber)
  if (!printing) return { checked: false, reason: 'printing-unknown' }
  ensureFinishAvailable(cardName, printing, finish)
  return { checked: true }
}

/**
 * Either the language was checked (and is available), or the reason it could
 * not be: the entry carries no `(SET:CN)` printing (a language claim on a
 * name-only line is unverifiable), or the on-demand Scryfall verification
 * could not be reached — only that branch carries the underlying error text.
 */
export type LanguageCheckResult =
  | { checked: true }
  | { checked: false; reason: 'no-printing' }
  | { checked: false; reason: 'verify-failed'; detail?: string }

/**
 * Validate that a printing exists in `language` before recording a `[lang]`
 * token for it.
 *
 * Unlike the finish check this is not cache-only: the common cache is built
 * from `default_cards` (English only), so a missing `ja` object proves nothing.
 * The check is layered:
 *
 * 1. `en` always passes — it is the bare-line default every printing's default
 *    object satisfies.
 * 2. The cached printing list can prove *availability* (it holds an object in
 *    that language) regardless of which bulk built it.
 * 3. It can prove *unavailability* only when it is complete AND was built from
 *    the `all_cards` bulk — then the absence is a fact, refused without a fetch.
 * 4. Otherwise the printing is verified on demand via
 *    `GET /cards/{set}/{cn}/{lang}`, exactly the pin-verification pattern: a
 *    404 is the user's mistake (usage error), while an unreachable API skips
 *    the check with `verify-failed` rather than fabricating a refusal.
 */
export async function ensureLanguageAvailableForEntry(
  cardName: string,
  entry: PrintingFields,
  language: CardLanguage,
): Promise<LanguageCheckResult> {
  if (displayLanguage(language) === 'en') return { checked: true }
  if (!hasSpecificPrinting(entry)) return { checked: false, reason: 'no-printing' }

  let result: CardPrintingsResult
  try {
    result = await getCardPrintingsResult(cardName, { network: false })
  } catch (err) {
    if (err instanceof CardCommandError) throw err
    throw new CardCommandError(
      'runtime_error',
      `Failed to look up printings for '${cardName}': ${getErrorMessage(err)}`,
      ExitCode.RuntimeError,
    )
  }
  const available = printingLanguages(result.printings, entry.set, entry.collectorNumber)
  if (available.includes(language)) return { checked: true }

  const printingLabel = `${entry.set.toUpperCase()}:${entry.collectorNumber}`
  if (
    printingsAreComplete(result) &&
    available.length > 0 &&
    (await readRecordedCardBulkType()) === 'all_cards'
  ) {
    throw new CardCommandError(
      'usage_error',
      `Printing ${printingLabel} of '${cardName}' is not available in ${languageDisplayName(language)} (${language}). Available languages: ${formatLanguageList(available)}.`,
      ExitCode.UsageError,
      { availableLanguages: available },
    )
  }

  let printing: ScryfallCard | null
  try {
    printing = await fetchPrintingByCollectorNumber(entry.set, entry.collectorNumber, language)
  } catch (err) {
    return { checked: false, reason: 'verify-failed', detail: getErrorMessage(err) }
  }
  if (!printing) {
    throw new CardCommandError(
      'usage_error',
      `Scryfall has no ${languageDisplayName(language)} (${language}) object for printing ${printingLabel} of '${cardName}'.`,
      ExitCode.UsageError,
    )
  }
  if (!sameCardName(printing.name, cardName)) {
    throw new CardCommandError(
      'usage_error',
      `${printingLabel} is '${printing.name}', not '${cardName}'.`,
      ExitCode.UsageError,
    )
  }
  return { checked: true }
}

/**
 * Reject a valid finish the chosen printing is not offered in. `carriedOver`
 * marks a finish that came from the entry rather than a `--finish` flag, so the
 * refusal says how to resolve it instead of blaming a flag the user never
 * passed.
 */
export function ensureFinishAvailable(
  cardName: string,
  printing: ScryfallCard,
  finish: Finish,
  carriedOver = false,
): void {
  const match = matchFinishPin(cardName, printing, finish)
  if (!match.ok) {
    const message = carriedOver
      ? `${match.message} The entry already records ${finish}; pass --finish to record an available one.`
      : match.message
    throw new CardCommandError('usage_error', message, ExitCode.UsageError, {
      availableFinishes: match.available,
    })
  }
}
