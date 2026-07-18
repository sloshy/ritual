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
  isResolveListError,
  listLocations,
  listTypeFromFlags,
  parseListArgument,
  resolveList,
  type ListTypeFlags,
  type ResolveListError,
} from '../resolve-list'
import { formatPrintingAnnotation } from '../change-event'
import { isNoInput } from '../no-input'
import { matchFinishPin, matchPrintingPin } from './collection-helpers'
import { getCardPrintings } from '../scryfall'
import { CardCommandError, getErrorMessage } from '../errors'
import type { Condition, Finish, ScryfallCard } from '../types'

/** Unified summary for a card entry across all list types. */
export type EntryRef = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
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
 * Parse a string that must be a strictly positive integer (digits only, no
 * sign, no decimals, no leading zeros). Returns `undefined` when the input is
 * not one — the caller owns the error representation for its surface.
 */
export function parsePositiveInteger(raw: string): number | undefined {
  if (!/^[1-9]\d*$/.test(raw)) return undefined
  return Number.parseInt(raw, 10)
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

// ── List resolution ─────────────────────────────────────────────────────────

/** A located list and the type it was resolved to. */
export type ResolvedList = { type: ListType; filePath: string }

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
  if (error.kind === 'ambiguous') {
    return new CardCommandError('usage_error', formatResolveListError(error), ExitCode.UsageError)
  }
  return new CardCommandError('not_found', formatResolveListError(error), ExitCode.NotFound)
}

/**
 * Resolve the target list for a card command. When `listName` is given it is
 * matched via the shared resolver — an optional `deck:`/`collection:`/`wanted:`
 * prefix overrides `type` (from a type flag), matching is case-insensitive, and
 * ambiguity is a usage error. When `listName` is omitted, the user picks
 * interactively from the lists in scope.
 */
export async function resolveListSelection(
  listName: string | undefined,
  type: ListType | undefined,
): Promise<ResolvedList> {
  if (listName !== undefined) {
    const arg = parseListArgument(listName)
    const resolved = await resolveList(arg.name, arg.type ?? type)
    if (isResolveListError(resolved)) throw resolveErrorToCommandError(resolved)
    return { type: resolved.type, filePath: resolved.filePath }
  }

  requireInteractive('a list name')
  const locations = await listLocations(type)
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
    return matches[0]!
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
        })),
      },
    )
  }

  return promptCardSelection(entries)
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

/**
 * Whether interactive prompting is unavailable for this process: `--no-input`
 * (or `RITUAL_NO_INPUT`) disabled prompts, or stdin is not a terminal. The
 * single source of truth for the prompt gate — commands must consult this (or
 * {@link requireInteractive}) rather than re-deriving the condition inline, so
 * the `--no-input` half can never be dropped from one copy.
 */
export function promptsUnavailable(): boolean {
  return isNoInput() || !process.stdin.isTTY
}

/**
 * Refuse to open an interactive picker when prompting is unavailable — stdin
 * is not a terminal, or `--no-input` disabled prompts. Without this, a script
 * that omits a selector either exits 0 having done nothing (closed stdin: the
 * prompt never resolves and the event loop drains) or blocks — never an
 * acceptable one-shot contract.
 */
export function requireInteractive(what: string): void {
  if (promptsUnavailable()) {
    throw new CardCommandError(
      'usage_error',
      `Input required: pass ${what} (interactive selection is unavailable without a terminal or with --no-input).`,
      ExitCode.UsageError,
    )
  }
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

/**
 * Resolve a strict `--set`/`--collector-number` pin against the card's known
 * printings. A failed cache lookup is a runtime error; a pin that matches no
 * printing is a usage error listing the printings that do exist — deliberately
 * not routed through `resolveCardPrinting`'s soft set filter, which falls back
 * to all printings instead of failing.
 */
export async function resolvePinnedPrinting(
  cardName: string,
  pin: PrintingPin,
): Promise<ScryfallCard> {
  let printings: ScryfallCard[]
  try {
    printings = await getCardPrintings(cardName)
  } catch (err) {
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

/** Reject a valid `--finish` the chosen printing is not offered in. */
export function ensureFinishAvailable(
  cardName: string,
  printing: ScryfallCard,
  finish: Finish,
): void {
  const match = matchFinishPin(cardName, printing, finish)
  if (!match.ok) {
    throw new CardCommandError('usage_error', match.message, ExitCode.UsageError, {
      availableFinishes: match.available,
    })
  }
}
