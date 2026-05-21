import { describe, test, expect, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setBaseDir } from '../../src/base-dir'
import { initRitualConfig, resetRitualConfigCache } from '../../src/ritual-config'
import { cleanGitEnv } from '../../src/git-diff'
import { computeHash, loadHash, writeFileWithHash } from '../../src/content-hash'
import { detectChanges, applyDetectedChanges } from '../../src/commands/git-detect-changes'

// ── Test fixtures ────────────────────────────────────────────────────

const DECK_BEFORE = `---
name: "Test Deck"
format: "commander"
---

# Test Deck

## Mainboard

1 Sol Ring (C21:263) &1
1 Lightning Bolt (2X2:117) &2
`

// Lightning Bolt removed.
const DECK_AFTER = `---
name: "Test Deck"
format: "commander"
---

# Test Deck

## Mainboard

1 Sol Ring (C21:263) &1
`

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

type Repo = { dir: string; deckPath: string; before: string }

/**
 * Create a fresh git repo with a committed deck (and its `.sha256` sidecar)
 * written through Ritual. Returns the repo dir, deck path, and the commit SHA
 * of that initial state to diff against.
 */
async function setupRepo(): Promise<Repo> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-detect-test-'))
  setBaseDir(dir)
  resetRitualConfigCache()
  await initRitualConfig()

  git(dir, 'init')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'commit.gpgsign', 'false')

  const deckPath = path.join(dir, 'decks', 'test-deck.md')
  await fs.mkdir(path.dirname(deckPath), { recursive: true })
  // writeFileWithHash mirrors how Ritual writes deck files: content + sidecar.
  await writeFileWithHash(deckPath, DECK_BEFORE)

  const before = commitAll(dir, 'initial deck')
  return { dir, deckPath, before }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('git-detect-changes hash-aware detection', () => {
  const originalCwd = process.cwd()
  let repo: Repo | null = null

  afterEach(async () => {
    setBaseDir(originalCwd)
    resetRitualConfigCache()
    if (repo) {
      await fs.rm(repo.dir, { recursive: true, force: true })
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

    const updated = await applyDetectedChanges(output, repo.dir, false)
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

    const updated = await applyDetectedChanges(output, repo.dir, false)
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
    const updated = await applyDetectedChanges(output, repo.dir, true)
    expect(updated).toBe(1)

    // Dry run leaves the changelog absent and the sidecar untouched. The
    // sidecar still holds DECK_BEFORE's hash because the hand edit used plain
    // fs.writeFile (no sidecar update) and dry-run skips the refresh.
    expect(await fileExists(changesPath)).toBe(false)
    expect(await loadHash(repo.deckPath)).toBe(computeHash(DECK_BEFORE))
  })
})
