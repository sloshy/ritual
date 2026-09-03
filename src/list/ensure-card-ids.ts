/**
 * The `&N` backfill: every card line in every list file carries a stable id, so
 * the sites, editors, and sidecars can key per-card data on something the file
 * itself holds. Ids are allocated from the file's own reuse pool, never
 * renumbered, and only ever added.
 *
 * Two rewrites happen here and nowhere else on the read path:
 *
 * - a line with **no** `&N` (or a duplicate of one already used) is stamped;
 * - a flat-list line with a **quantity** is expanded into one line per copy —
 *   a collection and a wanted list hold one line per physical card, so a pasted
 *   `- 3 Sol Ring (LEA:270)` is read as three cards and written as three lines.
 *
 * Expansion happens only here (and in `cleanup`), never inside a read: a parse
 * yields the copies it read and says so with an advisory, and the file catches
 * up on the next save.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { isRitualClean, writeFileWithHash } from '../changes/content-hash'
import { allocateId, createIdPool, parseCardIdsFromContent } from '../card/card-id'
import { formatCanonicalCardLine, type FlatCardLineFields } from '../card/card-line-tail'
import { matchCardId } from '../card/card-line-id'
import { readCardLine } from '../card/card-line-read'
import { isDeckFile } from '../importers/text-file'
import { createFenceTracker, frontMatterBodyStart } from './markdown-fence'
import { getErrorMessage, hasErrorCode } from '../util/errors'
import { getCollectionsDir, getDecksDir, getWantedDir } from '../config/ritual-config'
import { isListMarkdownFile } from './list-file-name'
import type { ListType } from './list-type'

export type EnsureIdsResult = { content: string; added: number }

/**
 * `line` with its trailing `&N` cut off, trailing whitespace and all. The id's
 * exact position comes from `matchCardId`, so `card-line-id.ts` stays the only
 * module that spells the pattern.
 */
function withoutCardId(line: string): string {
  const id = matchCardId(line)
  return (id === undefined ? line : line.slice(0, id.index)).trimEnd()
}

function ensureIds(content: string, type: ListType): EnsureIdsResult {
  const lines = content.split('\n')
  const pool = createIdPool(parseCardIdsFromContent(content))
  const seenIds = new Set<number>()

  // Front matter is opaque YAML — a value that happens to look like a card
  // line must never be stamped. One detector (frontMatterBodyStart) for the
  // whole codebase, so this scanner can't disagree with the parsers.
  const bodyStart = frontMatterBodyStart(lines)
  let added = 0
  /** Take the next id from the pool, counting it as one this pass added. */
  const nextId = (): number => {
    const id = allocateId(pool)
    added++
    seenIds.add(id)
    return id
  }
  // A card-looking line inside a fenced code block is prose the user wrote —
  // stamping an `&N` into it would edit their example and burn an id.
  const fence = createFenceTracker()
  const newLines: string[] = []
  for (const [index, line] of lines.entries()) {
    if (index < bodyStart) {
      newLines.push(line)
      continue
    }
    if (fence.feed(line).opaque) {
      newLines.push(line)
      continue
    }
    // The same reader every mutation path uses, so the backfill cannot stamp a
    // line the parsers do not read as a card — or skip one they do.
    const read = readCardLine(type, line.trim())
    if (read === undefined) {
      newLines.push(line)
      continue
    }
    const { tokens } = read
    const indent = line.slice(0, line.length - line.trimStart().length)

    // One line per copy on a flat list. The first copy keeps the line's own
    // `&N` (ids are never renumbered); the extra copies allocate from the pool,
    // exactly as a fresh card would. A line whose labels token the grammar
    // refuses is left alone: the rewrite would delete the token.
    if (type !== 'deck' && tokens.quantity > 1 && read.invalidLabels === undefined) {
      const fields: FlatCardLineFields = {
        name: tokens.name,
        printing: tokens.printing,
        finish: tokens.finish,
        condition: tokens.condition,
        language: tokens.language,
        labels: tokens.labels,
        tags: tokens.tags,
        note: tokens.note,
      }
      const keptId =
        tokens.cardId !== undefined && !seenIds.has(tokens.cardId) ? tokens.cardId : undefined
      if (keptId !== undefined) seenIds.add(keptId)
      for (let copy = 0; copy < tokens.quantity; copy++) {
        const cardId = copy === 0 && keptId !== undefined ? keptId : nextId()
        newLines.push(indent + formatCanonicalCardLine(type, { ...fields, cardId }))
      }
      continue
    }

    if (tokens.cardId !== undefined) {
      if (!seenIds.has(tokens.cardId)) {
        seenIds.add(tokens.cardId)
        newLines.push(line) // First occurrence — keep as-is
        continue
      }
      // Duplicate ID — strip and reassign to the next available slot
      newLines.push(withoutCardId(line) + ` &${nextId()}`)
      continue
    }
    newLines.push(line.replace(/\s+$/, '') + ` &${nextId()}`)
  }

  return { content: newLines.join('\n'), added }
}

export function ensureDeckIdsInContent(content: string): EnsureIdsResult {
  return ensureIds(content, 'deck')
}

export function ensureCollectionIdsInContent(content: string): EnsureIdsResult {
  return ensureIds(content, 'collection')
}

export function ensureWantedIdsInContent(content: string): EnsureIdsResult {
  return ensureIds(content, 'wanted')
}

async function ensureIdsInDir(
  dir: string,
  ensureFn: (content: string) => EnsureIdsResult,
  fileFilter: (filename: string) => boolean,
): Promise<void> {
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch (err) {
    // A missing directory is normal — the user may not have set up decks/collections/wanted.
    // Other errors (permission denied, I/O) are real and worth surfacing so files don't go un-IDed.
    if (hasErrorCode(err, 'ENOENT')) return
    console.warn(`ensure-card-ids: failed to read ${dir}: ${getErrorMessage(err)}`)
    return
  }
  for (const filename of files.filter(fileFilter)) {
    const filePath = path.join(dir, filename)
    let content: string
    try {
      content = await fs.readFile(filePath, 'utf-8')
    } catch (err) {
      console.warn(`ensure-card-ids: failed to read ${filePath}: ${getErrorMessage(err)}`)
      continue
    }
    const { content: newContent, added } = ensureFn(content)
    if (added > 0) {
      // The pre-backfill content is what the sidecar has to match: only then
      // are the ID additions Ritual's own write and safe to stamp. Otherwise
      // the file holds an unrecorded hand edit — leave the sidecar stale or
      // absent so detect-changes still records the edit's changelog.
      const wasRitualClean = await isRitualClean(filePath, content)
      if (wasRitualClean) {
        await writeFileWithHash(filePath, newContent)
      } else {
        await fs.writeFile(filePath, newContent)
      }
    }
  }
}

/**
 * Backfills missing `&N` card IDs across every deck/collection/wanted markdown so
 * downstream consumers (build-site, trade page, admin editors) can rely on every
 * card line having a stable ID without per-load backfill.
 */
export async function ensureCardIdsForAllLists(): Promise<void> {
  await ensureIdsInDir(getDecksDir(), ensureDeckIdsInContent, isDeckFile)
  await ensureIdsInDir(getCollectionsDir(), ensureCollectionIdsInContent, isListMarkdownFile)
  await ensureIdsInDir(getWantedDir(), ensureWantedIdsInContent, isListMarkdownFile)
}
