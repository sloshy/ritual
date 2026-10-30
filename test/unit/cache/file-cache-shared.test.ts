import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileCacheManager } from '../../../src/cache/file-cache'
import { makeScryfallCard } from '../../test-utils'

/**
 * The card cache file can be shared by every workspace's processes. Two
 * managers over one file stand in for two processes: each keeps its own memo,
 * exactly as separate processes would.
 */

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-shared-file-cache-'))
  file = path.join(dir, 'cache.json')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function card(name: string): ReturnType<typeof makeScryfallCard>[] {
  return [makeScryfallCard({ name })]
}

describe('FileCacheManager over a shared file', () => {
  test('a write never saves an older copy over another process’s newer one', async () => {
    const a = new FileCacheManager(file, 'cards', 0)
    const b = new FileCacheManager(file, 'cards', 0)
    await a.set('Sol Ring', card('Sol Ring'))
    // `b` loads now, then `a` writes again: `b`'s memo is out of date.
    expect(await b.keys()).toEqual(['Sol Ring'])
    await a.set('Mana Crypt', card('Mana Crypt'))

    await b.set('Llanowar Elves', card('Llanowar Elves'))

    const onDisk = new FileCacheManager(file, 'cards', 0)
    expect((await onDisk.keys()).sort()).toEqual(['Llanowar Elves', 'Mana Crypt', 'Sol Ring'])
  })

  test('a read picks up another process’s write instead of serving its memo', async () => {
    const a = new FileCacheManager(file, 'cards', 0)
    const b = new FileCacheManager(file, 'cards', 0)
    expect(await a.isEmpty()).toBe(true)

    await b.bulkSet({ 'Sol Ring': card('Sol Ring') })

    expect(await a.keys()).toEqual(['Sol Ring'])
    expect(await a.getLastRefreshedAt()).not.toBeNull()
  })

  test('writes from one process run in order, none lost', async () => {
    const a = new FileCacheManager(file, 'cards', 0)
    const names = ['A', 'B', 'C', 'D', 'E']
    await Promise.all(names.map((name) => a.set(name, card(name))))

    expect((await new FileCacheManager(file, 'cards', 0).keys()).sort()).toEqual(names)
  })

  test('two managers over one file (prices and cards) never lose each other’s writes', async () => {
    const cards = new FileCacheManager(file, 'cards', 0)
    const prices = new FileCacheManager(file, 'prices', 0)
    const names = ['A', 'B', 'C', 'D']
    await Promise.all(
      names.flatMap((name) => [
        cards.set(name, card(name)),
        prices.set(name, { latest: 1, min: 1, max: 1 }),
        // Reads interleaved with the writes must not push a write onto a stale copy.
        cards.get(name),
      ]),
    )

    const onDisk = JSON.parse(await fs.readFile(file, 'utf-8')) as {
      cards: Record<string, unknown>
      prices: Record<string, unknown>
    }
    expect(Object.keys(onDisk.cards).sort()).toEqual(names)
    expect(Object.keys(onDisk.prices).sort()).toEqual(names)
  })

  test('a cache file that cannot be parsed reads as empty but is never overwritten', async () => {
    await fs.writeFile(file, '{"cards": {"Sol Ring": [trunc')
    const manager = new FileCacheManager(file, 'cards', 0)

    expect(await manager.isEmpty()).toBe(true)
    const refused = await manager.set('Mana Crypt', card('Mana Crypt')).catch((e: unknown) => e)

    expect(String((refused as Error).message)).toContain('will not overwrite it')
    expect(String((refused as Error).message)).toContain('ritual cache preload-all')
    expect(await fs.readFile(file, 'utf-8')).toBe('{"cards": {"Sol Ring": [trunc')
  })

  test('a read failure is not remembered: a repaired file is read again', async () => {
    await fs.writeFile(file, 'not json')
    const manager = new FileCacheManager(file, 'cards', 0)
    expect(await manager.isEmpty()).toBe(true)

    await new FileCacheManager(path.join(dir, 'other.json'), 'cards', 0).set('x', card('x'))
    await fs.copyFile(path.join(dir, 'other.json'), file)

    expect(await manager.keys()).toEqual(['x'])
  })

  test('a full bulk refresh heals an unreadable cache file', async () => {
    await fs.writeFile(file, 'not json')
    const manager = new FileCacheManager(file, 'cards', 0)

    await manager.bulkSet({ 'Sol Ring': card('Sol Ring') }, { replace: true })

    expect(await new FileCacheManager(file, 'cards', 0).keys()).toEqual(['Sol Ring'])
  })

  test('a write that keeps losing to other writers rejects instead of claiming success', async () => {
    await new FileCacheManager(file, 'cards', 0).set('Sol Ring', card('Sol Ring'))
    let rewrites = 0
    // Every attempt finds the file rewritten by "another process" just before its rename.
    const contended = new FileCacheManager(file, 'cards', 0, Date.now, {
      beforeWrite: async (target) => {
        rewrites++
        await fs.appendFile(target, ' ')
      },
    })

    const failure = await contended.set('Mana Crypt', card('Mana Crypt')).catch((e: unknown) => e)

    expect(String((failure as Error).message)).toContain('kept rewriting it')
    expect(rewrites).toBeGreaterThan(1)
    expect(await new FileCacheManager(file, 'cards', 0).keys()).toEqual(['Sol Ring'])
  })
})
