/**
 * Saving an imported list to disk: deck and flat-list writers sharing one
 * name/ID conflict protocol (overwrite / rename / cancel). Used by the CLI
 * importers (`import`, `import-account`) and the admin import handler.
 */
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { promptUser } from '../util/prompt'
import { listFileName, unusableFileNameMessage } from '../list/list-file-name'
import { listDeckFiles } from './text-file'
import {
  applyCsvImport,
  type CsvImportMode,
  type FlatListType,
  type ImportCardEntry,
} from './csv-apply'
import type { DeckData } from '../list/deck'
import { serializeDeckToMarkdown, type DeckFrontMatter } from '../list/deck-file'
import { parseMoxfieldPrimer } from '../list/primer-parser'
import { getLogger } from '../util/logger'
import { writeFileWithHash } from '../changes/content-hash'
import { isPathWithinDir } from '../util/path-validation'
import { listFilePath, normalizeListName } from '../list/resolve-list'
import { listTypeLabel } from '../list/list-type'
import { promptsUnavailable } from '../util/no-input'
import { CardCommandError, ExitCode, hasErrorCode, localizedCommandError } from '../util/errors'
import { t } from '../i18n/t'

export interface SaveListOptions {
  forceOverwrite?: boolean
  /**
   * Refuse to prompt on a name/ID conflict and throw instead. Defaults to
   * `promptsUnavailable()`, so every caller — the CLI, `import-account`, the
   * admin import handler — gets the actionable conflict error rather than a
   * prompt guard firing deep inside the save. Programmatic callers (the admin
   * import handler) pass true explicitly since there is never a terminal there.
   */
  noPrompts?: boolean
  /** Auto-answer the overwrite confirmation with yes when a conflict comes up. */
  assumeYes?: boolean
  dryRun?: boolean
  /**
   * Suppress progress and confirmation chatter ("Successfully imported … to …"),
   * matching the repo-wide `--quiet` convention. Errors, the interactive
   * conflict messages, and the `Overwriting …` notice are never suppressed —
   * silence must not hide that a file is about to be replaced, so that notice
   * goes to stderr through `warn` on every source kind (matching the CSV path).
   */
  quiet?: boolean
}

type DeckFileFrontmatter = {
  sourceId?: string
}

/** What saving the imported list did — or would do, under `--dry-run`. */
export type SaveListAction = 'created' | 'overwritten' | 'renamed'

/** Result of {@link saveDeck} / {@link saveFlatList}: where the list went, or a prompt cancel. */
export type SaveListOutcome =
  | { status: 'saved'; filePath: string; name: string; action: SaveListAction }
  | { status: 'cancelled' }

function normalizeSaveListOptions(options?: SaveListOptions): Required<SaveListOptions> {
  return {
    forceOverwrite: options?.forceOverwrite ?? false,
    noPrompts: options?.noPrompts ?? promptsUnavailable(),
    assumeYes: options?.assumeYes ?? false,
    dryRun: options?.dryRun ?? false,
    quiet: options?.quiet ?? false,
  }
}

/** `getLogger().info` gated on a save's `quiet` option. */
function saveInfo(resolvedOptions: Required<SaveListOptions>, message: string): void {
  if (resolvedOptions.quiet) return
  getLogger().info(message)
}

/**
 * The one refusal for an import that would replace an existing list without
 * being told to. Shared by the deck and flat-list saves (and matched by the CSV
 * path's own wording) so the advice and the usage exit code never diverge.
 */
function importConflictError(target: string): CardCommandError {
  return localizedCommandError('usage_error', ExitCode.UsageError, 'cli.import.conflict', {
    target,
  })
}

type ConflictResolution =
  | { action: 'overwrite' }
  | { action: 'rename'; newName: string }
  | { action: 'cancel' }

/** Run the interactive overwrite/rename/cancel dance for an import name conflict. */
async function promptConflictResolution(renamePrompt: string): Promise<ConflictResolution> {
  let response = ''
  while (!['o', 'r', 'c'].includes(response)) {
    response = (await promptUser(t('cli.import.conflictAction'))).toLowerCase()
  }

  if (response === 'c') return { action: 'cancel' }
  if (response === 'o') return { action: 'overwrite' }

  let newName = ''
  while (!newName) {
    newName = await promptUser(renamePrompt)
  }
  return { action: 'rename', newName }
}

export async function saveDeck(
  deckData: DeckData,
  decksDir: string,
  options?: SaveListOptions,
): Promise<SaveListOutcome> {
  const resolvedOptions = normalizeSaveListOptions(options)
  // Determine Target Filename. An imported deck's name comes from the source
  // service, so it can be anything — a name with nothing usable left is an error,
  // not a file called `.md`.
  let fileName = listFileName(deckData.name)
  if (fileName === null) {
    throw new Error(unusableFileNameMessage(deckData.name))
  }

  // Scan Existing Decks for ID Conflict
  let conflictFile: string | null = null
  let conflictReason: 'id' | 'name' | null = null

  // A dry run must leave a pristine directory byte-for-byte untouched, so the
  // decks dir is only created on the path that actually writes into it; the
  // conflict scan below already tolerates a missing directory.
  if (!resolvedOptions.dryRun) {
    await fs.mkdir(decksDir, { recursive: true })
  }

  let existingFiles: string[]
  try {
    existingFiles = await listDeckFiles(decksDir)
  } catch (error) {
    // A dry run (or a first import) legitimately finds no decks dir; any other
    // read failure must not be mistaken for "no conflicts".
    if (!hasErrorCode(error, 'ENOENT')) throw error
    existingFiles = []
  }

  // Helper to read simple frontmatter without heavy parser
  const readFrontmatter = async (fPath: string): Promise<DeckFileFrontmatter> => {
    const content = await Bun.file(fPath).text()
    const match = content.match(/^sourceId:\s*(?:"([^"]*)"|(\S+))/m)
    return match ? { sourceId: match[1] ?? match[2] } : {}
  }

  if (deckData.sourceId) {
    for (const f of existingFiles) {
      const fPath = path.join(decksDir, f)
      const meta = await readFrontmatter(fPath)
      if (meta.sourceId === deckData.sourceId) {
        conflictFile = f
        conflictReason = 'id'
        break
      }
    }
  }

  // If no ID conflict, check Filename conflict — by the resolver's folding, not
  // by a byte-exact file name: importing `atraxa superfriends` beside
  // `Atraxa Superfriends.md` would otherwise create a pair that every
  // name-resolving command reports as ambiguous, which `new` and `rename` refuse.
  if (!conflictFile) {
    const normalized = normalizeListName(path.basename(fileName, '.md'))
    const folded = existingFiles.find(
      (f) => normalizeListName(path.basename(f, '.md')) === normalized,
    )
    if (folded !== undefined) {
      conflictFile = folded
      conflictReason = 'name'
    }
  }

  let filePath = path.join(decksDir, fileName)
  let action: SaveListAction = 'created'
  const shouldOverwrite = resolvedOptions.forceOverwrite || resolvedOptions.assumeYes

  if (conflictFile && shouldOverwrite) {
    filePath = path.join(decksDir, conflictFile)
    action = 'overwritten'
    if (!resolvedOptions.dryRun) {
      getLogger().warn(t('cli.import.overwritingFile', { file: conflictFile }))
    }
  } else if (conflictFile && !shouldOverwrite) {
    if (resolvedOptions.noPrompts) {
      throw importConflictError(conflictFile)
    }

    if (conflictReason === 'id') {
      getLogger().warn(`\n${t('cli.import.deckExistsId', { file: conflictFile })}`)
    } else {
      getLogger().warn(`\n${t('cli.import.fileExistsName', { file: conflictFile })}`)
    }

    const resolution = await promptConflictResolution(t('cli.import.promptNewFileName'))

    if (resolution.action === 'cancel') {
      getLogger().warn(t('cli.import.cancelledSave'))
      return { status: 'cancelled' }
    } else if (resolution.action === 'rename') {
      // The typed-in name goes through the same naming rule as any other list, so
      // a prompt answer can neither escape the decks directory nor name a file `.md`.
      const renamed = listFileName(resolution.newName.replace(/\.md$/i, ''))
      if (renamed === null) {
        throw new Error(unusableFileNameMessage(resolution.newName))
      }
      fileName = renamed
      filePath = path.join(decksDir, fileName)
      action = 'renamed'
      if (!isPathWithinDir(filePath, decksDir)) {
        throw new Error(t('cli.import.invalidDeckFileName', { name: resolution.newName }))
      }

      // Double check new filename
      if (await Bun.file(filePath).exists()) {
        getLogger().error(t('cli.import.renameTargetExists', { file: fileName }))
        throw new Error(t('cli.import.fileExists'))
      }
    } else {
      // Overwrite existing file.
      filePath = path.join(decksDir, conflictFile)
      action = 'overwritten'
      getLogger().warn(t('cli.import.overwritingFile', { file: conflictFile }))
    }
  }

  // Written through the shared serializer, so an imported deck comes out with the
  // same front matter (including a canonical `format:`, resolved from the source
  // service or the deck's sections) and the same `&N` card ids as a deck saved by
  // any other surface.
  const frontMatter: DeckFrontMatter = {
    name: deckData.name,
    format: deckData.format,
    sourceId: deckData.sourceId,
    sourceUrl: deckData.sourceUrl,
    description: deckData.description,
    created: new Date().toISOString(),
    tags: [],
  }
  const fileContent = serializeDeckToMarkdown(deckData, frontMatter)

  // Derive primer sidecar path from the deck file path
  const primerPath = filePath.replace(/\.md$/, '.primer.md')
  const primerMarkdown = deckData.primer ? parseMoxfieldPrimer(deckData.primer).markdown : undefined

  const outcome: SaveListOutcome = { status: 'saved', filePath, name: deckData.name, action }

  if (resolvedOptions.dryRun) {
    // A preview of a destructive import must show the destruction: the
    // `Overwriting …` notice is suppressed under --dry-run, so the verb here
    // carries it instead of reading like a fresh create.
    saveInfo(
      resolvedOptions,
      action === 'overwritten'
        ? t('cli.import.dryRunOverwriteDeck', { path: filePath })
        : t('cli.import.dryRunSaveDeck', { path: filePath }),
    )
    if (primerMarkdown) {
      saveInfo(resolvedOptions, t('cli.import.dryRunSavePrimer', { path: primerPath }))
    }
    return outcome
  }

  await writeFileWithHash(filePath, fileContent)
  saveInfo(resolvedOptions, t('cli.import.savedDeck', { path: filePath }))

  if (primerMarkdown) {
    await Bun.write(primerPath, primerMarkdown + '\n')
    saveInfo(resolvedOptions, t('cli.import.savedPrimer', { path: primerPath }))
  }

  return outcome
}

/** Flatten parsed deck-style sections into flat-list entries, one per card line. */
function flattenToEntries(deckData: DeckData): ImportCardEntry[] {
  const entries: ImportCardEntry[] = []
  for (const section of deckData.sections) {
    for (const card of section.cards) {
      entries.push({
        name: card.name,
        quantity: card.quantity,
        set: card.set,
        collectorNumber: card.collectorNumber,
        finish: card.finish,
        condition: card.condition,
        language: card.language,
        note: card.note,
        section: section.name,
      })
    }
  }
  return entries
}

/**
 * Save parsed text-file cards as a new collection or wanted list. Mirrors the
 * deck flow's conflict handling (overwrite/rename/cancel), then applies the
 * entries through the same writer the CSV import uses, so list files come out
 * identical regardless of the import source.
 */
export async function saveFlatList(
  deckData: DeckData,
  listType: FlatListType,
  options?: SaveListOptions,
): Promise<SaveListOutcome> {
  const resolvedOptions = normalizeSaveListOptions(options)
  const label = listTypeLabel(listType)
  const entries = flattenToEntries(deckData)

  // Collection lines always carry a printing; reject up front rather than
  // writing malformed `(:)` lines or silently dropping cards.
  if (listType === 'collection') {
    const missing = entries.filter((entry) => !entry.set || !entry.collectorNumber)
    if (missing.length > 0) {
      const preview = missing.slice(0, 5).map((entry) => entry.name)
      const rest = missing.length - preview.length
      throw new Error(
        t('cli.import.collectionNeedsPrinting', {
          count: missing.length,
          names: preview.join(', '),
          more: rest > 0 ? t('cli.import.andMore', { count: rest }) : '',
        }),
      )
    }
  }

  let name = deckData.name
  let mode: CsvImportMode = 'create'
  let action: SaveListAction = 'created'

  /** The list's path, rejecting a name with nothing usable left rather than naming a file `.md`. */
  const targetPathFor = (listName: string): string => {
    const target = listFilePath(listType, listName)
    if (target === null) {
      throw new Error(unusableFileNameMessage(listName))
    }
    return target
  }

  let filePath = targetPathFor(name)
  const exists = await Bun.file(filePath).exists()
  const shouldOverwrite = resolvedOptions.forceOverwrite || resolvedOptions.assumeYes

  if (exists && shouldOverwrite) {
    mode = 'overwrite'
    action = 'overwritten'
    if (!resolvedOptions.dryRun) {
      getLogger().warn(t('cli.import.overwritingFile', { file: path.basename(filePath) }))
    }
  } else if (exists) {
    if (resolvedOptions.noPrompts) {
      throw importConflictError(path.basename(filePath))
    }

    getLogger().warn(`\n${t('cli.import.fileExistsName', { file: path.basename(filePath) })}`)
    const resolution = await promptConflictResolution(t('cli.import.promptNewListName', { label }))

    if (resolution.action === 'cancel') {
      getLogger().warn(t('cli.import.cancelledSave'))
      return { status: 'cancelled' }
    } else if (resolution.action === 'rename') {
      name = resolution.newName
      filePath = targetPathFor(name)
      action = 'renamed'

      if (await Bun.file(filePath).exists()) {
        getLogger().error(t('cli.import.renameTargetExists', { file: path.basename(filePath) }))
        throw new Error(t('cli.import.fileExists'))
      }
    } else {
      mode = 'overwrite'
      action = 'overwritten'
      getLogger().warn(t('cli.import.overwritingFile', { file: path.basename(filePath) }))
    }
  }

  if (resolvedOptions.dryRun) {
    saveInfo(
      resolvedOptions,
      action === 'overwritten'
        ? t('cli.import.dryRunOverwriteList', { label, path: filePath })
        : t('cli.import.dryRunSaveList', { label, path: filePath }),
    )
    return { status: 'saved', filePath, name, action }
  }

  const result = await applyCsvImport({ listType, name, mode }, entries)
  if ('error' in result) {
    throw new Error(result.error)
  }

  saveInfo(resolvedOptions, t('cli.import.savedList', { label, path: result.filePath }))
  return { status: 'saved', filePath: result.filePath, name, action }
}
