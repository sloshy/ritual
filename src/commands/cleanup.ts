import { Command } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from '../base-dir'
import { hashPath, writeFileWithHash } from '../content-hash'
import { listFileName, unusableFileNameMessage } from '../list-file-name'
import { listLocations, type ListLocation } from '../resolve-list'
import type { ListType } from '../list-type'
import { resolveDeckFormat, type DeckFormatKey } from '../deck-format'
import { parseDeckFrontMatter, serializeDeckToMarkdown } from '../deck-file'
import { parseDeckText } from '../importers/text-file'
import { moveListSidecars } from '../list-sidecars'
import { collectionToMarkdown, wantedToMarkdown } from '../editor/list-export'
import { promptDeckFormat } from './deck-helpers'
import { readCollectionFile, readWantedFile } from './flat-list-session'

/**
 * The `ritual cleanup` command: one pass over every deck, collection, and wanted
 * list that brings each file up to the current conventions —
 *
 * 1. every deck gets an explicit `format:` (inferred from its sections when
 *    possible, otherwise chosen via {@link CleanupOptions.chooseFormat});
 * 2. every file is re-emitted through the canonical serializers, so older
 *    formatting variants converge on what a fresh save would write;
 * 3. every file is named exactly as its list is named (a deck's `name:` front
 *    matter, a collection or wanted list's `# Title` H1), replacing file names
 *    left over from the old lower-kebab-case deck slugs.
 *
 * Cleanup never touches `.changes.md` changelogs beyond renaming them alongside
 * their list, and never appends changelog entries — a cleaned-up file has the
 * same cards it had before.
 */

export type CleanupOptions = {
  /** Report what would change without writing anything. */
  dryRun?: boolean
  /**
   * Choose a format for a deck that has none and whose sections don't imply one.
   * Return null to leave the deck without a format. Omitted (e.g. under
   * `--dry-run`) every such deck is left unset and reported.
   */
  chooseFormat?: (deckName: string) => Promise<DeckFormatKey | null>
}

/** What cleanup did (or, under dry-run, would do) to one list file. */
export type CleanupResult = {
  type: ListType
  /** The file's path when cleanup found it (before any rename). */
  filePath: string
  /** New file basename when the file was renamed to match the list's name. */
  renamedTo?: string
  /** Format stamped onto a deck that had none. */
  formatSet?: DeckFormatKey
  /** Whether the file's content changed when re-emitted in canonical form. */
  rewritten: boolean
  /** True for a deck left without a format (no answer, or dry-run). */
  missingFormat?: boolean
  warnings: string[]
}

/** True when the result carries something worth reporting. */
export function hasCleanupActions(result: CleanupResult): boolean {
  return (
    result.rewritten ||
    result.renamedTo !== undefined ||
    result.formatSet !== undefined ||
    result.missingFormat === true ||
    result.warnings.length > 0
  )
}

/** A list file reduced to what the shared cleanup tail needs. */
type ListDocument = {
  /** The list's display name — what the file should be named after. */
  displayName: string
  /** The file's content as it is on disk. */
  original: string
  /** The file re-emitted through the canonical serializer. */
  canonical: string
  /** Parse warnings; a file that produced any is not rewritten (see below). */
  parseWarnings: string[]
  /** Format stamped onto a deck that had none. */
  formatSet?: DeckFormatKey
  /** True for a deck left without a format (no answer, or dry-run). */
  missingFormat?: boolean
}

async function readDeckDocument(
  location: ListLocation,
  options: CleanupOptions,
): Promise<ListDocument> {
  const original = await fs.readFile(location.filePath, 'utf-8')
  // Parsed directly (not via `loadDeck`) for the skipped-line warnings, which
  // gate the rewrite below — a re-emit would drop what the parser skipped.
  const { deck, warnings } = parseDeckText(original, location.name)
  // Copy before mutating: gray-matter caches parses by content string, so the
  // parsed front matter object is shared between byte-identical files.
  const frontMatter = { ...(await parseDeckFrontMatter(location.filePath)) }
  let formatSet: DeckFormatKey | undefined
  let missingFormat: boolean | undefined
  if (!resolveDeckFormat(deck, frontMatter.format)) {
    const chosen = options.chooseFormat ? await options.chooseFormat(deck.name) : null
    if (chosen) {
      frontMatter.format = chosen
      formatSet = chosen
    } else {
      missingFormat = true
    }
  }
  return {
    displayName: deck.name,
    original,
    canonical: serializeDeckToMarkdown(deck, frontMatter),
    parseWarnings: warnings,
    formatSet,
    missingFormat,
  }
}

async function readCollectionDocument(location: ListLocation): Promise<ListDocument> {
  const file = await readCollectionFile(location.filePath)
  return {
    displayName: file.title,
    original: file.content,
    canonical: collectionToMarkdown(file.title, file.entries, file.sectionOrder),
    parseWarnings: file.warnings,
  }
}

async function readWantedDocument(location: ListLocation): Promise<ListDocument> {
  const file = await readWantedFile(location.filePath)
  return {
    displayName: file.title,
    original: file.content,
    canonical: wantedToMarkdown(file.title, file.entries, file.sectionOrder),
    parseWarnings: file.warnings,
  }
}

/**
 * Whether two paths refer to the same file on disk. Distinguishes a case-only
 * rename on a case-insensitive file system (same file — fine to rename) from a
 * genuine collision with a different list whose name differs only in case.
 */
async function isSameFile(a: string, b: string): Promise<boolean> {
  try {
    const [statA, statB] = await Promise.all([fs.stat(a), fs.stat(b)])
    return statA.ino === statB.ino && statA.dev === statB.dev
  } catch {
    return false
  }
}

/** Move a list file and every sidecar it has to the renamed path. */
async function renameListFile(oldPath: string, newPath: string): Promise<void> {
  await fs.rename(oldPath, newPath)
  // A rename-only cleanup does not rewrite content, so the still-valid hash
  // sidecar moves with the file rather than being recomputed.
  if (await Bun.file(hashPath(oldPath)).exists()) {
    await fs.rename(hashPath(oldPath), hashPath(newPath))
  }
  await moveListSidecars(oldPath, newPath)
}

/** Clean up a single list file. Never throws for per-file problems — they land in `warnings`. */
export async function cleanupList(
  location: ListLocation,
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const result: CleanupResult = {
    type: location.type,
    filePath: location.filePath,
    rewritten: false,
    warnings: [],
  }

  const document =
    location.type === 'deck'
      ? await readDeckDocument(location, options)
      : location.type === 'collection'
        ? await readCollectionDocument(location)
        : await readWantedDocument(location)
  if (document.formatSet) result.formatSet = document.formatSet
  if (document.missingFormat) result.missingFormat = true

  // Where the file should live, given the list's display name.
  const dir = path.dirname(location.filePath)
  const currentBase = path.basename(location.filePath)
  const targetBase = listFileName(document.displayName)
  let targetPath = location.filePath
  if (targetBase === null) {
    result.warnings.push(unusableFileNameMessage(document.displayName))
  } else if (targetBase !== currentBase) {
    const candidate = path.join(dir, targetBase)
    // An existing target is a conflict unless it is this very file — which it is
    // on a case-insensitive file system when the rename only changes casing.
    const occupied =
      (await Bun.file(candidate).exists()) && !(await isSameFile(candidate, location.filePath))
    if (occupied) {
      result.warnings.push(`not renamed to '${targetBase}': another list already has that file`)
    } else {
      targetPath = candidate
      result.renamedTo = targetBase
    }
  }

  // A file whose parse skipped lines would lose them if re-emitted; leave its
  // content alone (renaming is still safe) and surface the warnings instead.
  if (document.parseWarnings.length > 0) {
    result.warnings.push(...document.parseWarnings)
    result.warnings.push('not rewritten: fix the lines above and rerun cleanup')
  } else {
    result.rewritten = document.canonical !== document.original
  }

  if (options.dryRun) return result

  if (targetPath !== location.filePath) {
    await renameListFile(location.filePath, targetPath)
  }
  if (result.rewritten) {
    await writeFileWithHash(targetPath, document.canonical)
  }
  return result
}

/** Run cleanup across every deck, collection, and wanted list. */
export async function cleanupAllLists(options: CleanupOptions = {}): Promise<CleanupResult[]> {
  const results: CleanupResult[] = []
  for (const location of await listLocations()) {
    results.push(await cleanupList(location, options))
  }
  return results
}

type CleanupCommandOptions = Pick<CleanupOptions, 'dryRun'>

/** The action phrases reported for one cleaned-up file, e.g. `renamed to 'Winota Stax.md'`. */
function describeActions(result: CleanupResult, dryRun: boolean): string[] {
  const actions: string[] = []
  if (result.formatSet) actions.push(`format set to ${result.formatSet}`)
  if (result.renamedTo) actions.push(`renamed to '${result.renamedTo}'`)
  if (result.rewritten) actions.push('rewritten in canonical form')
  if (result.missingFormat) {
    actions.push(dryRun ? 'needs a format' : 'left without a format')
  }
  return actions
}

async function runCleanup(options: CleanupCommandOptions): Promise<void> {
  const dryRun = options.dryRun ?? false
  const baseDir = getBaseDir()
  const prefix = dryRun ? '[dry-run] ' : ''

  const chooseFormat = dryRun
    ? undefined
    : async (deckName: string): Promise<DeckFormatKey | null> => {
        console.log(`Deck '${deckName}' has no format and its sections don't imply one.`)
        return promptDeckFormat(null)
      }

  const results = await cleanupAllLists({ dryRun, chooseFormat })

  let changed = 0
  for (const result of results) {
    if (!hasCleanupActions(result)) continue
    changed++
    const rel = path.relative(baseDir, result.filePath)
    const actions = describeActions(result, dryRun)
    if (actions.length > 0) {
      console.log(`${prefix}${rel}: ${actions.join(', ')}`)
    }
    for (const warning of result.warnings) {
      console.warn(`${prefix}${rel}: warning: ${warning}`)
    }
  }

  const files = (count: number): string => `${count} list file${count === 1 ? '' : 's'}`
  if (results.length === 0) {
    console.log('No list files found.')
  } else if (changed === 0) {
    console.log(`Checked ${files(results.length)}; everything is already clean.`)
  } else {
    const verb = dryRun ? 'Would clean up' : 'Cleaned up'
    console.log(`\n${verb} ${changed} of ${files(results.length)}.`)
  }
}

export function registerCleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description(
      'Normalize every list file: canonical formatting, file names that match list names, and a format for every deck',
    )
    .option('-n, --dry-run', 'Report what would change without writing anything')
    .action(async (options: CleanupCommandOptions) => {
      await runCleanup(options)
    })
}
