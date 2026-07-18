/**
 * Note-specific apply logic for the `note` command's flat-list (collection and
 * wanted) path. List and card targeting live in `card-target.ts`; this module
 * owns rewriting the resolved entry's line in place. Decks do not come through
 * here — the `note` command routes them through the shared change engine
 * (`applyChangesToListFile`), which re-serializes the whole deck file.
 */

import * as fs from 'node:fs/promises'
import { COLLECTION_CARD_LINE_RE } from '../collection-file'
import { formatWantedListLine, WANTED_CARD_LINE_RE } from './wanted-helpers'
import { formatCollectionLine } from './collection-helpers'
import { writeFileWithHash } from '../content-hash'
import { ExitCode } from './scripting'
import { noteOrUndefined } from '../note-helpers'
import { CardCommandError } from '../errors'
import type { EntryRef } from './card-target'

/**
 * Write a new note value to the matching card entry by rewriting its `- ...`
 * line in place, preserving leading whitespace and the rest of the file. Pass
 * `undefined` to remove the existing note. Match is by `cardId` when present,
 * otherwise by name + set + collector number. Position counting is intentionally
 * avoided — collection and wanted parsers silently skip malformed lines, so
 * position-based matching can desync.
 *
 * No content-hash check is performed: this is a CLI-only path that reads, mutates,
 * and writes back. Concurrent edits to the same file (e.g. from the admin server)
 * can be silently overwritten. The admin save endpoints (`save-helpers.ts`) do
 * enforce hash-based conflict detection.
 */
export async function applyNoteUpdate(
  type: 'collection' | 'wanted',
  filePath: string,
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
    throw new CardCommandError(
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
