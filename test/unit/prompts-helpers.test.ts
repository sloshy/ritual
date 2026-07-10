import { describe, expect, test } from 'bun:test'
import prompts, { type Choice } from 'prompts'
import { ask, promptExitMenu, suggestByTitleTerms } from '../../src/commands/prompts-helpers'

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
