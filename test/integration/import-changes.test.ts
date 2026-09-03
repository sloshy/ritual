import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import { cardCache } from '../../src/cache'
import { getBaseDir, setBaseDir } from '../../src/config/base-dir'
import { getDefaultRitualConfig } from '../../src/config/ritual-config'
import { applyChangeBundle } from '../../src/admin/api/import-changes'
import { parseChangeBundle, type ChangeBundle } from '../../src/changes/change-bundle'
import { runCli, withTempDir } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import {
  bindWorkspace,
  initGitRepo,
  writeCollectionFile,
  writeConfig,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from '../helpers/workspace'

const BUNDLE = {
  format: 'ritual-change-bundle',
  version: 2,
  exportedAt: '2026-06-04T00:00:00.000Z',
  moves: [],
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
    name: 'Test Deck',
    frontMatter: { format: 'commander' },
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

  test('names a finish the target card has no printing for, rather than "card not found"', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      // `1 Lightning Bolt &1` pins no printing, so a foil token has nothing to
      // describe — but the card is right there, and saying "not found" would
      // send the user hunting for it.
      const bundle = {
        format: 'ritual-change-bundle',
        version: 2,
        exportedAt: '2026-06-04T00:00:00.000Z',
        moves: [],
        lists: [
          {
            kind: 'deck',
            slug: 'test-deck',
            name: 'Test Deck',
            changes: [
              {
                id: 'f1',
                timestamp: 1,
                action: 'set-finish',
                cardName: 'Lightning Bolt',
                cardId: 1,
                finish: 'foil',
              },
            ],
          },
        ],
      }
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(bundle, null, 2))

      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir)
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('Skipped (card has no printing for that finish)')
      expect(result.stderr).not.toContain('card not found')

      const quiet = await runCli(['import-changes', 'edits.json', '--yes', '--quiet'], dir)
      expect(quiet.stderr).toContain(
        'Test Deck: 1 change skipped (card has no printing for that finish: 1)',
      )
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

  test('a pinning move converts the name-only line and writes the replacement back to the source', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      await writeCollectionFile(dir, 'binder', {
        entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
      })
      const bundle = {
        ...BUNDLE,
        lists: [{ kind: 'deck', slug: 'test-deck', name: 'Test Deck', changes: [] }],
        moves: [
          {
            id: 'pin',
            timestamp: 1,
            cardName: 'Lightning Bolt',
            from: { kind: 'collection', slug: 'binder', name: 'binder' },
            to: { kind: 'deck', slug: 'test-deck', name: 'Test Deck' },
            set: 'lea',
            collectorNumber: '161',
            cardId: 1,
            toCardId: 1,
            pinsCardId: 1,
            replacement: { set: 'm10', collectorNumber: '146' },
          },
        ],
      }
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(bundle))

      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir)
      expect(result.exitCode).toBe(0)
      // The preview names the replacement going back to the source.
      expect(result.stdout).toContain('replacing the copy taken')

      const deck = await fs.readFile(path.join(dir, 'decks', 'test-deck.md'), 'utf-8')
      expect(deck).toMatch(/1 Lightning Bolt \(LEA:161\) &1/)
      const binder = await fs.readFile(path.join(dir, 'collections', 'binder.md'), 'utf-8')
      expect(binder).not.toContain('LEA:161')
      expect(binder).toMatch(/Lightning Bolt \(M10:146\) &1/)
      const binderLog = await fs.readFile(
        path.join(dir, 'collections', 'binder.changes.md'),
        'utf-8',
      )
      expect(binderLog).toMatch(/Added "Lightning Bolt" \(M10:146\) &1/)
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
        name: 'Test Deck',
        frontMatter: { format: 'commander' },
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
        name: 'Test Deck',
        frontMatter: { format: 'commander' },
        cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
      })
      await cardCache.bulkSet({})
      initGitRepo(ws.dir)
      execSync('git add -A', { cwd: ws.dir })
      execSync('git commit -q -m baseline', { cwd: ws.dir })

      const bundle = parseChangeBundle(
        JSON.stringify({
          format: 'ritual-change-bundle',
          version: 2,
          exportedAt: '2026-06-04T00:00:00.000Z',
          moves: [],
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
        name: 'Test Deck',
        frontMatter: { format: 'commander' },
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
          version: 2,
          exportedAt: '2026-06-04T00:00:00.000Z',
          moves: [],
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

  test('previews the moves block and applies a move to both lists through the CLI', async () => {
    await withTempDir(async (dir) => {
      await seedWorkspace(dir)
      await writeCollectionFile(dir, 'binder', {
        title: 'Binder',
        entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
      })
      const bundle = {
        ...BUNDLE,
        lists: [],
        moves: [
          {
            id: 'm1',
            timestamp: 1,
            cardName: 'Sol Ring',
            from: { kind: 'collection', slug: 'binder', name: 'Binder' },
            to: { kind: 'deck', slug: 'test-deck', name: 'Test Deck' },
            set: 'c21',
            collectorNumber: '263',
            cardId: 1,
          },
        ],
      }
      await fs.writeFile(path.join(dir, 'edits.json'), JSON.stringify(bundle))

      const result = await runCli(['import-changes', 'edits.json', '--yes'], dir)

      // Exit 0 (not 3, "no changes"): the move alone counts toward the bundle's total.
      expect(result.exitCode).toBe(0)
      // The preview's own block for moves, naming both ends; the count includes it.
      expect(result.stdout).toContain('Moves between lists — 1 move')
      expect(result.stdout).toContain(
        "Move Sol Ring (C21:263) &1 to Deck 'Test Deck' (from Collection 'Binder')",
      )
      expect(result.stdout).toContain('Test Deck: applied 1 change')

      const deck = await fs.readFile(path.join(dir, 'decks', 'test-deck.md'), 'utf-8')
      expect(deck).toMatch(/1 Sol Ring \(C21:263\) &\d+/)
      // Both sides written; the changelog wording is pinned by the engine tests below.
      const binder = await fs.readFile(path.join(dir, 'collections', 'binder.md'), 'utf-8')
      expect(binder).not.toContain('Sol Ring')
    })
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

/** A v2 bundle from its lists and moves, parsed through the real validator. */
function bundleOf(lists: unknown[], moves: unknown[]): ChangeBundle {
  const bundle = parseChangeBundle(
    JSON.stringify({
      format: 'ritual-change-bundle',
      version: 2,
      exportedAt: '2026-06-04T00:00:00.000Z',
      lists,
      moves,
    }),
  )
  if (typeof bundle === 'string') throw new Error(`invalid fixture bundle: ${bundle}`)
  return bundle
}

const DECK_REF = { kind: 'deck', slug: 'test-deck', name: 'Test Deck' }
const BINDER_REF = { kind: 'collection', slug: 'binder', name: 'Binder' }

describe('applyChangeBundle with moves', () => {
  let ws: BoundWorkspace
  beforeEach(async () => {
    ws = await bindWorkspace({ config: false })
    await cardCache.bulkSet({})
  })
  afterEach(async () => {
    await ws.dispose()
  })

  const SWAP_MOVES = [
    {
      id: 'm1',
      timestamp: 1,
      cardName: 'Sol Ring',
      from: DECK_REF,
      to: BINDER_REF,
      set: 'c19',
      collectorNumber: '221',
      cardId: 1,
    },
    {
      id: 'm2',
      timestamp: 2,
      cardName: 'Sol Ring',
      from: BINDER_REF,
      to: DECK_REF,
      set: 'c21',
      collectorNumber: '263',
      cardId: 1,
    },
  ]

  test('a move carries its tags onto the destination line', async () => {
    await writeDeckFile(ws.dir, 'test-deck', {
      name: 'Test Deck',
      cards: [
        {
          quantity: 1,
          name: 'Sol Ring',
          set: 'c19',
          collectorNumber: '221',
          cardId: 1,
          tags: ['Ramp'],
        },
      ],
    })
    await writeCollectionFile(ws.dir, 'binder', { title: 'Binder', entries: [] })

    const result = await applyChangeBundle(
      bundleOf([], [{ ...SWAP_MOVES[0]!, tags: ['Ramp', 'Card Draw'] }]),
    )
    expect(result.failedCount).toBe(0)
    const deck = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(deck).not.toContain('C19:221')
    const binder = await fs.readFile(path.join(ws.dir, 'collections', 'binder.md'), 'utf-8')
    expect(binder).toMatch(/Sol Ring \(C19:221\) #Card Draw, Ramp &\d+/)
  }, 60_000)

  test('a tagged copy moved into a deck folds onto the same-tagged line, and the changelog names it', async () => {
    // The `add` twin of this test is pinned above; a `move-to` carries tags
    // too, so the id re-target's merge probe must see them or it rewrites the
    // changelog to the plain sibling the reducer never merged onto.
    await writeDeckFile(ws.dir, 'test-deck', {
      name: 'Test Deck',
      cards: [
        {
          quantity: 1,
          name: 'Sol Ring',
          set: 'c21',
          collectorNumber: '263',
          tags: ['ramp'],
          cardId: 7,
        },
        { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 9 },
      ],
    })
    await writeCollectionFile(ws.dir, 'binder', {
      title: 'Binder',
      entries: [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', tags: ['ramp'], cardId: 1 },
      ],
    })
    const result = await applyChangeBundle(
      bundleOf([], [{ ...SWAP_MOVES[1]!, tags: ['ramp'], toCardId: 50 }]),
    )
    expect(result.failedCount).toBe(0)
    const deck = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(deck).toMatch(/2 Sol Ring \(C21:263\) #ramp &7/)
    expect(deck).toMatch(/1 Sol Ring \(C21:263\) &9/)
    const deckLog = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.changes.md'), 'utf-8')
    expect(deckLog).toMatch(/Moved "Sol Ring" \(C21:263\) &7/)
    expect(deckLog).not.toMatch(/&9/)
  }, 60_000)

  test('a two-move swap round-trips both files and both changelogs', async () => {
    await writeDeckFile(ws.dir, 'test-deck', {
      name: 'Test Deck',
      cards: [{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }],
    })
    await writeCollectionFile(ws.dir, 'binder', {
      title: 'Binder',
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
    })

    // The wizard's output: the deck's copy goes to the binder and the
    // binder's copy comes back — one move per physical copy, each applied
    // on its destination, whose save takes the copy out of the source.
    const result = await applyChangeBundle(bundleOf([], SWAP_MOVES))
    expect(result.failedCount).toBe(0)
    // Targets appear in move order (each move's source, then destination), not list order.
    expect(result.lists.map((l) => [l.name, l.applied, l.conflicts.length])).toEqual([
      ['Test Deck', 1, 0],
      ['Binder', 1, 0],
    ])

    const deck = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(deck).toMatch(/1 Sol Ring \(C21:263\) &\d+/)
    expect(deck).not.toContain('C19:221')
    const binder = await fs.readFile(path.join(ws.dir, 'collections', 'binder.md'), 'utf-8')
    expect(binder).toMatch(/Sol Ring \(C19:221\) &\d+/)
    expect(binder).not.toContain('C21:263')

    const deckLog = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.changes.md'), 'utf-8')
    expect(deckLog).toMatch(/Moved "Sol Ring" \(C19:221\).*to Collection 'Binder'/)
    expect(deckLog).toMatch(/Moved "Sol Ring" \(C21:263\).*from Collection 'Binder'/)
    const binderLog = await fs.readFile(
      path.join(ws.dir, 'collections', 'binder.changes.md'),
      'utf-8',
    )
    expect(binderLog).toMatch(/Moved "Sol Ring" \(C19:221\).*from Deck 'Test Deck'/)
    expect(binderLog).toMatch(/Moved "Sol Ring" \(C21:263\).*to Deck 'Test Deck'/)
  }, 60_000)

  test('a move whose source no longer holds the copy fails its destination’s batch, writing nothing', async () => {
    await writeDeckFile(ws.dir, 'test-deck', {
      name: 'Test Deck',
      cards: [{ quantity: 1, name: 'Lightning Bolt', cardId: 1 }],
    })
    await writeCollectionFile(ws.dir, 'binder', { title: 'Binder', entries: [] })
    const deckBefore = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.md'), 'utf-8')

    // The second move claims the binder's Sol Ring, which the binder never had.
    const result = await applyChangeBundle(bundleOf([], [SWAP_MOVES[1]!]))
    expect(result.failedCount).toBe(1)
    // The source (binder) is listed with nothing applied; the destination failed.
    expect(result.lists.map((l) => [l.name, l.applied, l.error === undefined])).toEqual([
      ['Binder', 0, true],
      ['Test Deck', 0, false],
    ])
    expect(result.lists[1]!.error).toContain('no matching copy')

    expect(await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.md'), 'utf-8')).toBe(deckBefore)
    expect(await Bun.file(path.join(ws.dir, 'decks', 'test-deck.changes.md')).exists()).toBeFalse()
  }, 60_000)

  test('an edit in a later batch finds the copy an earlier batch moved in, through the exported destination id', async () => {
    await writeDeckFile(ws.dir, 'test-deck', {
      name: 'Test Deck',
      cards: [{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }],
    })
    await writeCollectionFile(ws.dir, 'binder', {
      title: 'Binder',
      entries: [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
        { name: 'Counterspell', set: 'lea', collectorNumber: '55', cardId: 2 },
      ],
    })

    // Deck batch (the move), binder batch (a removal), deck batch again (the
    // set-finish on the moved-in copy, by the browser's id for it): the deck
    // is loaded fresh for the third batch and holds two Sol Rings by then.
    const result = await applyChangeBundle(
      bundleOf(
        [
          {
            ...DECK_REF,
            changes: [
              {
                id: 'f1',
                timestamp: 3,
                action: 'set-finish',
                cardName: 'Sol Ring',
                cardId: 7,
                finish: 'foil',
              },
            ],
          },
          {
            ...BINDER_REF,
            changes: [
              { id: 'r1', timestamp: 2, action: 'remove', cardName: 'Counterspell', cardId: 2 },
            ],
          },
        ],
        [{ ...SWAP_MOVES[1]!, timestamp: 1, toCardId: 7 }],
      ),
    )
    expect(result.failedCount).toBe(0)
    expect(result.lists).toMatchObject([
      { name: 'Test Deck', applied: 2, conflicts: [] },
      { name: 'Binder', applied: 1, conflicts: [] },
    ])
    const deck = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(deck).toMatch(/1 Sol Ring \(C19:221\) &1/)
    expect(deck).toMatch(/1 Sol Ring \(C21:263\) \[foil\] &\d+/)
  }, 60_000)

  test('same-tuple copies moved into a deck share one line, and its id, in the changelog', async () => {
    await writeDeckFile(ws.dir, 'test-deck', {
      name: 'Test Deck',
      cards: [{ quantity: 1, name: 'Lightning Bolt', cardId: 1 }],
    })
    await writeCollectionFile(ws.dir, 'binder', {
      title: 'Binder',
      entries: [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 2 },
      ],
    })
    // No destination id on either move: each is allocated a fresh id, and the
    // deck reducer folds the second onto the first line — the changelog must
    // name that line, not a phantom `&3`.
    const result = await applyChangeBundle(
      bundleOf(
        [],
        [
          { ...SWAP_MOVES[1]!, id: 'm1', timestamp: 1, cardId: 1 },
          { ...SWAP_MOVES[1]!, id: 'm2', timestamp: 2, cardId: 2 },
        ],
      ),
    )
    expect(result.failedCount).toBe(0)
    expect(result.lists.map((l) => [l.name, l.applied])).toEqual([
      ['Binder', 0],
      ['Test Deck', 2],
    ])
    const deck = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(deck).toMatch(/2 Sol Ring \(C21:263\) &2/)
    const deckLog = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.changes.md'), 'utf-8')
    expect(
      deckLog.match(/Moved "Sol Ring" \(C21:263\) &2 .*from Collection 'Binder'/g),
    ).toHaveLength(2)
    expect(deckLog).not.toContain('&3')
  }, 60_000)

  test('a [proxy] copy added to a deck folds onto the [proxy] line, and the changelog names that line', async () => {
    await writeDeckFile(ws.dir, 'test-deck', {
      name: 'Test Deck',
      cards: [
        {
          quantity: 1,
          name: 'Sol Ring',
          set: 'c21',
          collectorNumber: '263',
          labels: ['proxy'],
          cardId: 7,
        },
        { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 9 },
      ],
    })
    const result = await applyChangeBundle(
      bundleOf(
        [
          {
            ...DECK_REF,
            changes: [
              {
                id: 'a1',
                timestamp: 1,
                action: 'add',
                cardName: 'Sol Ring',
                set: 'c21',
                collectorNumber: '263',
                labels: ['proxy'],
                cardId: 50,
              },
            ],
          },
        ],
        [],
      ),
    )
    expect(result.failedCount).toBe(0)
    const deck = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(deck).toMatch(/2 Sol Ring \(C21:263\) \[proxy\] &7/)
    expect(deck).toMatch(/1 Sol Ring \(C21:263\) &9/)
    const deckLog = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.changes.md'), 'utf-8')
    // The re-target allocated a phantom id (the pool's smallest free, &1); the
    // merge probe — labels included — rewrote it to the [proxy] line's &7.
    expect(deckLog).toMatch(/Added "Sol Ring" \(C21:263\) &7/)
    expect(deckLog).not.toMatch(/&1\b/)
    expect(deckLog).not.toMatch(/&9/)
  }, 60_000)

  test('a #tagged copy added to a deck folds onto the same-tagged line, never its plain sibling', async () => {
    await writeDeckFile(ws.dir, 'test-deck', {
      name: 'Test Deck',
      cards: [
        {
          quantity: 1,
          name: 'Sol Ring',
          set: 'c21',
          collectorNumber: '263',
          tags: ['ramp'],
          cardId: 7,
        },
        { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 9 },
      ],
    })
    const result = await applyChangeBundle(
      bundleOf(
        [
          {
            ...DECK_REF,
            changes: [
              {
                id: 'a1',
                timestamp: 1,
                action: 'add',
                cardName: 'Sol Ring',
                set: 'c21',
                collectorNumber: '263',
                tags: ['ramp'],
                cardId: 50,
              },
            ],
          },
        ],
        [],
      ),
    )
    expect(result.failedCount).toBe(0)
    const deck = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(deck).toMatch(/2 Sol Ring \(C21:263\) #ramp &7/)
    expect(deck).toMatch(/1 Sol Ring \(C21:263\) &9/)
    const deckLog = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.changes.md'), 'utf-8')
    // The merge probe includes tags, so the phantom id was rewritten to &7.
    expect(deckLog).toMatch(/Added "Sol Ring" \(C21:263\) &7/)
    expect(deckLog).not.toMatch(/&1\b/)
    expect(deckLog).not.toMatch(/&9/)
  }, 60_000)

  test('a move applies before a later edit on the copy it brought in, in timestamp order', async () => {
    await writeDeckFile(ws.dir, 'test-deck', {
      name: 'Test Deck',
      cards: [{ quantity: 1, name: 'Lightning Bolt', cardId: 1 }],
    })
    await writeCollectionFile(ws.dir, 'binder', {
      title: 'Binder',
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
    })

    // The set-finish is listed in the deck's own changes and stamped after
    // the move; the browser's id for the new copy (7) means nothing here, so
    // it can only resolve by name against the line the move just created.
    const result = await applyChangeBundle(
      bundleOf(
        [
          {
            ...DECK_REF,
            changes: [
              {
                id: 'f1',
                timestamp: 2,
                action: 'set-finish',
                cardName: 'Sol Ring',
                cardId: 7,
                finish: 'foil',
              },
            ],
          },
        ],
        [{ ...SWAP_MOVES[1]!, timestamp: 1 }],
      ),
    )
    expect(result.failedCount).toBe(0)
    expect(result.lists.map((l) => [l.name, l.applied, l.conflicts.length])).toEqual([
      ['Test Deck', 2, 0],
      ['Binder', 0, 0],
    ])

    const deck = await fs.readFile(path.join(ws.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(deck).toMatch(/1 Sol Ring \(C21:263\) \[foil\] &\d+/)
    const binder = await fs.readFile(path.join(ws.dir, 'collections', 'binder.md'), 'utf-8')
    expect(binder).not.toContain('Sol Ring')
  }, 60_000)
})
