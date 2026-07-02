import fs from 'node:fs/promises'
import path from 'node:path'
import { writeFileWithHash } from './content-hash'
import { allocateId, createIdPool, parseCardIdsFromContent } from './card-id'
import { DECK_CARD_LINE_RE, isDeckFile } from './importers/text-file'
import { COLLECTION_CARD_LINE_RE } from './collection-file'
import { WANTED_CARD_LINE_RE } from './commands/wanted-helpers'
import { getErrorMessage } from './errors'
import { getCollectionsDir, getDecksDir, getWantedDir } from './ritual-config'

function isNoEntryError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
}

export type EnsureIdsResult = { content: string; added: number }

interface EnsureIdsOptions {
  cardLineRe: RegExp
  skipFrontMatter: boolean
}

function ensureIds(content: string, options: EnsureIdsOptions): EnsureIdsResult {
  const { cardLineRe, skipFrontMatter } = options
  const lines = content.split('\n')
  const pool = createIdPool(parseCardIdsFromContent(content))
  const seenIds = new Set<number>()

  let inFrontMatter = false
  let frontMatterClosed = false
  let added = 0
  const newLines = lines.map((line, idx) => {
    if (skipFrontMatter && !frontMatterClosed) {
      if (idx === 0 && line.trim() === '---') {
        inFrontMatter = true
        return line
      }
      if (inFrontMatter) {
        if (line.trim() === '---') {
          inFrontMatter = false
          frontMatterClosed = true
        }
        return line
      }
    }
    const trimmed = line.trim()
    const match = cardLineRe.exec(trimmed)
    if (!match) return line
    // The card-line regexes for deck, collection, and wanted lists all anchor with `$`
    // and place the optional `&(\d+)` ID as the final capture group.
    const rawId = match[match.length - 1]
    if (rawId !== undefined) {
      const id = Number.parseInt(rawId, 10)
      if (!seenIds.has(id)) {
        seenIds.add(id)
        return line // First occurrence — keep as-is
      }
      // Duplicate ID — strip and reassign to the next available slot
      const newId = allocateId(pool)
      added++
      return line.replace(/\s+&\d+\s*$/, '') + ` &${newId}`
    }
    const id = allocateId(pool)
    added++
    return line.replace(/\s+$/, '') + ` &${id}`
  })

  return { content: newLines.join('\n'), added }
}

export function ensureDeckIdsInContent(content: string): EnsureIdsResult {
  return ensureIds(content, { cardLineRe: DECK_CARD_LINE_RE, skipFrontMatter: true })
}

export function ensureCollectionIdsInContent(content: string): EnsureIdsResult {
  return ensureIds(content, { cardLineRe: COLLECTION_CARD_LINE_RE, skipFrontMatter: false })
}

export function ensureWantedIdsInContent(content: string): EnsureIdsResult {
  return ensureIds(content, { cardLineRe: WANTED_CARD_LINE_RE, skipFrontMatter: false })
}

function isListMarkdown(filename: string): boolean {
  return filename.endsWith('.md') && !filename.endsWith('.changes.md')
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
    if (isNoEntryError(err)) return
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
      await writeFileWithHash(filePath, newContent)
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
  await ensureIdsInDir(getCollectionsDir(), ensureCollectionIdsInContent, isListMarkdown)
  await ensureIdsInDir(getWantedDir(), ensureWantedIdsInContent, isListMarkdown)
}
