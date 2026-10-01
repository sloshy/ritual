import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import { ensureDeckFile } from '../../src/list/ensure-list-file'
import { createAddChange } from '../../src/changes/change-event'
import { toWireChange } from '../../src/changes/wire-changes'
import type { ListSaveResponse } from '../../src/admin/api/list-save'
import { saveList } from '../helpers/list-save'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace()
})

afterEach(async () => {
  await ws.dispose()
})

const SLUG = 'Session Deck'

/**
 * Drive two admin deck saves — Sol Ring, then Lightning Bolt against the hash
 * the first returned — with `continueSession` on the second as given, and
 * return the changelog they leave behind.
 */
async function saveTwice(continueSession: boolean): Promise<string> {
  const filePath = await ensureDeckFile(SLUG, 'commander')

  const first = await saveList('deck', SLUG, filePath, [
    toWireChange(createAddChange('Sol Ring', { section: 'Main' })),
  ])
  expect(first.status).toBe(200)
  const { contentHash } = (await first.json()) as ListSaveResponse

  const second = await saveList(
    'deck',
    SLUG,
    filePath,
    [toWireChange(createAddChange('Lightning Bolt', { section: 'Main' }))],
    { contentHash, continueSession },
  )
  expect(second.status).toBe(200)

  return fs.readFile(filePath.replace(/\.md$/, '.changes.md'), 'utf-8')
}

/** Count the `## ` blocks (one per changelog entry) in a changelog file. */
function countBlocks(content: string): number {
  return content.split('\n').filter((line) => line.startsWith('## ')).length
}

describe('changelog session grouping (admin save, Integration)', () => {
  test('a second save with continueSession folds into the same changelog block', async () => {
    const changelog = await saveTwice(true)
    expect(countBlocks(changelog)).toBe(1)
    expect(changelog).toContain('- Added "Sol Ring"')
    expect(changelog).toContain('- Added "Lightning Bolt"')
  })

  test('a second save without continueSession opens a new changelog block', async () => {
    const changelog = await saveTwice(false)
    expect(countBlocks(changelog)).toBe(2)
    expect(changelog).toContain('- Added "Lightning Bolt"')
  })
})
