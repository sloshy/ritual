import { Command, Option } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from '../config/base-dir'
import { isRitualClean, writeFileWithHash } from '../changes/content-hash'
import { listFileName, unusableFileNameMessage } from '../list/list-file-name'
import { listLocations, type ListLocation } from '../list/resolve-list'
import type { ListType } from '../list/list-type'
import {
  deckFormatKeysForSignal,
  detectDeckFormatSignal,
  type DeckFormatKey,
  type DeckFormatSignal,
} from '../list/deck-format'
import {
  parseDeckFrontMatter,
  serializeDeckToMarkdown,
  type DeckFrontMatter,
} from '../list/deck-file'
import type { DeckData } from '../list/deck'
import { unreadableLines } from '../list/markdown-fence'
import { parseDeckText } from '../importers/text-file'
import { listNameCollision } from '../list/list-lifecycle'
import { moveListFileAndSidecars, renameListThroughTemp } from '../list/list-sidecars'
import { isSameFile as statSameFile, type SameFileCheck } from '../util/same-file'
import { collectionToMarkdown, wantedToMarkdown } from '../list/list-export'
import { getErrorMessage, localizedCommandError, ExitCode } from '../util/errors'
import { runCommandAction } from '../cli/action'
import { promptDeckFormat } from './deck-helpers'
import { readCollectionFile, readWantedFile } from './flat-list-session'
import {
  canPromptWithOutput,
  emitOutput,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from '../cli/output'
import { addDryRunOption, addScriptingOptions } from '../cli/options'
import { t } from '../i18n/t'

/**
 * The `ritual cleanup` command: one pass over every deck, collection, and wanted
 * list that brings each file up to the current conventions —
 *
 * 1. every deck gets an explicit `format:`, chosen by the user via
 *    {@link CleanupOptions.chooseFormat} — the deck's shape (command zone, card
 *    count) only orders the offered formats, it never decides;
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
   * Choose a format for a deck whose front matter declares none. `signal` is
   * what the deck's card list suggests, for ordering the offered formats.
   * Return null to leave the deck alone. Omitted (e.g. under `--dry-run`),
   * every such deck is left unset and reported.
   */
  chooseFormat?: (deckName: string, signal: DeckFormatSignal) => Promise<DeckFormatKey | null>
  /**
   * The same seam `renameList` takes: how "is the destination this very file?"
   * is decided. Defaults to a device+inode comparison; injectable so the
   * case-insensitive-file-system path can be exercised on a case-sensitive one.
   */
  isSameFile?: SameFileCheck
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
  /**
   * True when parse warnings blocked the rewrite: the parser skipped lines, so
   * a re-emit would silently drop them. The file must be fixed by hand.
   */
  rewriteBlocked?: boolean
  /**
   * True when the file could not be read or parsed at all (broken YAML front
   * matter, an unreadable file). Nothing is rewritten or renamed for it, the
   * reason is in `warnings`, and the run reports failure — but every other list
   * is still cleaned up, which is the whole point of a per-file failure.
   */
  unreadable?: boolean
  warnings: string[]
}

/** True when the result carries something worth reporting. */
export function hasCleanupActions(result: CleanupResult): boolean {
  return (
    result.unreadable === true ||
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
  /**
   * Notices about content that parsed but is worth saying out loud: a card name
   * starting with a quantity (which the re-emit preserves exactly), or a deck's
   * empty extras section (which the re-emit drops — the one advisory that names
   * something cleanup removes). Reported alongside the warnings, never blocking.
   */
  advisories: string[]
  /** Format stamped onto a deck that had none. */
  formatSet?: DeckFormatKey
  /** True for a deck left without a format (no answer, or dry-run). */
  missingFormat?: boolean
}

/**
 * A deck read and parsed, before the format question is asked.
 *
 * The split exists so `cleanupList`'s "could not be read" guard can wrap the
 * read and *only* the read. With the prompt inside it, a `--no-input` run that
 * needed the deck-format prompt reported the file as unreadable and exited 1,
 * hiding both the real usage error and the file's actual parse error.
 */
type ParsedDeckDocument = {
  original: string
  deck: DeckData
  frontMatter: DeckFrontMatter
  parseWarnings: string[]
  advisories: string[]
}

async function readDeckDocument(location: ListLocation): Promise<ParsedDeckDocument> {
  const original = await fs.readFile(location.filePath, 'utf-8')
  // Parsed directly (not via `loadDeck`) for the skipped-line warnings, which
  // gate the rewrite below — a re-emit would drop what the parser skipped.
  const parsedDeck = parseDeckText(original, location.name)
  const { deck, advisories } = parsedDeck
  // Fenced code blocks join the parse warnings: the canonical re-emit would
  // delete them, exactly like a line the parser could not read.
  const warnings = unreadableLines(parsedDeck)
  // Copy before mutating: gray-matter caches parses by content string, so the
  // parsed front matter object is shared between byte-identical files.
  const frontMatter = { ...(await parseDeckFrontMatter(location.filePath)) }
  return { original, deck, frontMatter, parseWarnings: warnings, advisories }
}

/**
 * Ask for a missing deck format (when the caller supplies a prompt) and produce
 * the document the shared cleanup tail works on.
 *
 * Runs outside `cleanupList`'s read guard: a prompt that cannot run is the
 * command's problem, not the file's, and must reach the caller as a thrown
 * usage error rather than a per-file warning.
 */
async function resolveDeckDocument(
  parsed: ParsedDeckDocument,
  options: CleanupOptions,
): Promise<ListDocument> {
  const { original, deck, parseWarnings: warnings } = parsed
  const frontMatter = parsed.frontMatter
  let formatSet: DeckFormatKey | undefined
  let missingFormat: boolean | undefined
  // A declared format stands; anything less — including a format the sections
  // merely imply — is the user's call. The deck's shape orders the choices.
  if (!(deck.format ?? frontMatter.format)) {
    const chosen = options.chooseFormat
      ? await options.chooseFormat(deck.name, detectDeckFormatSignal(deck))
      : null
    if (chosen) {
      frontMatter.format = chosen
      formatSet = chosen
    } else {
      // Not chosen (cancelled, or dry-run). Leave the file's content entirely
      // alone: re-emitting would stamp the section-inferred format the user
      // just declined to confirm (`serializeDeckToMarkdown` persists it).
      missingFormat = true
      return {
        displayName: deck.name,
        original,
        canonical: original,
        parseWarnings: warnings,
        advisories: parsed.advisories,
        missingFormat,
      }
    }
  }
  return {
    displayName: deck.name,
    original,
    canonical: serializeDeckToMarkdown(deck, frontMatter),
    parseWarnings: warnings,
    advisories: parsed.advisories,
    formatSet,
    missingFormat,
  }
}

async function readCollectionDocument(location: ListLocation): Promise<ListDocument> {
  const file = await readCollectionFile(location.filePath)
  return {
    displayName: file.title,
    original: file.content,
    canonical: collectionToMarkdown(file.title, file.entries, file.sectionOrder, file.frontMatter),
    parseWarnings: file.warnings,
    advisories: file.advisories,
  }
}

async function readWantedDocument(location: ListLocation): Promise<ListDocument> {
  const file = await readWantedFile(location.filePath)
  return {
    displayName: file.title,
    original: file.content,
    canonical: wantedToMarkdown(file.title, file.entries, file.sectionOrder, file.frontMatter),
    parseWarnings: file.warnings,
    advisories: file.advisories,
  }
}

/** Record a file the cleanup could not read, and skip it. */
function markUnreadable(result: CleanupResult, error: unknown): CleanupResult {
  result.unreadable = true
  result.warnings.push(t('cli.cleanup.couldNotRead', { reason: getErrorMessage(error) }))
  result.warnings.push(t('cli.cleanup.skipped'))
  return result
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

  // The read is the one step that can throw for reasons the file itself owns —
  // broken front matter, bad permissions. `cleanupList` promises those land in
  // `warnings`, so the whole workspace is not lost to one hand-edited file.
  // Only the read is guarded. A deck's format prompt runs *after* its read
  // returns, so a prompt that cannot run stays a usage error the command reports
  // rather than being relabelled as a broken file.
  let document: ListDocument
  if (location.type === 'deck') {
    let parsed: ParsedDeckDocument
    try {
      parsed = await readDeckDocument(location)
    } catch (error) {
      return markUnreadable(result, error)
    }
    document = await resolveDeckDocument(parsed, options)
  } else {
    try {
      document =
        location.type === 'collection'
          ? await readCollectionDocument(location)
          : await readWantedDocument(location)
    } catch (error) {
      return markUnreadable(result, error)
    }
  }
  if (document.formatSet) result.formatSet = document.formatSet
  if (document.missingFormat) result.missingFormat = true

  // Where the file should live, given the list's display name.
  const dir = path.dirname(location.filePath)
  const currentBase = path.basename(location.filePath)
  const targetBase = listFileName(document.displayName)
  let targetPath = location.filePath
  let sameFileTarget = false
  const sameFile = options.isSameFile ?? statSameFile
  if (targetBase === null) {
    result.warnings.push(unusableFileNameMessage(document.displayName))
  } else if (targetBase !== currentBase) {
    const candidate = path.join(dir, targetBase)
    // The destination can name this very file — which it does on a
    // case-insensitive file system when the rename only changes casing. That is
    // this list's own rename, not a conflict, but it needs the two-step move
    // below, since a direct rename would be a no-op there.
    sameFileTarget =
      (await Bun.file(candidate).exists()) && (await sameFile(candidate, location.filePath))
    const occupied = (await Bun.file(candidate).exists()) && !sameFileTarget
    // Renaming onto a name that merely *folds* onto another list would leave the
    // two mutually unaddressable — the same refusal `new` and `rename` give.
    const collision = occupied
      ? null
      : await listNameCollision(location.type, document.displayName, location.filePath, sameFile)
    if (occupied) {
      result.warnings.push(t('cli.cleanup.notRenamedOccupied', { file: targetBase }))
    } else if (collision) {
      result.warnings.push(
        t('cli.cleanup.notRenamedCollision', { file: targetBase, reason: collision.message }),
      )
    } else {
      targetPath = candidate
      result.renamedTo = targetBase
    }
  }

  // Reported, never blocking: this is the surface that reads every list file,
  // and so the one place a quantity-prefixed line in a collection or wanted list
  // reliably gets said out loud. Most of these lines survive the re-emit
  // verbatim; a deck's empty extras section is the exception the re-emit drops,
  // which is precisely why cleanup has to name it.
  result.warnings.push(...document.advisories)

  // A file whose parse skipped lines would lose them if re-emitted; leave its
  // content alone (renaming is still safe) and surface the warnings instead.
  if (document.parseWarnings.length > 0) {
    result.rewriteBlocked = true
    result.warnings.push(...document.parseWarnings)
    result.warnings.push(t('cli.cleanup.notRewritten'))
  } else {
    result.rewritten = document.canonical !== document.original
  }

  if (options.dryRun) return result

  if (targetPath !== location.filePath) {
    // A rename-only cleanup does not rewrite content, so the still-valid hash
    // sidecar travels with the file — the shared movers own that, and the whole
    // sidecar set, so a future sidecar kind cannot be left behind here.
    if (sameFileTarget) {
      await renameListThroughTemp(location.filePath, targetPath)
    } else {
      await moveListFileAndSidecars(location.filePath, targetPath)
    }
  }
  if (result.rewritten) {
    // Refresh the `.sha256` only when it matched the file before cleanup ran.
    // Stamping a file that holds unrecorded hand edits would make detect-changes
    // skip it and drop the edits' changelog entries — cleanup canonicalizes
    // formatting, it does not get to declare someone else's edits recorded.
    if (await isRitualClean(targetPath, document.original)) {
      await writeFileWithHash(targetPath, document.canonical)
    } else {
      await fs.writeFile(targetPath, document.canonical)
    }
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

type CleanupCommandOptions = {
  dryRun?: boolean
  skipFormats?: boolean
  check?: boolean
} & Partial<ScriptingOptions>

/** The `--output json`/`ndjson` payload: per-file results plus flattened warnings. */
type CleanupReport = {
  files: CleanupResult[]
  warnings: string[]
}

/** The action phrases reported for one cleaned-up file, e.g. `renamed to 'Winota Stax.md'`. */
function describeActions(result: CleanupResult, dryRun: boolean, skipFormats: boolean): string[] {
  const actions: string[] = []
  if (result.formatSet) {
    actions.push(t('cli.cleanup.actionFormatSet', { format: result.formatSet }))
  }
  if (result.renamedTo) actions.push(t('cli.cleanup.actionRenamed', { file: result.renamedTo }))
  if (result.rewritten) actions.push(t('cli.cleanup.actionRewritten'))
  if (result.missingFormat) {
    actions.push(
      dryRun
        ? t('cli.cleanup.actionNeedsFormat')
        : skipFormats
          ? t('cli.cleanup.actionFormatSkipped')
          : t('cli.cleanup.actionNoFormat'),
    )
  }
  return actions
}

/** The line printed above the format prompt, explaining what the deck's shape suggests. */
function formatSignalNote(deckName: string, signal: DeckFormatSignal): string {
  switch (signal.kind) {
    case 'command-zone':
      return t('cli.cleanup.signalCommandZone', { name: deckName })
    case 'constructed-60':
      return t('cli.cleanup.signalConstructed', { name: deckName, count: signal.mainDeckSize })
    case 'limited':
      return t('cli.cleanup.signalLimited', { name: deckName, count: signal.mainDeckSize })
    case 'none':
      return t('cli.cleanup.signalNone', { name: deckName })
  }
}

/** Whether a result carries a change a real (or `--check`) run would write. */
function wouldChangeFile(result: CleanupResult): boolean {
  return result.rewritten || result.renamedTo !== undefined || result.formatSet !== undefined
}

async function runCleanup(
  options: CleanupCommandOptions,
  scripting: ScriptingOptions,
): Promise<void> {
  const check = options.check ?? false
  // `--check` implies `--dry-run` (see the Option registration below).
  const dryRun = options.dryRun ?? false
  const skipFormats = options.skipFormats ?? false
  const baseDir = getBaseDir()
  const prefix = check ? '[check] ' : dryRun ? '[dry-run] ' : ''

  const interactive = canPromptWithOutput(scripting)

  // A real run over a formatless deck needs the prompt. When prompts are
  // unavailable, refuse up front — before any file is touched — instead of
  // failing midway through the pass.
  if (!dryRun && !skipFormats && !interactive) {
    const preview = await cleanupAllLists({ dryRun: true })
    const formatless = preview.filter((result) => result.missingFormat)
    if (formatless.length > 0) {
      const names = formatless.map((result) => path.relative(baseDir, result.filePath)).join(', ')
      throw localizedCommandError(
        'usage_error',
        ExitCode.UsageError,
        'cli.cleanup.formatlessDecks',
        { count: formatless.length, names },
      )
    }
  }

  const chooseFormat =
    dryRun || skipFormats
      ? undefined
      : async (deckName: string, signal: DeckFormatSignal): Promise<DeckFormatKey | null> => {
          console.log(formatSignalNote(deckName, signal))
          return promptDeckFormat({ keys: deckFormatKeysForSignal(signal.kind) })
        }

  const results = await cleanupAllLists({ dryRun, chooseFormat })
  const reported = results.filter(hasCleanupActions)

  if (scripting.output === 'text') {
    for (const result of reported) {
      const rel = path.relative(baseDir, result.filePath)
      const actions = describeActions(result, dryRun, skipFormats)
      if (actions.length > 0 && !scripting.quiet) {
        console.log(t('cli.cleanup.fileLine', { prefix, file: rel, actions: actions.join(', ') }))
      }
      for (const warning of result.warnings) {
        console.warn(t('cli.cleanup.fileWarning', { prefix, file: rel, warning }))
      }
    }

    if (!scripting.quiet) {
      if (results.length === 0) {
        console.log(t('cli.cleanup.noListFiles'))
      } else if (reported.length === 0) {
        console.log(
          t('cli.cleanup.allClean', {
            counted: t('domain.count.listFiles', { count: results.length }),
          }),
        )
      } else {
        // Count only what a run would actually write — a deck that merely
        // needs a format (unanswerable without a prompt) is reported above but
        // is not a pending change, and `--check`'s exit code agrees.
        const changing = reported.filter(wouldChangeFile).length
        if (changing > 0) {
          console.log(
            `\n${t('cli.cleanup.summary', {
              mode: dryRun ? 'preview' : 'done',
              changed: changing,
              counted: t('domain.count.listFiles', { count: results.length }),
            })}`,
          )
        }
        const unreadable = reported.filter((result) => result.unreadable).length
        if (unreadable > 0) {
          console.error(t('cli.cleanup.unreadableFiles', { count: unreadable }))
        }
        // Only decks left without a format count here — a file that was skipped
        // or merely warned about is not a deck waiting on an answer.
        const formatOnly = reported.filter((result) => result.missingFormat === true).length
        if (formatOnly > 0) {
          console.log(t('cli.cleanup.decksNeedFormat', { count: formatOnly }))
        }
      }
    }
  } else {
    const report: CleanupReport = {
      files: reported,
      warnings: reported.flatMap((result) =>
        result.warnings.map((warning) => `${path.relative(baseDir, result.filePath)}: ${warning}`),
      ),
    }
    emitOutput(report, scripting)
  }

  const blocked = results.some((result) => result.rewriteBlocked)
  // A file cleanup could not read at all fails every mode, including --dry-run:
  // the workspace is not clean and no run of this command can make it so.
  const unreadable = results.some((result) => result.unreadable)
  if (check) {
    // `--check` is for hooks/CI: fail when a real run would change any file,
    // or when a file cannot be brought to canonical form (blocked rewrite, or a
    // parse failure — the messages above say which).
    if (results.some(wouldChangeFile) || blocked || unreadable) {
      process.exitCode = ExitCode.RuntimeError
    }
    return
  }
  // A real run that had to leave a file un-rewritten because its parse skipped
  // lines did not fully clean the workspace — surface that in the exit code.
  if (unreadable || (!dryRun && blocked)) {
    process.exitCode = ExitCode.RuntimeError
  }
}

export function registerCleanupCommand(program: Command): void {
  addScriptingOptions(
    addDryRunOption(
      program.command('cleanup').description(t('help.cleanup.description')),
      t('help.cleanup.dryRun'),
    )
      .option('--skip-formats', t('help.cleanup.skipFormats'))
      .addOption(new Option('--check', t('help.cleanup.check')).implies({ dryRun: true })),
  ).action(async (options: CleanupCommandOptions) => {
    const scripting = normalizeScriptingOptions(options)
    await runCommandAction(scripting, () => runCleanup(options, scripting))
  })
}
