import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isSameFile } from '../../src/util/same-file'
import {
  moveListFileAndSidecars,
  renameListThroughTemp,
  type KindedSidecarMove,
} from '../../src/list/list-sidecars'

const testDir = path.join(import.meta.dir, '../.test-list-sidecars')

const exists = (p: string): Promise<boolean> => Bun.file(p).exists()

beforeEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true })
  await fs.mkdir(testDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true })
})

/** A list file with every sidecar beside it. */
async function seedList(base: string): Promise<string> {
  const mdPath = path.join(testDir, `${base}.md`)
  await fs.writeFile(mdPath, `# ${base}\n`)
  await fs.writeFile(`${mdPath}.sha256`, 'deadbeef\n')
  await fs.writeFile(path.join(testDir, `${base}.changes.md`), '# Changelog\n')
  await fs.writeFile(path.join(testDir, `${base}.primer.md`), '# Primer\n')
  await fs.writeFile(path.join(testDir, `${base}.art.json`), '{\n  "1": { "file": "a.jpg" }\n}\n')
  return mdPath
}

describe('isSameFile', () => {
  test('is true for two spellings of one path', async () => {
    const mdPath = await seedList('Burn')
    expect(await isSameFile(mdPath, path.join(testDir, '.', 'Burn.md'))).toBe(true)
  })

  test('is false for two distinct files', async () => {
    const a = await seedList('Burn')
    const b = await seedList('Elves')
    expect(await isSameFile(a, b)).toBe(false)
  })

  test('is false when either path is missing', async () => {
    const mdPath = await seedList('Burn')
    expect(await isSameFile(mdPath, path.join(testDir, 'Nope.md'))).toBe(false)
    expect(await isSameFile(path.join(testDir, 'Nope.md'), mdPath)).toBe(false)
  })
})

describe('moveListFileAndSidecars', () => {
  test('moves every sidecar and reports which kinds existed', async () => {
    const from = await seedList('burn')
    await fs.rm(path.join(testDir, 'burn.primer.md'))
    const to = path.join(testDir, 'Legacy Burn.md')

    expect(await moveListFileAndSidecars(from, to)).toEqual(['hash', 'changelog', 'art'])
    expect(await exists(to)).toBe(true)
    expect(await exists(`${to}.sha256`)).toBe(true)
    expect(await exists(path.join(testDir, 'Legacy Burn.changes.md'))).toBe(true)
    expect(await exists(path.join(testDir, 'Legacy Burn.art.json'))).toBe(true)
    expect(await exists(from)).toBe(false)
  })
})

describe('renameListThroughTemp', () => {
  test('lands the file and its sidecars at the destination, tagged by kind', async () => {
    const from = await seedList('burn')
    const to = path.join(testDir, 'Burn Redux.md')

    const moves = await renameListThroughTemp(from, to)

    expect(moves.map((m: KindedSidecarMove) => m.kind).sort()).toEqual([
      'art',
      'changelog',
      'hash',
      'primer',
    ])
    // Reported in the caller's terms — the temp name never leaks out.
    for (const move of moves) {
      expect(move.from).toStartWith(path.join(testDir, 'burn'))
      expect(move.to).toStartWith(path.join(testDir, 'Burn Redux'))
    }
    expect(await exists(to)).toBe(true)
    expect(await exists(path.join(testDir, 'Burn Redux.changes.md'))).toBe(true)
    expect(await exists(path.join(testDir, 'Burn Redux.art.json'))).toBe(true)
    expect((await fs.readdir(testDir)).filter((f) => f.startsWith('.ritual-rename'))).toEqual([])
  })

  test('rolls every piece back when the second leg fails part-way', async () => {
    const from = await seedList('burn')
    const to = path.join(testDir, 'Burn Redux.md')
    // A directory sitting where the changelog wants to land: the second leg
    // moves the hash, then fails on the changelog, leaving the `.md` parked
    // under the temporary name — the partial state the rollback exists for.
    await fs.mkdir(path.join(testDir, 'Burn Redux.changes.md'))

    let thrown: unknown
    try {
      await renameListThroughTemp(from, to)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)

    // Nothing stranded: the list and every sidecar are back where they started,
    // and no `.ritual-rename-*` file is left holding the `&N` changelog.
    expect(await exists(from)).toBe(true)
    expect(await exists(`${from}.sha256`)).toBe(true)
    expect(await exists(path.join(testDir, 'burn.changes.md'))).toBe(true)
    expect(await exists(path.join(testDir, 'burn.primer.md'))).toBe(true)
    expect(await exists(path.join(testDir, 'burn.art.json'))).toBe(true)
    expect((await fs.readdir(testDir)).filter((f) => f.startsWith('.ritual-rename'))).toEqual([])
  })
})
