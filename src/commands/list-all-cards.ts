import { Command } from 'commander'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from '../base-dir'
import { printingSuffix } from '../card-line'
import { getCollectionsDir, getDecksDir, getWantedDir } from '../ritual-config'
import { importFromTextFile, listDeckFiles } from '../importers/text-file'
import { parseCollectionFile } from '../collection-file'
import { parseWantedListFile } from './wanted-helpers'
import { CardCommandError, getErrorMessage } from '../errors'
import { runCommandAction } from './card-target'
import {
  addScriptingOptions,
  emitToFileOrStdout,
  ExitCode,
  normalizeScriptingOptions,
  type OutputConfirmation,
  type OutputFormat,
  type ScriptingOptions,
} from './scripting'
import type { DeckData } from '../types'

export type UniqueCardEntry = {
  name: string
  set?: string
  collectorNumber?: string
}

/** A list file (or directory) that could not be read or parsed while collecting cards. */
export type SkippedFile = {
  /** Path relative to the base directory. */
  file: string
  reason: string
}

/** Everything a scan of the list directories produced: entries plus per-file diagnostics. */
export type CollectAllCardsResult = {
  entries: UniqueCardEntry[]
  /** Files whose read or parse failed entirely; the manifest is missing their cards. */
  skipped: SkippedFile[]
  /** Non-fatal parser warnings (e.g. malformed lines), prefixed with their file. */
  warnings: string[]
}

/** Mutable accumulator threaded through the per-directory collectors. */
type CollectContext = {
  seen: Map<string, UniqueCardEntry>
  skipped: SkippedFile[]
  warnings: string[]
}

/** The minimal parse-result surface shared by the collection and wanted-list parsers. */
type ParsedFlatList = {
  entries: UniqueCardEntry[]
  warnings: string[]
}

function entryKey(entry: UniqueCardEntry): string {
  return `${entry.name}|${entry.set ?? ''}|${entry.collectorNumber ?? ''}`
}

function compareEntries(a: UniqueCardEntry, b: UniqueCardEntry): number {
  const nameCmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en')
  if (nameCmp !== 0) return nameCmp
  const setCmp = (a.set ?? '').localeCompare(b.set ?? '', 'en')
  if (setCmp !== 0) return setCmp
  return (a.collectorNumber ?? '').localeCompare(b.collectorNumber ?? '', 'en', { numeric: true })
}

function relativeToBase(filePath: string): string {
  return path.relative(getBaseDir(), filePath)
}

function isMissingDirError(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * List the markdown files of a flat-list directory. A missing directory is
 * normal (the user may not have set one up); any other readdir failure is
 * reported as a skip so the manifest's incompleteness is visible.
 */
async function readMarkdownFiles(dir: string, ctx: CollectContext): Promise<string[]> {
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch (err) {
    if (!isMissingDirError(err)) {
      ctx.skipped.push({ file: relativeToBase(dir), reason: getErrorMessage(err) })
    }
    return []
  }
  return files.filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
}

async function collectFromDecks(dir: string, ctx: CollectContext): Promise<void> {
  let files: string[]
  try {
    files = await listDeckFiles(dir)
  } catch (err) {
    if (!isMissingDirError(err)) {
      ctx.skipped.push({ file: relativeToBase(dir), reason: getErrorMessage(err) })
    }
    return
  }
  for (const fileName of files) {
    const filePath = path.join(dir, fileName)
    let deck: DeckData
    try {
      deck = await importFromTextFile(filePath)
    } catch (err) {
      ctx.skipped.push({ file: relativeToBase(filePath), reason: getErrorMessage(err) })
      continue
    }
    for (const section of deck.sections) {
      for (const card of section.cards) {
        const entry: UniqueCardEntry = {
          name: card.name,
          set: card.set?.toLowerCase(),
          collectorNumber: card.collectorNumber,
        }
        ctx.seen.set(entryKey(entry), entry)
      }
    }
  }
}

async function collectFromFlatLists(
  dir: string,
  parse: (content: string) => ParsedFlatList,
  ctx: CollectContext,
): Promise<void> {
  for (const fileName of await readMarkdownFiles(dir, ctx)) {
    const filePath = path.join(dir, fileName)
    let content: string
    try {
      content = await fs.readFile(filePath, 'utf-8')
    } catch (err) {
      ctx.skipped.push({ file: relativeToBase(filePath), reason: getErrorMessage(err) })
      continue
    }
    const { entries, warnings } = parse(content)
    for (const warning of warnings) {
      ctx.warnings.push(`${relativeToBase(filePath)}: ${warning}`)
    }
    for (const e of entries) {
      const entry: UniqueCardEntry = {
        name: e.name,
        set: e.set?.toLowerCase(),
        collectorNumber: e.collectorNumber,
      }
      ctx.seen.set(entryKey(entry), entry)
    }
  }
}

export async function collectAllCards(): Promise<CollectAllCardsResult> {
  const ctx: CollectContext = { seen: new Map(), skipped: [], warnings: [] }
  await collectFromDecks(getDecksDir(), ctx)
  await collectFromFlatLists(getCollectionsDir(), parseCollectionFile, ctx)
  await collectFromFlatLists(getWantedDir(), parseWantedListFile, ctx)
  return {
    entries: Array.from(ctx.seen.values()).sort(compareEntries),
    skipped: ctx.skipped,
    warnings: ctx.warnings,
  }
}

export function formatAllCardsFile(entries: UniqueCardEntry[]): string {
  const lines: string[] = ['# All cards', '']
  for (const entry of entries) {
    lines.push(`- ${entry.name}${printingSuffix(entry.set, entry.collectorNumber)}`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Serialize the manifest for the requested format. `text` is the markdown
 * manifest; `json`/`ndjson` emit the raw {@link UniqueCardEntry} array (set
 * codes lowercase, as stored). The result carries its own trailing newline so
 * stdout and `--out` file contents are byte-identical.
 */
function renderManifest(entries: UniqueCardEntry[], format: OutputFormat): string {
  if (format === 'json') return `${JSON.stringify(entries, null, 2)}\n`
  if (format === 'ndjson') return entries.map((entry) => `${JSON.stringify(entry)}\n`).join('')
  return formatAllCardsFile(entries)
}

/** Resolve `--out` to an absolute path; absent or `-` means stdout. */
function resolveOutPath(out: string | undefined): string | undefined {
  if (out === undefined || out === '-') return undefined
  return path.isAbsolute(out) ? out : path.join(getBaseDir(), out)
}

type ListAllCardsOptions = Partial<ScriptingOptions> & {
  out?: string
}

async function runListAllCards(
  out: string | undefined,
  scripting: ScriptingOptions,
): Promise<void> {
  const { entries, skipped, warnings } = await collectAllCards()

  for (const warning of warnings) {
    console.warn(`warning: ${warning}`)
  }
  for (const skip of skipped) {
    console.warn(`warning: skipped ${skip.file}: ${skip.reason}`)
  }
  if (skipped.length > 0) {
    // The manifest is still emitted, but it is incomplete — surface that to CI.
    process.exitCode = ExitCode.RuntimeError
  }

  const rendered = renderManifest(entries, scripting.output)
  const outPath = resolveOutPath(out)
  // No stdout-mode confirmation: stdout is the data channel.
  const confirm: OutputConfirmation = {
    file: (target) => `Wrote ${entries.length} cards to ${target}`,
  }
  if (outPath === undefined) {
    await emitToFileOrStdout(rendered, { quiet: scripting.quiet, confirm })
    return
  }

  try {
    await emitToFileOrStdout(rendered, { outPath, quiet: scripting.quiet, confirm })
  } catch (err) {
    throw new CardCommandError(
      'runtime_error',
      `Failed to write ${outPath}: ${getErrorMessage(err)}`,
      ExitCode.RuntimeError,
    )
  }
}

export function registerListAllCardsCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('list-all-cards')
      .description(
        'Print a manifest of every unique card across decks, collections, and wanted lists. Useful as a deterministic cache key for CI builds.',
      )
      .option(
        '--out <file>',
        "Write the manifest to this file (relative to base dir) instead of stdout; '-' means stdout",
      ),
  ).action(async (options: ListAllCardsOptions) => {
    const scripting = normalizeScriptingOptions(options)
    await runCommandAction(scripting, () => runListAllCards(options.out, scripting))
  })
}
