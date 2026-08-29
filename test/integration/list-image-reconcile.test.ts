import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import {
  createWorkspace,
  removeWorkspace,
  writeCollectionFile,
  writeDeckFile,
} from '../helpers/workspace'
import type { ListImageRef } from '../../src/list/list-image'

/**
 * A `card`-mode cover is filed under a card line's `&N`, and those ids are
 * *reused*: the id a removal releases is handed to the next card added. So a
 * cover that outlives its card does not merely go stale — it silently shows an
 * unrelated card. Every save path therefore reconciles the key alongside the
 * custom-art sidecar (`reconcileListRefs`).
 *
 * The pure decision is pinned by test/unit/list-image.test.ts; what belongs here
 * is that a real write path actually asks for it, and that the covers which
 * reference nothing of the list's are left exactly as they were.
 */

describe('list cover image reconcile (Integration)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await createWorkspace()
  })

  afterEach(async () => {
    await removeWorkspace(dir)
  })

  /** A deck whose cover points at the `&2` line, plus a line that is not covered. */
  async function seedDeck(image: ListImageRef): Promise<string> {
    return writeDeckFile(dir, 'burn', {
      name: 'Burn',
      frontMatter: { image },
      cards: [
        { quantity: 2, name: 'Sol Ring', cardId: 1 },
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
      ],
    })
  }

  test('removing the covered card line clears the key', async () => {
    const filePath = await seedDeck({ card: 2 })
    expect(await fs.readFile(filePath, 'utf-8')).toContain('image:\n  card: 2')

    const result = await runCli(['remove-card', '--deck', 'burn', 'Lightning', 'Bolt'], dir)
    expect(result.exitCode).toBe(0)

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).not.toContain('image:')
    // Only the front-matter key moved: the surviving line is untouched.
    expect(content).toContain('2 Sol Ring &1')
  })

  test('a recycled id cannot inherit the cover: the key is gone before it is reused', async () => {
    const filePath = await seedDeck({ card: 2 })
    await runCli(['remove-card', '--deck', 'burn', 'Lightning', 'Bolt'], dir)

    // `&2` is back in the pool; whatever claims it next must not become the
    // deck's cover.
    await runCli(['note', '--deck', 'burn', 'Sol', 'Ring', 'still here'], dir)
    expect(await fs.readFile(filePath, 'utf-8')).not.toContain('image:')
  })

  test('removing a different card leaves the cover alone', async () => {
    const filePath = await seedDeck({ card: 2 })

    const result = await runCli(['remove-card', '--deck', 'burn', 'Sol', 'Ring', '-q', '2'], dir)
    expect(result.exitCode).toBe(0)
    expect(await fs.readFile(filePath, 'utf-8')).toContain('image:\n  card: 2')
  })

  test('decrementing the covered line keeps its id, and its cover', async () => {
    const filePath = await seedDeck({ card: 1 })

    const result = await runCli(['remove-card', '--deck', 'burn', 'Sol', 'Ring'], dir)
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('1 Sol Ring &1')
    expect(content).toContain('image:\n  card: 1')
  })

  test('a file cover survives a card save untouched', async () => {
    const filePath = await writeCollectionFile(dir, 'binder', {
      entries: [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
        { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
      ],
    })
    await runCli(['set-list-image', 'binder', '--file', 'alters/binder.png'], dir)

    const result = await runCli(['remove-card', '--collection', 'binder', 'Sol', 'Ring'], dir)
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('image:\n  file: alters/binder.png')
    expect(content).not.toContain('Sol Ring')
  })

  test('a cross-list move clears the source cover it took the card from', async () => {
    const source = await writeCollectionFile(dir, 'binder', {
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
    })
    await writeCollectionFile(dir, 'keep', { entries: [] })
    await runCli(['set-list-image', 'binder', '--card', '1'], dir)
    expect(await fs.readFile(source, 'utf-8')).toContain('image:\n  card: 1')

    const result = await runCli(
      [
        'move',
        'Sol',
        'Ring',
        '--from',
        'collection:binder',
        '--to',
        'collection:keep',
        '--no-input',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    expect(await fs.readFile(source, 'utf-8')).not.toContain('image:')
    // The destination gains no cover of its own — a cover does not travel.
    expect(await fs.readFile(path.join(dir, 'collections', 'keep.md'), 'utf-8')).not.toContain(
      'image:',
    )
  })
})
