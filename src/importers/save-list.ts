/**
 * Saving an imported list to disk: deck and flat-list writers sharing one
 * name/ID conflict protocol (overwrite / rename / cancel). Used by the CLI
 * importers (`import`, `import-account`) and the admin import handler.
 */
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { listFileName, unusableFileNameMessage } from '../list/list-file-name'
import { listDeckFiles, parseDeckText } from './text-file'
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
import { dirForType, listFilePath, normalizeListName } from '../list/resolve-list'
import { findCollidingList } from '../list/list-lifecycle'
import { reconcileListRefs } from '../list/list-refs'
import { collectDeckCardIds } from '../card/card-id'
import { listTypeLabel, type ListType } from '../list/list-type'
import { CardCommandError, ExitCode, hasErrorCode, localizedCommandError } from '../util/errors'
import { t } from '../i18n/t'
import type { MessageKey } from '../i18n/messages/en'

/**
 * An existing list an import would replace, and how it was matched. Only a
 * deck carries a `sourceId`, so an id match is a deck match by construction.
 */
export type SaveConflict =
  | { file: string; reason: 'id'; listType: 'deck' }
  | { file: string; reason: 'name'; listType: ListType }

export type ConflictResolution =
  | { action: 'overwrite' }
  | { action: 'rename'; newName: string }
  | { action: 'cancel' }

/**
 * Settles a conflict neither `forceOverwrite` nor `assumeYes` covers. May throw
 * a `CardCommandError` to refuse outright — the CLI resolver does so when
 * prompts are unavailable — which the writers propagate untouched.
 */
export type ConflictResolver = (conflict: SaveConflict) => Promise<ConflictResolution>

export interface SaveListOptions {
  forceOverwrite?: boolean
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
  /**
   * How to settle a name/ID conflict the flags above do not. Absent — the admin
   * import handler, any headless caller — the conflict is the actionable usage
   * error rather than a prompt firing deep inside the save; the CLI passes its
   * interactive resolver (`cliConflictResolver` in `src/cli/import-prompts.ts`).
   */
  resolveConflict?: ConflictResolver
}

type ResolvedSaveOptions = Required<Omit<SaveListOptions, 'resolveConflict'>> &
  Pick<SaveListOptions, 'resolveConflict'>

/** What saving the imported list did — or would do, under `--dry-run`. */
export type SaveListAction = 'created' | 'overwritten' | 'renamed'

/** Where a save lands once any conflict is settled. */
type SaveTarget = { filePath: string; name: string; action: SaveListAction }

/** Result of {@link saveDeck} / {@link saveFlatList}: where the list went, or a prompt cancel. */
export type SaveListOutcome = ({ status: 'saved' } & SaveTarget) | { status: 'cancelled' }

function normalizeSaveListOptions(options?: SaveListOptions): ResolvedSaveOptions {
  return {
    forceOverwrite: options?.forceOverwrite ?? false,
    assumeYes: options?.assumeYes ?? false,
    dryRun: options?.dryRun ?? false,
    quiet: options?.quiet ?? false,
    resolveConflict: options?.resolveConflict,
  }
}

/** `getLogger().info` gated on a save's `quiet` option. */
function saveInfo(resolvedOptions: ResolvedSaveOptions, message: string): void {
  if (resolvedOptions.quiet) return
  getLogger().info(message)
}

/**
 * The one refusal for an import that would replace an existing list without
 * being told to. Shared by the deck and flat-list saves (and matched by the CSV
 * path's own wording) so the advice and the usage exit code never diverge.
 */
export function importConflictError(target: string): CardCommandError {
  return localizedCommandError('usage_error', ExitCode.UsageError, 'cli.import.conflict', {
    target,
  })
}

/** A list name with nothing usable left is the caller's mistake, not a crash. */
function unusableNameError(name: string): CardCommandError {
  return new CardCommandError('usage_error', unusableFileNameMessage(name), ExitCode.UsageError)
}

/** The stderr notice naming why an import conflicts, by how it was matched. */
const CONFLICT_NOTICE = {
  id: 'cli.import.deckExistsId',
  name: 'cli.import.fileExistsName',
} as const satisfies Record<SaveConflict['reason'], MessageKey>

type ConflictInput = {
  conflict: SaveConflict
  /** The import's own name, kept when the existing file is exactly its slug. */
  name: string
  /** The directory the list lives in; a rename may not escape it. */
  dir: string
  /** The path a typed-in rename would save to; null when the name is unusable. */
  pathFor: (name: string) => string | null
  options: ResolvedSaveOptions
}

/**
 * Settle a name/ID conflict: the flags decide, else the injected resolver, else
 * the usage error. Returns null when the resolver cancelled the import.
 */
async function resolveSaveConflict(input: ConflictInput): Promise<SaveTarget | null> {
  const { conflict, dir, options } = input
  const overwrite = (): SaveTarget => {
    const existing = path.basename(conflict.file, '.md')
    // A fold collision (`trade binder` vs `Trade Binder.md`) must replace the
    // existing file, not write a twin the writers would name from the import.
    const keepsName = path.basename(input.pathFor(input.name) ?? '', '.md') === existing
    return {
      filePath: path.join(dir, conflict.file),
      name: keepsName ? input.name : existing,
      action: 'overwritten',
    }
  }

  if (options.forceOverwrite || options.assumeYes) {
    if (!options.dryRun) getLogger().warn(t('cli.import.overwritingFile', { file: conflict.file }))
    return overwrite()
  }
  if (options.resolveConflict === undefined) throw importConflictError(conflict.file)

  getLogger().warn(`\n${t(CONFLICT_NOTICE[conflict.reason], { file: conflict.file })}`)
  const resolution = await options.resolveConflict(conflict)
  if (resolution.action === 'cancel') {
    getLogger().warn(t('cli.import.cancelledSave'))
    return null
  }
  if (resolution.action === 'overwrite') {
    getLogger().warn(t('cli.import.overwritingFile', { file: conflict.file }))
    return overwrite()
  }
  // The typed-in name goes through the same naming rule as any other list, so
  // a prompt answer can neither escape the list directory nor name a file `.md`.
  const newName = resolution.newName.replace(/\.md$/i, '')
  const filePath = input.pathFor(newName)
  if (filePath === null || !isPathWithinDir(filePath, dir)) {
    throw unusableNameError(resolution.newName)
  }
  if (await Bun.file(filePath).exists()) throw importConflictError(path.basename(filePath))
  return { filePath, name: newName, action: 'renamed' }
}

/**
 * Where a save lands: the fresh `created` target when nothing conflicts, else
 * whatever {@link resolveSaveConflict} settles on — or null for a cancel.
 */
async function settleTarget(
  created: Omit<SaveTarget, 'action'>,
  conflict: SaveConflict | null,
  input: Omit<ConflictInput, 'conflict'>,
): Promise<SaveTarget | null> {
  if (conflict === null) return { ...created, action: 'created' }
  return resolveSaveConflict({ conflict, ...input })
}

/**
 * The `sourceId` a deck file's leading front-matter block declares, read with
 * a regex rather than a YAML parse: a neighbour's malformed front matter must
 * never fail an unrelated import. An unquoted numeric scalar is a YAML number,
 * which `validateDeckFrontMatter` does not read as a source id either.
 */
async function readSourceId(filePath: string): Promise<string | undefined> {
  const content = await Bun.file(filePath).text()
  const frontMatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  const match = frontMatter.match(/^sourceId:\s*(?:"([^"]*)"|'([^']*)'|(\S+))/m)
  if (!match) return undefined
  if (match[3] !== undefined && /^\d+$/.test(match[3])) return undefined
  return match[1] ?? match[2] ?? match[3]
}

/** The existing deck an import would replace: same source id first, then a folded name. */
async function scanDeckConflict(
  deckData: DeckData,
  decksDir: string,
  fileName: string,
): Promise<SaveConflict | null> {
  let existingFiles: string[]
  try {
    existingFiles = await listDeckFiles(decksDir)
  } catch (error) {
    // A dry run (or a first import) legitimately finds no decks dir; any other
    // read failure must not be mistaken for "no conflicts".
    if (!hasErrorCode(error, 'ENOENT')) throw error
    existingFiles = []
  }
  if (deckData.sourceId) {
    for (const file of existingFiles) {
      if ((await readSourceId(path.join(decksDir, file))) === deckData.sourceId) {
        return { file, reason: 'id', listType: 'deck' }
      }
    }
  }
  // By the resolver's folding, not a byte-exact file name: importing `atraxa
  // superfriends` beside `Atraxa Superfriends.md` would otherwise create a pair
  // every name-resolving command reports as ambiguous, which `new` and `rename` refuse.
  const normalized = normalizeListName(path.basename(fileName, '.md'))
  const folded = existingFiles.find(
    (f) => normalizeListName(path.basename(f, '.md')) === normalized,
  )
  return folded === undefined ? null : { file: folded, reason: 'name', listType: 'deck' }
}

/**
 * The existing list of this type an import's name folds onto, if any — the same
 * fold `new` and `rename` refuse. Exported for the CSV import path, whose
 * `--overwrite` must land on the folded file too.
 */
export async function scanNameConflict(
  listType: ListType,
  filePath: string,
): Promise<SaveConflict | null> {
  const existing = await findCollidingList(listType, path.basename(filePath, '.md'))
  return existing === null
    ? null
    : { file: path.basename(existing.filePath), reason: 'name', listType }
}

/** The `&N` ids a deck file holds, so an overwrite can retire what it replaces. */
async function readDeckCardIds(filePath: string, fallbackName: string): Promise<number[]> {
  const content = await Bun.file(filePath).text()
  return collectDeckCardIds(parseDeckText(content, fallbackName).deck)
}

export async function saveDeck(
  deckData: DeckData,
  decksDir: string,
  options?: SaveListOptions,
): Promise<SaveListOutcome> {
  const resolvedOptions = normalizeSaveListOptions(options)
  // An imported deck's name comes from the source service, so it can be
  // anything — a name with nothing usable left is an error, not a file called `.md`.
  const fileName = listFileName(deckData.name)
  if (fileName === null) throw unusableNameError(deckData.name)
  const pathFor = (name: string): string | null => {
    const file = listFileName(name)
    return file === null ? null : path.join(decksDir, file)
  }

  // A dry run must leave a pristine directory byte-for-byte untouched, so the
  // decks dir is only created on the path that actually writes into it; the
  // conflict scan tolerates a missing directory.
  if (!resolvedOptions.dryRun) {
    await fs.mkdir(decksDir, { recursive: true })
  }

  const target = await settleTarget(
    { filePath: path.join(decksDir, fileName), name: deckData.name },
    await scanDeckConflict(deckData, decksDir, fileName),
    { name: deckData.name, dir: decksDir, pathFor, options: resolvedOptions },
  )
  if (target === null) return { status: 'cancelled' }
  const { filePath, action } = target

  // Written through the shared serializer, so an imported deck comes out with the
  // same front matter (including a canonical `format:`, resolved from the source
  // service or the deck's sections) and the same `&N` card ids as a deck saved by
  // any other surface.
  const frontMatter: DeckFrontMatter = {
    format: deckData.format,
    sourceId: deckData.sourceId,
    sourceUrl: deckData.sourceUrl,
    description: deckData.description,
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

  // The replaced deck's `&N` ids are retired: the new lines are numbered from
  // scratch, so custom art or a cover filed under an old id would otherwise
  // reappear on whichever card takes the number next.
  const retired = action === 'overwritten' ? await readDeckCardIds(filePath, deckData.name) : []
  await writeFileWithHash(filePath, fileContent)
  if (retired.length > 0) await reconcileListRefs(filePath, { removed: retired })
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
        labels: card.labels,
        tags: card.tags,
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
      throw localizedCommandError(
        'usage_error',
        ExitCode.UsageError,
        'cli.import.collectionNeedsPrinting',
        {
          count: missing.length,
          names: preview.join(', '),
          more: rest > 0 ? t('cli.import.andMore', { count: rest }) : '',
        },
      )
    }
  }

  // The list's path, rejecting a name with nothing usable left rather than naming a file `.md`.
  const filePath = listFilePath(listType, deckData.name)
  if (filePath === null) throw unusableNameError(deckData.name)

  const target = await settleTarget(
    { filePath, name: deckData.name },
    await scanNameConflict(listType, filePath),
    {
      name: deckData.name,
      dir: dirForType(listType),
      pathFor: (name) => listFilePath(listType, name),
      options: resolvedOptions,
    },
  )
  if (target === null) return { status: 'cancelled' }
  const { name, action } = target
  const mode: CsvImportMode = action === 'overwritten' ? 'overwrite' : 'create'

  if (resolvedOptions.dryRun) {
    saveInfo(
      resolvedOptions,
      action === 'overwritten'
        ? t('cli.import.dryRunOverwriteList', { label, path: target.filePath })
        : t('cli.import.dryRunSaveList', { label, path: target.filePath }),
    )
    return { status: 'saved', filePath: target.filePath, name, action }
  }

  // The settled path is handed down so an overwrite replaces the file the
  // notice named, never a folded twin the writer would name from the import.
  const result = await applyCsvImport({ listType, name, mode, filePath: target.filePath }, entries)
  if ('error' in result) {
    throw new CardCommandError('usage_error', result.error, ExitCode.UsageError)
  }

  saveInfo(resolvedOptions, t('cli.import.savedList', { label, path: result.filePath }))
  return { status: 'saved', filePath: result.filePath, name, action }
}
