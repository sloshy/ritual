import { Command } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseTitleFromContent } from '../section-format'
import {
  getChangedFiles,
  getFileAtCommit,
  classifyFile,
  changesPath,
  type FileChange,
  type ListKind,
} from '../git-diff'
import { diffDeckCards, diffCollectionEntries, diffWantedEntries } from '../diff-cards'
import { importFromTextFile } from '../importers/text-file'
import { parseCollectionFile } from '../collection-file'
import { parseWantedListFile } from './wanted-helpers'
import { appendChangelog } from '../changelog-writer'
import { formatChange, type ChangeEvent } from '../change-event'
import { getBaseDir } from '../base-dir'
import { computeHash, isRitualClean, saveHash } from '../content-hash'
import { parseCardIdsFromContent } from '../card-id'
import { getErrorMessage } from '../errors'
import {
  addDryRunOption,
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

// ── Types ────────────────────────────────────────────────────────────

type GitDetectChangesOptions = {
  dryRun?: boolean
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

type DetectChangesOutput = {
  results: DetectResult[]
  renames: Map<string, string>
}

/**
 * The `--output json`/`ndjson` payload: the detection results plus what the run
 * did (or, under `--dry-run`, would do). File paths are repo-relative, as git
 * emits them.
 */
type DetectChangesReport = {
  commit: string
  dryRun: boolean
  /** Number of list files whose changelog was (or would be) updated. */
  changelogsUpdated: number
  /** Old path → new path for renamed list files. */
  renames: Record<string, string>
  results: DetectResult[]
}

// ── Entity name extraction ───────────────────────────────────────────

function entityNameFromContent(content: string, fallbackPath: string): string {
  return parseTitleFromContent(content) ?? path.basename(fallbackPath, '.md')
}

/**
 * A revision written before Ritual assigned `&N` IDs has no IDs to match on.
 * Diffing it against a since-backfilled working tree would key the two sides
 * differently (composite vs `id:N`) and report every card as removed and
 * re-added, so when the old side carries no IDs at all, strip them from the
 * new side and let both sides pair by the composite key. The change events for
 * such a file carry no `&N` — the IDs the backfill assigned have no old-side
 * counterpart to be matched against, so inventing pairings here would be worse.
 */
function alignIdsForDiff(oldContent: string | null, newContent: string): string {
  if (oldContent === null) return newContent
  if (parseCardIdsFromContent(oldContent).length > 0) return newContent
  return newContent.replace(/[^\S\n]+&\d+[^\S\n]*$/gm, '')
}

// ── Per-file diffing ─────────────────────────────────────────────────

function diffCollection(oldContent: string | null, newContent: string): ChangeEvent[] {
  const newParsed = parseCollectionFile(newContent)
  for (const w of newParsed.warnings) console.warn(`  ⚠ ${w}`)

  if (!oldContent) {
    return diffCollectionEntries([], newParsed.entries)
  }

  const oldParsed = parseCollectionFile(oldContent)
  for (const w of oldParsed.warnings) console.warn(`  ⚠ ${w}`)

  return diffCollectionEntries(oldParsed.entries, newParsed.entries)
}

function diffWanted(oldContent: string | null, newContent: string): ChangeEvent[] {
  const newParsed = parseWantedListFile(newContent)
  for (const w of newParsed.warnings) console.warn(`  ⚠ ${w}`)

  if (!oldContent) {
    return diffWantedEntries([], newParsed.entries)
  }

  const oldParsed = parseWantedListFile(oldContent)
  for (const w of oldParsed.warnings) console.warn(`  ⚠ ${w}`)

  return diffWantedEntries(oldParsed.entries, newParsed.entries)
}

// ── Main logic ───────────────────────────────────────────────────────

export async function detectChanges(commit: string, cwd: string): Promise<DetectChangesOutput> {
  const fileChanges = getChangedFiles(commit, cwd)
  const results: DetectResult[] = []
  const renames = new Map<string, string>()

  const tempDir = path.join(cwd, '.git', `ritual-tmp-${Date.now()}`)
  let tempFileCounter = 0

  async function diffDeck(oldContent: string | null, newContent: string): Promise<ChangeEvent[]> {
    const suffix = tempFileCounter++
    const newTmp = path.join(tempDir, `new-deck-${suffix}.md`)
    await fs.writeFile(newTmp, newContent)
    const newDeck = await importFromTextFile(newTmp)

    if (!oldContent) {
      return diffDeckCards([], newDeck.sections)
    }

    const oldTmp = path.join(tempDir, `old-deck-${suffix}.md`)
    await fs.writeFile(oldTmp, oldContent)
    const oldDeck = await importFromTextFile(oldTmp)

    return diffDeckCards(oldDeck.sections, newDeck.sections)
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
      const newContent = await fs.readFile(newPath, 'utf-8')

      // Hash-aware skip: when the file content matches its committed `.sha256`
      // sidecar, Ritual itself last wrote this exact state and already recorded
      // the corresponding changelog entries locally. Re-diffing would
      // double-record those changes, so skip detection for this file.
      if (await isRitualClean(newPath, newContent)) {
        results.push({ file: fc.path, kind, status: fc.status, changes: [], ritualClean: true })
        continue
      }

      const oldContent = fc.status === 'A' ? null : getFileAtCommit(commit, fc.oldPath, cwd)
      const alignedNewContent = alignIdsForDiff(oldContent, newContent)

      let changes: ChangeEvent[]
      switch (kind) {
        case 'deck':
          changes = await diffDeck(oldContent, alignedNewContent)
          break
        case 'collection':
          changes = diffCollection(oldContent, alignedNewContent)
          break
        case 'wanted':
          changes = diffWanted(oldContent, alignedNewContent)
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

  return { results, renames }
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
      if (dryRun) {
        log(`  Would rename: ${changesPath(oldPath)} → ${changesPath(newPath)}`)
      } else {
        await fs.rename(oldChangesPath, newChangesPath)
        log(`  Renamed: ${changesPath(oldPath)} → ${changesPath(newPath)}`)
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
        log(`  Would delete: ${changesPath(result.file)}`)
      } else {
        await fs.rm(deletePath)
        log(`  Deleted: ${changesPath(result.file)}`)
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
      log(`  ${label}: up to date with Ritual — skipping`)
      continue
    }

    if (result.changes.length === 0) {
      log(`  ${label}: no card changes detected`)
      continue
    }

    log(`  ${label}: ${result.changes.length} change(s)`)
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

// ── Command registration ─────────────────────────────────────────────

export function registerGitDetectChangesCommand(program: Command): void {
  addScriptingOptions(
    addDryRunOption(
      program
        .command('git-detect-changes')
        .description('Detect card changes from git history and update changelogs')
        .argument('<commit>', 'Git commit hash or ref to diff against (e.g. HEAD~1, abc123)'),
      'Preview detected changes without writing files',
    ),
  ).action(async (commit: string, options: GitDetectChangesOptions) => {
    const scripting = normalizeScriptingOptions(options)
    const cwd = getBaseDir()
    const dryRun = options.dryRun ?? false
    const text = scripting.output === 'text'
    // Non-text modes own stdout (the payload must stay pure JSON), so the
    // progress chatter only exists in non-quiet text mode.
    const chatty = text && !scripting.quiet

    if (chatty) {
      console.log(`Comparing against ${commit}...`)
      if (dryRun) console.log('(dry run — no files will be modified)\n')
    }

    let output: DetectChangesOutput
    try {
      output = await detectChanges(commit, cwd)
    } catch (err) {
      emitError('runtime_error', `Failed to detect changes: ${getErrorMessage(err)}`, scripting)
      process.exitCode = ExitCode.RuntimeError
      return
    }

    if (text && output.results.length === 0 && output.renames.size === 0) {
      if (chatty) console.log('No deck, collection, or wanted list changes detected.')
      return
    }

    let updated: number
    try {
      updated = await applyDetectedChanges(output, cwd, { dryRun, quiet: !chatty })
    } catch (err) {
      emitError(
        'runtime_error',
        `Failed to apply detected changes: ${getErrorMessage(err)}`,
        scripting,
      )
      process.exitCode = ExitCode.RuntimeError
      return
    }

    if (!text) {
      const report: DetectChangesReport = {
        commit,
        dryRun,
        changelogsUpdated: updated,
        renames: Object.fromEntries(output.renames),
        results: output.results,
      }
      emitOutput(report, scripting)
      return
    }

    if (!chatty) return

    if (dryRun) {
      console.log('\nDry run complete. No files were modified.')
    } else if (updated > 0) {
      console.log('\nChangelogs updated.')
    } else {
      console.log('\nNo changelog updates needed.')
    }
  })
}
