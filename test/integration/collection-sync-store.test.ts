import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createDiskCollectionListStore } from '../../src/collection-sync/store'
import { isSyncMessage } from '../../src/sync/message'
import { keyedMessage } from '../helpers/api-message'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

/**
 * The collection-sync store's `load`, against a real file: what the run log
 * reports about a list is split by severity, and an advisory keeps the key its
 * parser gave it, so the admin Sync Collection page renders it in its reader's
 * language.
 */

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
})

afterEach(async () => {
  await ws.dispose()
})

describe('createDiskCollectionListStore().load (Integration)', () => {
  test('splits warnings from advisories, each advisory a keyed message', async () => {
    // A front-matter block that is a YAML list, not a mapping (an advisory: the
    // block round-trips) and a prose line the parser cannot read (a warning).
    await fs.writeFile(
      path.join(ws.dir, 'collections', 'binder.md'),
      '---\n- just\n- a list\n---\n# Binder\n\n- Sol Ring (C21:263) &1\nthis is not a card line\n',
    )

    const loaded = await createDiskCollectionListStore().load('binder')
    if (isSyncMessage(loaded)) throw new Error(`expected a loaded list, got: ${loaded.message}`)

    expect(loaded.entries.map((entry) => entry.name)).toEqual(['Sol Ring'])
    expect(loaded.warnings.map(keyedMessage)).toEqual([
      'Skipped malformed line: this is not a card line',
    ])
    expect(loaded.advisories.map((advisory) => advisory.messageKey)).toEqual([
      'domain.list.frontMatter.notMapping',
    ])
    expect(loaded.advisories.map(keyedMessage)).toEqual([
      'Front matter is not a key/value mapping, so its content was ignored (the block itself is preserved on save).',
    ])
  })
})
