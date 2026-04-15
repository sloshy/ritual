import { Command } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
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
import { parseCollectionFile } from './price-collection'
import { parseWantedListFile } from './wanted-helpers'
import { appendChangelog } from '../changelog-writer'
import { formatChange, type ChangeEvent } from '../change-event'
import { getBaseDir } from '../base-dir'

// ── Types ────────────────────────────────────────────────────────────

type GitDetectChangesOptions = {
  dryRun?: boolean
}

type DetectResult = {
  file: string
  kind: ListKind
  status: FileChange['status']
  changes: ChangeEvent[]
}

type DetectChangesOutput = {
  results: DetectResult[]
  renames: Map<string, string>
}

// ── Entity name extraction ───────────────────────────────────────────

function entityNameFromContent(content: string, fallbackPath: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]
  if (heading) return heading.trim()
  return path.basename(fallbackPath, '.md')
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

async function detectChanges(commit: string, cwd: string): Promise<DetectChangesOutput> {
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
        results.push({ file: fc.oldPath, kind, status: 'D', changes: [] })
        continue
      }

      const newContent = await fs.readFile(path.join(cwd, fc.path), 'utf-8')
      const oldContent = fc.status === 'A' ? null : getFileAtCommit(commit, fc.oldPath, cwd)

      let changes: ChangeEvent[]
      switch (kind) {
        case 'deck':
          changes = await diffDeck(oldContent, newContent)
          break
        case 'collection':
          changes = diffCollection(oldContent, newContent)
          break
        case 'wanted':
          changes = diffWanted(oldContent, newContent)
          break
        default: {
          const _exhaustive: never = kind
          throw new Error(`Unknown list kind: ${_exhaustive}`)
        }
      }

      results.push({ file: fc.path, kind, status: fc.status, changes })
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }

  return { results, renames }
}

// ── Command registration ─────────────────────────────────────────────

export function registerGitDetectChangesCommand(program: Command) {
  program
    .command('git-detect-changes')
    .description('Detect card changes from git history and update changelogs')
    .argument('<commit>', 'Git commit hash or ref to diff against (e.g. HEAD~1, abc123)')
    .option('--dry-run', 'Preview detected changes without writing files')
    .action(async (commit: string, options: GitDetectChangesOptions) => {
      const cwd = getBaseDir()
      const dryRun = options.dryRun ?? false

      console.log(`Comparing against ${commit}...`)
      if (dryRun) console.log('(dry run — no files will be modified)\n')

      let output: DetectChangesOutput
      try {
        output = await detectChanges(commit, cwd)
      } catch (err) {
        console.error(
          `Failed to detect changes: ${err instanceof Error ? err.message : String(err)}`,
        )
        process.exitCode = 1
        return
      }

      const { results, renames } = output

      if (results.length === 0 && renames.size === 0) {
        console.log('No deck, collection, or wanted list changes detected.')
        return
      }

      // First pass: handle renames of .changes.md files
      for (const [oldPath, newPath] of renames) {
        const oldChangesPath = path.join(cwd, changesPath(oldPath))
        const newChangesPath = path.join(cwd, changesPath(newPath))

        try {
          await fs.access(oldChangesPath)
          if (dryRun) {
            console.log(`  Would rename: ${changesPath(oldPath)} → ${changesPath(newPath)}`)
          } else {
            await fs.rename(oldChangesPath, newChangesPath)
            console.log(`  Renamed: ${changesPath(oldPath)} → ${changesPath(newPath)}`)
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
            console.log(`  Would delete: ${changesPath(result.file)}`)
          } else {
            await fs.rm(deletePath)
            console.log(`  Deleted: ${changesPath(result.file)}`)
          }
        } catch {
          // Changes file doesn't exist — nothing to delete
        }
      }

      // Third pass: append changelog entries for actual card changes
      for (const result of results) {
        if (result.status === 'D') continue

        const filePath = path.join(cwd, result.file)
        const label = `${result.kind}/${path.basename(result.file, '.md')}`

        if (result.changes.length === 0) {
          console.log(`  ${label}: no card changes detected`)
          continue
        }

        console.log(`  ${label}: ${result.changes.length} change(s)`)
        for (const change of result.changes) {
          console.log(`    ${formatChange(change)}`)
        }

        if (!dryRun) {
          const content = await fs.readFile(filePath, 'utf-8')
          const entityName = entityNameFromContent(content, result.file)
          await appendChangelog(filePath, entityName, result.changes)
        }
      }

      if (dryRun) {
        console.log('\nDry run complete. No files were modified.')
      } else {
        console.log('\nChangelogs updated.')
      }
    })
}
