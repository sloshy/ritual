/**
 * Direct-to-file ChangeEvent application for one-shot CLI commands
 * (`remove-card`, `set-card`, ...).
 *
 * The admin save handlers implement the same apply semantics but wrap them in
 * content-hash conflict checks, full Scryfall load payloads, and git
 * auto-commit; the MCP mutations reuse those handlers in-process. One-shot CLI
 * commands use this module instead: read the list file, apply the events
 * through the shared editor engines, re-serialize, write through the `.sha256`
 * sidecar helpers, and append one changelog block per invocation. Like the
 * other CLI paths (note-edit, add-card) there is no content-hash conflict
 * check and no git side effect.
 *
 * Flat lists are re-serialized to canonical sectioned form — exactly what an
 * admin save does — so a one-line change can reformat a legacy file as a side
 * effect.
 *
 * Callers must resolve the target entry first (see `card-target.ts`): the
 * editor apply engines are silent no-ops when a change's target card does not
 * exist in the list.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { importFromTextFile } from './importers/text-file'
import { parseDeckFrontMatter, serializeDeckToMarkdown } from './deck-file'
import { parseCollectionFile } from './collection-file'
import { parseWantedListFile } from './commands/wanted-helpers'
import { toWantedCardEntries } from './editor/wanted-entries'
import { applyChangeToDeck } from './editor/deck-changes'
import { applyChangeToCollection, findCollectionPrintingError } from './editor/collection-changes'
import { applyChangeToWantedList } from './editor/wanted-changes'
import { collectionToMarkdown, wantedToMarkdown } from './editor/list-export'
import { parseTitleFromContent } from './section-format'
import { writeFileWithHash, hashPath } from './content-hash'
import { appendChangelog } from './changelog-writer'
import { allocateId, collectExistingIds, createIdPool, type EntryWithCardId } from './card-id'
import { CardCommandError, ExitCode } from './errors'
import type { ChangeEvent, MoveFromChange, MoveToChange } from './change-event'
import type { ListType } from './list-type'
import type { CollectionCardEntry } from './site/data-types'

/** The change kinds this module applies — moves belong to the move engine. */
export type CardMutationChange = Exclude<ChangeEvent, MoveFromChange | MoveToChange>

export type MutateListResult = {
  /**
   * The written list file, its hash sidecar, and the changelog file. Not
   * consumed by the current CLI callers (no git side effects on this path) —
   * kept so a future caller can stage exactly what was touched, mirroring
   * commitAllMoves.
   */
  writtenFiles: string[]
}

/**
 * Apply `changes` to the list file and persist the result, appending one new
 * changelog block (no session merging — each one-shot invocation is its own
 * block). Move events are not supported here; cross-list moves go through the
 * move engine (`move-helpers.ts`), which owns both sides of the transfer.
 */
export async function applyChangesToListFile(
  type: ListType,
  filePath: string,
  changes: CardMutationChange[],
): Promise<MutateListResult> {
  // Defense in depth for callers that cast around the type-level exclusion.
  for (const change of changes as ChangeEvent[]) {
    if (change.action === 'move-from' || change.action === 'move-to') {
      throw new Error('applyChangesToListFile does not handle move events; use the move engine.')
    }
  }

  // The applied changes, not the requested ones: a flat-list `add` is stamped
  // with the `&N` it will carry on disk, so the changelog names the same id the
  // line does.
  let applied: CardMutationChange[]
  if (type === 'deck') {
    await applyToDeck(filePath, changes)
    applied = changes
  } else if (type === 'collection') {
    applied = await applyToCollection(filePath, changes)
  } else {
    applied = await applyToWanted(filePath, changes)
  }

  const slug = path.basename(filePath, '.md')
  const changelogPath = await appendChangelog(filePath, slug, applied)
  return { writtenFiles: [filePath, hashPath(filePath), changelogPath] }
}

/**
 * Give every `add` change a pool-allocated `&N`, so no flat-list line is ever
 * written without one.
 *
 * Flat lists are one line per copy, so an `add` always creates a line that needs
 * an id — unlike a deck `add`, which may just increment an existing card's
 * quantity, and whose ids are assigned at serialization time by
 * `assignMissingDeckCardIds`.
 *
 * The pool is seeded from the entries as they were **before** the batch, so an
 * id a removal in the same batch frees is not handed straight back to an
 * addition that the removal's own targeting still has to find. Callers that
 * already chose an id (an undo reclaiming one) keep it.
 */
function stampAddIds(
  changes: CardMutationChange[],
  entries: readonly EntryWithCardId[],
): CardMutationChange[] {
  if (!changes.some((change) => change.action === 'add' && change.cardId === undefined)) {
    return changes
  }
  const pool = createIdPool(collectExistingIds(entries))
  return changes.map((change) =>
    change.action === 'add' && change.cardId === undefined
      ? { ...change, cardId: allocateId(pool) }
      : change,
  )
}

async function applyToDeck(filePath: string, changes: CardMutationChange[]): Promise<void> {
  let deck = await importFromTextFile(filePath)
  const frontMatter = await parseDeckFrontMatter(filePath)
  for (const change of changes) {
    deck = applyChangeToDeck(deck, change)
  }
  await writeFileWithHash(filePath, serializeDeckToMarkdown(deck, frontMatter))
}

async function applyToCollection(
  filePath: string,
  changes: CardMutationChange[],
): Promise<CardMutationChange[]> {
  const printingError = findCollectionPrintingError(changes)
  if (printingError) {
    throw new CardCommandError('usage_error', printingError, ExitCode.UsageError)
  }
  const content = await fs.readFile(filePath, 'utf-8')
  const parsed = parseCollectionFile(content)
  // Same entry mapping as the admin collection-save handler: lowercase set,
  // defaulted finish/condition, fileOrder by position.
  let entries: CollectionCardEntry[] = parsed.entries.map((e, i) => ({
    name: e.name,
    set: e.set.toLowerCase(),
    collectorNumber: e.collectorNumber,
    finish: e.finish ?? 'nonfoil',
    condition: e.condition ?? 'NM',
    price: 0,
    fileOrder: i,
    section: e.section,
    note: e.note,
    cardId: e.cardId,
  }))
  const applied = stampAddIds(changes, entries)
  for (const change of applied) {
    entries = applyChangeToCollection(entries, change)
  }
  const title = parseTitleFromContent(content) ?? path.basename(filePath, '.md')
  await writeFileWithHash(filePath, collectionToMarkdown(title, entries, parsed.sectionOrder))
  return applied
}

async function applyToWanted(
  filePath: string,
  changes: CardMutationChange[],
): Promise<CardMutationChange[]> {
  const content = await fs.readFile(filePath, 'utf-8')
  const parsed = parseWantedListFile(content)
  let entries = toWantedCardEntries(parsed.entries)
  const applied = stampAddIds(changes, entries)
  for (const change of applied) {
    entries = applyChangeToWantedList(entries, change)
  }
  const title = parseTitleFromContent(content) ?? path.basename(filePath, '.md')
  await writeFileWithHash(filePath, wantedToMarkdown(title, entries, parsed.sectionOrder))
  return applied
}
