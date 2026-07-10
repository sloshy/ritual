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
} from './helpers/workspace'

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
  await writeDeckFile(dir, 'test', {
    frontMatter: { name: 'Test Deck' },
    cards: [
      { quantity: 2, name: 'Sol Ring', note: 'fast mana', cardId: 1 },
      { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
      {
        quantity: 1,
        name: 'Lightning Bolt',
        set: '2xm',
        collectorNumber: '157',
        note: 'reprint',
        cardId: 3,
      },
    ],
  })
  await writeCollectionFile(dir, 'main', {
    entries: [
      { name: 'Sol Ring', set: 'c21', collectorNumber: '240', note: 'first edition', cardId: 1 },
      { name: 'Mana Crypt', set: '2xm', collectorNumber: '1', finish: 'foil', cardId: 2 },
    ],
  })
  await writeWantedFile(dir, 'needs', {
    entries: [
      { name: 'Demonic Tutor', note: 'old shtick', cardId: 1 },
      { name: 'Underground Sea', set: 'leb', collectorNumber: '286', cardId: 2 },
    ],
  })
})

afterEach(async () => {
  await removeWorkspace(dir)
})

describe('clear-note CLI (Integration)', () => {
  test('clears the note on a deck card and writes a changelog entry', async () => {
    const result = await runCli(
      ['clear-note', '--deck', 'test', 'Sol', 'Ring', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as {
      cardId: number
      cleared: boolean
      previousNote: string | null
    }
    expect(json.cardId).toBe(1)
    expect(json.cleared).toBe(true)
    expect(json.previousNote).toBe('fast mana')

    const content = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(content).toContain('2 Sol Ring &1')
    expect(content).not.toContain('{fast mana}')

    const changelog = await fs.readFile(path.join(dir, 'decks', 'test.changes.md'), 'utf-8')
    expect(changelog).toContain('Cleared note on "Sol Ring" &1')
  })

  test('is idempotent: clearing a card without a note succeeds with no changelog', async () => {
    const result = await runCli(
      ['clear-note', '--deck', 'test', '--card-id', '2', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as { cleared: boolean; previousNote: string | null }
    expect(json.cleared).toBe(false)
    expect(json.previousNote).toBeNull()

    const content = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    // File is unchanged.
    expect(content).toContain('1 Lightning Bolt (LEA:161) &2')

    // No changelog entry — the file should not exist or contain nothing relevant.
    const changelogPath = path.join(dir, 'decks', 'test.changes.md')
    const changelogExists = await Bun.file(changelogPath).exists()
    if (changelogExists) {
      const changelog = await fs.readFile(changelogPath, 'utf-8')
      expect(changelog).not.toContain('Cleared note on "Lightning Bolt"')
    }
  })

  test('fails with usage_error when the card name is ambiguous across printings', async () => {
    const result = await runCli(
      ['clear-note', '--deck', 'test', 'Lightning', 'Bolt', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain("Multiple cards match 'Lightning Bolt'")
  })

  test('--card-id resolves ambiguity', async () => {
    const result = await runCli(
      ['clear-note', '--deck', 'test', '--card-id', '3', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as { cleared: boolean; previousNote: string | null }
    expect(json.cleared).toBe(true)
    expect(json.previousNote).toBe('reprint')
    const content = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(content).toContain('1 Lightning Bolt (2XM:157) &3')
    expect(content).not.toContain('{reprint}')
  })

  test('clears a collection card', async () => {
    const result = await runCli(
      ['clear-note', '--collection', 'main', 'Sol', 'Ring', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C21:240) &1')
    expect(content).not.toContain('{first edition}')
  })

  test('clears a wanted-list card', async () => {
    const result = await runCli(
      ['clear-note', '--wanted', 'needs', 'Demonic', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
    expect(content).toContain('- Demonic Tutor &1')
    expect(content).not.toContain('{old shtick}')
  })
})
