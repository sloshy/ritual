import { Command, Option } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from '../config/base-dir'
import { isRitualClean, sameFileContent, writeListFile } from '../changes/content-hash'
import { listSlug, titleNamesFile, titleSlug } from '../list/list-file-name'
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
import { advisoryMessages, unreadableMessages } from '../list/unreadable-content'
import { parseDeckText } from '../importers/text-file'
import {
  isListLifecycleError,
  planListRename,
  renameList,
  unusableFileNameMessage,
  type ListLifecycleError,
  type RenameListOptions,
  type RenameListResult,
} from '../list/list-lifecycle'
import { listIdentityKey, type ListInfo } from '../list/list-identity'
import { loadListInfo } from '../list/list-info'
import { findListNameProblems, foldedTitleKey } from '../list/list-name-check'
import { listDisplayNameFromContent } from '../list/list-display-name'
import {
  applyCategoryChangesToRecord,
  categoriesSaveTouchesDisk,
  commitCategoryChanges,
  foldRepeatedFaceCategoryChanges,
  loadCardCategories,
  previewCategoriesSaveAction,
  pruneCardCategories,
} from '../list/card-categories-sidecar'
import type { ChangeEvent } from '../changes/change-event'
import { foldRepeatedFaceNames } from '../scryfall/card-utils'
import { loadDefaultCategories } from '../config/ritual-config'
import { listCardNameSet } from '../list/card-names'
import { isSameFile as statSameFile, type SameFileCheck } from '../util/same-file'
import { collectionToMarkdown, wantedToMarkdown } from '../list/list-export'
import { localizedCommandError, ExitCode } from '../util/errors'
import { runCommandAction } from '../cli/action'
import { promptDeckFormat } from './session/deck-prompts'
import { readCollectionFile, readWantedFile } from '../list/flat-list-read'
import {
  canPromptWithOutput,
  emitOutput,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from '../cli/output'
import { addDryRunOption, addScriptingOptions } from '../cli/options'
import { t } from '../i18n/t'
import { formatUnitList } from '../i18n/format'
import { currentLocale } from '../i18n/runtime'
import { compareData } from '../i18n/collate'
import {
  errorMessage,
  errorParam,
  renderSyncMessage,
  syncList,
  syncMessage,
  syncRef,
  type SyncMessage,
} from '../sync/message'
import { COMMAND, FLAG, commandLine } from '../util/cli-tokens'

/**
 * The `ritual cleanup` command: one pass over every deck, collection, and wanted
 * list that brings each file up to the current conventions (the categories
 * sidecar is pruned and canonicalized alongside, see `cleanupList`) —
 *
 * 1. every deck gets an explicit `format:`, chosen by the user via
 *    {@link CleanupOptions.chooseFormat} — the deck's shape (command zone, card
 *    count) only orders the offered formats, it never decides;
 * 2. every file is re-emitted through the canonical serializers, so older
 *    formatting variants converge on what a fresh save would write: `- `
 *    bullets on deck lines, canonical token order and spacing, uppercase set
 *    codes, a flat list's quantity prefixes expanded to one line per copy
 *    (every front-matter key stays);
 * 3. every file is named exactly as its list is named (its `# Title` H1) —
 *    a list's title and its file name are one name, unique per list type —
 *    so a file whose title was edited by hand (or that was renamed on disk) is
 *    renamed to match, through the rename engine; a title another list already
 *    goes by, or two lists sharing one, is reported for the user to settle;
 * 4. every card line spelled with a repeated face (`Steam Vents // Steam Vents`,
 *    Scryfall's name for a reversible printing) is renamed to the card's folded
 *    name, the one the card cache files that printing under — and its category
 *    assignments move with it.
 *
 * Cleanup never touches a `.changes.md` changelog — a cleaned-up file has the
 * same cards it had before, and a rename carries the sidecar along unchanged —
 * and never stamps a `.sha256` sidecar that did not already match the file (see
 * `cleanupList`).
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
  /**
   * The lists to clean, in pass order. Defaults to every list, in directory
   * order; injectable so a test can pin the order renames are tried in. Lists
   * left out still hold their names (the preview reads the real listing).
   */
  locations?: ListLocation[]
}

/** What cleanup did (or, under dry-run, would do) to one list file. */
export type CleanupResult = {
  listType: ListType
  /** The file's path when cleanup found it (before any rename). */
  filePath: string
  /**
   * The list's title (its `# Title`; its file name when it has none). Absent
   * for a file cleanup could not read.
   */
  name?: string
  /** New file basename when the file was renamed to match the list's name. */
  renamedTo?: string
  /**
   * The list that already goes by this list's title, when that kept the file
   * from being renamed to match it. One of the two needs a new title, by hand.
   */
  renameBlockedBy?: ListInfo
  /**
   * The other lists of this type whose titles fold to this one's (`Burn` and
   * `burn`), when this list's file was not already blocked by one of them
   * (`renameBlockedBy`). One of each needs a new title, by hand.
   */
  sharesTitleWith?: ListInfo[]
  /**
   * True when the list's title has no character a file name can hold
   * (`# ???`), so no file can be named after it: give it a new title.
   */
  titleUnusable?: boolean
  /**
   * True when the rename to the title could not be made — a companion file
   * already at the destination with no list of its own, or a file-system
   * error. The warning says which.
   */
  renameFailed?: boolean
  /** Format stamped onto a deck that had none. */
  formatSet?: DeckFormatKey
  /** Whether the file's content changed when re-emitted in canonical form. */
  rewritten: boolean
  /** True for a deck left without a format (no answer, or dry-run). */
  missingFormat?: boolean
  /**
   * True when the parse blocked the rewrite: the parser skipped lines a re-emit
   * would silently drop. The file must be fixed by hand.
   */
  rewriteBlocked?: boolean
  /**
   * True when the file could not be read or parsed at all (broken YAML front
   * matter, an unreadable file). Nothing is rewritten or renamed for it, the
   * reason is in `warnings`, and the run reports failure — but every other list
   * is still cleaned up, which is the whole point of a per-file failure.
   */
  unreadable?: boolean
  /**
   * Card names, as the file spelled them, whose lines were (or would be) renamed
   * to the card's folded name ({@link foldRepeatedFaceNames}). Absent when no
   * line repeats a face, and when the rewrite is blocked or declined — a name is
   * only folded by a rewrite that happens.
   */
  cardNamesFolded?: string[]
  /**
   * Card names whose category assignments were dropped, because the list no
   * longer holds a line of that name. Absent when nothing was pruned.
   */
  categoriesPruned?: string[]
  /**
   * True when the categories sidecar was (or would be) rewritten — pruned,
   * canonically ordered, or canonically serialized.
   */
  categoriesRewritten?: boolean
  /**
   * What to tell the user about this file, as messages: English plus the catalog
   * key where Ritual words it (a parser's card-line refusal has none). The CLI
   * renders them in its language; `--output json` carries them as they are.
   */
  warnings: SyncMessage[]
}

/** True when the result carries something worth reporting. */
export function hasCleanupActions(result: CleanupResult): boolean {
  return (
    result.unreadable === true ||
    result.rewritten ||
    result.renamedTo !== undefined ||
    result.formatSet !== undefined ||
    result.missingFormat === true ||
    (result.categoriesPruned?.length ?? 0) > 0 ||
    result.categoriesRewritten === true ||
    result.warnings.length > 0
  )
}

/** A list file reduced to what the shared cleanup tail needs. */
type ListDocument = {
  /** The file's content as it is on disk. */
  original: string
  /** The file re-emitted through the canonical serializer. */
  canonical: string
  /**
   * What blocks the rewrite: lines the parser skipped, and fenced blocks; a
   * file that produced any is not rewritten (see below).
   */
  parseWarnings: SyncMessage[]
  /**
   * Notices about content that parsed but is worth saying out loud: a card name
   * that looks like it holds a printing, copies a flat list will expand, or a
   * deck's empty extras section (which the re-emit drops — the one advisory
   * that names something cleanup removes). Reported alongside the warnings,
   * never blocking.
   */
  advisories: SyncMessage[]
  /** Format stamped onto a deck that had none. */
  formatSet?: DeckFormatKey
  /** True for a deck left without a format (no answer, or dry-run). */
  missingFormat?: boolean
  /** The distinct card names `canonical` folds (see {@link CleanupResult.cardNamesFolded}). */
  foldedNames: string[]
}

/** A parsed card line, reduced to the one field the name fold rewrites. */
type NamedCardLine = { name: string }

/**
 * Rename every card line spelled with a repeated face to the card's folded name,
 * in place, and return the distinct spellings that changed (sorted). The list
 * file is the one place the doubled spelling can outlive a cache refresh, so this
 * is where it converges on the name the cache files the printing under.
 */
function foldCardLineNames(lines: Iterable<NamedCardLine>): string[] {
  const folded = new Set<string>()
  for (const line of lines) {
    const name = foldRepeatedFaceNames(line.name)
    if (name === line.name) continue
    folded.add(line.name)
    line.name = name
  }
  return [...folded].sort(compareData)
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
  parseWarnings: SyncMessage[]
  advisories: SyncMessage[]
  foldedNames: string[]
}

async function readDeckDocument(location: ListLocation): Promise<ParsedDeckDocument> {
  const original = await fs.readFile(location.filePath, 'utf-8')
  // Parsed directly (not via `loadDeck`) for the skipped-line warnings, which
  // gate the rewrite below — a re-emit would drop what the parser skipped.
  const parsedDeck = parseDeckText(original, location.name)
  const { deck } = parsedDeck
  const advisories = advisoryMessages(parsedDeck)
  // Fenced code blocks join the parse warnings: the canonical re-emit would
  // delete them, exactly like a line the parser could not read.
  const warnings = unreadableMessages(parsedDeck)
  // Copy before mutating: gray-matter caches parses by content string, so the
  // parsed front matter object is shared between byte-identical files.
  const frontMatter = { ...(await parseDeckFrontMatter(location.filePath)) }
  const foldedNames = foldCardLineNames(deck.sections.flatMap((section) => section.cards))
  return { original, deck, frontMatter, parseWarnings: warnings, advisories, foldedNames }
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
  const { original, deck, frontMatter, parseWarnings: warnings } = parsed
  let formatSet: DeckFormatKey | undefined
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
      return {
        original,
        canonical: original,
        parseWarnings: warnings,
        advisories: parsed.advisories,
        missingFormat: true,
        // Nothing is written, so nothing is folded.
        foldedNames: [],
      }
    }
  }
  return {
    original,
    canonical: serializeDeckToMarkdown(deck, frontMatter),
    parseWarnings: warnings,
    advisories: parsed.advisories,
    formatSet,
    foldedNames: parsed.foldedNames,
  }
}

async function readCollectionDocument(location: ListLocation): Promise<ListDocument> {
  const file = await readCollectionFile(location.filePath)
  const foldedNames = foldCardLineNames(file.entries)
  return {
    original: file.content,
    canonical: collectionToMarkdown(file.title, file.entries, file.sectionOrder, file.frontMatter),
    parseWarnings: file.warningMessages,
    advisories: file.advisoryMessages,
    foldedNames,
  }
}

async function readWantedDocument(location: ListLocation): Promise<ListDocument> {
  const file = await readWantedFile(location.filePath)
  const foldedNames = foldCardLineNames(file.entries)
  return {
    original: file.content,
    canonical: wantedToMarkdown(file.title, file.entries, file.sectionOrder, file.frontMatter),
    parseWarnings: file.warningMessages,
    advisories: file.advisoryMessages,
    foldedNames,
  }
}

/**
 * Record a rename refusal on its file. A name another list already goes by
 * needs a person to choose, so `renameBlockedBy` names that list (see
 * {@link blockRename}); any other refusal (a companion file in the way) is the
 * engine's own sentence, and fails the run like an error.
 */
function refuseRename(result: CleanupResult, refusal: ListLifecycleError): void {
  result.renameFailed = true
  result.warnings.push(refusal.message)
}

/** Record that `other` already goes by the title this list's file was to be renamed after. */
function blockRename(result: CleanupResult, targetBase: string, other: ListInfo): void {
  result.renameBlockedBy = other
  result.warnings.push(
    syncMessage('cli.cleanup.renameTaken', {
      file: targetBase,
      name: other.name,
      otherFile: `${other.slug}.md`,
      command: COMMAND_RENAME,
    }),
  )
}

/** Record a rename the file system refused: this file's failure, never the pass's. */
function renameErrored(result: CleanupResult, intent: RenameIntent, error: unknown): void {
  result.renameFailed = true
  result.warnings.push(
    syncMessage('cli.cleanup.renameFailed', { file: intent.targetBase, reason: errorParam(error) }),
  )
}

/** Forget an earlier block before the rename is tried again. */
function clearBlock(result: CleanupResult): void {
  delete result.renameBlockedBy
  result.warnings = result.warnings.filter(
    (warning) => warning.messageKey !== 'cli.cleanup.renameTaken',
  )
}

/**
 * Rename one file after its title, on disk. Returns whether it moved. A name
 * another list goes by blocks it (and may free up later in the pass); an I/O
 * failure is this file's problem, reported on it, never an aborted pass.
 */
async function attemptRename(
  result: CleanupResult,
  location: ListLocation,
  intent: RenameIntent,
  renameOptions: RenameListOptions,
): Promise<boolean> {
  clearBlock(result)
  let renamed: RenameListResult
  try {
    renamed = await renameList(location.type, location.filePath, intent.title, renameOptions)
  } catch (error) {
    renameErrored(result, intent, error)
    return false
  }
  if (!isListLifecycleError(renamed)) {
    result.renamedTo = intent.targetBase
    result.warnings.push(...renamed.warnings)
    return true
  }
  if (renamed.kind === 'already-exists') {
    blockRename(
      result,
      intent.targetBase,
      await loadListInfo({ type: location.type, filePath: renamed.existingFilePath }),
    )
  } else {
    refuseRename(result, renamed)
  }
  return false
}

/** The command a clash of titles is settled with, as the warnings quote it. */
const COMMAND_RENAME = commandLine(COMMAND.rename, '<list>', '"<new title>"')

/** Record a file the cleanup could not read, and skip it. */
function markUnreadable(result: CleanupResult, error: unknown): CleanupResult {
  result.unreadable = true
  result.warnings.push(syncMessage('cli.cleanup.couldNotRead', { reason: errorParam(error) }))
  result.warnings.push(syncMessage('cli.cleanup.skipped'))
  return result
}

/** Clean up a single list file. Never throws for per-file problems — they land in `warnings`. */
export async function cleanupList(
  location: ListLocation,
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const cleaned = await cleanupFile(location, options)
  if (options.dryRun) await settlePreviewedRenames([cleaned], await listLocations(location.type))
  return cleaned.result
}

/** One file cleaned up, with the rename it still wants when it wants one. */
type CleanedFile = {
  result: CleanupResult
  location: ListLocation
  /** The rename the file's title asks for, when its file name drifted from it. */
  intent?: RenameIntent
  renameOptions: RenameListOptions
}

/** A file to be renamed after its title. */
type RenameIntent = {
  title: string
  /** The file name (with `.md`) the title names. */
  targetBase: string
}

/**
 * Everything `cleanupList` does to one file. A real run renames it too; a dry
 * run leaves the rename to {@link settlePreviewedRenames}, which needs every
 * file's intent to model the pass.
 */
async function cleanupFile(location: ListLocation, options: CleanupOptions): Promise<CleanedFile> {
  const result: CleanupResult = {
    listType: location.type,
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
      return { result: markUnreadable(result, error), location, renameOptions: {} }
    }
    document = await resolveDeckDocument(parsed, options)
  } else {
    try {
      document =
        location.type === 'collection'
          ? await readCollectionDocument(location)
          : await readWantedDocument(location)
    } catch (error) {
      return { result: markUnreadable(result, error), location, renameOptions: {} }
    }
  }
  if (document.formatSet) result.formatSet = document.formatSet
  if (document.missingFormat) result.missingFormat = true

  // Reported, never blocking: this is the surface that reads every list file,
  // and so the one place a collection or wanted list's advisories — a quantity
  // the re-emit expands into one line per copy, a name that still looks like it
  // holds a printing — reliably get said out loud. Most of these lines survive
  // the re-emit unchanged; a deck's empty extras section is the exception the
  // re-emit drops, which is precisely why cleanup has to name it.
  result.warnings.push(...document.advisories)

  // A file whose parse skipped lines would lose them if re-emitted; leave its
  // content alone (renaming is still safe) and surface the warnings instead.
  if (document.parseWarnings.length > 0) {
    result.rewriteBlocked = true
    result.warnings.push(...document.parseWarnings)
    result.warnings.push(syncMessage('cli.cleanup.notRewritten'))
  } else {
    result.rewritten = !sameFileContent(document.canonical, document.original)
    if (document.foldedNames.length > 0) result.cardNamesFolded = document.foldedNames
  }

  // The categories sidecar's preview. Computed above the dry-run return —
  // exactly where `result.rewritten` is — so `--dry-run` reports the same prune
  // and rewrite the real run performs. Reads `location.filePath`: nothing has
  // moved yet.
  //
  // Pruning is gated on a clean parse for the same reason the rewrite above is:
  // a line the parser could not read holds a card that is still in the file, and
  // dropping its categories would destroy assignments the list still backs. A
  // blocked file's sidecar is canonicalized and left otherwise intact.
  const defaultCategories = await loadDefaultCategories()
  let knownCardNames: Set<string> | undefined
  // Whether this run's rewrite folds repeated-face names: it applies to content
  // cleanup rewrites, never to a blocked file or a deck left without a format.
  const namesFold = result.rewriteBlocked !== true && result.missingFormat !== true
  // The events moving assignments off the names the rewrite folds; replayed
  // by the preview and the commit alike.
  let foldChanges: ChangeEvent[] = []
  let categoriesReadable = true
  // Per-file contract: a categories problem is a warning on this file, never a
  // throw that aborts the whole pass.
  try {
    if (result.rewriteBlocked === true) {
      result.warnings.push(syncMessage('cli.cleanup.categoriesNotPruned'))
    } else {
      // Read from the file as it is on disk — so folded only when its rewrite
      // folds them: a deck left without a format keeps its doubled spellings, and
      // its assignments under them must not read as cards the list lost.
      const names = (await listCardNameSet(location.type, location.filePath)).names
      knownCardNames = namesFold ? new Set([...names].map(foldRepeatedFaceNames)) : names
    }
    const loadedCategories = await loadCardCategories(location.filePath, { knownCardNames })
    if (!loadedCategories.ok) {
      categoriesReadable = false
      result.warnings.push(loadedCategories.message)
    } else {
      let record = loadedCategories.categories
      // Folded whenever the names are, not only when a line changed: a sidecar
      // key left doubled by a hand edit beside already-folded lines merges too.
      if (namesFold) {
        foldChanges = foldRepeatedFaceCategoryChanges(record)
        record = applyCategoryChangesToRecord(record, foldChanges)
      }
      if (knownCardNames !== undefined) {
        const prune = pruneCardCategories(record, knownCardNames)
        if (prune.pruned.length > 0) result.categoriesPruned = prune.pruned
        record = prune.categories
      }
      result.categoriesRewritten = categoriesSaveTouchesDisk(
        await previewCategoriesSaveAction(location.filePath, record, defaultCategories),
      )
    }
  } catch (error) {
    categoriesReadable = false
    result.warnings.push(errorMessage(error))
  }

  // A list's title and its file name are one name. The title is read the way
  // every other surface reads it (`listDisplayNameFromContent`: the first
  // column-zero `# Title`), from the content this run leaves on disk — the
  // canonical re-emit when it happens, the file as it is otherwise — so the
  // file is renamed after the title it will have, and the rename engine finds
  // that very heading to rewrite rather than inserting a second one.
  const finalContent = result.rewriteBlocked === true ? document.original : document.canonical
  const title = listDisplayNameFromContent(finalContent, location.filePath)
  result.name = title
  const named = titleSlug(title)
  let intent: RenameIntent | undefined
  if (named === null) {
    result.titleUnusable = true
    result.warnings.push(unusableFileNameMessage(title))
  } else if (!titleNamesFile(title, listSlug(location.filePath))) {
    intent = { title, targetBase: `${named}.md` }
  }
  const renameOptions: RenameListOptions = { isSameFile: options.isSameFile ?? statSameFile }

  if (options.dryRun) {
    // Settled by `settlePreviewedRenames`, which models the whole pass. Only a
    // refusal the model cannot see (a companion file in the way) is final here.
    const wanted = intent
    if (wanted !== undefined) {
      try {
        const plan = await planListRename(location.type, location.filePath, title, renameOptions)
        if (isListLifecycleError(plan) && plan.kind !== 'already-exists') {
          refuseRename(result, plan)
          intent = undefined
        }
      } catch (error) {
        renameErrored(result, wanted, error)
        intent = undefined
      }
    }
    return { result, location, intent, renameOptions }
  }

  if (result.rewritten) {
    // Refresh the `.sha256` only when it matched the file before cleanup ran.
    // Stamping a file that holds unrecorded hand edits would make detect-changes
    // skip it and drop the edits' changelog entries — cleanup canonicalizes
    // formatting, it does not get to declare someone else's edits recorded.
    const wasRitualClean = await isRitualClean(location.filePath, document.original)
    await writeListFile(location.filePath, document.canonical, wasRitualClean)
  }

  // The categories write, in place: a rename below carries the sidecar along.
  // The stamp gate lives inside `saveCardCategories`, so a hand-edited sidecar
  // keeps its stale `.sha256` and `detect-changes` still records the edit, the
  // same rule the list file's rewrite follows.
  if (categoriesReadable) {
    const committed = await commitCategoryChanges(location.filePath, foldChanges, {
      knownCardNames,
      defaultCategories,
      canonicalize: true,
    })
    if (committed.pruned.length > 0) result.categoriesPruned = committed.pruned
    else delete result.categoriesPruned
    result.categoriesRewritten =
      committed.action !== undefined && categoriesSaveTouchesDisk(committed.action)
    if (committed.error !== undefined) result.warnings.push(committed.error)
  }

  // The rename comes last, in place of the file as cleanup leaves it: the rename
  // engine moves the file and its whole sidecar set, and keeps the `.sha256`
  // only when it matches — the same rename `ritual rename` makes.
  if (intent !== undefined) await attemptRename(result, location, intent, renameOptions)
  return { result, location, intent, renameOptions }
}

/** Run cleanup across every deck, collection, and wanted list. */
export async function cleanupAllLists(options: CleanupOptions = {}): Promise<CleanupResult[]> {
  const cleaned: CleanedFile[] = []
  const everyList = await listLocations()
  for (const location of options.locations ?? everyList) {
    cleaned.push(await cleanupFile(location, options))
  }
  // The preview models the renames against every list on disk, not only the
  // ones this pass cleans, as the real run's rename engine sees them.
  if (options.dryRun) await settlePreviewedRenames(cleaned, everyList)
  else await retryBlockedRenames(cleaned)
  const results = cleaned.map((file) => file.result)
  reportSharedTitles(results)
  return results
}

/**
 * A rename blocked by a list that was itself renamed away later in the pass
 * (`b.md` titled `Burn` waits on `Burn.md` titled `Red`, which moves to
 * `Red.md`) can go through now: retry every blocked rename, in pass order,
 * until a round moves nothing. A true cycle (two lists swapping names) never
 * frees up, and stays reported for the user to break with `ritual rename`.
 */
async function retryBlockedRenames(cleaned: readonly CleanedFile[]): Promise<void> {
  let progress = true
  while (progress) {
    progress = false
    for (const file of cleaned) {
      if (file.intent === undefined || file.result.renameBlockedBy === undefined) continue
      if (await attemptRename(file.result, file.location, file.intent, file.renameOptions)) {
        progress = true
      }
    }
  }
}

/**
 * The dry-run model of the pass's renames, so `--dry-run` and `--check` say
 * exactly what the real run will do whatever order the files come in: every
 * list holds its file name's fold (`foldedTitleKey`), each wanted rename is
 * tried in pass order against the names held at that point — a rename frees
 * the name it leaves — and the blocked ones are retried until a round moves
 * nothing, as {@link retryBlockedRenames} does on disk.
 */
async function settlePreviewedRenames(
  cleaned: readonly CleanedFile[],
  others: readonly ListLocation[],
): Promise<void> {
  // A name is held by every list whose file name folds to it — two files that
  // fold together (`Cafe.md`, `Café.md`) both hold it — including the lists
  // this pass does not clean (`others`), whose files the real run's rename
  // engine sees on disk just the same.
  const holders = new Map<string, Set<NameHolder>>()
  const held = new Map<CleanedFile, string>()
  // A name that folds to nothing is held by no one and blocks no one, as the
  // real run's collision check (`findCollidingList`) matches nothing for it.
  const hold = (key: string | null, holder: NameHolder): void => {
    if (key === null) return
    const set = holders.get(key)
    if (set) set.add(holder)
    else holders.set(key, new Set([holder]))
  }
  const slugOf = (file: CleanedFile): string =>
    listSlug(file.result.renamedTo ?? path.basename(file.result.filePath))
  for (const file of cleaned) {
    const key = foldedTitleKey(file.result.listType, slugOf(file))
    hold(key, file)
    if (key !== null) held.set(file, key)
  }
  const cleanedPaths = new Set(cleaned.map((file) => path.resolve(file.result.filePath)))
  for (const location of others) {
    if (cleanedPaths.has(path.resolve(location.filePath))) continue
    hold(foldedTitleKey(location.type, location.name), await loadListInfo(location))
  }
  const infoOf = (holder: NameHolder): ListInfo =>
    'result' in holder
      ? {
          listType: holder.result.listType,
          slug: slugOf(holder),
          name: holder.result.name ?? slugOf(holder),
        }
      : holder
  const attempt = (file: CleanedFile, intent: RenameIntent): boolean => {
    clearBlock(file.result)
    const key = foldedTitleKey(file.result.listType, listSlug(intent.targetBase))
    const blocker =
      key === null ? undefined : [...(holders.get(key) ?? [])].find((holder) => holder !== file)
    if (blocker !== undefined) {
      blockRename(file.result, intent.targetBase, infoOf(blocker))
      return false
    }
    const left = held.get(file)
    if (left !== undefined) {
      const set = holders.get(left)
      set?.delete(file)
      if (set?.size === 0) holders.delete(left)
    }
    hold(key, file)
    if (key === null) held.delete(file)
    else held.set(file, key)
    file.result.renamedTo = intent.targetBase
    return true
  }
  for (const file of cleaned) if (file.intent !== undefined) attempt(file, file.intent)
  let progress = true
  while (progress) {
    progress = false
    for (const file of cleaned) {
      if (file.intent === undefined || file.result.renameBlockedBy === undefined) continue
      if (attempt(file, file.intent)) progress = true
    }
  }
}

/** What holds a name in the preview: a file this pass cleans, or another list on disk. */
type NameHolder = CleanedFile | ListInfo

/** A cleanup result for a file that could be read, so its list has a title. */
type NamedCleanupResult = CleanupResult & { name: string }

/** The list a cleaned-up file holds, at the name it has (or, previewed, would have) now. */
function cleanedListInfo(result: NamedCleanupResult): ListInfo {
  const fileName = result.renamedTo ?? path.basename(result.filePath)
  return { listType: result.listType, slug: listSlug(fileName), name: result.name }
}

/**
 * Lists of one type whose titles fold together cannot both keep their title,
 * and which one gives it up is the user's call: each is reported, naming the
 * others — except a list already reported as blocked by one of them.
 */
function reportSharedTitles(results: CleanupResult[]): void {
  const named = results.filter((result): result is NamedCleanupResult => result.name !== undefined)
  const byKey = new Map(named.map((result) => [listIdentityKey(cleanedListInfo(result)), result]))
  for (const clash of findListNameProblems(named.map(cleanedListInfo)).shared) {
    for (const list of clash.lists) {
      const result = byKey.get(listIdentityKey(list))
      if (result === undefined || result.renameBlockedBy !== undefined) continue
      const others = clash.lists.filter((other) => other.slug !== list.slug)
      result.sharesTitleWith = others
      result.warnings.push(
        syncMessage('cli.cleanup.sharedTitle', {
          name: list.name,
          others: syncList(
            others.map((other) => syncRef('domain.list.fileQuoted', { file: `${other.slug}.md` })),
            'and',
          ),
          command: COMMAND_RENAME,
        }),
      )
    }
  }
}

type CleanupCommandOptions = {
  dryRun?: boolean
  skipFormats?: boolean
  check?: boolean
} & Partial<ScriptingOptions>

/** One warning of the flattened `--output json` list: the file it is about, and the message. */
export type CleanupWarning = SyncMessage & { file: string }

/** The `--output json`/`ndjson` payload: per-file results plus flattened warnings. */
export type CleanupReport = {
  files: CleanupResult[]
  warnings: CleanupWarning[]
}

/** The action phrases reported for one cleaned-up file, e.g. `renamed to 'Winota Stax.md'`. */
function describeActions(result: CleanupResult, dryRun: boolean, skipFormats: boolean): string[] {
  const actions: string[] = []
  if (result.formatSet) {
    actions.push(t('cli.cleanup.actionFormatSet', { format: result.formatSet }))
  }
  if (result.renamedTo) actions.push(t('cli.cleanup.actionRenamed', { file: result.renamedTo }))
  if (result.rewritten) actions.push(t('cli.cleanup.actionRewritten'))
  if (result.cardNamesFolded !== undefined) {
    actions.push(
      t('cli.cleanup.cardNamesFolded', {
        count: result.cardNamesFolded.length,
        names: result.cardNamesFolded.join(', '),
      }),
    )
  }
  if (result.categoriesRewritten === true) {
    actions.push(t('cli.cleanup.actionCategoriesRewritten'))
  }
  if (result.categoriesPruned !== undefined && result.categoriesPruned.length > 0) {
    actions.push(
      t('cli.cleanup.categoriesPruned', {
        count: result.categoriesPruned.length,
        names: result.categoriesPruned.join(', '),
      }),
    )
  }
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
  return (
    result.rewritten ||
    result.renamedTo !== undefined ||
    result.formatSet !== undefined ||
    result.categoriesRewritten === true ||
    (result.categoriesPruned?.length ?? 0) > 0
  )
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
  // A preview's lines carry the run's marker, worded where every other
  // command's dry-run marker is.
  const marked = (line: string): string =>
    check
      ? t('cli.cleanup.checkLine', { line })
      : dryRun
        ? t('cli.cardOps.dryRunLine', { line })
        : line

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
        { count: formatless.length, names, flag: FLAG.skipFormats },
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
        console.log(
          marked(
            t('cli.cleanup.fileLine', {
              file: rel,
              actions: formatUnitList(currentLocale(), actions),
            }),
          ),
        )
      }
      for (const warning of result.warnings) {
        console.warn(
          marked(t('cli.cleanup.fileWarning', { file: rel, warning: renderSyncMessage(warning) })),
        )
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
          console.log(
            t('cli.cleanup.decksNeedFormat', { count: formatOnly, flag: FLAG.skipFormats }),
          )
        }
      }
    }
  } else {
    const report: CleanupReport = {
      files: reported,
      warnings: reported.flatMap((result) =>
        result.warnings.map((warning): CleanupWarning => ({
          file: path.relative(baseDir, result.filePath),
          ...warning,
        })),
      ),
    }
    emitOutput(report, scripting)
  }

  const blocked = results.some((result) => result.rewriteBlocked)
  // Lists whose titles clash need a person to pick new titles: the workspace is
  // not clean until they do.
  const nameClash = results.some(
    (result) =>
      result.renameBlockedBy !== undefined ||
      result.sharesTitleWith !== undefined ||
      result.titleUnusable === true ||
      result.renameFailed === true,
  )
  // A file cleanup could not read at all fails every mode, including --dry-run:
  // the workspace is not clean and no run of this command can make it so.
  const unreadable = results.some((result) => result.unreadable)
  if (check) {
    // `--check` is for hooks/CI: fail when a real run would change any file,
    // or when a file cannot be brought to canonical form (blocked rewrite, or a
    // parse failure — the messages above say which).
    if (results.some(wouldChangeFile) || blocked || nameClash || unreadable) {
      process.exitCode = ExitCode.RuntimeError
    }
    return
  }
  // A real run that had to leave a file un-rewritten because its parse skipped
  // lines did not fully clean the workspace — surface that in the exit code.
  if (unreadable || (!dryRun && (blocked || nameClash))) {
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
      .addOption(
        new Option('--check', t('help.cleanup.check', { flag: FLAG.dryRun })).implies({
          dryRun: true,
        }),
      ),
  ).action(async (options: CleanupCommandOptions) => {
    const scripting = normalizeScriptingOptions(options)
    await runCommandAction(scripting, () => runCleanup(options, scripting))
  })
}
