import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { setBaseDir, getBaseDir } from '../../src/base-dir'
import { resetRitualConfigCache, getDefaultRitualConfig } from '../../src/ritual-config'
import { handleRemoveCommit } from '../../src/admin/api/move'

/**
 * End-to-end coverage for the admin cross-list remove endpoint. The client
 * addresses cards by `{listType, listSlug, name, cardId, copyIndex}`; the handler
 * reconstructs the physical-card key from disk and removes the matching lines.
 */

let tmpDir: string
let originalBase: string

beforeEach(async () => {
  originalBase = getBaseDir()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remove-api-'))
  await fs.mkdir(path.join(tmpDir, 'decks'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'collections'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'wanted'), { recursive: true })
  setBaseDir(tmpDir)
  resetRitualConfigCache()
})

afterEach(async () => {
  setBaseDir(originalBase)
  resetRitualConfigCache()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

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
    const binderPath = path.join(tmpDir, 'collections', 'binder.md')
    const wishlistPath = path.join(tmpDir, 'wanted', 'wishlist.md')
    await fs.writeFile(
      binderPath,
      '# Binder\n\n- Lightning Bolt (LEA:161) [foil] &1\n- Sol Ring (C21:240) &2\n',
    )
    await fs.writeFile(wishlistPath, '# Wishlist\n\n- Mana Crypt &1\n')

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
  })

  test('skips a card whose key no longer resolves', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'collections', 'binder.md'),
      '# Binder\n\n- Sol Ring (C21:240) &1\n',
    )
    const result = await remove([
      { listType: 'collection', listSlug: 'binder', name: 'Ghost', cardId: 999, copyIndex: 0 },
    ])
    expect(result.success).toBe(true)
    expect(result.removed).toBe(0)
    expect(result.skipped).toBe(1)
  })

  test('rejects a request whose removes field is not an array', async () => {
    const req = new Request('http://localhost/api/remove/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notRemoves: true }),
    })
    const resp = await handleRemoveCommit(req)
    expect(resp.status).toBe(400)
  })

  test('rejects a remove item with an invalid list type', async () => {
    const req = new Request('http://localhost/api/remove/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removes: [{ listType: 'bogus', listSlug: 'x', name: 'Y' }] }),
    })
    const resp = await handleRemoveCommit(req)
    expect(resp.status).toBe(400)
  })

  test('rejects a remove item whose cardId is not a number', async () => {
    const req = new Request('http://localhost/api/remove/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        removes: [{ listType: 'collection', listSlug: 'x', name: 'Y', cardId: 'nope' }],
      }),
    })
    const resp = await handleRemoveCommit(req)
    expect(resp.status).toBe(400)
  })

  test('auto-commits the written files when git auto-commit is enabled', async () => {
    execSync('git init -q', { cwd: tmpDir })
    execSync('git config user.email test@example.com', { cwd: tmpDir })
    execSync('git config user.name "Ritual Test"', { cwd: tmpDir })

    const binderPath = path.join(tmpDir, 'collections', 'binder.md')
    await fs.writeFile(binderPath, '# Binder\n\n- Sol Ring (C21:240) &1\n')

    const base = getDefaultRitualConfig()
    await fs.writeFile(
      path.join(tmpDir, 'ritual.config.json'),
      JSON.stringify({
        decksDir: './decks',
        collectionsDir: './collections',
        wantedDir: './wanted',
        admin: { ...base.admin, gitEnabled: true, gitAutoCommit: true, gitAutoPush: false },
      }),
    )

    const result = await remove([
      { listType: 'collection', listSlug: 'binder', name: 'Sol Ring', cardId: 1, copyIndex: 0 },
    ])
    expect(result.removed).toBe(1)

    const subject = execSync('git log -1 --pretty=%s', { cwd: tmpDir, encoding: 'utf-8' }).trim()
    expect(subject).toBe('Remove 1 card')
  })
})
