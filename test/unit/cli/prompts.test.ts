import { afterEach, describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import prompts, { type Choice } from 'prompts'
import {
  ask,
  askSequence,
  menuPageSize,
  promptCredentials,
  promptExitMenu,
  resolveImportPrintings,
  suggestByTitleTerms,
  withMenuPageSize,
  type UndeclaredPromptOptions,
} from '../../../src/cli/prompts'
import { normalizeScriptingOptions } from '../../../src/cli/output'
import { setNoInputOverride } from '../../../src/util/no-input'
import { registerCliMessages } from '../../../src/i18n/register/cli'
import { stubTty } from '../../test-utils'

// The refusal prose asserted below only exists once the CLI catalog is registered.
registerCliMessages()

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

describe('menu page sizing', () => {
  const realRows = process.stdout.rows
  afterEach(() => {
    process.stdout.rows = realRows
  })

  /** Pretend the terminal is `rows` tall, or of unknown height. */
  function setTerminalRows(rows: number | undefined): void {
    process.stdout.rows = rows as number
  }

  /** A bare list prompt, typed wide enough to read either page option. */
  function question(
    type: 'autocomplete' | 'select' | 'multiselect' | 'autocompleteMultiselect',
    own: UndeclaredPromptOptions & { limit?: number } = {},
  ): prompts.PromptObject<string> & UndeclaredPromptOptions {
    return { type, name: 'v', message: 'm', ...own }
  }

  test('a tall terminal is filled, keeping a few rows for the question around the list', () => {
    expect(menuPageSize(50)).toBe(45)
  })

  test("a short terminal, or one of unknown height, still gets the library's own page", () => {
    expect(menuPageSize(12)).toBe(10)
    setTerminalRows(undefined)
    expect(menuPageSize()).toBe(10)
  })

  test('autocompletes are sized by limit from the height when the prompt opens', () => {
    setTerminalRows(40)
    expect(withMenuPageSize(question('autocomplete')).limit).toBe(35)
    setTerminalRows(60)
    expect(withMenuPageSize(question('autocomplete')).limit).toBe(55)
  })

  test('selects are sized by optionsPerPage', () => {
    setTerminalRows(40)
    expect(withMenuPageSize(question('select')).optionsPerPage).toBe(35)
  })

  test.each(['multiselect', 'autocompleteMultiselect'] as const)(
    '%s leaves room for its instructions block',
    (type) => {
      setTerminalRows(40)
      expect(withMenuPageSize(question(type)).optionsPerPage).toBe(29)
    },
  )

  test("a prompt's own page size is kept", () => {
    setTerminalRows(40)
    expect(withMenuPageSize(question('autocomplete', { limit: 7 })).limit).toBe(7)
    expect(withMenuPageSize(question('select', { optionsPerPage: 7 })).optionsPerPage).toBe(7)
  })

  test('other prompt types pass through untouched', () => {
    const text: prompts.PromptObject<string> = { type: 'text', name: 'v', message: 'm' }
    expect(withMenuPageSize(text)).toBe(text)
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

/** A stdin the `prompts` library accepts as a terminal. */
type FakeTtyStdin = PassThrough & { isTTY: boolean; setRawMode: () => void }

describe('ask with an autocomplete', () => {
  test('a first Esc clears the typed text and keeps the prompt open; a second backs out', async () => {
    const stdin = new PassThrough() as FakeTtyStdin
    stdin.isTTY = true
    stdin.setRawMode = () => undefined
    let settled = false
    const answer = ask<string>({
      type: 'autocomplete',
      message: 'Card name?',
      choices: [{ title: 'Sol Ring', value: 'Sol Ring' }],
      stdin,
      stdout: new PassThrough(),
    }).finally(() => {
      settled = true
    })

    // A lone ESC only becomes a keypress after readline's escape timeout, so
    // wait for the keypress itself (registered after the prompt's own handler,
    // then one more turn for it to settle) rather than for a guessed delay.
    const pressed = (name: string): Promise<void> =>
      new Promise((resolve) => {
        const onKey = (_text: unknown, key?: { name?: string }): void => {
          if (key?.name !== name) return
          stdin.off('keypress', onKey)
          setImmediate(resolve)
        }
        stdin.on('keypress', onKey)
      })

    stdin.write('Sol')
    const firstEsc = pressed('escape')
    stdin.write('\x1b')
    await firstEsc
    expect(settled).toBeFalse()

    const secondEsc = pressed('escape')
    stdin.write('\x1b')
    await secondEsc
    expect(await answer).toBeUndefined()
  })
})

describe('promptCredentials', () => {
  test('collects both answers', async () => {
    prompts.inject(['user', 'pw'])
    expect(await promptCredentials()).toEqual({ username: 'user', password: 'pw' })
  })

  test('an escaped password question cancels the login', async () => {
    prompts.inject(['user', new Error('cancelled')])
    expect(await promptCredentials()).toBeUndefined()
  })

  test('refuses without a terminal by naming the headless flags', async () => {
    setNoInputOverride(true)
    try {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's rejects matcher resolves at runtime but its type doesn't expose Promise.
      await expect(promptCredentials()).rejects.toThrow(
        'Input required: Archidekt login credentials — pass --username and --password-stdin instead',
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

describe('askSequence', () => {
  test('collects every answer under its question name', async () => {
    prompts.inject(['mkm, sld', 'foil'])
    const answers = await askSequence([
      { type: 'text', name: 'sets', message: 'Sets?' },
      {
        type: 'select',
        name: 'finish',
        message: 'Finish?',
        choices: [{ title: 'Foil', value: 'foil' }],
      },
    ])
    expect(answers).toEqual({ sets: 'mkm, sld', finish: 'foil' })
  })

  test('stops at the first cancelled question and keeps the answers before it', async () => {
    prompts.inject(['mkm', new Error('cancelled'), 'never asked'])
    const answers = await askSequence([
      { type: 'text', name: 'sets', message: 'Sets?' },
      { type: 'text', name: 'finish', message: 'Finish?' },
      { type: 'text', name: 'condition', message: 'Condition?' },
    ])
    expect(answers).toStrictEqual({ sets: 'mkm' })
    // The third question was never opened: its injected answer is still queued.
    expect(await ask<string>({ type: 'text', message: 'Next?' })).toBe('never asked')
  })

  test('a false confirm is an answer, not a cancellation', async () => {
    prompts.inject([false, 'kept'])
    const answers = await askSequence([
      { type: 'confirm', name: 'foil', message: 'Foil?' },
      { type: 'text', name: 'note', message: 'Note?' },
    ])
    expect(answers).toStrictEqual({ foil: false, note: 'kept' })
  })

  test("applies each question's format", async () => {
    prompts.inject([' Mkm, sld ', 'ok'])
    const answers = await askSequence([
      {
        type: 'text',
        name: 'sets',
        message: 'Sets?',
        format: (value: string) => value.trim().toLowerCase().split(/,\s*/),
      },
      { type: 'text', name: 'note', message: 'Note?' },
    ])
    expect(answers).toEqual({ sets: ['mkm', 'sld'], note: 'ok' })
  })

  test('refuses the first question by its own subject under --no-input', async () => {
    setNoInputOverride(true)
    try {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's rejects matcher resolves at runtime but its type doesn't expose Promise.
      await expect(
        askSequence([
          {
            type: 'text',
            name: 'sets',
            message: 'Sets?',
            subjectKey: 'cli.prompt.subject.setFilter',
          },
        ]),
      ).rejects.toThrow('Input required: the session set filter (')
    } finally {
      setNoInputOverride(undefined)
    }
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
