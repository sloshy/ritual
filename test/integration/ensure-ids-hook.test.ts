import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { computeHash, hashPath } from '../../src/changes/content-hash'
import { ensureCardIdsForAllLists } from '../../src/list/ensure-card-ids'
import { ExitCode } from '../../src/util/errors'
import { runCli } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import { bindWorkspace, withWorkspace } from '../helpers/workspace'

/**
 * Pins the root preAction hook's wiring: index.ts hands `buildProgram` (src/cli/program.ts)
 * `shouldBackfillCardIds` as its backfill predicate (whose full decision matrix lives in
 * test/unit/id-backfill.test.ts) before running the file-writing card-ID
 * backfill, and the backfill never stamps a hand-edited file's `.sha256`
 * sidecar as Ritual-clean. The `--dry-run` skip is additionally pinned via
 * `cleanup --check` in test/integration/cleanup.test.ts.
 */

// Raw markdown, deliberately not the fixture serializer — it assigns card IDs,
// and these tests need an id-less line on disk.
const idlessDeck = '---\nname: Test Deck\n---\n\n## Main\n\n1 Sol Ring\n'
const backfilledDeck = '---\nname: Test Deck\n---\n\n## Main\n\n1 Sol Ring &1\n'

/** Fresh workspace with the id-less deck at decks/test.md; yields its path. */
async function withIdlessDeck(
  run: (deckPath: string, dir: string) => Promise<void>,
): Promise<void> {
  await withWorkspace(async (dir) => {
    const deckPath = path.join(dir, 'decks', 'test.md')
    await fs.writeFile(deckPath, idlessDeck)
    await run(deckPath, dir)
  })
}

describe('card-ID backfill preAction hook (Integration)', () => {
  // One representative per exempt command family. The asserted exit code
  // proves the invocation parsed and its action ran — i.e. the hook executed
  // and chose not to backfill, rather than the binary dying at parse time.
  type ExemptInvocation = { args: string[]; exitCode: number }
  const exemptInvocations: ExemptInvocation[] = [
    { args: ['lists'], exitCode: 0 },
    { args: ['list-all-cards'], exitCode: 0 },
    // Every detect-changes mode is exempt: it must see the tree as committed.
    { args: ['detect-changes', '--hash-only', '--quiet'], exitCode: 0 },
    // --verify exits 1 on drift; the id-less deck has no sidecar at all.
    { args: ['detect-changes', '--verify', '--quiet'], exitCode: ExitCode.RuntimeError },
    { args: ['get-primer', 'no-such-deck'], exitCode: ExitCode.NotFound },
    { args: ['rename', 'no-such-list', 'new-name'], exitCode: ExitCode.NotFound },
    // A subcommand whose leaf name is not the allowlist entry: `deck-sync
    // pull/push` backfill, `deck-sync status` must not.
    { args: ['deck-sync', 'status'], exitCode: 0 },
  ]

  for (const { args, exitCode } of exemptInvocations) {
    test(`\`${args.join(' ')}\` leaves an id-less list untouched`, async () => {
      await withIdlessDeck(async (deckPath, dir) => {
        const result = await runCli(args, dir)
        expect(result.exitCode).toBe(exitCode)
        expect(await fs.readFile(deckPath, 'utf-8')).toBe(idlessDeck)
      })
    })
  }

  test('an allowlisted command backfills ids (without stamping the sidecar) before its action runs', async () => {
    await withIdlessDeck(async (deckPath, dir) => {
      // `note` is in the allowlist; resolving a missing list fails the action
      // fast, after the hook already ran.
      const result = await runCli(['note', 'no-such-list', 'Sol Ring', '--clear'], dir)
      expect(result.exitCode).toBe(ExitCode.NotFound)
      expect(await fs.readFile(deckPath, 'utf-8')).toBe(backfilledDeck)
      // No sidecar existed, so the file is a hand edit Ritual hasn't recorded —
      // stamping it here would suppress detect-changes.
      expect(await Bun.file(hashPath(deckPath)).exists()).toBe(false)
    })
  })

  test('a subcommand is matched by its qualified `<parent> <leaf>` name', async () => {
    // `deck-sync pull` is allowlisted as the pair, not as the leaf `pull`; the
    // run then fails on the missing login, which is proof the action ran.
    await withIdlessDeck(async (deckPath, dir) => {
      const result = await runCli(['deck-sync', 'pull'], dir, OFFLINE_ENV)
      expect(result.exitCode).toBe(ExitCode.RuntimeError)
      expect(await fs.readFile(deckPath, 'utf-8')).toBe(backfilledDeck)
    })
  })

  test('`history --show` is read-only: the backfill is skipped', async () => {
    await withIdlessDeck(async (deckPath, dir) => {
      const result = await runCli(['history', 'no-such-list', '--show'], dir)
      expect(result.exitCode).toBe(ExitCode.NotFound)
      expect(await fs.readFile(deckPath, 'utf-8')).toBe(idlessDeck)
    })
  })

  test('a dry run skips the backfill', async () => {
    await withIdlessDeck(async (deckPath, dir) => {
      const result = await runCli(['cleanup', '--dry-run', '--skip-formats'], dir)
      expect(result.exitCode).toBe(0)
      expect(await fs.readFile(deckPath, 'utf-8')).toBe(idlessDeck)
    })
  })

  test('`serve` skips the backfill unless --build or --api makes it read list files', async () => {
    await withIdlessDeck(async (deckPath, dir) => {
      // Without --build, serve only serves a prebuilt dist/ and must not
      // write. The stderr assertion proves the rejection came from the action
      // (after the hook ran and skipped), not from a parse error.
      const plain = await runCli(['serve', '--refresh', 'never'], dir)
      expect(plain.exitCode).toBe(ExitCode.UsageError)
      expect(plain.stderr).toContain('only applies when building')
      expect(await fs.readFile(deckPath, 'utf-8')).toBe(idlessDeck)

      // With --api, the server reads list files live, so the hook backfills.
      // A build-only flag fails the action fast — after the hook ran, and
      // before --api's build-if-missing does any work.
      const api = await runCli(['serve', '--api', '--verbose'], dir)
      expect(api.exitCode).toBe(ExitCode.UsageError)
      expect(api.stderr).toContain('--verbose')
      expect(await fs.readFile(deckPath, 'utf-8')).toBe(backfilledDeck)
    })
  })

  test('`serve --build` backfills before the build runs', async () => {
    await withIdlessDeck(async (deckPath, dir) => {
      // An invalid --currencies value fails the build fast (before any
      // network or serving), so the process exits with the backfill on disk.
      const build = await runCli(['serve', '--build', '--currencies', 'bogus'], dir)
      expect(build.exitCode).toBe(ExitCode.UsageError)
      expect(build.stderr).toContain("Invalid currency 'bogus'")
      expect(await fs.readFile(deckPath, 'utf-8')).toBe(backfilledDeck)
    })
  })
})

describe('backfill sidecar handling (ensureCardIdsForAllLists)', () => {
  test('a hand-edited file (stale sidecar) gets ids but keeps the stale hash', async () => {
    const ws = await bindWorkspace({ init: true })
    try {
      const deckPath = path.join(ws.dir, 'decks', 'test.md')
      const ritualContent = '---\nname: Test Deck\n---\n\n## Main\n\n1 Mox Ruby &1\n'
      const staleHash = computeHash(ritualContent)
      await fs.writeFile(deckPath, ritualContent)
      await fs.writeFile(hashPath(deckPath), staleHash + '\n')
      // Hand-append an id-less line: the sidecar no longer matches the file.
      await fs.appendFile(deckPath, '1 Sol Ring\n')

      await ensureCardIdsForAllLists()

      expect(await fs.readFile(deckPath, 'utf-8')).toContain('1 Sol Ring &2')
      expect((await fs.readFile(hashPath(deckPath), 'utf-8')).trim()).toBe(staleHash)
    } finally {
      await ws.dispose()
    }
  })

  test('a Ritual-clean file (current sidecar) gets ids and a refreshed hash', async () => {
    const ws = await bindWorkspace({ init: true })
    try {
      const deckPath = path.join(ws.dir, 'decks', 'test.md')
      await fs.writeFile(deckPath, idlessDeck)
      await fs.writeFile(hashPath(deckPath), computeHash(idlessDeck) + '\n')

      await ensureCardIdsForAllLists()

      expect(await fs.readFile(deckPath, 'utf-8')).toBe(backfilledDeck)
      expect((await fs.readFile(hashPath(deckPath), 'utf-8')).trim()).toBe(
        computeHash(backfilledDeck),
      )
    } finally {
      await ws.dispose()
    }
  })

  test('a file with no sidecar gets ids and stays unstamped, across all three list types', async () => {
    const ws = await bindWorkspace({ init: true })
    try {
      const deckPath = path.join(ws.dir, 'decks', 'test.md')
      const collectionPath = path.join(ws.dir, 'collections', 'binder.md')
      const wantedPath = path.join(ws.dir, 'wanted', 'wants.md')
      await fs.writeFile(deckPath, idlessDeck)
      await fs.writeFile(collectionPath, '# Binder\n\n- Brainstorm (ICE:64)\n')
      await fs.writeFile(wantedPath, '# Wants\n\n- Demonic Tutor\n')

      await ensureCardIdsForAllLists()

      expect(await fs.readFile(deckPath, 'utf-8')).toBe(backfilledDeck)
      expect(await fs.readFile(collectionPath, 'utf-8')).toContain('- Brainstorm (ICE:64) &1')
      expect(await fs.readFile(wantedPath, 'utf-8')).toContain('- Demonic Tutor &1')
      for (const filePath of [deckPath, collectionPath, wantedPath]) {
        expect(await Bun.file(hashPath(filePath)).exists()).toBe(false)
      }
    } finally {
      await ws.dispose()
    }
  })
})
