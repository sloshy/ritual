import { describe, test, expect, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cleanGitEnv } from '../../src/git-diff'
import { computeHash, loadHash, writeFileWithHash } from '../../src/content-hash'
import { detectChanges, applyDetectedChanges } from '../../src/commands/git-detect-changes'
import { bindWorkspace, deckMarkdown, type BoundWorkspace } from './helpers/workspace'
import { runCli } from './helpers/cli'

// ── Test fixtures ────────────────────────────────────────────────────

const DECK_BEFORE = deckMarkdown({
  frontMatter: { name: 'Test Deck', format: 'commander' },
  sections: [
    {
      name: 'Mainboard',
      cards: [
        { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
        { quantity: 1, name: 'Lightning Bolt', set: '2x2', collectorNumber: '117', cardId: 2 },
      ],
    },
  ],
})

// Lightning Bolt removed.
const DECK_AFTER = deckMarkdown({
  frontMatter: { name: 'Test Deck', format: 'commander' },
  sections: [
    {
      name: 'Mainboard',
      cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
    },
  ],
})

// ── Git helpers ──────────────────────────────────────────────────────

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanGitEnv(),
  })
}

function commitAll(cwd: string, message: string): string {
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD').trim()
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

type Repo = { ws: BoundWorkspace; dir: string; deckPath: string; before: string }

/**
 * Create a fresh git repo with a committed deck (and its `.sha256` sidecar)
 * written through Ritual. Returns the repo dir, deck path, and the commit SHA
 * of that initial state to diff against.
 */
async function setupRepo(): Promise<Repo> {
  const ws = await bindWorkspace({ dirs: [], config: false, init: true })
  const dir = ws.dir

  git(dir, 'init')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'commit.gpgsign', 'false')

  const deckPath = path.join(dir, 'decks', 'test-deck.md')
  await fs.mkdir(path.dirname(deckPath), { recursive: true })
  // writeFileWithHash mirrors how Ritual writes deck files: content + sidecar.
  await writeFileWithHash(deckPath, DECK_BEFORE)

  const before = commitAll(dir, 'initial deck')
  return { ws, dir, deckPath, before }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('git-detect-changes hash-aware detection', () => {
  let repo: Repo | null = null

  afterEach(async () => {
    if (repo) {
      await repo.ws.dispose()
      repo = null
    }
  })

  test('skips a Ritual-written edit (sidecar matches) without re-recording', async () => {
    repo = await setupRepo()
    const changesPath = repo.deckPath.replace(/\.md$/, '.changes.md')

    // Edit the deck the way Ritual does — content and sidecar updated together.
    await writeFileWithHash(repo.deckPath, DECK_AFTER)
    commitAll(repo.dir, 'ritual edit')

    const output = await detectChanges(repo.before, repo.dir)
    const deckResult = output.results.find((r) => r.file.endsWith('test-deck.md'))
    expect(deckResult?.ritualClean).toBe(true)
    expect(deckResult?.changes).toHaveLength(0)

    const updated = await applyDetectedChanges(output, repo.dir, { dryRun: false })
    expect(updated).toBe(0)

    // No changelog should have been created for a Ritual-clean file.
    expect(await fileExists(changesPath)).toBe(false)
  })

  test('records a hand edit (stale sidecar) and refreshes the sidecar', async () => {
    repo = await setupRepo()
    const changesPath = repo.deckPath.replace(/\.md$/, '.changes.md')

    // Edit the deck file directly, leaving the sidecar stale (a raw git edit).
    await fs.writeFile(repo.deckPath, DECK_AFTER)
    commitAll(repo.dir, 'hand edit')

    const output = await detectChanges(repo.before, repo.dir)
    const deckResult = output.results.find((r) => r.file.endsWith('test-deck.md'))
    expect(deckResult?.ritualClean).toBe(false)
    expect(deckResult?.changes.length).toBeGreaterThan(0)

    const updated = await applyDetectedChanges(output, repo.dir, { dryRun: false })
    expect(updated).toBe(1)

    // The changelog records the removal.
    const changelog = await fs.readFile(changesPath, 'utf-8')
    expect(changelog).toContain('Removed "Lightning Bolt"')

    // The sidecar is refreshed so a re-run treats the file as Ritual-clean.
    expect(await loadHash(repo.deckPath)).toBe(computeHash(DECK_AFTER))

    const rerun = await detectChanges(repo.before, repo.dir)
    const rerunResult = rerun.results.find((r) => r.file.endsWith('test-deck.md'))
    expect(rerunResult?.ritualClean).toBe(true)
  })

  test('dry run reports a hand edit without writing the changelog or sidecar', async () => {
    repo = await setupRepo()
    const changesPath = repo.deckPath.replace(/\.md$/, '.changes.md')

    await fs.writeFile(repo.deckPath, DECK_AFTER)
    commitAll(repo.dir, 'hand edit')

    const output = await detectChanges(repo.before, repo.dir)
    const updated = await applyDetectedChanges(output, repo.dir, { dryRun: true })
    expect(updated).toBe(1)

    // Dry run leaves the changelog absent and the sidecar untouched. The
    // sidecar still holds DECK_BEFORE's hash because the hand edit used plain
    // fs.writeFile (no sidecar update) and dry-run skips the refresh.
    expect(await fileExists(changesPath)).toBe(false)
    expect(await loadHash(repo.deckPath)).toBe(computeHash(DECK_BEFORE))
  })
})

// ── CLI scripted output ──────────────────────────────────────────────

/** The parsed shape of the CLI's `--output json` payload (DetectChangesReport). */
type ParsedDetectChangesReport = {
  commit: string
  dryRun: boolean
  changelogsUpdated: number
  renames: Record<string, string>
  results: {
    file: string
    kind: string
    status: string
    ritualClean: boolean
    changes: { action: string; cardName?: string }[]
  }[]
}

describe('git-detect-changes apply failure', () => {
  let repo: Repo | null = null

  afterEach(async () => {
    if (repo) {
      await repo.ws.dispose()
      repo = null
    }
  })

  test('a failed changelog write exits 1 with an error instead of an unhandled crash', async () => {
    repo = await setupRepo()

    // Hand-edit the deck (stale sidecar), so detection produces changes to apply.
    await fs.writeFile(repo.deckPath, DECK_AFTER)
    commitAll(repo.dir, 'hand edit')

    // Sabotage the apply: a DIRECTORY at the changelog path makes the
    // changelog write fail (EISDIR), forcing applyDetectedChanges to throw.
    const changesPath = repo.deckPath.replace(/\.md$/, '.changes.md')
    await fs.mkdir(changesPath)

    const result = await runCli(['git-detect-changes', repo.before], repo.dir)

    // The failure maps to RuntimeError with a structured message on stderr —
    // not an unhandled stack trace.
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Failed to apply detected changes')
  })
})

describe('git-detect-changes --output json', () => {
  let repo: Repo | null = null

  afterEach(async () => {
    if (repo) {
      await repo.ws.dispose()
      repo = null
    }
  })

  test('emits the detection report as pure JSON on stdout', async () => {
    repo = await setupRepo()

    // Rename the deck and hand-edit it in the same commit, so the report
    // carries both a rename record and a diffed changes array. Only the .md
    // moves — the stale sidecar keeps the file from being Ritual-clean.
    const renamedPath = path.join(repo.dir, 'decks', 'renamed-deck.md')
    await fs.rename(repo.deckPath, renamedPath)
    await fs.writeFile(renamedPath, DECK_AFTER)
    commitAll(repo.dir, 'rename and hand edit')

    const result = await runCli(
      ['git-detect-changes', repo.before, '--output', 'json', '--dry-run'],
      repo.dir,
    )
    expect(result.exitCode).toBe(0)

    // stdout is the payload alone — the text progress lines are suppressed.
    const report = JSON.parse(result.stdout) as ParsedDetectChangesReport
    expect(report.commit).toBe(repo.before)
    expect(report.dryRun).toBe(true)
    expect(report.changelogsUpdated).toBe(1)
    expect(report.renames).toEqual({ 'decks/test-deck.md': 'decks/renamed-deck.md' })

    expect(report.results).toHaveLength(1)
    const deckResult = report.results[0]
    expect(deckResult?.file).toBe('decks/renamed-deck.md')
    expect(deckResult?.kind).toBe('deck')
    expect(deckResult?.status).toBe('R')
    expect(deckResult?.ritualClean).toBe(false)
    expect(deckResult?.changes.map((change) => change.action)).toEqual(['remove'])
    expect(deckResult?.changes[0]?.cardName).toBe('Lightning Bolt')
  })
})
