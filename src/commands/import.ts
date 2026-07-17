import { Command } from 'commander'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { promptUser } from '../utils'
import { listFileName, unusableFileNameMessage } from '../list-file-name'
import { importFromTextFile, listDeckFiles } from '../importers/text-file'
import { fetchDeckFromUrl, resolveImportSourceUrl } from '../importers/url-dispatch'
import {
  applyCsvImport,
  type CsvImportMode,
  type FlatListType,
  type ImportCardEntry,
} from '../importers/csv-apply'
import { type DeckData } from '../types'
import { serializeDeckToMarkdown, type DeckFrontMatter } from '../deck-file'
import { parseMoxfieldPrimer } from '../primer-parser'
import { ExitCode } from './scripting'
import { getLogger } from '../logger'
import { writeFileWithHash } from '../content-hash'
import { isPathWithinDir } from '../path-validation'
import { getDecksDir } from '../ritual-config'
import { listFilePath } from '../resolve-list'
import { isListType, listTypeLabel, LIST_TYPES, type ListType } from '../list-type'
import { promptListType } from './prompts-helpers'

interface SaveListOptions {
  forceOverwrite?: boolean
  nonInteractive?: boolean
  assumeYes?: boolean
  dryRun?: boolean
}

type DeckFileFrontmatter = {
  sourceId?: string
}

type ImportCommandOptions = {
  type?: string
  overwrite?: boolean
  nonInteractive?: boolean
  yes?: boolean
  dryRun?: boolean
  moxfieldUserAgent?: string
}

function normalizeSaveListOptions(options?: SaveListOptions | boolean): Required<SaveListOptions> {
  if (typeof options === 'boolean') {
    return {
      forceOverwrite: options,
      nonInteractive: false,
      assumeYes: false,
      dryRun: false,
    }
  }

  return {
    forceOverwrite: options?.forceOverwrite ?? false,
    nonInteractive: options?.nonInteractive ?? false,
    assumeYes: options?.assumeYes ?? false,
    dryRun: options?.dryRun ?? false,
  }
}

type ConflictResolution =
  | { action: 'overwrite' }
  | { action: 'rename'; newName: string }
  | { action: 'cancel' }

/** Run the interactive overwrite/rename/cancel dance for an import name conflict. */
async function promptConflictResolution(renamePrompt: string): Promise<ConflictResolution> {
  let response = ''
  while (!['o', 'r', 'c'].includes(response)) {
    response = (await promptUser('Action: [O]verwrite, [R]ename, [C]ancel? ')).toLowerCase()
  }

  if (response === 'c') return { action: 'cancel' }
  if (response === 'o') return { action: 'overwrite' }

  let newName = ''
  while (!newName) {
    newName = await promptUser(renamePrompt)
  }
  return { action: 'rename', newName }
}

// Export saveDeck for reuse
export async function saveDeck(
  deckData: DeckData,
  decksDir: string,
  options?: SaveListOptions | boolean,
): Promise<void> {
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

  await fs.mkdir(decksDir, { recursive: true })

  let existingFiles: string[]
  try {
    existingFiles = await listDeckFiles(decksDir)
  } catch {
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

  // If no ID conflict, check Filename conflict
  if (!conflictFile && existingFiles.includes(fileName)) {
    conflictFile = fileName
    conflictReason = 'name'
  }

  let filePath = path.join(decksDir, fileName)
  const shouldOverwrite = resolvedOptions.forceOverwrite || resolvedOptions.assumeYes

  if (conflictFile && shouldOverwrite) {
    filePath = path.join(decksDir, conflictFile)
    if (!resolvedOptions.dryRun) {
      getLogger().info(`Overwriting ${conflictFile}...`)
    }
  } else if (conflictFile && !shouldOverwrite) {
    if (resolvedOptions.nonInteractive) {
      throw new Error(
        `Import conflict for '${conflictFile}'. Re-run with --overwrite or --yes, or disable --non-interactive.`,
      )
    }

    if (conflictReason === 'id') {
      getLogger().info(`\nDeck already exists (ID Match): ${conflictFile}`)
    } else {
      getLogger().info(`\nFile already exists (Name Conflict): ${conflictFile}`)
    }

    const resolution = await promptConflictResolution('Enter new filename (without .md): ')

    if (resolution.action === 'cancel') {
      getLogger().info('Import cancelled.')
      return
    } else if (resolution.action === 'rename') {
      // The typed-in name goes through the same naming rule as any other list, so
      // a prompt answer can neither escape the decks directory nor name a file `.md`.
      const renamed = listFileName(resolution.newName.replace(/\.md$/i, ''))
      if (renamed === null) {
        throw new Error(unusableFileNameMessage(resolution.newName))
      }
      fileName = renamed
      filePath = path.join(decksDir, fileName)
      if (!isPathWithinDir(filePath, decksDir)) {
        throw new Error(`Name '${resolution.newName}' is not a valid deck file name`)
      }

      // Double check new filename
      if (await Bun.file(filePath).exists()) {
        getLogger().error(`File '${fileName}' also exists. Aborting.`)
        throw new Error('File exists')
      }
    } else {
      // Overwrite existing file.
      filePath = path.join(decksDir, conflictFile)
      getLogger().info(`Overwriting ${conflictFile}...`)
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

  if (resolvedOptions.dryRun) {
    getLogger().info(`[dry-run] Would save deck to: ${filePath}`)
    if (primerMarkdown) {
      getLogger().info(`[dry-run] Would save primer to: ${primerPath}`)
    }
    return
  }

  await writeFileWithHash(filePath, fileContent)
  getLogger().info(`Successfully imported deck to: ${filePath}`)

  if (primerMarkdown) {
    await Bun.write(primerPath, primerMarkdown + '\n')
    getLogger().info(`Successfully saved primer to: ${primerPath}`)
  }
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
): Promise<void> {
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
        `Cannot import as a collection: ${missing.length} card line(s) have no printing ` +
          `(set and collector number required): ${preview.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`,
      )
    }
  }

  let name = deckData.name
  let mode: CsvImportMode = 'create'

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
    if (!resolvedOptions.dryRun) {
      getLogger().info(`Overwriting ${path.basename(filePath)}...`)
    }
  } else if (exists) {
    if (resolvedOptions.nonInteractive) {
      throw new Error(
        `Import conflict for '${path.basename(filePath)}'. Re-run with --overwrite or --yes, or disable --non-interactive.`,
      )
    }

    getLogger().info(`\nFile already exists (Name Conflict): ${path.basename(filePath)}`)
    const resolution = await promptConflictResolution(`Enter new ${label} name: `)

    if (resolution.action === 'cancel') {
      getLogger().info('Import cancelled.')
      return
    } else if (resolution.action === 'rename') {
      name = resolution.newName
      filePath = targetPathFor(name)

      if (await Bun.file(filePath).exists()) {
        getLogger().error(`File '${path.basename(filePath)}' also exists. Aborting.`)
        throw new Error('File exists')
      }
    } else {
      mode = 'overwrite'
      getLogger().info(`Overwriting ${path.basename(filePath)}...`)
    }
  }

  if (resolvedOptions.dryRun) {
    getLogger().info(`[dry-run] Would save ${label} to: ${filePath}`)
    return
  }

  const result = await applyCsvImport({ listType, name, mode }, entries)
  if ('error' in result) {
    throw new Error(result.error)
  }

  getLogger().info(`Successfully imported ${label} to: ${result.filePath}`)
}

/** Resolve the target list type for a text-file import: flag, prompt, or deck default. */
async function resolveImportListType(
  typeFlag: ListType | undefined,
  nonInteractive: boolean,
): Promise<ListType | undefined> {
  if (typeFlag !== undefined) return typeFlag
  // Scripted imports keep the command's historical deck behavior, but say so —
  // the type was defaulted, not chosen.
  if (nonInteractive) {
    getLogger().info(
      'No --type given; importing as a deck (pass --type to import a collection or wanted list).',
    )
    return 'deck'
  }

  return promptListType()
}

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description(
      'Import a deck from a URL (Archidekt, Moxfield, MTGGoldfish), or a deck, collection, or wanted list from a local text file',
    )
    .argument('<source>', 'URL or file path')
    .option(
      '-t, --type <type>',
      `List type for a text file import: ${LIST_TYPES.join(', ')} (URLs always import decks)`,
    )
    .option('-o, --overwrite', 'Overwrite existing lists without prompting')
    .option('--non-interactive', 'Disable interactive prompts; fail when input is required')
    .option('-y, --yes', 'Automatically answer yes to prompts (implies overwrite on conflicts)')
    .option('--dry-run', 'Preview actions without writing files')
    .option(
      '--moxfield-user-agent <agent>',
      'Moxfield-approved unique User-Agent string (required for Moxfield imports unless MOXFIELD_USER_AGENT is set)',
    )
    .action(async (source: string, options: ImportCommandOptions) => {
      const logger = getLogger()

      let typeFlag: ListType | undefined
      if (options.type !== undefined) {
        const normalized = options.type.toLowerCase()
        if (!isListType(normalized)) {
          logger.error(`Invalid list type '${options.type}'. Use: ${LIST_TYPES.join(', ')}`)
          process.exitCode = ExitCode.UsageError
          return
        }
        typeFlag = normalized
      }

      // URL-shaped sources (explicit scheme, or a scheme-less supported deck
      // URL like `archidekt.com/decks/123`) go through URL dispatch; everything
      // else is a local file path.
      const sourceUrl = resolveImportSourceUrl(source)
      const isUrl = sourceUrl !== undefined
      if (isUrl && typeFlag !== undefined && typeFlag !== 'deck') {
        logger.error(
          `URL imports only support decks; importing a ${listTypeLabel(typeFlag)} from a URL is not supported.`,
        )
        process.exitCode = ExitCode.UsageError
        return
      }

      const nonInteractive = options.nonInteractive === true || options.yes === true
      const saveOptions: SaveListOptions = {
        forceOverwrite: options.overwrite === true,
        nonInteractive,
        assumeYes: options.yes === true,
        dryRun: options.dryRun === true,
      }

      try {
        if (sourceUrl !== undefined) {
          const result = await fetchDeckFromUrl(sourceUrl, {
            moxfieldUserAgent: options.moxfieldUserAgent,
            onProgress: (message) => logger.info(message),
          })
          if (typeof result === 'string') {
            logger.error(`Error: ${result}`)
            process.exitCode = ExitCode.UsageError
            return
          }
          await saveDeck(result, getDecksDir(), saveOptions)
          return
        }

        if (!(await Bun.file(source).exists())) {
          logger.error(`File not found: ${source}`)
          process.exitCode = ExitCode.NotFound
          return
        }

        logger.info(`Reading cards from file: ${source}...`)
        const deckData = await importFromTextFile(source)

        const listType = await resolveImportListType(typeFlag, nonInteractive)
        if (listType === undefined) {
          logger.info('Import cancelled.')
          return
        }

        if (listType === 'deck') {
          await saveDeck(deckData, getDecksDir(), saveOptions)
        } else {
          await saveFlatList(deckData, listType, saveOptions)
        }
      } catch (error) {
        logger.error('Failed to import:', error)
        process.exitCode = ExitCode.RuntimeError
      }
    })
}
