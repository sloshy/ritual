import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { createWorkspace, removeWorkspace, seedCardTargetWorkspace } from './helpers/workspace'

type RemoveCardJson = {
  type: string
  list: string
  cardName: string
  cardId?: number
  removed: number
  remaining: number
}

type ErrorJson = {
  error: { code: string; message: string; details?: { matches?: unknown[]; quantity?: number } }
}

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
  await seedCardTargetWorkspace(dir)
})

afterEach(async () => {
  await removeWorkspace(dir)
})

describe('remove-card CLI (Integration)', () => {
  test('removes one copy from a deck line and reports the remainder', async () => {
    const result = await runCli(
      ['remove-card', '--deck', 'test', 'Sol', 'Ring', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as RemoveCardJson
    expect(json.cardId).toBe(1)
    expect(json.removed).toBe(1)
    expect(json.remaining).toBe(1)

    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('1 Sol Ring &1')

    const changelog = await fs.readFile(path.join(dir, 'decks', 'test.changes.md'), 'utf-8')
    expect(changelog).toContain('Removed "Sol Ring" &1')
  })

  test('-q removes that many copies and drops the line at zero', async () => {
    const result = await runCli(
      ['remove-card', '--deck', 'test', 'Sol', 'Ring', '-q', '2', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as RemoveCardJson
    expect(json.removed).toBe(2)
    expect(json.remaining).toBe(0)
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).not.toContain('Sol Ring')
  })

  test('--all-copies removes the whole deck line', async () => {
    const result = await runCli(
      ['remove-card', '--deck', 'test', 'Sol', 'Ring', '--all-copies', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as RemoveCardJson
    expect(json.removed).toBe(2)
    expect(json.remaining).toBe(0)
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).not.toContain('Sol Ring')
  })

  test('rejects -q above the deck line quantity, reporting the actual quantity', async () => {
    const result = await runCli(
      ['remove-card', '--deck', 'test', 'Sol', 'Ring', '-q', '3', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('the deck has 2')
    expect(err.error.details?.quantity).toBe(2)
    // Nothing was written.
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).toContain('2 Sol Ring &1')
  })

  test('rejects -q together with --all-copies', async () => {
    const result = await runCli(
      [
        'remove-card',
        '--deck',
        'test',
        'Sol',
        'Ring',
        '-q',
        '2',
        '--all-copies',
        '--output',
        'json',
      ],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('mutually exclusive')
  })

  test('removes a collection entry, leaving the others untouched', async () => {
    const result = await runCli(
      ['remove-card', '--collection', 'main', 'Mana', 'Crypt', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as RemoveCardJson
    expect(json.removed).toBe(1)
    expect(json.remaining).toBe(0)
    const content = await fs.readFile(path.join(dir, 'collections', 'main.md'), 'utf-8')
    expect(content).not.toContain('Mana Crypt')
    expect(content).toContain('- Sol Ring (C21:240) &1')

    const changelog = await fs.readFile(path.join(dir, 'collections', 'main.changes.md'), 'utf-8')
    expect(changelog).toContain('Removed "Mana Crypt"')
  })

  test('removes a wanted-list entry by name', async () => {
    const result = await runCli(
      ['remove-card', '--wanted', 'needs', 'Demonic', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(path.join(dir, 'wanted', 'needs.md'), 'utf-8')
    expect(content).not.toContain('Demonic Tutor')
    expect(content).toContain('- Underground Sea (LEB:286) &2')
  })

  test('rejects -q > 1 on a flat list with usage_error', async () => {
    const result = await runCli(
      ['remove-card', '--collection', 'main', 'Sol', 'Ring', '-q', '2', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('one physical card')
  })

  test('rejects --all-copies on a flat list with usage_error', async () => {
    const result = await runCli(
      ['remove-card', '--wanted', 'needs', 'Demonic', '--all-copies', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain('one physical card')
  })

  test('fails with usage_error when the card name is ambiguous', async () => {
    const result = await runCli(
      ['remove-card', '--deck', 'test', 'Lightning', 'Bolt', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(2)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('usage_error')
    expect(err.error.message).toContain("Multiple cards match 'Lightning Bolt'")
    expect(err.error.details?.matches).toHaveLength(2)
  })

  test('--card-id resolves ambiguity and only removes that entry', async () => {
    const result = await runCli(
      ['remove-card', '--deck', 'test', '--card-id', '3', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(0)
    const deckContent = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
    expect(deckContent).not.toContain('(2XM:157)')
    expect(deckContent).toContain('1 Lightning Bolt (LEA:161) &2')
  })

  test('returns not_found for a card that is not in the list', async () => {
    const result = await runCli(
      ['remove-card', '--deck', 'test', 'Black', 'Lotus', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('not_found')
  })

  test('returns not_found when the list is missing', async () => {
    const result = await runCli(
      ['remove-card', '--deck', 'nonexistent', 'Sol', 'Ring', '--output', 'json'],
      dir,
    )
    expect(result.exitCode).toBe(3)
    const err = JSON.parse(result.stderr) as ErrorJson
    expect(err.error.code).toBe('not_found')
  })
})
