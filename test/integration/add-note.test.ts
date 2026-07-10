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
      { quantity: 2, name: 'Sol Ring', cardId: 1 },
      { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
      { quantity: 1, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157', cardId: 3 },
    ],
  })
  await writeCollectionFile(dir, 'main', {
    entries: [
      { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
      { name: 'Mana Crypt', set: '2xm', collectorNumber: '1', finish: 'foil', cardId: 2 },
    ],
  })
  await writeWantedFile(dir, 'needs', {
    entries: [
      { name: 'Demonic Tutor', cardId: 1 },
      { name: 'Underground Sea', set: 'leb', collectorNumber: '286', cardId: 2 },
    ],
  })
})

afterEach(async () => {
  await removeWorkspace(dir)
})

describe('add-note CLI (Integration)', () => {
  test('sets a note on a deck card and writes a changelog entry', async () => {
    const result = await runCli(
      [
        'add-note',
        '--deck',
        'test',
        'Sol',
        'Ring',
        '--note',
        'starts the engine',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as { cardId: number; note: string }
    expect(json.cardId).toBe(1)
    expect(json.note).toBe('starts the engine')

    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('2 Sol Ring {starts the engine} &1')

    const changelog = await fs.readFile(path.join(dir, 'decks', 'test.changes.md'), 'utf-8')
    expect(changelog).toContain('Set note on "Sol Ring" &1 to "starts the engine"')
  })

  test('fails with usage_error when card name is ambiguous across printings', async () => {
    const result = await runCli(
      ['add-note', '--deck', 'test', 'Lightning', 'Bolt', '--note', 'burn', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as {
      error: { code: string; message: string; details?: { matches: unknown[] } }
    }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain("Multiple cards match 'Lightning Bolt'")
    expect(err.error.details?.matches).toHaveLength(2)
  })

  test('--card-id resolves ambiguity', async () => {
    const result = await runCli(
      ['add-note', '--deck', 'test', '--card-id', '3', '--note', 'reprint', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('1 Lightning Bolt (2XM:157) {reprint} &3')
    // The other Lightning Bolt printing must remain untouched.
    expect(deckContent).toContain('1 Lightning Bolt (LEA:161) &2')
  })

  test('refuses to overwrite an existing note without --overwrite', async () => {
    await runCli(['add-note', '--deck', 'test', 'Sol', 'Ring', '--note', 'first'], dir)
    const result = await runCli(
      ['add-note', '--deck', 'test', 'Sol', 'Ring', '--note', 'second', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('--overwrite')
  })

  test('--overwrite replaces an existing note', async () => {
    await runCli(['add-note', '--deck', 'test', 'Sol', 'Ring', '--note', 'first'], dir)
    const result = await runCli(
      [
        'add-note',
        '--deck',
        'test',
        'Sol',
        'Ring',
        '--note',
        'second',
        '--overwrite',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as { note: string; previousNote?: string }
    expect(json.note).toBe('second')
    expect(json.previousNote).toBe('first')
    const content = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(content).toContain('2 Sol Ring {second} &1')
  })

  test('updates a collection card by name', async () => {
    const result = await runCli(
      [
        'add-note',
        '--collection',
        'main',
        'Mana',
        'Crypt',
        '--note',
        'fast mana',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Mana Crypt (2XM:1) [foil] {fast mana} &2')
  })

  test('updates a wanted-list card by name', async () => {
    const result = await runCli(
      ['add-note', '--wanted', 'needs', 'Demonic', '--note', 'old shtick', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
    expect(content).toContain('- Demonic Tutor {old shtick} &1')
  })

  test('rejects an empty --note with usage_error', async () => {
    const result = await runCli(
      ['add-note', '--deck', 'test', 'Sol', 'Ring', '--note', '', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('cannot be empty')
    // No existing note → no clear-note suggestion (would be misleading).
    expect(err.error.message).not.toContain('clear-note')
  })

  test('empty --note on a card with an existing note suggests clear-note', async () => {
    await runCli(['add-note', '--deck', 'test', 'Sol', 'Ring', '--note', 'first'], dir)
    const result = await runCli(
      [
        'add-note',
        '--deck',
        'test',
        'Sol',
        'Ring',
        '--note',
        '',
        '--overwrite',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('clear-note')
  })

  test('returns not_found exit code when the list is missing', async () => {
    const result = await runCli(
      ['add-note', '--deck', 'nonexistent', 'Sol', 'Ring', '--note', 'x', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as { error: { code: string } }
    expect(err.error.code).toBe('not_found')
  })

  test('rejects --card-id 0 with usage_error', async () => {
    const result = await runCli(
      ['add-note', '--deck', 'test', '--card-id', '0', '--note', 'x', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('positive integer')
  })

  test('rejects floating-point --card-id with usage_error', async () => {
    const result = await runCli(
      ['add-note', '--deck', 'test', '--card-id', '1.5', '--note', 'x', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('positive integer')
  })

  test('trims surrounding whitespace from --note', async () => {
    const result = await runCli(
      ['add-note', '--deck', 'test', 'Sol', 'Ring', '--note', '  spaced  ', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as { note: string }
    expect(json.note).toBe('spaced')
    const content = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(content).toContain('2 Sol Ring {spaced} &1')
  })

  test('rejects notes containing newlines with usage_error', async () => {
    const result = await runCli(
      [
        'add-note',
        '--deck',
        'test',
        'Sol',
        'Ring',
        '--note',
        'line one\nline two',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('control characters')
  })

  test('still finds the right collection card when a malformed line precedes it', async () => {
    // Reproduces the position-desync bug: parseCollectionFile silently skips lines
    // missing set + collector number (warning entries), but applyNoteToList must
    // still target by structural match, not by 1-based line position. The
    // `ensureCardIdsForAllLists` startup hook will backfill an &N ID on the
    // malformed line — we verify only that the target card is updated and the
    // malformed line is left otherwise unchanged. The raw markdown is the point
    // here (a line outside the collection grammar), so it stays inline.
    await fs.writeFile(
      path.join(dir, 'collections', 'main.md'),
      '# main\n\n- Sol Ring\n- Mana Crypt (2XM:1) [foil] &2\n',
    )
    const result = await runCli(
      [
        'add-note',
        '--collection',
        'main',
        '--card-id',
        '2',
        '--note',
        'fast mana',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    // The malformed `- Sol Ring` line must NOT have a {fast mana} note attached
    // — that would prove a position-desync regression.
    expect(content).not.toMatch(/^- Sol Ring.*\{fast mana\}/m)
    expect(content).toContain('- Mana Crypt (2XM:1) [foil] {fast mana} &2')
  })
})
