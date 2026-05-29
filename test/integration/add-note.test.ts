import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { runCli } from './helpers/cli'

async function setupFixture(): Promise<string> {
  const dir = path.join(tmpdir(), `ritual-add-note-${crypto.randomUUID()}`)
  await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
  await fs.mkdir(path.join(dir, 'collections'), { recursive: true })
  await fs.mkdir(path.join(dir, 'wanted'), { recursive: true })
  await fs.writeFile(
    path.join(dir, 'ritual.config.json'),
    JSON.stringify({ decksDir: './decks', collectionsDir: './collections', wantedDir: './wanted' }),
  )
  await fs.writeFile(
    path.join(dir, 'decks', 'test.md'),
    '---\nname: Test Deck\n---\n\n## Main\n2 Sol Ring &1\n1 Lightning Bolt (LEA:161) &2\n1 Lightning Bolt (2XM:157) &3\n',
  )
  await fs.writeFile(
    path.join(dir, 'collections', 'main.md'),
    '# main\n\n- Sol Ring (C21:240) &1\n- Mana Crypt (2XM:1) [foil] &2\n',
  )
  await fs.writeFile(
    path.join(dir, 'wanted', 'needs.md'),
    '# needs\n\n- Demonic Tutor &1\n- Underground Sea (LEB:286) &2\n',
  )
  return dir
}

async function teardown(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}

describe('add-note CLI (Integration)', () => {
  test('sets a note on a deck card and writes a changelog entry', async () => {
    const dir = await setupFixture()
    try {
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
    } finally {
      await teardown(dir)
    }
  })

  test('fails with usage_error when card name is ambiguous across printings', async () => {
    const dir = await setupFixture()
    try {
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
    } finally {
      await teardown(dir)
    }
  })

  test('--card-id resolves ambiguity', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['add-note', '--deck', 'test', '--card-id', '3', '--note', 'reprint', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(deckContent).toContain('1 Lightning Bolt (2XM:157) {reprint} &3')
      // The other Lightning Bolt printing must remain untouched.
      expect(deckContent).toContain('1 Lightning Bolt (LEA:161) &2')
    } finally {
      await teardown(dir)
    }
  })

  test('refuses to overwrite an existing note without --overwrite', async () => {
    const dir = await setupFixture()
    try {
      await runCli(['add-note', '--deck', 'test', 'Sol', 'Ring', '--note', 'first'], dir)
      const result = await runCli(
        ['add-note', '--deck', 'test', 'Sol', 'Ring', '--note', 'second', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('--overwrite')
    } finally {
      await teardown(dir)
    }
  })

  test('--overwrite replaces an existing note', async () => {
    const dir = await setupFixture()
    try {
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
    } finally {
      await teardown(dir)
    }
  })

  test('updates a collection card by name', async () => {
    const dir = await setupFixture()
    try {
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
    } finally {
      await teardown(dir)
    }
  })

  test('updates a wanted-list card by name', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['add-note', '--wanted', 'needs', 'Demonic', '--note', 'old shtick', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
      expect(content).toContain('- Demonic Tutor {old shtick} &1')
    } finally {
      await teardown(dir)
    }
  })

  test('rejects an empty --note with usage_error', async () => {
    const dir = await setupFixture()
    try {
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
    } finally {
      await teardown(dir)
    }
  })

  test('empty --note on a card with an existing note suggests clear-note', async () => {
    const dir = await setupFixture()
    try {
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
    } finally {
      await teardown(dir)
    }
  })

  test('rejects a whitespace-only --note as effectively empty', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['add-note', '--deck', 'test', 'Sol', 'Ring', '--note', '   ', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as { error: { code: string } }
      expect(err.error.code).toBe('usage_error')
    } finally {
      await teardown(dir)
    }
  })

  test('returns not_found exit code when the list is missing', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['add-note', '--deck', 'nonexistent', 'Sol', 'Ring', '--note', 'x', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(3)
      const err = JSON.parse(result.stderr) as { error: { code: string } }
      expect(err.error.code).toBe('not_found')
    } finally {
      await teardown(dir)
    }
  })

  test('rejects --card-id 0 with usage_error', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['add-note', '--deck', 'test', '--card-id', '0', '--note', 'x', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('positive integer')
    } finally {
      await teardown(dir)
    }
  })

  test('rejects negative --card-id with usage_error', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['add-note', '--deck', 'test', '--card-id', '-5', '--note', 'x', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
    } finally {
      await teardown(dir)
    }
  })

  test('rejects floating-point --card-id with usage_error', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['add-note', '--deck', 'test', '--card-id', '1.5', '--note', 'x', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
    } finally {
      await teardown(dir)
    }
  })

  test('trims surrounding whitespace from --note', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['add-note', '--deck', 'test', 'Sol', 'Ring', '--note', '  spaced  ', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { note: string }
      expect(json.note).toBe('spaced')
      const content = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(content).toContain('2 Sol Ring {spaced} &1')
    } finally {
      await teardown(dir)
    }
  })

  test('rejects notes containing newlines with usage_error', async () => {
    const dir = await setupFixture()
    try {
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
    } finally {
      await teardown(dir)
    }
  })

  test('rejects notes containing tabs with usage_error', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['add-note', '--deck', 'test', 'Sol', 'Ring', '--note', 'a\tb', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
    } finally {
      await teardown(dir)
    }
  })

  test('still finds the right collection card when a malformed line precedes it', async () => {
    // Reproduces the position-desync bug: parseCollectionFile silently skips lines
    // missing set + collector number (warning entries), but applyNoteToList must
    // still target by structural match, not by 1-based line position. The
    // `ensureCardIdsForAllLists` startup hook will backfill an &N ID on the
    // malformed line — we verify only that the target card is updated and the
    // malformed line is left otherwise unchanged.
    const dir = await setupFixture()
    try {
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
    } finally {
      await teardown(dir)
    }
  })
})
