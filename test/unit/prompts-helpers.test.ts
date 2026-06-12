import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import { ask, promptExitMenu } from '../../src/commands/prompts-helpers'

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
