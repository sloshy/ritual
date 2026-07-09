import { describe, expect, test } from 'bun:test'
import prompts, { type Choice } from 'prompts'
import { ask, promptExitMenu, suggestByTitleTerms } from '../../src/commands/prompts-helpers'

describe('suggestByTitleTerms', () => {
  const choices: Choice[] = [
    { title: '🎴 Winota Stax', value: 'deck' },
    { title: '📦 Main Binder', value: 'collection' },
    { title: '🎯 To Buy', value: 'wanted' },
  ]
  const titles = async (input: unknown): Promise<string[]> =>
    (await suggestByTitleTerms(input, choices)).map((c) => c.title)

  test('empty input keeps every choice', async () => {
    expect(await titles('')).toHaveLength(3)
  })

  test('matches terms anywhere in the title, past the leading icon', async () => {
    expect(await titles('binder')).toEqual(['📦 Main Binder'])
  })

  test('every whitespace-separated term must match', async () => {
    expect(await titles('winota stax')).toEqual(['🎴 Winota Stax'])
    expect(await titles('winota binder')).toEqual([])
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
  test('returns save when picked, with a change count given', async () => {
    prompts.inject(['save'])
    expect(await promptExitMenu(3)).toBe('save')
  })

  test('returns discard when picked, without a change count', async () => {
    prompts.inject(['discard'])
    expect(await promptExitMenu()).toBe('discard')
  })

  test('treats cancelling the prompt as Cancel (keep editing)', async () => {
    prompts.inject([new Error('cancelled')])
    expect(await promptExitMenu(1)).toBe('cancel')
  })
})
