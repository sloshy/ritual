import { describe, expect, test } from 'bun:test'
import prompts, { type Choice } from 'prompts'
import {
  ask,
  promptExitMenu,
  resolveImportPrintings,
  suggestByTitleTerms,
} from '../../src/commands/prompts-helpers'
import { normalizeScriptingOptions } from '../../src/commands/scripting'
import { setNoInputOverride } from '../../src/no-input'
import { stubTty } from '../test-utils'

// `ask` refuses to prompt without a terminal; these tests simulate an
// interactive session via prompts.inject, so pretend stdin is a TTY.
stubTty({ stdin: true })

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
        'Input required: Card name? (prompts are disabled by --no-input / RITUAL_NO_INPUT)',
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

describe('resolveImportPrintings', () => {
  const text = normalizeScriptingOptions({})
  const json = normalizeScriptingOptions({ output: 'json' })

  test('an explicit flag answers without prompting, in both directions', async () => {
    expect(
      await resolveImportPrintings({ flag: true, deckStatesPrintings: true, scripting: text }),
    ).toBe(true)
    expect(
      await resolveImportPrintings({ flag: false, deckStatesPrintings: true, scripting: text }),
    ).toBe(false)
  })

  test('a deck stating no printings is kept vacuously, never asked about', async () => {
    expect(
      await resolveImportPrintings({
        flag: undefined,
        deckStatesPrintings: false,
        scripting: text,
      }),
    ).toBe(true)
  })

  test('under --no-input the printings are kept', async () => {
    setNoInputOverride(true)
    try {
      expect(
        await resolveImportPrintings({
          flag: undefined,
          deckStatesPrintings: true,
          scripting: text,
        }),
      ).toBe(true)
    } finally {
      setNoInputOverride(undefined)
    }
  })

  test('JSON output refuses the prompt even on a TTY', async () => {
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's rejects matcher resolves at runtime but its type doesn't expose Promise.
    await expect(
      resolveImportPrintings({ flag: undefined, deckStatesPrintings: true, scripting: json }),
    ).rejects.toThrow('--sync-printings or --no-sync-printings')
  })

  test('answers and cancellation come back distinct', async () => {
    prompts.inject([false])
    expect(
      await resolveImportPrintings({ flag: undefined, deckStatesPrintings: true, scripting: text }),
    ).toBe(false)
    prompts.inject([new Error('cancelled')])
    expect(
      await resolveImportPrintings({ flag: undefined, deckStatesPrintings: true, scripting: text }),
    ).toBeUndefined()
  })
})

describe('promptExitMenu', () => {
  test('treats cancelling the prompt as Cancel (keep editing)', async () => {
    prompts.inject([new Error('cancelled')])
    expect(await promptExitMenu(1)).toBe('cancel')
  })
})
