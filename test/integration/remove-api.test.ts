import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { getDefaultRitualConfig } from '../../src/config/ritual-config'
import { handleRemoveCommit } from '../../src/admin/api/move'
import {
  bindWorkspace,
  initGitRepo,
  writeCollectionFile,
  writeConfig,
  writeWantedFile,
  type BoundWorkspace,
} from '../helpers/workspace'

/**
 * End-to-end coverage for the admin cross-list remove endpoint. The client
 * addresses cards by `{listType, listSlug, name, cardId, copyIndex}`; the handler
 * reconstructs the physical-card key from disk and removes the matching lines.
 */

let ws: BoundWorkspace
let tmpDir: string

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  tmpDir = ws.dir
})

afterEach(async () => {
  await ws.dispose()
})

/** One malformed request body the remove endpoint must reject with a 400. */
type InvalidRemoveBody = { label: string; body: unknown }

async function remove(
  removes: unknown[],
): Promise<{ success: boolean; removed: number; skipped: number }> {
  const req = new Request('http://localhost/api/remove/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removes }),
  })
  const resp = await handleRemoveCommit(req)
  return (await resp.json()) as { success: boolean; removed: number; skipped: number }
}

describe('remove API', () => {
  test('removes cards across two list types in one request', async () => {
    const binderPath = await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      entries: [
        { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', finish: 'foil', cardId: 1 },
        { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 2 },
      ],
    })
    const wishlistPath = await writeWantedFile(tmpDir, 'wishlist', {
      title: 'Wishlist',
      entries: [{ name: 'Mana Crypt', cardId: 1 }],
    })

    const result = await remove([
      {
        listType: 'collection',
        listSlug: 'binder',
        name: 'Lightning Bolt',
        cardId: 1,
        copyIndex: 0,
      },
      { listType: 'wanted', listSlug: 'wishlist', name: 'Mana Crypt', cardId: 1, copyIndex: 0 },
    ])
    expect(result.success).toBe(true)
    expect(result.removed).toBe(2)
    expect(result.skipped).toBe(0)

    const binder = await fs.readFile(binderPath, 'utf-8')
    expect(binder).not.toContain('Lightning Bolt')
    expect(binder).toContain('Sol Ring') // untouched

    expect(await fs.readFile(wishlistPath, 'utf-8')).not.toContain('Mana Crypt')

    // Every source list gets a .changes.md changelog recording the removal,
    // including the wanted list.
    const binderChanges = await fs.readFile(binderPath.replace('.md', '.changes.md'), 'utf-8')
    expect(binderChanges).toContain('Lightning Bolt')
    const wishlistChanges = await fs.readFile(wishlistPath.replace('.md', '.changes.md'), 'utf-8')
    expect(wishlistChanges).toContain('Mana Crypt')
  })

  test('skips a card whose key no longer resolves', async () => {
    await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
    })
    const result = await remove([
      { listType: 'collection', listSlug: 'binder', name: 'Ghost', cardId: 999, copyIndex: 0 },
    ])
    expect(result.success).toBe(true)
    expect(result.removed).toBe(0)
    expect(result.skipped).toBe(1)
  })

  const invalidBodies: InvalidRemoveBody[] = [
    { label: 'a request whose removes field is not an array', body: { notRemoves: true } },
    {
      label: 'a remove item with an invalid list type',
      body: { removes: [{ listType: 'bogus', listSlug: 'x', name: 'Y' }] },
    },
    {
      label: 'a remove item whose cardId is not a number',
      body: { removes: [{ listType: 'collection', listSlug: 'x', name: 'Y', cardId: 'nope' }] },
    },
  ]

  for (const { label, body } of invalidBodies) {
    test(`rejects ${label}`, async () => {
      const req = new Request('http://localhost/api/remove/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const resp = await handleRemoveCommit(req)
      expect(resp.status).toBe(400)
    })
  }

  test('auto-commits the written files when git auto-commit is enabled', async () => {
    initGitRepo(tmpDir)

    await writeCollectionFile(tmpDir, 'binder', {
      title: 'Binder',
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
    })

    const base = getDefaultRitualConfig()
    await writeConfig(tmpDir, {
      admin: { ...base.admin, gitEnabled: true, gitAutoCommit: true, gitAutoPush: false },
    })

    const result = await remove([
      { listType: 'collection', listSlug: 'binder', name: 'Sol Ring', cardId: 1, copyIndex: 0 },
    ])
    expect(result.removed).toBe(1)

    const subject = execSync('git log -1 --pretty=%s', { cwd: tmpDir, encoding: 'utf-8' }).trim()
    expect(subject).toBe('Remove 1 card')

    // The changelog written by the removal is part of the auto-commit.
    const committedFiles = execSync('git show --name-only --pretty=format: HEAD', {
      cwd: tmpDir,
      encoding: 'utf-8',
    })
    expect(committedFiles).toContain('collections/binder.changes.md')
  })
})
