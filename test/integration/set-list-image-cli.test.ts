import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import {
  createWorkspace,
  removeWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
} from '../helpers/workspace'

/**
 * `ritual set-list-image` — the CLI surface over a list's `image:` front-matter
 * key. The grammar is pinned by test/unit/list-image.test.ts and the write
 * engines by the metadata API tests; what belongs here per the layering policy
 * is the CLI wiring: one representative path per mode, the flag conflicts, the
 * exit codes, the `--dry-run` and `--no-input` contracts, and the file side
 * effects (front matter written, card lines untouched, nothing backfilled).
 */

describe('set-list-image CLI (Integration)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await createWorkspace()
  })

  afterEach(async () => {
    await removeWorkspace(dir)
  })

  /** A deck whose two card lines already carry ids, so a backfill would be a no-op. */
  async function seedDeck(): Promise<string> {
    return writeDeckFile(dir, 'burn', {
      name: 'Burn',
      cards: [
        { name: 'Lightning Bolt', quantity: 4, set: 'lea', collectorNumber: '161', cardId: 1 },
        { name: 'Sol Ring', quantity: 1, set: 'c21', collectorNumber: '263', cardId: 2 },
      ],
    })
  }

  test('--card writes the mapping form and leaves the card lines alone', async () => {
    const filePath = await seedDeck()

    const result = await runCli(['set-list-image', 'burn', '--card', '&2'], dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Deck 'burn': cover image is now the card &2")

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('image:\n  card: 2')
    expect(content).toContain('4 Lightning Bolt (LEA:161) &1')
    // Metadata is not a card change: no changelog appears.
    expect(await Bun.file(path.join(dir, 'decks', 'burn.changes.md')).exists()).toBeFalse()
  })

  test('--file and --url write their mode, and --default removes the key', async () => {
    const filePath = await writeCollectionFile(dir, 'binder', {
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
    })

    // A path naming a file that does not exist is accepted: the art may be
    // added later, exactly as the custom-art surfaces already allow.
    const file = await runCli(['set-list-image', 'binder', '--file', 'alters/binder.png'], dir)
    expect(file.exitCode).toBe(0)
    expect(await fs.readFile(filePath, 'utf-8')).toContain('image:\n  file: alters/binder.png')

    const url = await runCli(
      ['set-list-image', 'binder', '--url', 'https://example.test/binder.jpg'],
      dir,
    )
    expect(url.exitCode).toBe(0)
    const withUrl = await fs.readFile(filePath, 'utf-8')
    expect(withUrl).toContain("image:\n  url: 'https://example.test/binder.jpg'")
    expect(withUrl).not.toContain('file:')

    const cleared = await runCli(['set-list-image', 'binder', '--default'], dir)
    expect(cleared.exitCode).toBe(0)
    expect(cleared.stdout).toContain("Collection 'binder': cover image cleared")
    expect(await fs.readFile(filePath, 'utf-8')).not.toContain('image:')
  })

  test('a wanted list takes a cover image — its one writable key', async () => {
    const filePath = await writeWantedFile(dir, 'chase', {
      entries: [{ name: 'Ancestral Recall', set: 'lea', collectorNumber: '48', cardId: 1 }],
    })

    const result = await runCli(['set-list-image', 'chase', '--card', '1'], dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Wanted list 'chase': cover image is now the card &1")
    expect(await fs.readFile(filePath, 'utf-8')).toContain('image:\n  card: 1')
  })

  test('--output json reports the stored mapping under stable keys', async () => {
    await seedDeck()

    const result = await runCli(
      ['set-list-image', 'burn', '--url', 'https://example.test/burn.jpg', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      type: 'deck',
      list: 'burn',
      mode: 'url',
      image: { url: 'https://example.test/burn.jpg' },
    })
  })

  test('a card id no card carries is refused, writing nothing', async () => {
    const filePath = await seedDeck()
    const before = await fs.readFile(filePath, 'utf-8')

    const result = await runCli(['set-list-image', 'burn', '--card', '99'], dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('&99')
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
  })

  test('an art path escaping the art directory is refused with the parser reason', async () => {
    await seedDeck()

    const result = await runCli(['set-list-image', 'burn', '--file', '../secrets.png'], dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('escapes the art directory')
  })

  test('two modes at once is a usage error', async () => {
    await seedDeck()

    const result = await runCli(
      ['set-list-image', 'burn', '--card', '1', '--url', 'https://example.test/x.png'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--card')
  })

  test('--dry-run reports the change and writes nothing at all', async () => {
    const filePath = await seedDeck()
    const before = await fs.readFile(filePath, 'utf-8')

    const result = await runCli(['set-list-image', 'burn', '--card', '1', '--dry-run'], dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[dry-run]')
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
  })

  test('the card-ID backfill runs only for the modes that name a card', async () => {
    // A deck line with no `&N`: the backfill would stamp one, so whether the
    // file changed tells us whether the backfill ran. Written by hand rather
    // than through the fixture helper, whose serializer assigns ids.
    const unnumbered = path.join(dir, 'decks', 'legacy.md')
    await fs.mkdir(path.dirname(unnumbered), { recursive: true })
    await fs.writeFile(unnumbered, '---\nname: Legacy\n---\n\n## Main\n4 Brainstorm (ICE:61)\n')
    const filePath = await writeCollectionFile(dir, 'binder', {
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
    })

    // `--url` names no card, so a front-matter-only write must not rewrite
    // every list file in the workspace.
    const url = await runCli(
      ['set-list-image', 'binder', '--url', 'https://example.test/a.png'],
      dir,
    )
    expect(url.exitCode).toBe(0)
    expect(await fs.readFile(unnumbered, 'utf-8')).not.toContain('&1')

    // `--card` consumes persisted ids, so the backfill runs first.
    const card = await runCli(['set-list-image', 'binder', '--card', '1'], dir)
    expect(card.exitCode).toBe(0)
    expect(await fs.readFile(unnumbered, 'utf-8')).toContain('&1')
    expect(await fs.readFile(filePath, 'utf-8')).toContain('image:\n  card: 1')
  })

  test('--no-input with no mode flag refuses instead of prompting', async () => {
    await seedDeck()

    const result = await runCli(['set-list-image', 'burn', '--no-input'], dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Input required')
  })

  test('metadata set, unset and get all point at this command for the image key', async () => {
    await seedDeck()
    await writeCollectionFile(dir, 'binder', {
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
    })

    for (const args of [
      ['metadata', 'set', 'burn', 'image', '&1'],
      ['metadata', 'unset', 'burn', 'image'],
      ['metadata', 'get', 'burn', 'image'],
      // A flat list runs the same refusal through its own key vocabulary.
      ['metadata', 'set', 'binder', 'image', '&1'],
    ]) {
      const result = await runCli(args, dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('ritual set-list-image')
    }
  })
})
