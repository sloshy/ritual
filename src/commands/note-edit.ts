/**
 * Shared resolution and apply logic for note-editing commands (`add-note`,
 * `clear-note`). Each command brings its own UX (prompt vs. straight clear, note
 * validation), but the work of locating the target list, finding the right card
 * entry, and rewriting the file is identical.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import { importFromTextFile } from '../importers/text-file'
import { serializeDeckToMarkdown, parseDeckFrontMatter } from '../deck-file'
import { parseCollectionFile, COLLECTION_CARD_LINE_RE } from './price-collection'
import { parseWantedListFile, formatWantedListLine, WANTED_CARD_LINE_RE } from './wanted-helpers'
import { formatCollectionLine } from './collection-helpers'
import { writeFileWithHash } from '../content-hash'
import { ExitCode } from './scripting'
import { normalizeCardName } from './add-card'
import { type ListType } from '../list-type'
import {
  formatResolveListError,
  isResolveListError,
  listLocations,
  resolveList,
  type ResolveListError,
} from '../resolve-list'
import { noteOrUndefined } from '../note-helpers'
import { formatPrintingAnnotation } from '../change-event'
import type { Card, Condition, DeckData, ErrorCode, Finish } from '../types'

/** Unified summary for a card entry across all list types. */
export type EntryRef = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  note?: string
  cardId?: number
}

/** Structured error thrown by note-editing commands. The action handler should
 * `instanceof`-check this to convert it into an `emitError` call. */
export class NoteCommandError extends Error {
  readonly code: ErrorCode
  readonly exitCode: number
  readonly details?: unknown
  constructor(code: ErrorCode, message: string, exitCode: number, details?: unknown) {
    super(message)
    this.code = code
    this.exitCode = exitCode
    this.details = details
  }
}

export type ResolveTargetInput = {
  cardId: number | undefined
  cardName: string | undefined
}

/**
 * Parse a `--card-id` flag value into a positive integer. Rejects floats,
 * negatives, zero, and non-digit input.
 */
export function parseCardIdFlag(raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new NoteCommandError(
      'usage_error',
      `--card-id must be a positive integer (got '${raw}').`,
      ExitCode.UsageError,
    )
  }
  return Number.parseInt(raw, 10)
}

// ── List resolution ─────────────────────────────────────────────────────────

/** A located list and the type it was resolved to. */
export type ResolvedList = { type: ListType; filePath: string }

function resolveErrorToNoteError(error: ResolveListError): NoteCommandError {
  if (error.kind === 'ambiguous') {
    return new NoteCommandError('usage_error', formatResolveListError(error), ExitCode.UsageError)
  }
  return new NoteCommandError('not_found', formatResolveListError(error), ExitCode.NotFound)
}

/**
 * Resolve the target list for a note command. When `listName` is given it is matched
 * via the shared resolver — case-insensitively, across all types unless `type` (from a
 * `--deck` / `--collection` / `--wanted` flag) narrows the search — and ambiguity is a
 * usage error. When `listName` is omitted, the user picks interactively from the lists
 * in scope.
 */
export async function resolveListSelection(
  listName: string | undefined,
  type: ListType | undefined,
): Promise<ResolvedList> {
  if (listName !== undefined) {
    const resolved = await resolveList(listName, type)
    if (isResolveListError(resolved)) throw resolveErrorToNoteError(resolved)
    return { type: resolved.type, filePath: resolved.filePath }
  }

  const locations = await listLocations(type)
  if (locations.length === 0) {
    throw new NoteCommandError(
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
    throw new NoteCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
  const chosen = locations[resp.index]
  if (!chosen) {
    throw new NoteCommandError('runtime_error', 'Selection out of range.', ExitCode.RuntimeError)
  }
  return { type: chosen.type, filePath: chosen.filePath }
}

// ── Entry loading + target resolution ─────────────────────────────────────────

async function loadEntries(type: ListType, filePath: string): Promise<EntryRef[]> {
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
  const entries = await loadEntries(type, filePath)
  if (entries.length === 0) {
    throw new NoteCommandError('not_found', `${listTypeLabel(type)} is empty.`, ExitCode.NotFound)
  }

  if (input.cardId !== undefined) {
    const matches = entries.filter((e) => e.cardId === input.cardId)
    if (matches.length === 0) {
      throw new NoteCommandError(
        'not_found',
        `No card with id ${input.cardId} found in ${path.basename(filePath)}.`,
        ExitCode.NotFound,
      )
    }
    // Card IDs are unique per file, so we expect exactly one match.
    return matches[0]!
  }

  if (input.cardName !== undefined) {
    const matched = fuzzyMatchEntries(entries, input.cardName)
    if (matched.length === 0) {
      throw new NoteCommandError(
        'not_found',
        `No card matching '${input.cardName}' found in ${path.basename(filePath)}.`,
        ExitCode.NotFound,
      )
    }
    if (matched.length === 1) return matched[0]!
    throw new NoteCommandError(
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

/**
 * Filter `entries` to those whose name contains the normalized search as a substring.
 * Prefers exact-name matches when present.
 */
function fuzzyMatchEntries(entries: EntryRef[], search: string): EntryRef[] {
  const normalized = normalizeCardName(search)
  if (!normalized) return []
  const exact = entries.filter((e) => normalizeCardName(e.name) === normalized)
  if (exact.length > 0) return exact
  return entries.filter((e) => normalizeCardName(e.name).includes(normalized))
}

function formatAmbiguityMessage(search: string, matches: EntryRef[]): string {
  const lines = matches
    .slice(0, 10)
    .map((m) => `  - ${describeEntry(m)}`)
    .join('\n')
  const suffix = matches.length > 10 ? `\n  ... and ${matches.length - 10} more` : ''
  return `Multiple cards match '${search}'. Pick one with --card-id <id> or run interactively:\n${lines}${suffix}`
}

function describeEntry(entry: EntryRef): string {
  const annotation = formatPrintingAnnotation(entry)
  const id = entry.cardId !== undefined ? ` &${entry.cardId}` : ''
  return `${entry.name}${annotation}${id}`
}

async function promptCardSelection(entries: EntryRef[]): Promise<EntryRef> {
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
    throw new NoteCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
  const target = entries[resp.index]
  if (!target) {
    throw new NoteCommandError('runtime_error', 'Selection out of range.', ExitCode.RuntimeError)
  }
  return target
}

// ── Apply ─────────────────────────────────────────────────────────────────────

/**
 * Write a new note value to the matching card entry. Pass `undefined` to remove
 * the existing note. Both the deck path (full-file re-serialize) and the list
 * path (line-rewrite) preserve the rest of the file unchanged.
 *
 * No content-hash check is performed: this is a CLI-only path that reads, mutates,
 * and writes back. Concurrent edits to the same file (e.g. from the admin server)
 * can be silently overwritten. The admin save endpoints (`save-helpers.ts`) do
 * enforce hash-based conflict detection.
 */
export async function applyNoteUpdate(
  type: ListType,
  filePath: string,
  target: EntryRef,
  note: string | undefined,
): Promise<void> {
  if (type === 'deck') {
    await applyNoteToDeck(filePath, target, note)
    return
  }
  await applyNoteToList(filePath, type, target, note)
}

async function applyNoteToDeck(
  filePath: string,
  target: EntryRef,
  note: string | undefined,
): Promise<void> {
  const deck = await importFromTextFile(filePath)
  const fm = await parseDeckFrontMatter(filePath)

  const found = findDeckCard(deck, target)
  if (!found) {
    throw new NoteCommandError(
      'runtime_error',
      `Card no longer present in deck file (it may have been edited concurrently).`,
      ExitCode.RuntimeError,
    )
  }
  found.note = noteOrUndefined(note)

  const content = serializeDeckToMarkdown(deck, fm)
  await writeFileWithHash(filePath, content)
}

function findDeckCard(deck: DeckData, target: EntryRef): Card | null {
  for (const section of deck.sections) {
    for (const card of section.cards) {
      if (target.cardId !== undefined) {
        if (card.cardId === target.cardId) return card
        continue
      }
      // Fall back to a structural match when no cardId is available.
      if (
        card.name === target.name &&
        card.set?.toLowerCase() === target.set?.toLowerCase() &&
        card.collectorNumber === target.collectorNumber
      ) {
        return card
      }
    }
  }
  return null
}

/**
 * Rewrite the matching `- ...` line in a collection or wanted-list file in place,
 * preserving leading whitespace. Match by `cardId` when present, otherwise by name +
 * set + collector number. Position counting is intentionally avoided — collection and
 * wanted parsers silently skip malformed lines, so position-based matching can desync.
 */
async function applyNoteToList(
  filePath: string,
  type: 'collection' | 'wanted',
  target: EntryRef,
  note: string | undefined,
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8')
  const lines = content.split('\n')

  const resolvedNote = noteOrUndefined(note)
  let updated = false
  const newLines = lines.map((line) => {
    if (updated) return line
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) return line
    if (!isMatchingLine(type, trimmed, target)) return line
    updated = true
    const leading = line.match(/^(\s*)/)?.[1] ?? ''
    return leading + serializeListEntry(type, target, resolvedNote).trimEnd()
  })

  if (!updated) {
    throw new NoteCommandError(
      'runtime_error',
      `Card line no longer present in file (it may have been edited concurrently).`,
      ExitCode.RuntimeError,
    )
  }

  const newContent = newLines.join('\n')
  await writeFileWithHash(filePath, newContent)
}

function isMatchingLine(
  type: 'collection' | 'wanted',
  trimmedLine: string,
  target: EntryRef,
): boolean {
  const re = type === 'collection' ? COLLECTION_CARD_LINE_RE : WANTED_CARD_LINE_RE
  const m = trimmedLine.match(re)
  if (!m) return false
  // Both regexes start with `name`, `setCode`, `collectorNumber` and end with `cardId`.
  const name = m[1]
  const set = m[2]
  const collectorNumber = m[3]
  const idStr = m[m.length - 1]
  const lineCardId = idStr ? Number.parseInt(idStr, 10) : undefined

  if (target.cardId !== undefined) return lineCardId === target.cardId

  // Fall back to structural match. Names must match exactly; set/collectorNumber
  // narrow further when both target and line carry them.
  if (name !== target.name) return false
  if (target.set !== undefined && set?.toLowerCase() !== target.set.toLowerCase()) return false
  if (target.collectorNumber !== undefined && collectorNumber !== target.collectorNumber)
    return false
  return true
}

function serializeListEntry(
  type: 'collection' | 'wanted',
  entry: EntryRef,
  note: string | undefined,
): string {
  if (type === 'collection') {
    return formatCollectionLine(
      entry.name,
      entry.set ?? '',
      entry.collectorNumber ?? '',
      entry.finish ?? 'nonfoil',
      entry.condition,
      note,
      entry.cardId,
    )
  }
  const printing =
    entry.set && entry.collectorNumber
      ? { set: entry.set, collectorNumber: entry.collectorNumber }
      : undefined
  return formatWantedListLine(entry.name, printing, entry.finish, note, entry.cardId)
}

function listTypeLabel(type: ListType): string {
  if (type === 'deck') return 'Deck'
  if (type === 'collection') return 'Collection'
  return 'Wanted list'
}
