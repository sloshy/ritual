import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import { ask } from '../../src/commands/prompts-helpers'

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
