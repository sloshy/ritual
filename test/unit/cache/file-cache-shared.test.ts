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
})
