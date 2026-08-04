/**
 * Direct-to-file ChangeEvent application for collection-sync pulls.
 *
 * The admin save handlers implement the same apply semantics but wrap them in
 * content-hash conflict checks, full Scryfall load payloads, and git
 * auto-commit; the MCP mutations reuse those handlers in-process. The one-shot
 * CLI commands (`set-card`, `remove-card`, `note`) use the line-preserving
 * path in `commands/line-mutate.ts` instead. This module remains the
 * whole-file apply for `collection-sync`, whose pulls add and remove entries
 * in bulk: read the collection file, apply the events through the shared
 * editor engine, re-serialize, write through the `.sha256` sidecar helpers,
 * and append one changelog block per invocation. No content-hash conflict
 * check and no git side effect.
 *
 * The file is re-serialized to canonical sectioned form — exactly what an
 * admin save does — so any line the parser could not read is dropped by the
 * write. The sync engine's unreadable-lines gate is the guard: a list whose
 * parse produced warnings is held back until the user accepts the loss.
 *
 * As defense in depth, a change that misses its target during apply aborts the
 * whole mutation before anything is written — the file and its changelog must
 * never claim an edit that did not happen.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { parseCollectionFile } from './collection-file'
import {
  applyChangeToCollection,
  findCollectionPrintingError,
  toCollectionCardEntries,
} from './editor/collection-changes'
import { collectionToMarkdown } from './editor/list-export'
import { parseTitleFromContent } from './section-format'
import { writeFileWithHash, hashPath } from './content-hash'
import { appendChangelog } from './changelog-writer'
import { allocateId, collectExistingIds, createIdPool, type EntryWithCardId } from './card-id'
import { CardCommandError, ExitCode } from './errors'
import type { ChangeEvent, MoveFromChange, MoveToChange } from './change-event'
import {
  applyChangesCollectingMisses,
  describeUnmatchedChanges,
  type UnmatchedChange,
  type UnmatchedTarget,
} from './editor/apply-batch'

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
 * Apply `changes` to the collection file and persist the result, appending one
 * new changelog block (no session merging — each invocation is its own block).
 * Move events are not supported here; cross-list moves go through the move
 * engine (`move-helpers.ts`), which owns both sides of the transfer.
 */
export async function applyChangesToCollectionFile(
  filePath: string,
  changes: CardMutationChange[],
): Promise<MutateListResult> {
  // Defense in depth for callers that cast around the type-level exclusion.
  for (const change of changes as ChangeEvent[]) {
    if (change.action === 'move-from' || change.action === 'move-to') {
      throw new Error(
        'applyChangesToCollectionFile does not handle move events; use the move engine.',
      )
    }
  }

  // The applied changes, not the requested ones: an `add` is stamped with the
  // `&N` it will carry on disk, so the changelog names the same id the line does.
  const applied = await applyToCollection(filePath, changes)

  const slug = path.basename(filePath, '.md')
  const changelogPath = await appendChangelog(filePath, slug, applied)
  return { writtenFiles: [filePath, hashPath(filePath), changelogPath] }
}

/**
 * Abort when a change did not apply. Callers resolve targets before building
 * changes, so a miss here means the list changed underneath us or a caller
 * skipped resolution — either way, writing the survivors and a changelog block
 * naming the misses would falsify the record.
 */
function assertAllApplied(
  unmatched: UnmatchedChange<CardMutationChange>[],
  target: UnmatchedTarget,
): void {
  if (unmatched.length === 0) return
  throw new CardCommandError(
    'not_found',
    describeUnmatchedChanges(unmatched, target),
    ExitCode.NotFound,
  )
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
  const entries = toCollectionCardEntries(parsed.entries)
  const applied = stampAddIds(changes, entries)
  const result = applyChangesCollectingMisses(entries, applied, applyChangeToCollection)
  assertAllApplied(result.unmatched, {
    type: 'collection',
    slug: path.basename(filePath, '.md'),
  })
  const title = parseTitleFromContent(content) ?? path.basename(filePath, '.md')
  await writeFileWithHash(
    filePath,
    collectionToMarkdown(title, result.data, parsed.sectionOrder, parsed.frontMatter),
  )
  return applied
}
