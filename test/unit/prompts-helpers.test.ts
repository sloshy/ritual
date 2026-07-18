import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import prompts, { type Choice } from 'prompts'
import { ask, promptExitMenu, suggestByTitleTerms } from '../../src/commands/prompts-helpers'
import { setNoInputOverride } from '../../src/no-input'

// `ask` refuses to prompt without a terminal; these tests simulate an
// interactive session via prompts.inject, so pretend stdin is a TTY.
const originalIsTty = process.stdin.isTTY
beforeAll(() => {
  process.stdin.isTTY = true
})
afterAll(() => {
  process.stdin.isTTY = originalIsTty
})

describe('suggestByTitleTerms', () => {
  const choices: Choice[] = [
    { title: '🎴 Winota Stax', value: 'deck' },
    { title: '📦 Main Binder', value: 'collection' },
    { title: '🎯 To Buy', value: 'wanted' },
  ]

  test('matches terms anywhere in the title, past the leading icon', async () => {
    const matched = await suggestByTitleTerms('binder', choices)
    expect(matched.map((c) => c.value)).toEqual(['collection'])
  })
})

describe('ask under --no-input', () => {
  test('throws a usage error instead of prompting', async () => {
    setNoInputOverride(true)
    try {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's rejects matcher resolves at runtime but its type doesn't expose Promise.
      await expect(ask<string>({ type: 'text', message: 'Card name?' })).rejects.toThrow(
        'Input required: Card name? (prompts are disabled)',
      )
    } finally {
      setNoInputOverride(undefined)
    }
  })
})

describe('ask', () => {
  test('returns the answered value', async () => {
    prompts.inject(['Winota'])
    expect(await ask<string>({ type: 'text', message: 'Name?' })).toBe('Winota')
  })

  test('returns undefined when the user cancels', async () => {
    prompts.inject([new Error('cancelled')])
    expect(await ask<string>({ type: 'text', message: 'Name?' })).toBeUndefined()
  })
})

describe('promptExitMenu', () => {
  test('treats cancelling the prompt as Cancel (keep editing)', async () => {
    prompts.inject([new Error('cancelled')])
    expect(await promptExitMenu(1)).toBe('cancel')
  })
})
