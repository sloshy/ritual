import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { runCli } from './helpers/cli'

async function setupFixture(): Promise<string> {
  const dir = path.join(tmpdir(), `ritual-clear-note-${crypto.randomUUID()}`)
  await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
  await fs.mkdir(path.join(dir, 'collections'), { recursive: true })
  await fs.mkdir(path.join(dir, 'wanted'), { recursive: true })
  await fs.writeFile(
    path.join(dir, 'ritual.config.json'),
    JSON.stringify({ decksDir: './decks', collectionsDir: './collections', wantedDir: './wanted' }),
  )
  await fs.writeFile(
    path.join(dir, 'decks', 'test.md'),
    '---\nname: Test Deck\n---\n\n## Main\n2 Sol Ring {fast mana} &1\n1 Lightning Bolt (LEA:161) &2\n1 Lightning Bolt (2XM:157) {reprint} &3\n',
  )
  await fs.writeFile(
    path.join(dir, 'collections', 'main.md'),
    '# main\n\n- Sol Ring (C21:240) {first edition} &1\n- Mana Crypt (2XM:1) [foil] &2\n',
  )
  await fs.writeFile(
    path.join(dir, 'wanted', 'needs.md'),
    '# needs\n\n- Demonic Tutor {old shtick} &1\n- Underground Sea (LEB:286) &2\n',
  )
  return dir
}

async function teardown(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}

describe('clear-note CLI (Integration)', () => {
  test('clears the note on a deck card and writes a changelog entry', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['clear-note', 'deck', 'test', 'Sol', 'Ring', '--output', 'json'],
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
      expect(changelog).toContain('Cleared note on Sol Ring &1')
    } finally {
      await teardown(dir)
    }
  })

  test('is idempotent: clearing a card without a note succeeds with no changelog', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['clear-note', 'deck', 'test', '--card-id', '2', '--output', 'json'],
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
        expect(changelog).not.toContain('Cleared note on Lightning Bolt')
      }
    } finally {
      await teardown(dir)
    }
  })

  test('fails with usage_error when the card name is ambiguous across printings', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['clear-note', 'deck', 'test', 'Lightning', 'Bolt', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain("Multiple cards match 'Lightning Bolt'")
    } finally {
      await teardown(dir)
    }
  })

  test('--card-id resolves ambiguity', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['clear-note', 'deck', 'test', '--card-id', '3', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { cleared: boolean; previousNote: string | null }
      expect(json.cleared).toBe(true)
      expect(json.previousNote).toBe('reprint')
      const content = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(content).toContain('1 Lightning Bolt (2XM:157) &3')
      expect(content).not.toContain('{reprint}')
    } finally {
      await teardown(dir)
    }
  })

  test('clears a collection card', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['clear-note', 'collection', 'main', 'Sol', 'Ring', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
      expect(content).toContain('- Sol Ring (C21:240) &1')
      expect(content).not.toContain('{first edition}')
    } finally {
      await teardown(dir)
    }
  })

  test('clears a wanted-list card', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['clear-note', 'wanted', 'needs', 'Demonic', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
      expect(content).toContain('- Demonic Tutor &1')
      expect(content).not.toContain('{old shtick}')
    } finally {
      await teardown(dir)
    }
  })

  test('rejects negative --card-id with usage_error', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['clear-note', 'deck', 'test', '--card-id', '-5', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
    } finally {
      await teardown(dir)
    }
  })

  test('returns not_found when the list is missing', async () => {
    const dir = await setupFixture()
    try {
      const result = await runCli(
        ['clear-note', 'deck', 'nonexistent', 'Sol', 'Ring', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(3)
      const err = JSON.parse(result.stderr) as { error: { code: string } }
      expect(err.error.code).toBe('not_found')
    } finally {
      await teardown(dir)
    }
  })
})
