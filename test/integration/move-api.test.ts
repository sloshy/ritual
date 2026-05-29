import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { setBaseDir, getBaseDir } from '../../src/base-dir'
import { resetRitualConfigCache, getDefaultRitualConfig } from '../../src/ritual-config'
import { handleMoveData, handleMoveCommit } from '../../src/admin/api/move'
import type { MoveDataResponse, MovePhysicalCard } from '../../src/admin/api/move'

/**
 * End-to-end coverage for the admin move endpoints. Exercises the slug-based key
 * round-trip (the load endpoint issues a key, the commit endpoint reconstructs it
 * from disk) and the destination printing override used for collection moves.
 */

let tmpDir: string
let originalBase: string

beforeEach(async () => {
  originalBase = getBaseDir()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'move-api-'))
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

async function loadData(): Promise<MoveDataResponse> {
  const resp = await handleMoveData()
  return (await resp.json()) as MoveDataResponse
}

function findCard(data: MoveDataResponse, name: string): MovePhysicalCard {
  const card = data.cards.find((c) => c.name === name)
  if (!card) throw new Error(`card ${name} not found in move data`)
  return card
}

async function commit(
  moves: unknown[],
): Promise<{ success: boolean; moved: number; skipped: number }> {
  const req = new Request('http://localhost/api/move/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moves }),
  })
  const resp = await handleMoveCommit(req)
  return (await resp.json()) as { success: boolean; moved: number; skipped: number }
}

describe('move API', () => {
  test('lists every list and card across the three list types', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'collections', 'binder.md'),
      '# Binder\n\n- Lightning Bolt (LEA:161) &1\n',
    )
    await fs.writeFile(
      path.join(tmpDir, 'wanted', 'wishlist.md'),
      '# Wishlist\n\n- Mana Crypt &1\n',
    )

    const data = await loadData()
    expect(data.success).toBe(true)
    expect(data.lists.map((l) => `${l.type}:${l.slug}`).sort()).toEqual([
      'collection:binder',
      'wanted:wishlist',
    ])
    expect(data.cards.map((c) => c.name).sort()).toEqual(['Lightning Bolt', 'Mana Crypt'])
  })

  test('commits a move using the key issued by the load endpoint', async () => {
    const srcPath = path.join(tmpDir, 'collections', 'src.md')
    const dstPath = path.join(tmpDir, 'collections', 'dst.md')
    await fs.writeFile(srcPath, '# Source\n\n- Lightning Bolt (LEA:161) [foil] &1\n')
    await fs.writeFile(dstPath, '# Dest\n\n')

    const data = await loadData()
    const card = findCard(data, 'Lightning Bolt')

    const result = await commit([{ cardKey: card.key, toType: 'collection', toSlug: 'dst' }])
    expect(result.success).toBe(true)
    expect(result.moved).toBe(1)
    expect(result.skipped).toBe(0)

    expect(await fs.readFile(srcPath, 'utf-8')).not.toContain('Lightning Bolt')
    expect(await fs.readFile(dstPath, 'utf-8')).toContain('Lightning Bolt')
  })

  test('applies a destination printing override for a name-only card into a collection', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'wanted', 'wishlist.md'),
      '# Wishlist\n\n- Mana Crypt &1\n',
    )
    const binderPath = path.join(tmpDir, 'collections', 'binder.md')
    await fs.writeFile(binderPath, '# Binder\n\n')

    const data = await loadData()
    const card = findCard(data, 'Mana Crypt')

    const result = await commit([
      {
        cardKey: card.key,
        toType: 'collection',
        toSlug: 'binder',
        set: '2XM',
        collectorNumber: '270',
        finish: 'nonfoil',
        condition: 'NM',
      },
    ])
    expect(result.moved).toBe(1)

    const binder = await fs.readFile(binderPath, 'utf-8')
    expect(binder).toContain('Mana Crypt')
    // Set codes are uppercased in markdown output, normalized from the override.
    expect(binder).toContain('(2XM:270)')
  })

  test('skips a move whose card key no longer resolves', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'collections', 'src.md'),
      '# Source\n\n- Sol Ring (C21:240) &1\n',
    )
    await fs.writeFile(path.join(tmpDir, 'collections', 'dst.md'), '# Dest\n\n')

    const result = await commit([
      { cardKey: 'collection:src:999:0', toType: 'collection', toSlug: 'dst' },
    ])
    expect(result.success).toBe(true)
    expect(result.moved).toBe(0)
    expect(result.skipped).toBe(1)
  })

  test('auto-commits the written files when git auto-commit is enabled', async () => {
    execSync('git init -q', { cwd: tmpDir })
    execSync('git config user.email test@example.com', { cwd: tmpDir })
    execSync('git config user.name "Ritual Test"', { cwd: tmpDir })

    await fs.writeFile(
      path.join(tmpDir, 'collections', 'src.md'),
      '# Source\n\n- Sol Ring (C21:240) &1\n',
    )
    await fs.writeFile(path.join(tmpDir, 'collections', 'dst.md'), '# Dest\n\n')

    // A full, valid admin config with git auto-commit enabled (so loadRitualConfig keeps it).
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

    const data = await loadData()
    const card = findCard(data, 'Sol Ring')
    const result = await commit([{ cardKey: card.key, toType: 'collection', toSlug: 'dst' }])
    expect(result.moved).toBe(1)

    const subject = execSync('git log -1 --pretty=%s', { cwd: tmpDir, encoding: 'utf-8' }).trim()
    expect(subject).toBe('Move 1 card')

    // The moved list files were committed, not left as working-tree changes.
    const tracked = execSync('git ls-files', { cwd: tmpDir, encoding: 'utf-8' })
    expect(tracked).toContain('collections/src.md')
    expect(tracked).toContain('collections/dst.md')
  })

  test('rejects a request whose moves field is not an array', async () => {
    const req = new Request('http://localhost/api/move/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notMoves: true }),
    })
    const resp = await handleMoveCommit(req)
    expect(resp.status).toBe(400)
  })

  test('rejects a move item with an invalid field', async () => {
    const req = new Request('http://localhost/api/move/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // cardKey must be a string and toType must be a valid list type.
      body: JSON.stringify({ moves: [{ cardKey: 123, toType: 'bogus', toSlug: 'dst' }] }),
    })
    const resp = await handleMoveCommit(req)
    expect(resp.status).toBe(400)
  })
})
