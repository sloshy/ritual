import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { writeFileWithHash } from '../../src/changes/content-hash'
import type { CategoriesListResult, CategoriesWriteResult } from '../../src/commands/categories'
import {
  createWorkspace,
  removeWorkspace,
  snapshotTree,
  writeCollectionFile,
} from '../helpers/workspace'

/**
 * `ritual categories` — the scripting surface over a list's categories sidecar.
 * The sidecar engine (parse, prune, order resolution, hashing) and the removal's
 * event decomposition are pinned at the unit layer; what belongs here is the CLI
 * wiring: arguments, exit codes, the JSON payloads, and one representative file
 * side effect per subcommand.
 */

/**
 * The command's own payload types, imported rather than restated: they are a
 * machine contract, and a hand-copied mirror would keep compiling after a field
 * was renamed or dropped. `dryRun` is the envelope's own flag, not the payload's.
 */
type CategoriesListJson = CategoriesListResult
type CategoriesWriteJson = CategoriesWriteResult & { dryRun?: boolean }

type ErrorJson = { error: { code: string; message: string } }

describe('ritual categories (Integration)', () => {
  let dir: string
  const listFile = (): string => path.join(dir, 'collections', 'binder.md')
  const sidecar = (): string => path.join(dir, 'collections', 'binder.categories.json')
  const changelog = (): string => path.join(dir, 'collections', 'binder.changes.md')

  async function readSidecar(): Promise<unknown> {
    return JSON.parse(await fs.readFile(sidecar(), 'utf-8'))
  }

  beforeEach(async () => {
    dir = await createWorkspace()
    await writeCollectionFile(dir, 'binder', {
      entries: [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
        { name: 'Rhystic Study', set: 'c18', collectorNumber: '59', cardId: 2 },
      ],
    })
    // Seeded as Ritual itself would have written it — content plus a matching
    // `.sha256` — so the writes below may re-stamp the hash. One entry names a
    // card the list does not hold: the stale name `list` must report and
    // nothing in this command may prune.
    await writeFileWithHash(
      sidecar(),
      `${JSON.stringify(
        {
          order: ['Ramp', 'Draw', 'Removal'],
          cards: {
            'Rhystic Study': ['Draw'],
            'Sol Ring': ['Ramp'],
            'Swords to Plowshares': ['Removal'],
          },
        },
        null,
        2,
      )}\n`,
    )
  })

  afterEach(async () => {
    await removeWorkspace(dir)
  })

  test('list reports the vocabulary, the cards and the stale entry, and writes nothing', async () => {
    const before = await snapshotTree(dir)
    const result = await runCli(
      ['categories', 'list', 'binder', '--collection', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as CategoriesListJson
    expect(json.order).toEqual(['Ramp', 'Draw', 'Removal'])
    expect(json.cards).toEqual([
      { name: 'Rhystic Study', categories: ['Draw'] },
      { name: 'Sol Ring', categories: ['Ramp'] },
      { name: 'Swords to Plowshares', categories: ['Removal'] },
    ])
    expect(json.warnings.join('\n')).toContain('Swords to Plowshares')
    // A read does not write: the stale entry survives, byte for byte.
    expect(await snapshotTree(dir)).toEqual(before)
  })

  test('list prints the vocabulary and card lines as text', async () => {
    const result = await runCli(['categories', 'list', 'binder', '--collection'], dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('1. Ramp (1 card)')
    expect(result.stdout).toContain('Sol Ring: Ramp')
  })

  test('rename rewrites the sidecar, the changelog, and reports the cards it touched', async () => {
    const result = await runCli(
      ['categories', 'rename', 'binder', '--collection', 'Draw', 'Card Draw', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as CategoriesWriteJson
    expect(json.action).toBe('rename')
    expect(json.order).toEqual(['Ramp', 'Card Draw', 'Removal'])
    expect(json.cardsChanged).toEqual(['Rhystic Study'])
    expect(json.wouldWrite).toBe(true)
    expect(json.writtenFiles).toEqual([sidecar(), `${sidecar()}.sha256`, changelog()])

    expect(await readSidecar()).toMatchObject({
      order: ['Ramp', 'Card Draw', 'Removal'],
      cards: { 'Rhystic Study': ['Card Draw'] },
    })
    expect(await fs.readFile(changelog(), 'utf-8')).toContain(
      '- Renamed category "Draw" to "Card Draw"',
    )
  })

  test('order persists the new display order', async () => {
    const result = await runCli(
      ['categories', 'order', 'binder', '--collection', 'Removal, Ramp', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as CategoriesWriteJson
    // `Draw` is used by a card but not named, so the resolver appends it.
    expect(json.order.slice(0, 2)).toEqual(['Removal', 'Ramp'])
    expect(await fs.readFile(changelog(), 'utf-8')).toContain(
      '- Set category order to Removal, Ramp',
    )
  })

  test('remove drops the name from the vocabulary and from every card', async () => {
    const result = await runCli(
      ['categories', 'remove', 'binder', '--collection', 'Ramp', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as CategoriesWriteJson
    expect(json.cardsChanged).toEqual(['Sol Ring'])
    expect(await readSidecar()).toMatchObject({
      order: ['Draw', 'Removal'],
      cards: { 'Rhystic Study': ['Draw'], 'Swords to Plowshares': ['Removal'] },
    })
    const log = await fs.readFile(changelog(), 'utf-8')
    expect(log).toContain('- Set category order to Draw, Removal')
    expect(log).toContain('- Cleared categories of "Sol Ring"')
  })

  test('a category the list does not use is a not_found', async () => {
    const result = await runCli(
      ['categories', 'rename', 'binder', '--collection', 'Missing', 'X', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('not_found')
  })

  test('an empty order value is a usage error, and says why', async () => {
    const result = await runCli(['categories', 'order', 'binder', '--collection', '  '], dir)
    expect(result.exitCode).toBe(2)
    // Not just Commander's own argument check: the refusal is the command's.
    expect(result.stderr).toContain('one or more categories')
  })

  test('a malformed category name is a usage error', async () => {
    const result = await runCli(
      ['categories', 'rename', 'binder', '--collection', 'R&D', 'X', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect((JSON.parse(result.stderr) as ErrorJson).error.code).toBe('usage_error')
  })

  test('an unreadable sidecar refuses with exit 1 rather than overwriting it', async () => {
    await fs.writeFile(sidecar(), '{ not json')
    const before = await fs.readFile(sidecar(), 'utf-8')
    const result = await runCli(
      ['categories', 'rename', 'binder', '--collection', 'Draw', 'Card Draw', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(1)
    expect((JSON.parse(result.stderr) as ErrorJson).error.code).toBe('runtime_error')
    expect(await fs.readFile(sidecar(), 'utf-8')).toBe(before)
  })

  test('an empty record prints the "no categories" line', async () => {
    await fs.rm(sidecar())
    await fs.rm(`${sidecar()}.sha256`)
    const text = await runCli(['categories', 'list', 'binder', '--collection'], dir)
    expect(text.exitCode).toBe(0)
    expect(text.stdout).toContain('No categories in binder.')

    const json = await runCli(
      ['categories', 'list', 'binder', '--collection', '--output', 'json'],
      dir,
    )
    const payload = JSON.parse(json.stdout) as CategoriesListJson
    expect(payload).toMatchObject({ order: [], cards: [], warnings: [] })
  })

  test('--dry-run writes nothing, and a no-op edit reports wouldWrite: false', async () => {
    const before = await snapshotTree(dir)
    const preview = await runCli(
      [
        'categories',
        'rename',
        'binder',
        '--collection',
        'Draw',
        'Card Draw',
        '-n',
        '--output',
        'json',
      ],
      dir,
    )
    expect(preview.exitCode).toBe(0)
    const json = JSON.parse(preview.stdout) as CategoriesWriteJson
    expect(json.dryRun).toBe(true)
    expect(json.action).toBe('rename')
    expect(json.wouldWrite).toBe(true)
    expect(json.writtenFiles).toEqual([])
    expect(await snapshotTree(dir)).toEqual(before)

    // Renaming a category to the spelling it already has changes nothing.
    const noop = await runCli(
      ['categories', 'rename', 'binder', '--collection', 'Draw', 'Draw', '-n', '--output', 'json'],
      dir,
    )
    expect(noop.exitCode).toBe(0)
    expect((JSON.parse(noop.stdout) as CategoriesWriteJson).wouldWrite).toBe(false)
    expect(await snapshotTree(dir)).toEqual(before)
  })

  test('a REAL no-op edit records no changelog entry either', async () => {
    // The dry run above and the real run must agree about whether the command
    // touches disk — which is what `wouldWrite` promises.
    const before = await snapshotTree(dir)
    const result = await runCli(
      ['categories', 'rename', 'binder', '--collection', 'Draw', 'Draw', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as CategoriesWriteJson
    expect(json.wouldWrite).toBe(false)
    expect(json.writtenFiles).toEqual([])
    expect(await snapshotTree(dir)).toEqual(before)
  })

  test('a hand-edited sidecar keeps its stale hash, so detect-changes still sees the edit', async () => {
    await fs.writeFile(
      sidecar(),
      `${JSON.stringify({ order: ['Ramp'], cards: { 'Sol Ring': ['Ramp'] } }, null, 2)}\n`,
    )
    const hashBefore = await fs.readFile(`${sidecar()}.sha256`, 'utf-8')
    const result = await runCli(
      ['categories', 'rename', 'binder', '--collection', 'Ramp', 'Mana', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as CategoriesWriteJson
    expect(json.writtenFiles).toEqual([sidecar(), changelog()])
    expect(await fs.readFile(`${sidecar()}.sha256`, 'utf-8')).toBe(hashBefore)
  })

  test('a categories run never rewrites the list file or its hash', async () => {
    // Re-seeded through `writeFileWithHash` so the list carries a `.sha256`:
    // without one, the hash half of this assertion could only ever catch a hash
    // being created, never one being rewritten.
    const listBefore = await fs.readFile(listFile(), 'utf-8')
    await writeFileWithHash(listFile(), listBefore)
    const hashBefore = await fs.readFile(`${listFile()}.sha256`, 'utf-8')
    const result = await runCli(
      ['categories', 'order', 'binder', '--collection', 'Removal, Ramp, Draw'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    expect(await fs.readFile(listFile(), 'utf-8')).toBe(listBefore)
    expect(await fs.readFile(`${listFile()}.sha256`, 'utf-8')).toBe(hashBefore)
  })
})
