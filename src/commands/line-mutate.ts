/**
 * Line-preserving apply path for the one-shot card commands (`set-card`,
 * `remove-card`, `note`). Unlike the whole-file apply (list-mutate.ts),
 * which re-parses and re-serializes the whole file — deleting any content the
 * parser does not model — this module rewrites, moves, or removes only the
 * targeted entry's line, leaving every other byte of the file untouched. Prose,
 * comments, unusual headings, and malformed lines all survive a one-shot edit.
 *
 * Matching mirrors note-edit's original rule: by `cardId` when the target has
 * one (the backfill guarantees it for these commands), otherwise exact name
 * plus set/collector-number narrowing. Position counting is intentionally
 * avoided — the parsers skip lines they cannot read, so positions can desync.
 *
 * No content-hash conflict check is performed (CLI-only path; the admin save
 * routes own optimistic concurrency). The write refreshes the `.sha256`
 * sidecar: this path records its changelog in the same call, which is exactly
 * what a current sidecar asserts. Mixing a one-shot edit with uncommitted hand
 * edits in one detect-changes range remains the documented sidecar
 * limitation, unchanged from the whole-file path this replaces.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { COLLECTION_CARD_LINE_RE } from '../collection-file'
import { formatWantedListLine, WANTED_CARD_LINE_RE } from './wanted-helpers'
import { formatCollectionLine } from './collection-helpers'
import { DECK_CARD_LINE_RE } from '../importers/text-file'
import { serializeCardLine } from '../deck-file'
import { COMMANDER_SECTION, isCommanderSection, isSideboardSection } from '../deck-format'
import { DEFAULT_SECTION } from '../types'
import { hashPath, writeFileWithHash } from '../content-hash'
import { appendChangelog } from '../changelog-writer'
import { allocateNextIdFromContent } from '../card-id'
import {
  createAddChange,
  createSetCommanderChange,
  isSamePrinting,
  type PrintingTuple,
} from '../change-event'
import { applyConditionUpdate, isCondition, isFinish } from '../finish-condition'
import { noteOrUndefined } from '../note-helpers'
import { ExitCode } from './scripting'
import { CardCommandError } from '../errors'
import type { ListType } from '../list-type'
import type { CardMutationChange } from '../list-mutate'
import type { EntryRef } from './card-target'

export type TargetedMutateResult = {
  /** Absolute paths the mutation wrote: the list file, its hash sidecar, and the changelog. */
  writtenFiles: string[]
}

/**
 * Apply a batch of change events to the single entry `target` resolves to,
 * editing only that entry's line, then append one changelog block for the
 * batch. Changes apply in order, so a `set-printing` followed by a
 * `set-section` rewrites the line and then moves the rewritten line.
 */
export async function applyTargetedChanges(
  type: ListType,
  filePath: string,
  target: EntryRef,
  changes: CardMutationChange[],
): Promise<TargetedMutateResult> {
  const content = await fs.readFile(filePath, 'utf-8')
  // When the target arrived without a cardId, adopt the line's `&N` up front so
  // the changelog names the same id the file line carries.
  const resolved: EntryRef = { ...target }
  if (resolved.cardId === undefined) {
    const lines = content.split('\n')
    const idx = findTargetLineIndex(lines, type, resolved)
    if (idx !== -1) resolved.cardId = lineCardIdAt(lines, idx, type)
  }
  const stamped = changes.map((change) =>
    'cardId' in change && change.cardId === undefined && resolved.cardId !== undefined
      ? { ...change, cardId: resolved.cardId }
      : change,
  )
  const newContent = applyTargetedChangesToContent(content, type, resolved, stamped)
  await writeFileWithHash(filePath, newContent)
  const slug = path.basename(filePath, '.md')
  const changelogPath = await appendChangelog(filePath, slug, stamped)
  return { writtenFiles: [filePath, hashPath(filePath), changelogPath] }
}

/**
 * The pure core of {@link applyTargetedChanges}: content in, content out.
 * Throws when the target's line cannot be found or a change kind is not one
 * this path handles.
 */
export function applyTargetedChangesToContent(
  content: string,
  type: ListType,
  target: EntryRef,
  changes: CardMutationChange[],
): string {
  let lines = content.split('\n')
  // Mutated as update events apply, so each rewrite reflects earlier changes —
  // and later changes in the batch match against the line as it now reads.
  const entry: EntryRef = { ...target }
  let removeCopies = 0

  // Each update op finds the line by the entry's CURRENT identity before
  // mutating it, so a structural (no-cardId) match never chases values the
  // line does not carry yet. The matched line's `&N` is adopted so a rewrite
  // never strips an id the target did not happen to carry.
  const rewriteWith = (mutate: () => void): void => {
    const idx = findTargetLineIndex(lines, type, entry)
    if (idx === -1) throw targetLineGone()
    entry.cardId ??= lineCardIdAt(lines, idx, type)
    mutate()
    lines = replaceLineAt(lines, idx, serializeEntryLine(type, entry))
  }

  for (const change of changes) {
    switch (change.action) {
      case 'set-printing':
        rewriteWith(() => {
          entry.set = change.set?.toLowerCase()
          entry.collectorNumber = change.collectorNumber
          entry.finish = change.finish
          entry.condition = applyConditionUpdate(change.condition, entry.condition)
        })
        break
      case 'set-finish':
        rewriteWith(() => {
          entry.finish = change.finish
        })
        break
      case 'set-note':
        rewriteWith(() => {
          entry.note = noteOrUndefined(change.note)
        })
        break
      case 'set-section':
        requireDeck(type, change.action)
        lines = moveTargetLine(lines, entry, {
          kind: 'named-section',
          section: change.section,
        })
        break
      case 'set-commander':
        requireDeck(type, change.action)
        lines = moveTargetLine(lines, entry, { kind: 'commander' })
        break
      case 'unset-commander':
        requireDeck(type, change.action)
        lines = moveTargetLine(lines, entry, { kind: 'out-of-commander' })
        break
      case 'remove':
        // Aggregated and applied after the loop (remove-card emits one event
        // per copy and never mixes removes with update events).
        removeCopies += 1
        break
      default:
        throw new Error(
          `applyTargetedChanges does not handle '${change.action}' events; use the editor engines.`,
        )
    }
  }

  if (removeCopies > 0) {
    lines = removeTargetCopies(lines, type, entry, removeCopies)
  }

  // Keep the file's trailing-newline state: removing the final line must not
  // strip a newline the file had (or add one it deliberately lacked).
  const out = lines.join('\n')
  if (content.endsWith('\n') && !out.endsWith('\n')) return out + '\n'
  return out
}

/** Thrown when the resolved target's line has vanished between resolve and apply. */
function targetLineGone(): CardCommandError {
  return new CardCommandError(
    'runtime_error',
    'Card line no longer present in file (it may have been edited concurrently).',
    ExitCode.RuntimeError,
  )
}

/** Section and commander moves are deck-line operations only. */
function requireDeck(type: ListType, action: string): void {
  if (type !== 'deck') {
    throw new Error(`applyTargetedChanges cannot apply '${action}' to a ${type}`)
  }
}

function findTargetLineIndex(lines: string[], type: ListType, target: EntryRef): number {
  // Deck front matter is opaque data, never card lines — skip it so a YAML
  // value can't be misread as (or replaced by) a card line.
  const start = type === 'deck' ? bodyStart(lines) : 0
  for (let i = start; i < lines.length; i++) {
    if (isMatchingLine(type, lines[i]!.trim(), target)) return i
  }
  return -1
}

function isMatchingLine(type: ListType, trimmedLine: string, target: EntryRef): boolean {
  const m = trimmedLine.match(cardLineRe(type))
  if (!m) return false
  // The deck regex leads with the quantity; the flat regexes with the name.
  // All three end with the `&N` id as the final capture group.
  const nameIdx = type === 'deck' ? 2 : 1
  const name = m[nameIdx]
  const set = m[nameIdx + 1]
  const collectorNumber = m[nameIdx + 2]
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

function cardLineRe(type: ListType): RegExp {
  if (type === 'deck') return DECK_CARD_LINE_RE
  return type === 'collection' ? COLLECTION_CARD_LINE_RE : WANTED_CARD_LINE_RE
}

/** The `&N` id carried by the card line at `idx`, if any. */
function lineCardIdAt(lines: string[], idx: number, type: ListType): number | undefined {
  const m = lines[idx]!.trim().match(cardLineRe(type))
  const idStr = m?.[m.length - 1]
  return idStr ? Number.parseInt(idStr, 10) : undefined
}

/** The canonical single line for `entry`, without a trailing newline. */
function serializeEntryLine(type: ListType, entry: EntryRef): string {
  if (type === 'deck') {
    return serializeCardLine({
      quantity: entry.quantity ?? 1,
      name: entry.name,
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
      note: entry.note,
      cardId: entry.cardId,
    })
  }
  if (type === 'collection') {
    return formatCollectionLine(
      entry.name,
      entry.set ?? '',
      entry.collectorNumber ?? '',
      entry.finish ?? 'nonfoil',
      entry.condition,
      entry.note,
      entry.cardId,
    ).trimEnd()
  }
  const printing =
    entry.set && entry.collectorNumber
      ? { set: entry.set, collectorNumber: entry.collectorNumber }
      : undefined
  return formatWantedListLine(
    entry.name,
    printing,
    entry.finish,
    entry.note,
    entry.cardId,
  ).trimEnd()
}

/** Replace the line at `idx` with `newLine`, preserving its leading whitespace. */
function replaceLineAt(lines: string[], idx: number, newLine: string): string[] {
  const leading = lines[idx]!.match(/^(\s*)/)?.[1] ?? ''
  const next = [...lines]
  next[idx] = leading + newLine
  return next
}

/**
 * Remove `copies` from the target's line: flat-list entries are one physical
 * card each, so any removal deletes the line; deck lines decrement their
 * quantity and are deleted at zero — mirroring the editor engine.
 */
function removeTargetCopies(
  lines: string[],
  type: ListType,
  target: EntryRef,
  copies: number,
): string[] {
  const idx = findTargetLineIndex(lines, type, target)
  if (idx === -1) throw targetLineGone()
  if (type === 'deck') {
    // The line's own quantity, not the resolved target's — the same
    // stale-target reasoning as the cardId adoption above.
    const lineQuantity = Number.parseInt(
      lines[idx]!.trim().match(DECK_CARD_LINE_RE)?.[1] ?? '1',
      10,
    )
    const remaining = lineQuantity - copies
    if (remaining > 0) {
      const entry: EntryRef = {
        ...target,
        quantity: remaining,
        cardId: target.cardId ?? lineCardIdAt(lines, idx, type),
      }
      return replaceLineAt(lines, idx, serializeEntryLine(type, entry))
    }
  }
  return [...lines.slice(0, idx), ...lines.slice(idx + 1)]
}

// ── Deck section moves ────────────────────────────────────────────────────────

/** Where a deck line move lands, mirroring the editor engine's placement rules. */
type MoveDestination =
  | { kind: 'named-section'; section: string } // findOrCreateSection: exact name, created at the end
  | { kind: 'commander' } // first commander-named section, created at the front
  | { kind: 'out-of-commander' } // unset-commander: moves ONLY a card in a commander section

/** A `#`–`######` heading line, as the deck parser recognizes sections. */
const DECK_HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/

type HeadingLine = { index: number; level: number; name: string }

/**
 * Index of the first body line, skipping a leading `---` YAML front-matter
 * block. A `# comment` inside front matter must never read as a deck heading —
 * `parseDeckText` strips front matter before it ever sees the body.
 */
function bodyStart(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') return i + 1
  }
  return 0 // Unterminated: treat the whole file as body, as gray-matter does.
}

/**
 * The deck's section headings. A leading level-1 heading with no card lines of
 * its own is the document title (`# My Deck`), not a section — matching
 * `parseDeckText`, which folds such an H1 into the synthetic Main bucket.
 */
function deckHeadings(lines: string[]): HeadingLine[] {
  const all: HeadingLine[] = []
  for (let index = bodyStart(lines); index < lines.length; index++) {
    const m = lines[index]!.trim().match(DECK_HEADING_RE)
    if (m) all.push({ index, level: m[1]!.length, name: m[2]! })
  }
  const first = all[0]
  if (first !== undefined && first.level === 1 && !sectionHasCardLine(lines, all, first)) {
    return all.slice(1)
  }
  return all
}

/** Whether the block from `heading` to the next heading contains a card line. */
function sectionHasCardLine(
  lines: string[],
  headings: HeadingLine[],
  heading: HeadingLine,
): boolean {
  const next = headings.find((h) => h.index > heading.index)
  const end = next ? next.index : lines.length
  for (let i = heading.index + 1; i < end; i++) {
    if (DECK_CARD_LINE_RE.test(lines[i]!.trim())) return true
  }
  return false
}

/** The heading governing `lineIdx`, or null when the line precedes every heading. */
function headingAbove(headings: HeadingLine[], lineIdx: number): HeadingLine | null {
  let found: HeadingLine | null = null
  for (const heading of headings) {
    if (heading.index < lineIdx) found = heading
    else break
  }
  return found
}

/**
 * The insertion index for a card line joining the section that starts at
 * `heading`: after the section's last card line, or directly after the heading
 * when it has none — matching the engine's push-to-end placement.
 */
function insertionIndexFor(lines: string[], headings: HeadingLine[], heading: HeadingLine): number {
  const nextHeading = headings.find((h) => h.index > heading.index)
  const end = nextHeading ? nextHeading.index : lines.length
  let insertAt = heading.index + 1
  for (let i = heading.index + 1; i < end; i++) {
    if (DECK_CARD_LINE_RE.test(lines[i]!.trim())) insertAt = i + 1
  }
  return insertAt
}

/**
 * Move the target's line to `destination`, deck files only. Idempotent when the
 * line already sits in the destination (for `out-of-commander`, anywhere outside
 * a commander section is the requested end state, mirroring the engine). Only
 * the card line itself moves; every other line stays in place, and a missing
 * destination section is created where the editor engine would create it.
 */
function moveTargetLine(lines: string[], target: EntryRef, destination: MoveDestination): string[] {
  const idx = findTargetLineIndex(lines, 'deck', target)
  if (idx === -1) throw targetLineGone()
  const headings = deckHeadings(lines)
  const current = headingAbove(headings, idx)

  const alreadyThere = (): boolean => {
    if (destination.kind === 'out-of-commander') {
      // A line above every heading belongs to the synthetic Main section.
      return current === null || !isCommanderSection(current.name)
    }
    if (current === null) return false
    if (destination.kind === 'named-section') return current.name === destination.section
    return isCommanderSection(current.name)
  }
  if (alreadyThere()) return lines

  const cardLine = lines[idx]!
  const without = [...lines.slice(0, idx), ...lines.slice(idx + 1)]
  const remainingHeadings = deckHeadings(without)

  const existing = remainingHeadings.find((h) => {
    if (destination.kind === 'named-section') return h.name === destination.section
    if (destination.kind === 'commander') return isCommanderSection(h.name)
    // out-of-commander lands in the default add section, like the engine.
    return !isCommanderSection(h.name) && !isSideboardSection(h.name)
  })
  if (existing) {
    const insertAt = insertionIndexFor(without, remainingHeadings, existing)
    return [...without.slice(0, insertAt), cardLine, ...without.slice(insertAt)]
  }

  const sectionName =
    destination.kind === 'named-section'
      ? destination.section
      : destination.kind === 'commander'
        ? COMMANDER_SECTION
        : DEFAULT_SECTION
  if (destination.kind === 'commander' && remainingHeadings.length > 0) {
    // The engine unshifts a fresh Commander section in front of the others.
    const firstHeading = remainingHeadings[0]!.index
    return [
      ...without.slice(0, firstHeading),
      `## ${sectionName}`,
      cardLine,
      '',
      ...without.slice(firstHeading),
    ]
  }
  // Everything else is appended at the end, per findOrCreateSection /
  // resolveDefaultAddSection.
  const trimmedEnd = [...without]
  while (trimmedEnd.length > 0 && trimmedEnd[trimmedEnd.length - 1]!.trim() === '') {
    trimmedEnd.pop()
  }
  return [...trimmedEnd, '', `## ${sectionName}`, cardLine, '']
}

// ── Deck adds ─────────────────────────────────────────────────────────────────

/** Where a deck add places a card the deck does not already carry. */
export type DeckAddPlacement = {
  /** Explicit `## <name>` section — created at the end of the file when missing. */
  section?: string
  /** Land the card in the Commander section, exactly as `set-commander` does. */
  commander?: boolean
}

/** What a deck add did, for the caller's success payload and changelog. */
export type DeckAddOutcome = {
  /** The `&N` the card's line carries — freshly allocated, or the merged line's own. */
  cardId: number
  /** The line's quantity after the add (the merged line's new total, or the copies added). */
  quantity: number
  /** The section the card's line ended up in. */
  section: string
  /** True when the copies landed on a line the deck already had. */
  merged: boolean
}

export type DeckAddResult = { content: string; outcome: DeckAddOutcome }

/**
 * Add `copies` of `card` to a deck's markdown, one copy at a time — the same
 * per-copy semantics as the editor engine's `add` event (`quantity += 1`), and
 * the same placement rules: a line for the same card **and the same printing**
 * absorbs the copies, otherwise a new line is appended at the end of the target
 * section (the explicitly requested one, else the first non-commander,
 * non-sideboard section, else a freshly created `## Main`).
 *
 * Line-preserving like the rest of this module: only the merged line is
 * rewritten, or one line inserted. Nothing else in the file is touched.
 */
export function applyDeckAddToContent(
  content: string,
  card: EntryRef,
  copies: number,
  placement: DeckAddPlacement = {},
): DeckAddResult {
  if (!Number.isInteger(copies) || copies < 1) {
    throw new Error(`applyDeckAddToContent needs at least one copy to add (got ${copies}).`)
  }
  let lines = content.split('\n')
  let cardId = card.cardId
  let quantity = 0
  let merged = false

  for (let copy = 0; copy < copies; copy++) {
    const idx = findDeckMergeLineIndex(lines, card, cardId)
    if (idx !== -1) {
      if (copy === 0) merged = true
      // Rewrite from the line's OWN fields, not the incoming card's: a merge
      // target may carry a `{note}` (notes are not part of `isSamePrinting`) and
      // an `&N` the caller never had, and neither may be dropped by an add.
      const existing = parseDeckLineEntry(lines[idx]!) ?? card
      cardId ??= existing.cardId ?? allocateNextIdFromContent(lines.join('\n')).nextId
      quantity = (existing.quantity ?? 1) + 1
      lines = replaceLineAt(
        lines,
        idx,
        serializeEntryLine('deck', { ...existing, quantity, cardId }),
      )
      continue
    }
    // Allocate against the file as it now reads, so an id freed by an earlier
    // removal is reused exactly as the pool intends.
    cardId ??= allocateNextIdFromContent(lines.join('\n')).nextId
    quantity = 1
    lines = insertDeckCardLine(
      lines,
      serializeEntryLine('deck', { ...card, quantity, cardId }),
      placement.section,
    )
  }

  const withCommander = placement.commander
    ? moveTargetLine(lines, { ...card, cardId }, { kind: 'commander' })
    : lines

  const finalIdx = findTargetLineIndex(withCommander, 'deck', { ...card, cardId })
  const section =
    (finalIdx !== -1 ? headingAbove(deckHeadings(withCommander), finalIdx)?.name : undefined) ??
    DEFAULT_SECTION

  const out = withCommander.join('\n')
  // Both loop branches assign an id (allocating one when a merge target had
  // none), and the guard above makes at least one iteration run.
  if (cardId === undefined) throw new Error('applyDeckAddToContent produced no card id')
  return {
    content: content.endsWith('\n') && !out.endsWith('\n') ? out + '\n' : out,
    outcome: { cardId, quantity, section, merged },
  }
}

/**
 * Apply a deck add and persist it: write the file through the `.sha256`
 * sidecar, then append one changelog block holding **one add event per copy**
 * (the system-wide invariant — events carry no quantity) plus a
 * `set-commander` event when the add was directed at the commander section.
 */
export async function applyDeckAdd(
  filePath: string,
  card: EntryRef,
  copies: number,
  placement: DeckAddPlacement = {},
): Promise<DeckAddOutcome & TargetedMutateResult> {
  const content = await fs.readFile(filePath, 'utf-8')
  const { content: newContent, outcome } = applyDeckAddToContent(content, card, copies, placement)
  await writeFileWithHash(filePath, newContent)
  const changes: CardMutationChange[] = []
  for (let copy = 0; copy < copies; copy++) {
    changes.push(
      createAddChange(card.name, {
        set: card.set,
        collectorNumber: card.collectorNumber,
        finish: card.finish,
        condition: card.condition,
        // The section the copies actually landed in, which is not always the
        // requested one: copies merge onto an existing line wherever it lives.
        section: outcome.section,
        cardId: outcome.cardId,
      }),
    )
  }
  if (placement.commander) {
    changes.push(createSetCommanderChange(card.name, { cardId: outcome.cardId }))
  }
  const slug = path.basename(filePath, '.md')
  const changelogPath = await appendChangelog(filePath, slug, changes)
  return { ...outcome, writtenFiles: [filePath, hashPath(filePath), changelogPath] }
}

/**
 * The line `card`'s copies should merge onto: the `&N` line when one is known,
 * otherwise a line for the same name whose printing (set, collector number,
 * finish, condition) is identical — the editor engine's `findCardForAdd` rule,
 * which keeps a differently-printed copy as its own line.
 */
function findDeckMergeLineIndex(
  lines: string[],
  card: EntryRef,
  cardId: number | undefined,
): number {
  for (let i = bodyStart(lines); i < lines.length; i++) {
    const m = lines[i]!.trim().match(DECK_CARD_LINE_RE)
    if (!m) continue
    const lineId = m[8] ? Number.parseInt(m[8], 10) : undefined
    if (cardId !== undefined) {
      if (lineId === cardId) return i
      continue
    }
    if (m[2]?.trim() !== card.name) continue
    const linePrinting: PrintingTuple = {
      set: m[3]?.toLowerCase(),
      collectorNumber: m[4],
      finish: isFinish(m[5]) ? m[5] : undefined,
      condition: isCondition(m[6]) ? m[6] : undefined,
    }
    if (isSamePrinting(linePrinting, card)) return i
  }
  return -1
}

/**
 * Read a deck card line back into an {@link EntryRef} — every field the line
 * carries, including the `{note}` and `&N` a merging add must preserve.
 * Returns undefined for a line that is not a card line.
 */
function parseDeckLineEntry(line: string): EntryRef | undefined {
  const m = line.trim().match(DECK_CARD_LINE_RE)
  if (!m) return undefined
  return {
    name: m[2]!.trim(),
    quantity: Number.parseInt(m[1] ?? '1', 10),
    set: m[3]?.toLowerCase(),
    collectorNumber: m[4],
    finish: isFinish(m[5]) ? m[5] : undefined,
    condition: isCondition(m[6]) ? m[6] : undefined,
    note: noteOrUndefined(m[7]),
    cardId: m[8] ? Number.parseInt(m[8], 10) : undefined,
  }
}

/**
 * Insert a new card line at the end of its section: the named section when one
 * was requested, otherwise the first non-commander, non-sideboard section —
 * `resolveDefaultAddSection`'s rule, so a deck organized as `## Mainboard`
 * never grows a second `## Main`. A missing section is appended at the end of
 * the file, exactly one blank line before it.
 */
function insertDeckCardLine(lines: string[], cardLine: string, section?: string): string[] {
  const headings = deckHeadings(lines)
  const target =
    section !== undefined
      ? headings.find((h) => h.name === section)
      : headings.find((h) => !isCommanderSection(h.name) && !isSideboardSection(h.name))
  if (target) {
    const insertAt = insertionIndexFor(lines, headings, target)
    return [...lines.slice(0, insertAt), cardLine, ...lines.slice(insertAt)]
  }
  if (section === undefined && headings.length === 0) {
    // A headless deck body is one synthetic `Main` bucket: join it after its
    // last card line rather than appending a `## Main` that would split the
    // deck into two same-named sections on the next parse.
    let lastCard = -1
    for (let i = bodyStart(lines); i < lines.length; i++) {
      if (DECK_CARD_LINE_RE.test(lines[i]!.trim())) lastCard = i
    }
    if (lastCard !== -1) {
      return [...lines.slice(0, lastCard + 1), cardLine, ...lines.slice(lastCard + 1)]
    }
  }
  const trimmedEnd = [...lines]
  while (trimmedEnd.length > 0 && trimmedEnd[trimmedEnd.length - 1]!.trim() === '') {
    trimmedEnd.pop()
  }
  return [...trimmedEnd, '', `## ${section ?? DEFAULT_SECTION}`, cardLine, '']
}
