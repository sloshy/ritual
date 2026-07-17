import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { createWorkspace, removeWorkspace, seedCardTargetWorkspace } from './helpers/workspace'

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
  await seedCardTargetWorkspace(dir, { withNotes: true })
})

afterEach(async () => {
  await removeWorkspace(dir)
})

describe('note CLI — setting (Integration)', () => {
  test('sets a note on a deck card and writes a changelog entry', async () => {
    const result = await runCli(
      ['note', '--deck', 'test', 'Sol', 'Ring', '--note', 'starts the engine', '--output', 'json'],
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

  test('replaces an existing note without any extra flag', async () => {
    await runCli(['note', '--deck', 'test', 'Sol', 'Ring', '--note', 'first'], dir)
    const result = await runCli(
      ['note', '--deck', 'test', 'Sol', 'Ring', '--note', 'second', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as { note: string; previousNote?: string }
    expect(json.note).toBe('second')
    expect(json.previousNote).toBe('first')
    const content = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(content).toContain('2 Sol Ring {second} &1')
    expect(content).not.toContain('{first}')
  })

  test('fails with usage_error when card name is ambiguous across printings', async () => {
    // Shallow pin only — remove-card.test.ts holds the representative deep
    // assertion on the ambiguity payload (details.matches shape).
    const result = await runCli(
      ['note', '--deck', 'test', 'Lightning', 'Bolt', '--note', 'burn', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Multiple cards match')
  })

  test('--card-id resolves ambiguity', async () => {
    const result = await runCli(
      ['note', '--deck', 'test', '--card-id', '2', '--note', 'original', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('1 Lightning Bolt (LEA:161) {original} &2')
    // The other Lightning Bolt printing must remain untouched.
    expect(deckContent).toContain('1 Lightning Bolt (2XM:157) {reprint} &3')
  })

  test('updates a collection card by name', async () => {
    const result = await runCli(
      ['note', '--collection', 'main', 'Mana', 'Crypt', '--note', 'fast mana', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Mana Crypt (2XM:1) [foil] {fast mana} &2')
  })

  test('updates a wanted-list card by name', async () => {
    const result = await runCli(
      ['note', '--wanted', 'needs', 'Underground', '--note', 'dual land', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
    expect(content).toContain('- Underground Sea (LEB:286) {dual land} &2')
  })

  test('rejects an empty --note with usage_error suggesting --clear', async () => {
    const result = await runCli(
      ['note', '--deck', 'test', 'Sol', 'Ring', '--note', '', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('cannot be empty')
    expect(err.error.message).toContain('--clear')
  })

  test('rejects a whitespace-only --note with usage_error', async () => {
    const result = await runCli(
      ['note', '--deck', 'test', 'Sol', 'Ring', '--note', '   ', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string } }
    expect(err.error.code).toBe('usage_error')
  })

  test('fails with usage_error in non-TTY when neither --note nor --clear is given', async () => {
    const result = await runCli(['note', '--deck', 'test', 'Sol', 'Ring', '--output', 'json'], dir)
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('--note')
    expect(err.error.message).toContain('--clear')
  })

  test('rejects combining --note with --clear', async () => {
    // Commander enforces the conflict; index.ts maps CommanderError → UsageError.
    const result = await runCli(
      ['note', '--deck', 'test', 'Sol', 'Ring', '--note', 'x', '--clear'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('cannot be used with')
  })

  test('trims surrounding whitespace from --note', async () => {
    const result = await runCli(
      ['note', '--deck', 'test', 'Sol', 'Ring', '--note', '  spaced  ', '--output', 'json'],
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
      ['note', '--deck', 'test', 'Sol', 'Ring', '--note', 'line one\nline two', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('control characters')
  })

  test('returns not_found exit code when the list is missing', async () => {
    const result = await runCli(
      ['note', '--deck', 'nonexistent', 'Sol', 'Ring', '--note', 'x', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as { error: { code: string } }
    expect(err.error.code).toBe('not_found')
  })

  test('returns not_found exit code when no card matches the name', async () => {
    const result = await runCli(
      ['note', '--deck', 'test', 'Black', 'Lotus', '--note', 'x', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as { error: { code: string } }
    expect(err.error.code).toBe('not_found')
  })

  test('rejects --card-id 0 with usage_error', async () => {
    const result = await runCli(
      ['note', '--deck', 'test', '--card-id', '0', '--note', 'x', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('positive integer')
  })

  test('rejects floating-point --card-id with usage_error', async () => {
    const result = await runCli(
      ['note', '--deck', 'test', '--card-id', '1.5', '--note', 'x', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('positive integer')
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
      ['note', '--collection', 'main', '--card-id', '2', '--note', 'fast mana', '--output', 'json'],
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

describe('note CLI — clearing (Integration)', () => {
  test('clears the note on a deck card and writes a changelog entry', async () => {
    const result = await runCli(
      ['note', '--deck', 'test', '--card-id', '3', '--clear', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as {
      cardId: number
      cleared: boolean
      previousNote: string | null
    }
    expect(json.cardId).toBe(3)
    expect(json.cleared).toBe(true)
    expect(json.previousNote).toBe('reprint')

    const content = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(content).toContain('1 Lightning Bolt (2XM:157) &3')
    expect(content).not.toContain('{reprint}')

    const changelog = await fs.readFile(path.join(dir, 'decks', 'test.changes.md'), 'utf-8')
    expect(changelog).toContain('Cleared note on "Lightning Bolt" &3')
  })

  test('is idempotent: clearing a card without a note succeeds with no changelog', async () => {
    const result = await runCli(
      ['note', '--deck', 'test', '--card-id', '2', '--clear', '--output', 'json'],
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

  test('clears a collection card', async () => {
    const result = await runCli(
      ['note', '--collection', 'main', 'Sol', 'Ring', '--clear', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).toContain('- Sol Ring (C21:240) &1')
    expect(content).not.toContain('{first edition}')
  })

  test('clears a wanted-list card', async () => {
    const result = await runCli(
      ['note', '--wanted', 'needs', 'Demonic', '--clear', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
    expect(content).toContain('- Demonic Tutor &1')
    expect(content).not.toContain('{old shtick}')
  })
})
