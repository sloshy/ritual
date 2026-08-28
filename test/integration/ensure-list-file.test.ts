import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureCollectionFile } from '../../src/list/ensure-list-file'
import { CardCommandError, ExitCode } from '../../src/util/errors'
import { bindWorkspace, writeCollectionFile, type BoundWorkspace } from '../helpers/workspace'

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ init: true })
  await writeCollectionFile(ws.dir, 'Atraxa Binder', { entries: [] })
})

afterEach(async () => {
  await ws.dispose()
})

async function collectionFiles(): Promise<string[]> {
  return (await fs.readdir(path.join(ws.dir, 'collections'))).sort()
}

describe('ensureCollectionFile', () => {
  test('the byte-identical name is the existing file, not a collision', async () => {
    const before = await collectionFiles()
    expect(await ensureCollectionFile('Atraxa Binder')).toBe(
      path.join(ws.dir, 'collections', 'Atraxa Binder.md'),
    )
    expect(await collectionFiles()).toEqual(before)
  })

  test('a name that folds onto an existing list is refused the way `ritual new` refuses it', async () => {
    const before = await collectionFiles()
    let thrown: unknown
    try {
      await ensureCollectionFile('atraxa binder')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(CardCommandError)
    if (!(thrown instanceof CardCommandError)) return
    expect(thrown.message).toBe(
      "A collection named 'Atraxa Binder' already exists (it matches 'atraxa binder' under list-name folding).",
    )
    expect(thrown.code).toBe('usage_error')
    expect(thrown.exitCode).toBe(ExitCode.UsageError)
    expect(await collectionFiles()).toEqual(before)
  })

  test('a free name is created', async () => {
    await ensureCollectionFile('Trade Binder')
    expect(await collectionFiles()).toContain('Trade Binder.md')
  })
})
