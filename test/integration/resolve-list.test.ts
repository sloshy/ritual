import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { runCli } from './helpers/cli'

/**
 * End-to-end coverage for the shared cross-type list resolver, exercised through
 * `add-note` (a type-agnostic command). Verifies flagless cross-type resolution,
 * ambiguity failure + flag disambiguation, case-insensitive matching, and the
 * unique-substring fallback.
 */

type Fixture = { decks?: Record<string, string>; collections?: Record<string, string> }

async function setupFixture(fixture: Fixture): Promise<string> {
  const dir = path.join(tmpdir(), `ritual-resolve-${crypto.randomUUID()}`)
  await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
  await fs.mkdir(path.join(dir, 'collections'), { recursive: true })
  await fs.mkdir(path.join(dir, 'wanted'), { recursive: true })
  await fs.writeFile(
    path.join(dir, 'ritual.config.json'),
    JSON.stringify({ decksDir: './decks', collectionsDir: './collections', wantedDir: './wanted' }),
  )
  for (const [name, body] of Object.entries(fixture.decks ?? {})) {
    await fs.writeFile(path.join(dir, 'decks', `${name}.md`), body)
  }
  for (const [name, body] of Object.entries(fixture.collections ?? {})) {
    await fs.writeFile(path.join(dir, 'collections', `${name}.md`), body)
  }
  return dir
}

async function teardown(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}

const DECK_BODY = '---\nname: Goblins\n---\n\n## Main\n1 Sol Ring &1\n'
const COLLECTION_BODY = '# staples\n\n- Sol Ring (C21:240) &1\n'

describe('cross-type list resolution (Integration)', () => {
  test('resolves a unique name across types without a type flag', async () => {
    const dir = await setupFixture({ decks: { goblins: DECK_BODY } })
    try {
      const result = await runCli(
        ['add-note', 'goblins', 'Sol', 'Ring', '--note', 'ramp', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { type: string; note: string }
      expect(json.type).toBe('deck')
      expect(json.note).toBe('ramp')
    } finally {
      await teardown(dir)
    }
  })

  test('fails with a usage error when a name is ambiguous across types', async () => {
    const dir = await setupFixture({
      decks: { staples: DECK_BODY },
      collections: { staples: COLLECTION_BODY },
    })
    try {
      const result = await runCli(
        ['add-note', 'staples', 'Sol', 'Ring', '--note', 'x', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('ambiguous')
      expect(err.error.message).toContain('--deck, --collection, or --wanted')
    } finally {
      await teardown(dir)
    }
  })

  test('a type flag disambiguates an otherwise-ambiguous name', async () => {
    const dir = await setupFixture({
      decks: { staples: DECK_BODY },
      collections: { staples: COLLECTION_BODY },
    })
    try {
      const result = await runCli(
        ['add-note', '--collection', 'staples', 'Sol', 'Ring', '--note', 'x', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { type: string }
      expect(json.type).toBe('collection')
    } finally {
      await teardown(dir)
    }
  })

  test('rejects conflicting type flags with a usage error', async () => {
    const dir = await setupFixture({ decks: { staples: DECK_BODY } })
    try {
      const result = await runCli(
        [
          'add-note',
          '--deck',
          '--collection',
          'staples',
          'Sol',
          'Ring',
          '--note',
          'x',
          '--output',
          'json',
        ],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('only one of --deck, --collection, or --wanted')
    } finally {
      await teardown(dir)
    }
  })

  test('matches a name case-insensitively', async () => {
    const dir = await setupFixture({ decks: { Goblins: DECK_BODY } })
    try {
      const result = await runCli(
        ['add-note', 'GOBLINS', 'Sol', 'Ring', '--note', 'x', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      expect((JSON.parse(result.stdout) as { type: string }).type).toBe('deck')
    } finally {
      await teardown(dir)
    }
  })

  test('falls back to a unique substring match', async () => {
    const dir = await setupFixture({ decks: { 'mono-red-burn': DECK_BODY } })
    try {
      const result = await runCli(
        ['add-note', 'burn', 'Sol', 'Ring', '--note', 'x', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(0)
      expect((JSON.parse(result.stdout) as { type: string }).type).toBe('deck')
    } finally {
      await teardown(dir)
    }
  })

  test('a substring that matches across types is ambiguous', async () => {
    const dir = await setupFixture({
      decks: { 'goblin-aggro': DECK_BODY },
      collections: { 'goblin-combo': COLLECTION_BODY },
    })
    try {
      const result = await runCli(
        ['add-note', 'goblin', 'Sol', 'Ring', '--note', 'x', '--output', 'json'],
        dir,
      )
      expect(result.exitCode).toBe(2)
      const err = JSON.parse(result.stderr) as { error: { code: string; message: string } }
      expect(err.error.code).toBe('usage_error')
      expect(err.error.message).toContain('ambiguous')
    } finally {
      await teardown(dir)
    }
  })
})
