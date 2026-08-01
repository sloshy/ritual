import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import { cardCache } from '../../src/cache'
import { getBaseDir, setBaseDir } from '../../src/base-dir'
import { getDefaultRitualConfig } from '../../src/ritual-config'
import { applyChangeBundle } from '../../src/admin/api/import-changes'
import { parseChangeBundle } from '../../src/editor/change-bundle'
import { runCli, withTempDir } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import {
  bindWorkspace,
  initGitRepo,
  writeCollectionFile,
  writeConfig,
  writeDeckFile,
  writeWantedFile,
} from './helpers/workspace'

const BUNDLE = {
  format: 'ritual-change-bundle',
  version: 1,
  exportedAt: '2026-06-04T00:00:00.000Z',
  lists: [
    {
      kind: 'deck',
      slug: 'test-deck',
      name: 'Test Deck',
      changes: [
        { id: 'a1', timestamp: 1, action: 'add', cardName: 'Counterspell' },
        { id: 'r1', timestamp: 2, action: 'remove', cardName: 'Lightning Bolt', cardId: 1 },
        { id: 'r2', timestamp: 3, action: 'remove', cardName: 'Not In Deck', cardId: 99 },
      ],
    },
    {
      kind: 'wanted',
      slug: 'wishlist',
      name: 'Wishlist',
      changes: [{ id: 'a2', timestamp: 4, action: 'add', cardName: 'Brainstorm' }],
    },
  ],
}

/**
 * Seed the workspace lists and mark the card cache freshly bulk-downloaded, so
 * the spawned binary's list loads fetch (at most) the few named cards from
 * Scryfall instead of triggering a full bulk download.
 */
async function seedWorkspace(dir: string): Promise<void> {
  await writeDeckFile(dir, 'test-deck', {
    frontMatter: { name: 'Test Deck', format: 'commander' },
    cards: [
      { quantity: 1, name: 'Lightning Bolt', cardId: 1 },
      { quantity: 1, name: 'Sol Ring', cardId: 2 },
    ],
  })
  await writeWantedFile(dir, 'wishlist', { title: 'Wishlist', entries: [] })

  const originalBase = getBaseDir()
  setBaseDir(dir)
  try {
    await cardCache.bulkSet({})
  } finally {
    setBaseDir(originalBase)
  }
}

describe('import-changes command (Integration)', () => {
  test('previews and applies a multi-list bundle with --yes, reporting conflicts', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      const bundlePath = path.join(dir, 'edits.json')
      await fs.writeFile(bundlePath, JSON.stringify(BUNDLE, null, 2))

      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir)

      expect(result.exitCode).toBe(0)
      // The preview lists every pending change grouped by target list.
      expect(result.stdout).toContain("Test Deck (deck 'test-deck') — 3 changes")
      expect(result.stdout).toContain('Add Counterspell')
      expect(result.stdout).toContain('Remove Lightning Bolt')
      expect(result.stdout).toContain("Wishlist (wanted list 'wishlist') — 1 change")
      // Applied counts plus the skipped conflict for the missing card.
      expect(result.stdout).toContain('applied 2 changes')
      expect(result.stdout).toContain('applied 1 change')
      // Skipped conflicts are a data-loss signal, so they go to stderr and
      // keep stdout the applied-counts report.
      expect(result.stderr).toContain('Skipped (card not found): Remove Not In Deck')

      const deck = await fs.readFile(path.join(dir, 'decks', 'test-deck.md'), 'utf-8')
      expect(deck).toMatch(/Counterspell &\d+/)
      expect(deck).not.toContain('Lightning Bolt')
      expect(deck).toContain('Sol Ring &2')

      const wanted = await fs.readFile(path.join(dir, 'wanted', 'wishlist.md'), 'utf-8')
      expect(wanted).toMatch(/Brainstorm &\d+/)

      // Each applied list gets a changelog entry.
      const deckLog = await fs.readFile(path.join(dir, 'decks', 'test-deck.changes.md'), 'utf-8')
      expect(deckLog).toContain('Counterspell')
    })
  }, 60_000)

  // `--quiet` drops the preview and the applied counts, but a skipped change is
  // data loss that nothing else reports and that does not move the exit code.
  test('--quiet keeps the skipped-conflict summary and names the real reason', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      const bundlePath = path.join(dir, 'edits.json')
      await fs.writeFile(bundlePath, JSON.stringify(BUNDLE, null, 2))

      const result = await runCli(['import-changes', 'edits.json', '--yes', '--quiet'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Test Deck: 1 change skipped (card not found: 1)')

      // The changes themselves still applied.
      const deck = await fs.readFile(path.join(dir, 'decks', 'test-deck.md'), 'utf-8')
      expect(deck).toMatch(/Counterspell &\d+/)
    })
  }, 60_000)

  // A conflict is not always "card not found": an action that can never apply
  // to the list's type must be reported as such, quiet or not.
  test('reports a not-applicable conflict with its own reason', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      await writeCollectionFile(dir, 'binder', {
        title: 'Binder',
        entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
      })
      const bundle = {
        ...BUNDLE,
        lists: [
          {
            kind: 'collection',
            slug: 'binder',
            name: 'Binder',
            changes: [
              { id: 'c1', timestamp: 1, action: 'set-commander', cardName: 'Sol Ring', cardId: 1 },
            ],
          },
        ],
      }
      const bundlePath = path.join(dir, 'edits.json')
      await fs.writeFile(bundlePath, JSON.stringify(bundle, null, 2))

      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir)
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('Skipped (not applicable to this list)')

      const quiet = await runCli(['import-changes', 'edits.json', '--yes', '--quiet'], dir)
      expect(quiet.stderr).toContain('Binder: 1 change skipped (not applicable to this list: 1)')
    })
  }, 60_000)

  test('exits non-zero when a list in the bundle does not exist, still applying the rest', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      const bundle = {
        ...BUNDLE,
        lists: [
          {
            kind: 'collection',
            slug: 'no-such-collection',
            name: 'Ghost',
            changes: [{ id: 'a1', timestamp: 1, action: 'add', cardName: 'Sol Ring' }],
          },
          BUNDLE.lists[1],
        ],
      }
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(bundle))

      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No collections found')
      const wanted = await fs.readFile(path.join(dir, 'wanted', 'wishlist.md'), 'utf-8')
      expect(wanted).toContain('Brainstorm')
    })
  }, 60_000)

  test('applies a public-site export whose slug is a slugified display name', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      // A collection file named after its display name, as on disk.
      await writeCollectionFile(dir, 'Red Binder', {
        entries: [
          { name: 'Sol Ring', set: 'c21', collectorNumber: '263', condition: 'NM', cardId: 1 },
        ],
      })

      // The public site exports the slug as a URL-slugified display name
      // ("Red Binder" -> "red-binder"), which is not the file basename.
      const bundle = {
        ...BUNDLE,
        lists: [
          {
            kind: 'collection',
            slug: 'red-binder',
            name: 'Red Binder',
            changes: [
              {
                id: 'r1',
                timestamp: 1,
                action: 'remove',
                cardName: 'Sol Ring',
                cardId: 1,
                set: 'c21',
                collectorNumber: '263',
              },
            ],
          },
        ],
      }
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(bundle))

      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).not.toContain('not found')
      expect(result.stdout).toContain('applied 1 change')

      const collection = await fs.readFile(path.join(dir, 'collections', 'Red Binder.md'), 'utf-8')
      expect(collection).not.toContain('Sol Ring')
    })
  }, 60_000)

  test('rejects a file that is not a change bundle with a usage error', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'nope.json'), '{"format":"other"}')
      const result = await runCli(['import-changes', 'nope.json', '--yes'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Invalid change bundle')
    })
  })

  test('reports a missing file with a readable error and exit code 3', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['import-changes', 'absent.json', '--yes'], dir)
      expect(result.exitCode).toBe(3)
      expect(result.stderr).toContain("Cannot read 'absent.json'")
    })
  })

  test('exits 3 when the bundle contains no changes to apply', async () => {
    await withTempDir(async (dir) => {
      const empty = { ...BUNDLE, lists: [] }
      await fs.writeFile(path.join(dir, 'empty.json'), JSON.stringify(empty))
      const result = await runCli(['import-changes', 'empty.json'], dir)
      expect(result.exitCode).toBe(3)
      expect(result.stderr).toContain('no changes to apply')
    })
  })

  test('--output json emits the admin-verbatim payload on stdout with no preview', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(BUNDLE))

      const result = await runCli(
        ['import-changes', 'edits.json', '--yes', '--output', 'json'],
        dir,
      )

      expect(result.exitCode).toBe(0)
      // stdout is pure JSON — the preview and per-list glyph lines are text-only.
      const report = JSON.parse(result.stdout)
      expect(report.success).toBe(true)
      expect(report.message).toBe('Applied 3 changes across 2 lists')
      expect(report.lists).toHaveLength(2)

      const [deck, wanted] = report.lists
      expect(deck).toMatchObject({ kind: 'deck', slug: 'test-deck', name: 'Test Deck', applied: 2 })
      expect(deck.conflicts).toHaveLength(1)
      expect(deck.conflicts[0].reason).toBe('target-not-found')
      expect(deck.conflicts[0].change.cardName).toBe('Not In Deck')
      expect(wanted).toMatchObject({ kind: 'wanted', slug: 'wishlist', applied: 1, conflicts: [] })

      // The apply really happened, same as text mode.
      const deckFile = await fs.readFile(path.join(dir, 'decks', 'test-deck.md'), 'utf-8')
      expect(deckFile).toMatch(/Counterspell &\d+/)
    })
  }, 60_000)

  test('--output json stays pure JSON on a cold cache with Scryfall unreachable', async () => {
    await withTempDir(async (dir) => {
      // No cache pre-warm and no network: the harshest conditions for stdout
      // purity, since anything the data layer decides to say must go to stderr.
      // The apply itself loads `?view=cards`, which does no Scryfall work at
      // all, so a run here should be silent — and stdout must still be nothing
      // but the payload.
      await writeDeckFile(dir, 'test-deck', {
        frontMatter: { name: 'Test Deck', format: 'commander' },
        cards: [],
      })
      const bundle = {
        ...BUNDLE,
        lists: [
          {
            kind: 'deck',
            slug: 'test-deck',
            name: 'Test Deck',
            changes: [{ id: 'a1', timestamp: 1, action: 'add', cardName: 'Counterspell' }],
          },
        ],
      }
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(bundle))

      const result = await runCli(
        ['import-changes', 'edits.json', '--yes', '--output', 'json'],
        dir,
        OFFLINE_ENV,
      )

      // Whatever the data layer said went to stderr, never to stdout.
      expect(result.stdout).not.toContain('Fetching')
      // And stdout carries the payload, entire: a chatter line prepended to it
      // would make this parse throw.
      const report = JSON.parse(result.stdout)
      expect(report).toMatchObject({ success: true })
      expect(report.lists[0]).toMatchObject({ kind: 'deck', slug: 'test-deck', applied: 1 })
    })
  }, 240_000)

  test('--output json without --yes emits a structured usage error and applies nothing', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(BUNDLE))

      const result = await runCli(['import-changes', 'edits.json', '--output', 'json'], dir)

      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
      const envelope = JSON.parse(result.stderr)
      expect(envelope.error.code).toBe('usage_error')
      expect(envelope.error.message).toBe(
        'Confirmation required: pass --yes to apply changes non-interactively.',
      )
      // Nothing was applied: the target deck file was never created.
      expect(await Bun.file(path.join(dir, 'decks', 'test-deck.md')).exists()).toBeFalse()
    })
  })

  test('never creates git commits, even when admin git auto-commit is enabled', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      // A full, valid admin config with auto-commit enabled — the keys govern
      // the admin surfaces (web UI + MCP), never the CLI.
      const base = getDefaultRitualConfig()
      await writeConfig(dir, {
        admin: { ...base.admin, gitEnabled: true, gitAutoCommit: true, gitAutoPush: false },
      })
      initGitRepo(dir)
      execSync('git add -A', { cwd: dir })
      execSync('git commit -q -m baseline', { cwd: dir })
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(BUNDLE))

      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir)

      expect(result.exitCode).toBe(0)
      const deck = await fs.readFile(path.join(dir, 'decks', 'test-deck.md'), 'utf-8')
      expect(deck).toMatch(/Counterspell &\d+/)

      // The applied changes stay in the working tree: git log is unchanged and
      // the rewritten deck file is left uncommitted.
      const log = execSync('git log --pretty=%s', { cwd: dir, encoding: 'utf-8' }).trim()
      expect(log).toBe('baseline')
      const status = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8' })
      expect(status).toContain('decks/test-deck.md')
    })
  }, 60_000)

  test('the admin applyChangeBundle path auto-commits each saved list when enabled', async () => {
    const base = getDefaultRitualConfig()
    const ws = await bindWorkspace({
      config: {
        admin: { ...base.admin, gitEnabled: true, gitAutoCommit: true, gitAutoPush: false },
      },
    })
    try {
      await writeDeckFile(ws.dir, 'test-deck', {
        frontMatter: { name: 'Test Deck', format: 'commander' },
        cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
      })
      await cardCache.bulkSet({})
      initGitRepo(ws.dir)
      execSync('git add -A', { cwd: ws.dir })
      execSync('git commit -q -m baseline', { cwd: ws.dir })

      const bundle = parseChangeBundle(
        JSON.stringify({
          format: 'ritual-change-bundle',
          version: 1,
          exportedAt: '2026-06-04T00:00:00.000Z',
          lists: [
            {
              kind: 'deck',
              slug: 'test-deck',
              name: 'Test Deck',
              changes: [
                { id: 'r1', timestamp: 1, action: 'remove', cardName: 'Sol Ring', cardId: 1 },
              ],
            },
          ],
        }),
      )
      if (typeof bundle === 'string') throw new Error(`invalid fixture bundle: ${bundle}`)

      // Called directly (as the admin route and MCP tool do), with no CLI
      // suppression wrapper: the save handler's auto-commit must fire.
      const result = await applyChangeBundle(bundle)
      expect(result.failedCount).toBe(0)

      const subject = execSync('git log -1 --pretty=%s', { cwd: ws.dir, encoding: 'utf-8' }).trim()
      expect(subject).toBe('Edit deck: Test Deck (1 changes)')
      // The rewritten deck file was committed, not left as a working-tree change.
      const status = execSync('git status --porcelain', { cwd: ws.dir, encoding: 'utf-8' })
      expect(status).not.toContain('decks/test-deck.md')
    } finally {
      await ws.dispose()
    }
  }, 60_000)

  test('auto-commit targets the list directory git repo when it differs from the base dir repo', async () => {
    // Regression pin for autoCommitAndPush's dir consistency: the repo guard,
    // the commit, and the push must all run against the *list* directory, so a
    // decksDir configured inside a different git repo than the base dir gets
    // the commit — and the base dir's repo stays untouched.
    const base = getDefaultRitualConfig()
    const ws = await bindWorkspace({
      config: {
        decksDir: './deck-repo/decks',
        admin: { ...base.admin, gitEnabled: true, gitAutoCommit: true, gitAutoPush: false },
      },
      // Load the written config into the sync cache so getDecksDir() sees the
      // custom decksDir (the default bindWorkspace leaves defaults cached).
      init: true,
    })
    try {
      const deckRepo = path.join(ws.dir, 'deck-repo')
      await writeDeckFile(deckRepo, 'test-deck', {
        frontMatter: { name: 'Test Deck', format: 'commander' },
        cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
      })
      await cardCache.bulkSet({})

      // The deck dir lives in its own git repo, nested inside (but separate
      // from) the base dir's repo.
      initGitRepo(deckRepo)
      execSync('git add -A', { cwd: deckRepo })
      execSync('git commit -q -m deck-baseline', { cwd: deckRepo })
      initGitRepo(ws.dir)
      execSync('git add ritual.config.json', { cwd: ws.dir })
      execSync('git commit -q -m base-baseline', { cwd: ws.dir })

      const bundle = parseChangeBundle(
        JSON.stringify({
          format: 'ritual-change-bundle',
          version: 1,
          exportedAt: '2026-06-04T00:00:00.000Z',
          lists: [
            {
              kind: 'deck',
              slug: 'test-deck',
              name: 'Test Deck',
              changes: [
                { id: 'r1', timestamp: 1, action: 'remove', cardName: 'Sol Ring', cardId: 1 },
              ],
            },
          ],
        }),
      )
      if (typeof bundle === 'string') throw new Error(`invalid fixture bundle: ${bundle}`)

      const result = await applyChangeBundle(bundle)
      expect(result.failedCount).toBe(0)

      // The commit landed in the deck repo, covering the rewritten deck file...
      const subject = execSync('git log -1 --pretty=%s', {
        cwd: deckRepo,
        encoding: 'utf-8',
      }).trim()
      expect(subject).toBe('Edit deck: Test Deck (1 changes)')
      const deckStatus = execSync('git status --porcelain', { cwd: deckRepo, encoding: 'utf-8' })
      expect(deckStatus).not.toContain('decks/test-deck.md')
      // ...and the base dir's own repo history is untouched.
      const baseLog = execSync('git log --pretty=%s', { cwd: ws.dir, encoding: 'utf-8' }).trim()
      expect(baseLog).toBe('base-baseline')
    } finally {
      await ws.dispose()
    }
  }, 60_000)

  test('requires --yes when stdin is not a TTY instead of prompting', async () => {
    await withTempDir(async (dir) => {
      // runCli spawns the binary without a terminal on stdin, so the confirm
      // prompt cannot run; the command must refuse rather than hang or no-op.
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(BUNDLE))
      const result = await runCli(['import-changes', 'edits.json'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain(
        'Confirmation required: pass --yes to apply changes non-interactively.',
      )
      // Nothing was applied: the target deck file was never created.
      expect(await Bun.file(path.join(dir, 'decks', 'test-deck.md')).exists()).toBeFalse()
    })
  })
})
