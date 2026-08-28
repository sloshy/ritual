import { describe, test, expect, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cleanGitEnv } from '../../src/changes/git-diff'
import { computeHash, loadHash, writeFileWithHash } from '../../src/changes/content-hash'
import {
  detectChanges,
  applyDetectedChanges,
  type DetectWarning,
} from '../../src/commands/detect-changes'
import { bindWorkspace, deckMarkdown, type BoundWorkspace } from '../helpers/workspace'
import { runCli, withTempDir } from './helpers/cli'

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

// One repo at a time, disposed for the whole file: every describe below shares
// the same fixture lifecycle, and per-test setup stays inside each test.
let repo: Repo | null = null

afterEach(async () => {
  if (repo) {
    await repo.ws.dispose()
    repo = null
  }
})

// ── Tests ────────────────────────────────────────────────────────────

describe('detect-changes hash-aware detection', () => {
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

// ── `&N` alignment across the diff ───────────────────────────────────

describe('detect-changes card-ID alignment', () => {
  /** The same two cards, with `&N` on only some lines of the old revision. */
  const PARTIALLY_IDD = [
    '---',
    'name: Test Deck',
    'format: commander',
    '---',
    '',
    '## Mainboard',
    '',
    '1 Sol Ring (C21:263) &1',
    '1 Llanowar Elves (M19:314)',
    '',
  ].join('\n')

  const FULLY_IDD_PLUS_ONE = [
    '---',
    'name: Test Deck',
    'format: commander',
    '---',
    '',
    '## Mainboard',
    '',
    '1 Sol Ring (C21:263) &1',
    '1 Llanowar Elves (M19:314) &2',
    '1 Birds of Paradise (M19:165) &3',
    '',
  ].join('\n')

  test('a card that only gained an &N after the commit is not reported as removed and re-added', async () => {
    repo = await setupRepo()

    // Commit a partially-ID'd revision (normal now that the backfill is opt-in),
    // then hand-edit it into a fully-ID'd one that also adds a card.
    await fs.writeFile(repo.deckPath, PARTIALLY_IDD)
    const before = commitAll(repo.dir, 'partially ID-d deck')
    await fs.writeFile(repo.deckPath, FULLY_IDD_PLUS_ONE)
    commitAll(repo.dir, 'backfill IDs and add a card')

    const output = await detectChanges(before, repo.dir)
    const changes = (output.results.find((r) => r.file.endsWith('test-deck.md'))?.changes ??
      []) as { action: string; cardName?: string; cardId?: number }[]

    // Only the genuinely new card, and with no `&N` — the old side had none to
    // pair against, so the diff keys both sides by composite key.
    expect(changes.map((change) => [change.action, change.cardName])).toEqual([
      ['add', 'Birds of Paradise'],
    ])
    expect(changes[0]?.cardId).toBeUndefined()
  })
})

// ── CLI scripted output ──────────────────────────────────────────────

/** The parsed shape of the CLI's `--output json` payload (DetectChangesReport). */
type ParsedDetectChangesReport = {
  mode: string
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
  warnings: DetectWarning[]
}

describe('detect-changes apply failure', () => {
  test('a failed changelog write exits 1 with an error instead of an unhandled crash', async () => {
    repo = await setupRepo()

    // Hand-edit the deck (stale sidecar), so detection produces changes to apply.
    await fs.writeFile(repo.deckPath, DECK_AFTER)
    commitAll(repo.dir, 'hand edit')

    // Sabotage the apply: a DIRECTORY at the changelog path makes the
    // changelog write fail (EISDIR), forcing applyDetectedChanges to throw.
    const changesPath = repo.deckPath.replace(/\.md$/, '.changes.md')
    await fs.mkdir(changesPath)

    const result = await runCli(['detect-changes', repo.before], repo.dir)

    // The failure maps to RuntimeError with a structured message on stderr —
    // not an unhandled stack trace.
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Failed to apply detected changes')
  })
})

describe('detect-changes --output json', () => {
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
      ['detect-changes', repo.before, '--output', 'json', '--dry-run'],
      repo.dir,
    )
    expect(result.exitCode).toBe(0)

    // stdout is the payload alone — the text progress lines are suppressed.
    const report = JSON.parse(result.stdout) as ParsedDetectChangesReport
    expect(report.mode).toBe('detect')
    expect(report.commit).toBe(repo.before)
    expect(report.dryRun).toBe(true)
    expect(report.changelogsUpdated).toBe(1)
    expect(report.renames).toEqual({ 'decks/test-deck.md': 'decks/renamed-deck.md' })
    expect(report.warnings).toEqual([])

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

// ── Default mode: git preconditions and per-file resilience ──────────

describe('detect-changes git failures', () => {
  test('outside a git repository it fails with a message pointing at --hash-only', async () => {
    // The CLI runs in its own process keyed on cwd, so a plain temp directory
    // is all this needs — no in-process base dir to bind.
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
      const result = await runCli(['detect-changes', 'HEAD~1'], dir)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Not a git repository')
      expect(result.stderr).toContain('--hash-only')
      // The raw git wording never reaches the user.
      expect(result.stderr).not.toContain('Could not access')
    })
  })

  test('an unknown ref is reported by name instead of raw git stderr', async () => {
    repo = await setupRepo()
    const result = await runCli(['detect-changes', 'not-a-ref'], repo.dir)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown git ref: not-a-ref')
    expect(result.stderr).not.toContain('ambiguous argument')
  })

  test('a git failure that is not "no repo" is reported as itself, with git detail', async () => {
    repo = await setupRepo()
    // git refusing a repository it will not work with (dubious ownership in
    // CI, an unsupported format here) must not read as "there is no repo".
    git(repo.dir, 'config', 'core.repositoryformatversion', '99')

    const result = await runCli(['detect-changes', 'HEAD~1'], repo.dir)
    expect(result.exitCode).toBe(1)
    // Not steered toward the destructive workaround for a repo that exists.
    expect(result.stderr).not.toContain('--hash-only')
    expect(result.stderr).toContain('Failed to check whether')
    expect(result.stderr).toContain('git: fatal: Expected git repo version')
  })

  test('a list file missing from the working tree warns and the run continues', async () => {
    repo = await setupRepo()

    // A second deck, committed and then deleted locally without committing:
    // it is in the diff range but absent from the working tree.
    const goneDeck = path.join(repo.dir, 'decks', 'gone-deck.md')
    await fs.writeFile(goneDeck, DECK_BEFORE)
    // Hand-edit the surviving deck in the same commit so there is real work
    // that must not be abandoned by the missing file.
    await fs.writeFile(repo.deckPath, DECK_AFTER)
    const before = commitAll(repo.dir, 'add second deck and hand-edit the first')
    await fs.rm(goneDeck)

    const result = await runCli(['detect-changes', `${before}~1`, '--output', 'json'], repo.dir)

    // Partial run: the missing file is a warning and the exit code is nonzero…
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('gone-deck.md')
    expect(result.stderr).toContain('missing from the working tree')
    expect(result.stderr).not.toContain('ENOENT')

    // …and the payload carries the same warning, tagged as a skipped file.
    const report = JSON.parse(result.stdout) as ParsedDetectChangesReport
    expect(report.warnings).toEqual([
      {
        kind: 'missing-file',
        file: 'decks/gone-deck.md',
        message:
          'skipped decks/gone-deck.md: changed in the range but missing from the working tree',
      },
    ])

    // …but the other file's changelog was still written.
    const changelog = await fs.readFile(repo.deckPath.replace(/\.md$/, '.changes.md'), 'utf-8')
    expect(changelog).toContain('Removed "Lightning Bolt"')
  })

  test('an unreadable card line is a parse warning that does not fail the run', async () => {
    repo = await setupRepo()

    await fs.writeFile(repo.deckPath, `${DECK_AFTER}this line is not a card\n`)
    commitAll(repo.dir, 'hand edit with a malformed line')

    const result = await runCli(
      ['detect-changes', repo.before, '--output', 'json', '--dry-run'],
      repo.dir,
    )

    // A skipped line still leaves a complete diff for the file: exit 0.
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('Skipped malformed line: this line is not a card')

    const report = JSON.parse(result.stdout) as ParsedDetectChangesReport
    expect(report.warnings).toEqual([
      {
        kind: 'parse',
        file: 'decks/test-deck.md',
        revision: 'working-tree',
        message: 'decks/test-deck.md: Skipped malformed line: this line is not a card',
      },
    ])
    // The rest of the file was still diffed.
    expect(report.changelogsUpdated).toBe(1)
  })
})

// ── Mode: --hash-only ────────────────────────────────────────────────

/** The parsed shape of the `--hash-only --output json` payload. */
type ParsedHashOnlyReport = {
  mode: string
  dryRun: boolean
  stamped: { file: string; priorState: string; hash: string }[]
  unrecordedEdits: number
}

describe('detect-changes --hash-only', () => {
  test('stamps list files (never primers), warning about the edits it forfeits', async () => {
    repo = await setupRepo()

    // A hand edit that Ritual never recorded: the sidecar still holds
    // DECK_BEFORE's hash.
    await fs.writeFile(repo.deckPath, DECK_AFTER)
    // A deck primer sidecar must never be treated as a list file.
    const primerPath = repo.deckPath.replace(/\.md$/, '.primer.md')
    await fs.writeFile(primerPath, '# How to play\n')

    // `--quiet` proves the data-loss warning is essential: it prints anyway.
    const result = await runCli(['detect-changes', '--hash-only', '--quiet'], repo.dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('stamped 1 file with unrecorded edits')
    expect(result.stderr).toContain('will not receive changelog entries')
    expect(result.stderr).toContain(path.join('decks', 'test-deck.md'))

    // The sidecar now matches the hand-edited content…
    expect(await loadHash(repo.deckPath)).toBe(computeHash(DECK_AFTER))
    // …and the primer got no sidecar of its own.
    expect(await fileExists(`${primerPath}.sha256`)).toBe(false)
  })

  test('text mode prints each stamped file with the hash it wrote, then a count', async () => {
    repo = await setupRepo()

    const result = await runCli(['detect-changes', '--hash-only'], repo.dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      `${path.join('decks', 'test-deck.md')}: ${computeHash(DECK_BEFORE)}`,
    )
    expect(result.stdout).toContain('Stamped 1 file.')
    // Nothing drifted, so there is no data-loss warning.
    expect(result.stderr).toBe('')
  })

  test('with no list files it says so instead of reporting a stamp', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['detect-changes', '--hash-only'], dir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('No list files found.')
      expect(result.stdout).not.toContain('Stamped')
    })
  })

  test('--output json reports each stamped file with its pre-run sidecar state', async () => {
    repo = await setupRepo()
    await fs.writeFile(repo.deckPath, DECK_AFTER)

    const result = await runCli(
      ['detect-changes', '--hash-only', '--output', 'json', '--dry-run'],
      repo.dir,
    )
    expect(result.exitCode).toBe(0)

    const report = JSON.parse(result.stdout) as ParsedHashOnlyReport
    expect(report.mode).toBe('hash-only')
    expect(report.dryRun).toBe(true)
    expect(report.unrecordedEdits).toBe(1)
    expect(report.stamped).toEqual([
      {
        file: path.join('decks', 'test-deck.md'),
        priorState: 'diverged',
        hash: computeHash(DECK_AFTER),
      },
    ])

    // A preview says it *would* stamp — it must never claim it already did.
    expect(result.stderr).toContain('would stamp 1 file with unrecorded edits')
    expect(result.stderr).not.toContain('stamped 1 file with unrecorded edits')

    // A dry run writes nothing: the sidecar still holds the pre-edit hash.
    expect(await loadHash(repo.deckPath)).toBe(computeHash(DECK_BEFORE))
  })

  test('dry-run text mode marks every line as a preview', async () => {
    repo = await setupRepo()

    const result = await runCli(['detect-changes', '--hash-only', '--dry-run'], repo.dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`[dry-run] ${path.join('decks', 'test-deck.md')}: `)
    expect(result.stdout).toContain('Would stamp 1 file.')
  })
})

// ── Mode: --verify ───────────────────────────────────────────────────

/** The parsed shape of the `--verify --output json` payload. */
type ParsedVerifyReport = {
  mode: string
  files: { file: string; state: string; hash: string }[]
  clean: number
  diverged: number
  missing: number
}

describe('detect-changes --verify', () => {
  test('exits 0 and reports every file clean when no list has drifted', async () => {
    repo = await setupRepo()

    const result = await runCli(['detect-changes', '--verify'], repo.dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`${path.join('decks', 'test-deck.md')}: clean`)
    expect(result.stdout).toContain('1 file: 1 clean, 0 diverged, 0 without a sidecar.')
    // Nothing drifted, so the remedy line stays out of the way.
    expect(result.stdout).not.toContain('--hash-only')
  })

  test('exits 1 on drift, names each state, and writes nothing', async () => {
    repo = await setupRepo()

    // One diverged file (stale sidecar) and one that never had a sidecar.
    await fs.writeFile(repo.deckPath, DECK_AFTER)
    const unstamped = path.join(repo.dir, 'decks', 'unstamped.md')
    await fs.writeFile(unstamped, DECK_BEFORE)

    const result = await runCli(['detect-changes', '--verify', '--output', 'json'], repo.dir)
    expect(result.exitCode).toBe(1)

    const report = JSON.parse(result.stdout) as ParsedVerifyReport
    expect(report.mode).toBe('verify')
    expect(report.clean).toBe(0)
    expect(report.diverged).toBe(1)
    expect(report.missing).toBe(1)
    // Each state tied to its own file, not asserted positionally.
    expect(report.files).toEqual([
      {
        file: path.join('decks', 'test-deck.md'),
        state: 'diverged',
        hash: computeHash(DECK_AFTER),
      },
      {
        file: path.join('decks', 'unstamped.md'),
        state: 'missing',
        hash: computeHash(DECK_BEFORE),
      },
    ])

    // Verify never writes: the stale sidecar stays stale, the missing one
    // stays missing.
    expect(await loadHash(repo.deckPath)).toBe(computeHash(DECK_BEFORE))
    expect(await fileExists(`${unstamped}.sha256`)).toBe(false)
  })

  test('text mode on drift names the two ways to resolve it', async () => {
    repo = await setupRepo()
    await fs.writeFile(repo.deckPath, DECK_AFTER)

    const result = await runCli(['detect-changes', '--verify'], repo.dir)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain(`${path.join('decks', 'test-deck.md')}: diverged`)
    expect(result.stdout).toContain('1 file: 0 clean, 1 diverged, 0 without a sidecar.')
    expect(result.stdout).toContain('to record these edits in changelogs')
    expect(result.stdout).toContain('--hash-only')
  })
})

// ── Mode selection ───────────────────────────────────────────────────

describe('detect-changes mode conflicts', () => {
  test('--hash-only with --verify is a usage error (exit 2) that writes nothing', async () => {
    repo = await setupRepo()

    // Hand-edit first, so a stray stamp would be observable: a rejected run
    // must leave the sidecar holding the pre-edit hash.
    await fs.writeFile(repo.deckPath, DECK_AFTER)

    const result = await runCli(['detect-changes', '--hash-only', '--verify'], repo.dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--hash-only and --verify cannot be combined.')
    expect(result.stdout).toBe('')
    expect(await loadHash(repo.deckPath)).toBe(computeHash(DECK_BEFORE))
  })
})
