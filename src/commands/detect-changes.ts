import { Command } from 'commander'
import { compareData } from '../i18n/collate'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseTitleFromContent } from '../list/section-format'
import {
  getChangedFiles,
  getFileAtCommit,
  probeGitRef,
  probeGitRepository,
  classifyFile,
  changesPath,
  GitCommandError,
  type FileChange,
  type ListKind,
} from '../changes/git-diff'
import { diffDeckCards, diffCollectionEntries, diffWantedEntries } from '../changes/diff-cards'
import { loadDeckFile } from '../importers/text-file'
import { parseCollectionFile } from '../list/collection-file'
import { parseWantedListFile } from '../list/wanted-file'
import { appendChangelog } from '../changes/changelog-writer'
import type { ChangeEvent } from '../changes/change-event'
import { formatChange } from '../changes/change-message'
import { getBaseDir } from '../config/base-dir'
import {
  classifySidecarWithHash,
  computeHash,
  isRitualClean,
  loadHash,
  saveHash,
  type SidecarState,
} from '../changes/content-hash'
import { listLocations } from '../list/resolve-list'
import { getErrorMessage, hasErrorCode, ExitCode } from '../util/errors'
import type { DeckSection } from '../list/deck'
import { addDryRunOption, addScriptingOptions } from '../cli/options'
import {
  emitOutput,
  emitWarnings,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from '../cli/output'
import { failWith, runCommandAction } from '../cli/action'

// ── Types ────────────────────────────────────────────────────────────

/**
 * What this invocation does. The three modes are mutually exclusive and are
 * selected by flags: no flag detects from git history, `--hash-only` stamps
 * sidecars without git, `--verify` only reports.
 */
export type DetectChangesMode = 'detect' | 'hash-only' | 'verify'

type DetectChangesCliOptions = {
  dryRun?: boolean
  hashOnly?: boolean
  verify?: boolean
} & Partial<ScriptingOptions>

type DetectResult = {
  file: string
  kind: ListKind
  status: FileChange['status']
  changes: ChangeEvent[]
  /**
   * True when the file content matches its `.sha256` sidecar — Ritual itself
   * last wrote (and already recorded a changelog for) this exact state, so
   * detection is skipped to avoid double-recording changes made locally.
   */
  ritualClean: boolean
}

/**
 * Something the run noticed but did not stop for:
 *
 * - `missing-file` — the file changed in the range but is gone from the
 *   working tree, so it was skipped entirely. This makes the run *partial*,
 *   which is why it (and only it) sets a nonzero exit code.
 * - `parse` — a line the parser could not read. The rest of the file is still
 *   diffed, so the run is complete; the note exists because the skipped line
 *   gets no changelog entry and the sidecar refresh will declare it recorded.
 */
export type DetectWarningKind = 'missing-file' | 'parse'

export type DetectWarning = {
  kind: DetectWarningKind
  /** Repo-relative path of the list file the warning is about. */
  file: string
  /** Which revision of `file` produced a `parse` warning. */
  revision?: 'working-tree' | 'committed'
  /** Ready-to-print text, already naming the file and revision. */
  message: string
}

/** Whether `warnings` describe a run that could not process every candidate. */
export function hasSkippedFiles(warnings: readonly DetectWarning[]): boolean {
  return warnings.some((warning) => warning.kind === 'missing-file')
}

type DetectChangesOutput = {
  results: DetectResult[]
  renames: Map<string, string>
  /** Per-file problems that did not stop the run. See {@link DetectWarning}. */
  warnings: DetectWarning[]
}

/**
 * The default mode's `--output json`/`ndjson` payload: the detection results
 * plus what the run did (or, under `--dry-run`, would do). File paths are
 * repo-relative, as git emits them.
 */
export type DetectChangesReport = {
  mode: Extract<DetectChangesMode, 'detect'>
  commit: string
  dryRun: boolean
  /** Number of list files whose changelog was (or would be) updated. */
  changelogsUpdated: number
  /** Old path → new path for renamed list files. */
  renames: Record<string, string>
  results: DetectResult[]
  /** Everything the run skipped or could not read; a `missing-file` means exit 1. */
  warnings: DetectWarning[]
}

/** One list file's sidecar status, as seen by `--hash-only` and `--verify`. */
export type SidecarInspection = {
  /** Base-dir-relative path of the list file. */
  file: string
  /** How the file's content relates to its sidecar right now. */
  state: SidecarState
  /** SHA-256 of the file's current on-disk content. */
  hash: string
}

/**
 * A file `--hash-only` stamped. The state is named `priorState` because the
 * stamp has already overwritten it — unlike `--verify`'s {@link SidecarInspection},
 * the condition it describes no longer holds once the run finishes.
 */
export type StampedFile = Omit<SidecarInspection, 'state'> & { priorState: SidecarState }

/** The `--hash-only` payload. */
export type HashOnlyReport = {
  mode: Extract<DetectChangesMode, 'hash-only'>
  dryRun: boolean
  /** Every list file stamped (or, under `--dry-run`, that would be stamped). */
  stamped: StampedFile[]
  /** How many stamped files carried unrecorded edits (`priorState !== 'clean'`). */
  unrecordedEdits: number
}

/** The `--verify` payload. */
export type VerifyReport = {
  mode: Extract<DetectChangesMode, 'verify'>
  files: SidecarInspection[]
  clean: number
  diverged: number
  missing: number
}

/** Every `--output json` payload this command can emit, keyed by `mode`. */
export type DetectChangesPayload = DetectChangesReport | HashOnlyReport | VerifyReport

/**
 * Compile-time proof that every {@link DetectChangesMode} has a payload: adding
 * a mode without a payload (or renaming one) makes this alias `never` and the
 * assignment below fails to compile.
 */
type ModesCovered =
  Exclude<DetectChangesMode, DetectChangesPayload['mode']> extends never ? true : never
const _modesCovered: ModesCovered = true
void _modesCovered

// ── Entity name extraction ───────────────────────────────────────────

function entityNameFromContent(content: string, fallbackPath: string): string {
  return parseTitleFromContent(content) ?? path.basename(fallbackPath, '.md')
}

// ── `&N` alignment ───────────────────────────────────────────────────

type WithCardId = { cardId?: number }

/**
 * The two sides of a diff, keyed consistently.
 *
 * `diff-cards` keys a card by its `&N` when it has one and by its composite
 * (name/set/number/finish/condition) otherwise, so a card that is ID'd on one
 * side and not the other never pairs — it reports as removed *and* added. A
 * revision committed before Ritual assigned IDs, or committed while only some
 * lines had them (normal now that the backfill is opt-in), is exactly that
 * case. Whenever the old side is not *fully* ID'd, drop IDs from both sides so
 * every card pairs by composite key. The change events for such a file then
 * carry no `&N`: the IDs the backfill assigned have no old-side counterpart to
 * be matched against, so inventing pairings would be worse.
 */
type AlignedEntries<T> = { old: T[]; current: T[] }

function withoutIds<T extends WithCardId>(entries: readonly T[]): T[] {
  return entries.map((entry) => ({ ...entry, cardId: undefined }))
}

function alignEntryIds<T extends WithCardId>(
  oldEntries: readonly T[],
  newEntries: readonly T[],
): AlignedEntries<T> {
  if (oldEntries.every((entry) => entry.cardId !== undefined)) {
    return { old: [...oldEntries], current: [...newEntries] }
  }
  return { old: withoutIds(oldEntries), current: withoutIds(newEntries) }
}

/** {@link alignEntryIds} over deck sections, whose cards are one level down. */
function alignSectionIds(
  oldSections: readonly DeckSection[],
  newSections: readonly DeckSection[],
): AlignedEntries<DeckSection> {
  const flatten = (sections: readonly DeckSection[]): WithCardId[] =>
    sections.flatMap((section) => section.cards)
  if (flatten(oldSections).every((card) => card.cardId !== undefined)) {
    return { old: [...oldSections], current: [...newSections] }
  }
  const strip = (sections: readonly DeckSection[]): DeckSection[] =>
    sections.map((section) => ({ ...section, cards: withoutIds(section.cards) }))
  return { old: strip(oldSections), current: strip(newSections) }
}

// ── Per-file diffing ─────────────────────────────────────────────────

/** Collects a parser warning against the revision it came from. */
type ReportParseWarning = (revision: 'working-tree' | 'committed', warning: string) => void

function diffCollection(
  oldContent: string | null,
  newContent: string,
  report: ReportParseWarning,
): ChangeEvent[] {
  const newParsed = parseCollectionFile(newContent)
  for (const w of newParsed.warnings) report('working-tree', w)

  if (!oldContent) {
    return diffCollectionEntries([], newParsed.entries)
  }

  const oldParsed = parseCollectionFile(oldContent)
  for (const w of oldParsed.warnings) report('committed', w)

  const aligned = alignEntryIds(oldParsed.entries, newParsed.entries)
  return diffCollectionEntries(aligned.old, aligned.current)
}

function diffWanted(
  oldContent: string | null,
  newContent: string,
  report: ReportParseWarning,
): ChangeEvent[] {
  const newParsed = parseWantedListFile(newContent)
  for (const w of newParsed.warnings) report('working-tree', w)

  if (!oldContent) {
    return diffWantedEntries([], newParsed.entries)
  }

  const oldParsed = parseWantedListFile(oldContent)
  for (const w of oldParsed.warnings) report('committed', w)

  const aligned = alignEntryIds(oldParsed.entries, newParsed.entries)
  return diffWantedEntries(aligned.old, aligned.current)
}

// ── Main logic ───────────────────────────────────────────────────────

export async function detectChanges(commit: string, cwd: string): Promise<DetectChangesOutput> {
  const fileChanges = getChangedFiles(commit, cwd)
  const results: DetectResult[] = []
  const renames = new Map<string, string>()
  const warnings: DetectWarning[] = []

  const tempDir = path.join(cwd, '.git', `ritual-tmp-${Date.now()}`)
  let tempFileCounter = 0

  async function diffDeck(
    oldContent: string | null,
    newContent: string,
    report: ReportParseWarning,
  ): Promise<ChangeEvent[]> {
    const suffix = tempFileCounter++
    const newTmp = path.join(tempDir, `new-deck-${suffix}.md`)
    await fs.writeFile(newTmp, newContent)
    // loadDeckFile, not importFromTextFile: a line the deck parser could not
    // read must be reported, since the sidecar refresh below will otherwise
    // declare it recorded forever.
    const newDeck = await loadDeckFile(newTmp)
    for (const w of newDeck.warnings) report('working-tree', w)

    if (!oldContent) {
      return diffDeckCards([], newDeck.deck.sections)
    }

    const oldTmp = path.join(tempDir, `old-deck-${suffix}.md`)
    await fs.writeFile(oldTmp, oldContent)
    const oldDeck = await loadDeckFile(oldTmp)
    for (const w of oldDeck.warnings) report('committed', w)

    const aligned = alignSectionIds(oldDeck.deck.sections, newDeck.deck.sections)
    return diffDeckCards(aligned.old, aligned.current)
  }
  await fs.mkdir(tempDir, { recursive: true })

  try {
    for (const fc of fileChanges) {
      const kind = classifyFile(fc.path) ?? classifyFile(fc.oldPath)
      if (!kind) continue

      // Track renames for .changes.md handling
      if (fc.status === 'R' && fc.oldPath !== fc.path) {
        renames.set(fc.oldPath, fc.path)
      }

      if (fc.status === 'D') {
        results.push({ file: fc.oldPath, kind, status: 'D', changes: [], ritualClean: false })
        continue
      }

      const newPath = path.join(cwd, fc.path)
      // A file can change within the range and still be absent from the working
      // tree (deleted locally without committing). That is a per-file problem,
      // not a reason to abandon every other file's changelog.
      let newContent: string
      try {
        newContent = await fs.readFile(newPath, 'utf-8')
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error
        warnings.push({
          kind: 'missing-file',
          file: fc.path,
          message: t('cli.detectChanges.missingFile', { path: fc.path }),
        })
        continue
      }

      // Hash-aware skip: when the file content matches its committed `.sha256`
      // sidecar, Ritual itself last wrote this exact state and already recorded
      // the corresponding changelog entries locally. Re-diffing would
      // double-record those changes, so skip detection for this file.
      if (await isRitualClean(newPath, newContent)) {
        results.push({ file: fc.path, kind, status: fc.status, changes: [], ritualClean: true })
        continue
      }

      const oldContent = fc.status === 'A' ? null : getFileAtCommit(commit, fc.oldPath, cwd)
      const report: ReportParseWarning = (revision, warning) => {
        const where = revision === 'committed' ? `${fc.oldPath} at ${commit}` : fc.path
        warnings.push({ kind: 'parse', file: fc.path, revision, message: `${where}: ${warning}` })
      }

      let changes: ChangeEvent[]
      switch (kind) {
        case 'deck':
          changes = await diffDeck(oldContent, newContent, report)
          break
        case 'collection':
          changes = diffCollection(oldContent, newContent, report)
          break
        case 'wanted':
          changes = diffWanted(oldContent, newContent, report)
          break
        default: {
          const _exhaustive: never = kind
          throw new Error(`Unknown list kind: ${_exhaustive}`)
        }
      }

      results.push({ file: fc.path, kind, status: fc.status, changes, ritualClean: false })
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }

  return { results, renames, warnings }
}

// ── Applying detected changes ────────────────────────────────────────

export type ApplyDetectedChangesOptions = {
  /** Report what would change without writing files. */
  dryRun: boolean
  /**
   * Suppress the per-file progress lines on stdout. Non-text output modes own
   * stdout, so they always apply quietly.
   */
  quiet?: boolean
}

/**
 * Apply the output of {@link detectChanges} to disk: rename/delete `.changes.md`
 * changelog files to follow their list files, and append changelog entries for
 * any hand-edited list whose content has drifted from its `.sha256` sidecar.
 *
 * Ritual-clean files (content matches the sidecar) are skipped entirely, since
 * their changelog was already written when Ritual made the edit locally.
 *
 * @returns The number of list files whose changelog was (or would be) updated.
 */
export async function applyDetectedChanges(
  output: DetectChangesOutput,
  cwd: string,
  options: ApplyDetectedChangesOptions,
): Promise<number> {
  const { results, renames } = output
  const { dryRun } = options
  const log: (message: string) => void = options.quiet
    ? () => undefined
    : (message) => console.log(message)

  // First pass: handle renames of .changes.md files
  for (const [oldPath, newPath] of renames) {
    const oldChangesPath = path.join(cwd, changesPath(oldPath))
    const newChangesPath = path.join(cwd, changesPath(newPath))

    try {
      await fs.access(oldChangesPath)
      const paths = { from: changesPath(oldPath), to: changesPath(newPath) }
      if (dryRun) {
        log(`  ${t('cli.detectChanges.wouldRename', paths)}`)
      } else {
        await fs.rename(oldChangesPath, newChangesPath)
        log(`  ${t('cli.detectChanges.renamed', paths)}`)
      }
    } catch {
      // Old changes file doesn't exist — nothing to rename
    }
  }

  // Second pass: handle deletes of .changes.md files
  for (const result of results) {
    if (result.status !== 'D') continue

    const deletePath = path.join(cwd, changesPath(result.file))
    try {
      await fs.access(deletePath)
      if (dryRun) {
        log(`  ${t('cli.detectChanges.wouldDelete', { path: changesPath(result.file) })}`)
      } else {
        await fs.rm(deletePath)
        log(`  ${t('cli.detectChanges.deleted', { path: changesPath(result.file) })}`)
      }
    } catch {
      // Changes file doesn't exist — nothing to delete
    }
  }

  // Third pass: append changelog entries for actual card changes
  let updated = 0
  for (const result of results) {
    if (result.status === 'D') continue

    const filePath = path.join(cwd, result.file)
    const label = `${result.kind}/${path.basename(result.file, '.md')}`

    if (result.ritualClean) {
      log(`  ${t('cli.detectChanges.upToDate', { label })}`)
      continue
    }

    if (result.changes.length === 0) {
      log(`  ${t('cli.detectChanges.noCardChanges', { label })}`)
      continue
    }

    log(`  ${t('cli.detectChanges.changeCount', { label, count: result.changes.length })}`)
    for (const change of result.changes) {
      log(`    ${formatChange(change)}`)
    }
    updated++

    if (!dryRun) {
      const content = await fs.readFile(filePath, 'utf-8')
      const entityName = entityNameFromContent(content, result.file)
      await appendChangelog(filePath, entityName, result.changes)
      // The list file's changes are now recorded, so refresh its sidecar to
      // match the current content. Subsequent runs will treat it as
      // Ritual-clean and skip it, keeping detection idempotent.
      await saveHash(filePath, computeHash(content))
    }
  }

  return updated
}

// ── Sidecar inspection (--hash-only / --verify) ──────────────────────

/**
 * Inspect every list file's `.sha256` sidecar. Enumeration goes through
 * `listLocations`, the one list-file scan in the repo, so changelog
 * (`.changes.md`) files are never mistaken for list files. Deck primers
 * (`.primer.md`) are excluded too, by the deck scan's own `isDeckFile` filter —
 * primers are a decks-only convention, so nothing else needs to exclude them.
 *
 * A file that vanishes between the scan and the read is skipped rather than
 * aborting the pass, matching how the default mode handles the same race.
 *
 * Reads only; the caller decides whether to stamp.
 */
export async function inspectListSidecars(baseDir: string): Promise<SidecarInspection[]> {
  const locations = await listLocations()
  const inspections: SidecarInspection[] = []
  for (const location of locations) {
    let content: string
    try {
      content = await fs.readFile(location.filePath, 'utf-8')
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
      continue
    }
    const classification = classifySidecarWithHash(content, await loadHash(location.filePath))
    inspections.push({
      file: path.relative(baseDir, location.filePath),
      state: classification.state,
      hash: classification.hash,
    })
  }
  return inspections.sort((a, b) => compareData(a.file, b.file))
}

/** The files an inspection pass found carrying edits Ritual has not recorded. */
function unrecorded(stamped: readonly StampedFile[]): StampedFile[] {
  return stamped.filter((file) => file.priorState !== 'clean')
}

/**
 * The data-loss warning for `--hash-only`: stamping a file whose content
 * diverged from its sidecar (or that never had one) declares those edits
 * already recorded, so `detect-changes` will skip them forever. Essential —
 * it prints even under `--quiet`.
 */
function stampWarnings(stamped: readonly StampedFile[], dryRun: boolean): string[] {
  const lost = unrecorded(stamped)
  if (lost.length === 0) return []
  const warning = t('cli.detectChanges.stampWarning', {
    mode: dryRun ? 'dryRun' : 'applied',
    count: t('domain.count.files', { count: lost.length }),
  })
  return [`⚠️  ${warning}`, ...lost.map((inspection) => `⚠️    ${inspection.file}`)]
}

// ── Mode: --hash-only ────────────────────────────────────────────────

async function runHashOnly(
  baseDir: string,
  dryRun: boolean,
  scripting: ScriptingOptions,
): Promise<void> {
  const stamped: StampedFile[] = (await inspectListSidecars(baseDir)).map(
    ({ file, state, hash }) => ({ file, priorState: state, hash }),
  )
  if (!dryRun) {
    for (const inspection of stamped) {
      await saveHash(path.join(baseDir, inspection.file), inspection.hash)
    }
  }

  // The warning is data-loss reporting, so it precedes the payload and survives
  // both `--quiet` and structured output.
  emitWarnings(stampWarnings(stamped, dryRun), scripting, { essential: true })

  if (scripting.output !== 'text') {
    const report: HashOnlyReport = {
      mode: 'hash-only',
      dryRun,
      stamped,
      unrecordedEdits: unrecorded(stamped).length,
    }
    emitOutput(report, scripting)
    return
  }

  if (scripting.quiet) return

  for (const inspection of stamped) {
    console.log(`${dryRun ? '[dry-run] ' : ''}${inspection.file}: ${inspection.hash}`)
  }

  if (stamped.length === 0) {
    console.log(t('cli.detectChanges.noListFiles'))
    return
  }
  console.log(
    `\n${t('cli.detectChanges.stamped', {
      mode: dryRun ? 'dryRun' : 'applied',
      count: t('domain.count.files', { count: stamped.length }),
    })}`,
  )
}

// ── Mode: --verify ───────────────────────────────────────────────────

/** Message keys for the per-file states `--verify` prints. */
const VERIFY_LABELS = {
  clean: 'domain.sidecar.clean',
  diverged: 'domain.sidecar.diverged',
  missing: 'domain.sidecar.missing',
} as const satisfies Record<SidecarState, MessageKey>

async function runVerify(baseDir: string, scripting: ScriptingOptions): Promise<void> {
  const files = await inspectListSidecars(baseDir)
  const counts: Record<SidecarState, number> = { clean: 0, diverged: 0, missing: 0 }
  for (const file of files) counts[file.state]++

  const drifted = counts.diverged + counts.missing
  // Drift is the reportable condition, not a crash: exit 1 so a CI check can
  // gate on it, exactly like `cleanup --check`.
  if (drifted > 0) process.exitCode = ExitCode.RuntimeError

  if (scripting.output !== 'text') {
    const report: VerifyReport = {
      mode: 'verify',
      files,
      clean: counts.clean,
      diverged: counts.diverged,
      missing: counts.missing,
    }
    emitOutput(report, scripting)
    return
  }

  if (scripting.quiet) return

  for (const file of files) {
    console.log(`${file.file}: ${t(VERIFY_LABELS[file.state])}`)
  }

  if (files.length === 0) {
    console.log(t('cli.detectChanges.noListFiles'))
    return
  }

  console.log(
    `\n${t('cli.detectChanges.verifySummary', {
      files: t('domain.count.files', { count: files.length }),
      clean: counts.clean,
      diverged: counts.diverged,
      missing: counts.missing,
    })}`,
  )
  if (drifted > 0) {
    console.log(t('cli.detectChanges.verifyAdvice'))
  }
}

// ── Mode: git detection (default) ────────────────────────────────────

/** Render a git failure as the operation that failed, then git's own detail. */
export function describeGitFailure(error: unknown, prefix: string): string {
  if (error instanceof GitCommandError) {
    return error.gitDetail === null ? error.message : `${error.message}\n  git: ${error.gitDetail}`
  }
  return `${prefix}: ${getErrorMessage(error)}`
}

async function runDetect(
  commit: string,
  cwd: string,
  dryRun: boolean,
  scripting: ScriptingOptions,
): Promise<void> {
  const text = scripting.output === 'text'
  // Non-text modes own stdout (the payload must stay pure JSON), so the
  // progress chatter only exists in non-quiet text mode.
  const chatty = text && !scripting.quiet

  const repoProbe = probeGitRepository(cwd)
  if (!repoProbe.ok) {
    // git could not answer at all — reporting "not a git repository" here would
    // send the user to --hash-only, which forfeits changelog entries, for a
    // repository that is fine.
    failWith(
      scripting,
      'runtime_error',
      describeGitFailure(repoProbe.error, t('cli.detectChanges.gitProbeFailed')),
    )
    return
  }
  if (!repoProbe.present) {
    failWith(scripting, 'runtime_error', t('cli.detectChanges.notGitRepo', { path: cwd }))
    return
  }

  const refProbe = probeGitRef(commit, cwd)
  if (!refProbe.ok) {
    failWith(
      scripting,
      'runtime_error',
      describeGitFailure(refProbe.error, t('cli.detectChanges.resolveRefFailed', { commit })),
    )
    return
  }
  if (!refProbe.present) {
    failWith(scripting, 'runtime_error', t('cli.detectChanges.unknownRef', { commit, path: cwd }))
    return
  }

  if (chatty) {
    console.log(t('cli.detectChanges.comparing', { commit }))
    if (dryRun) console.log(`${t('cli.detectChanges.dryRunNotice')}\n`)
  }

  let output: DetectChangesOutput
  try {
    output = await detectChanges(commit, cwd)
  } catch (err) {
    failWith(
      scripting,
      'runtime_error',
      describeGitFailure(err, t('cli.detectChanges.detectFailed')),
    )
    return
  }

  // Warnings go to stderr in every mode so stdout stays a pure payload, and are
  // essential: each one names something that will not get a changelog entry.
  emitWarnings(
    output.warnings.map((warning) => `⚠️  ${warning.message}`),
    scripting,
    { essential: true },
  )
  // Only a skipped file makes the run *partial*; a skipped line still leaves a
  // complete, applied diff for its file.
  const skipped = hasSkippedFiles(output.warnings)
  if (skipped) process.exitCode = ExitCode.RuntimeError

  if (text && output.results.length === 0 && output.renames.size === 0) {
    // With everything skipped, the warnings above already said what happened —
    // claiming "no changes detected" would contradict them and the exit code.
    if (chatty && !skipped) console.log(t('cli.detectChanges.noChanges'))
    return
  }

  let updated: number
  try {
    updated = await applyDetectedChanges(output, cwd, { dryRun, quiet: !chatty })
  } catch (err) {
    failWith(
      scripting,
      'runtime_error',
      t('cli.detectChanges.applyFailed', { reason: getErrorMessage(err) }),
    )
    return
  }

  if (!text) {
    const report: DetectChangesReport = {
      mode: 'detect',
      commit,
      dryRun,
      changelogsUpdated: updated,
      renames: Object.fromEntries(output.renames),
      results: output.results,
      warnings: output.warnings,
    }
    emitOutput(report, scripting)
    return
  }

  if (!chatty) return

  if (dryRun) {
    console.log(`\n${t('cli.detectChanges.dryRunComplete')}`)
  } else if (updated > 0) {
    console.log(`\n${t('cli.detectChanges.changelogsUpdated')}`)
  } else {
    console.log(`\n${t('cli.detectChanges.noChangelogUpdates')}`)
  }
}

// ── Mode selection ───────────────────────────────────────────────────

/**
 * The resolved mode, or the usage error the user sees. The `detect` variant
 * carries the commit so the caller never has to re-assert that it is present.
 */
export type ModeSelection =
  | { ok: true; mode: 'detect'; commit: string }
  | { ok: true; mode: Exclude<DetectChangesMode, 'detect'> }
  | { ok: false; message: string }

/**
 * Resolve the requested mode, rejecting combinations that cannot mean anything:
 * the modes are mutually exclusive, `<commit>` belongs to git detection alone,
 * and `--verify` writes nothing so `--dry-run` has nothing to preview. Pure, so
 * the whole matrix is unit-testable.
 */
export function selectDetectChangesMode(
  commit: string | undefined,
  options: Pick<DetectChangesCliOptions, 'hashOnly' | 'verify' | 'dryRun'>,
): ModeSelection {
  const hashOnly = options.hashOnly === true
  const verify = options.verify === true

  if (hashOnly && verify) {
    return { ok: false, message: t('cli.detectChanges.modesExclusive') }
  }
  if (verify && options.dryRun === true) {
    return { ok: false, message: t('cli.detectChanges.verifyNoDryRun') }
  }
  if (!hashOnly && !verify) {
    if (commit === undefined) {
      return { ok: false, message: t('cli.detectChanges.missingCommit') }
    }
    return { ok: true, mode: 'detect', commit }
  }
  if (commit !== undefined) {
    const flag = hashOnly ? '--hash-only' : '--verify'
    return { ok: false, message: t('cli.detectChanges.commitNotUsed', { flag }) }
  }
  return { ok: true, mode: hashOnly ? 'hash-only' : 'verify' }
}

// ── Command registration ─────────────────────────────────────────────

export function registerDetectChangesCommand(program: Command): void {
  addScriptingOptions(
    addDryRunOption(
      program
        .command('detect-changes')
        .description(t('help.detectChanges.description'))
        .argument('[commit]', t('help.detectChanges.commit'))
        .option('--hash-only', t('help.detectChanges.hashOnly'))
        .option('--verify', t('help.detectChanges.verify')),
      t('help.detectChanges.dryRun'),
    ),
  ).action(async (commit: string | undefined, options: DetectChangesCliOptions) => {
    const scripting = normalizeScriptingOptions(options)
    const cwd = getBaseDir()
    const dryRun = options.dryRun ?? false

    const selection = selectDetectChangesMode(commit, options)
    if (!selection.ok) {
      failWith(scripting, 'usage_error', selection.message)
      return
    }

    // The sidecar modes walk the filesystem, so an unreadable list file (or a
    // list directory that changes under them) surfaces as the shared
    // `runtime_error` envelope rather than a raw ENOENT string that would
    // escape the --output contract.
    await runCommandAction(scripting, async () => {
      switch (selection.mode) {
        case 'hash-only':
          await runHashOnly(cwd, dryRun, scripting)
          return
        case 'verify':
          await runVerify(cwd, scripting)
          return
        case 'detect':
          await runDetect(selection.commit, cwd, dryRun, scripting)
          return
      }
    })
  })
}
