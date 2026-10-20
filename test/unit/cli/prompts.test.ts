import { afterEach, describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import prompts, { type Choice } from 'prompts'
import {
  ask,
  askSequence,
  menuPageSize,
  promptCredentials,
  promptExitMenu,
  promptLibraryStrings,
  resolveImportPrintings,
  type AskQuestion,
  suggestByTitleTerms,
  withMenuPageSize,
  type UndeclaredPromptOptions,
} from '../../../src/cli/prompts'
import { normalizeScriptingOptions } from '../../../src/cli/output'
import { setNoInputOverride } from '../../../src/util/no-input'
import { stubTty } from '../../test-utils'
import {
  expectLocaleInForce,
  pseudoCatalog,
  pseudoString,
  withSyntheticLocale,
  withSyntheticLocaleAsync,
} from '../../helpers/sync-text'

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

/** A fresh {@link FakeTtyStdin}. */
function fakeTtyStdin(): FakeTtyStdin {
  const stdin = new PassThrough() as FakeTtyStdin
  stdin.isTTY = true
  stdin.setRawMode = () => undefined
  return stdin
}

/** What a prompt drew, and what it answered. */
type DrawnPrompt = { drawn: string; answer: unknown }

/**
 * Open `question` through {@link ask} on a fake terminal, type `keys`, and
 * collect everything the library drew until it settled.
 */
async function drawPrompt(question: AskQuestion, keys: string): Promise<DrawnPrompt> {
  const stdin = fakeTtyStdin()
  const stdout = new PassThrough()
  let drawn = ''
  stdout.on('data', (chunk: Buffer) => {
    drawn += chunk.toString()
  })
  const pending = ask<unknown>({ ...question, stdin, stdout })
  stdin.write(keys)
  const answer = await pending
  return { drawn, answer }
}

describe('ask with an autocomplete', () => {
  test('a first Esc clears the typed text and keeps the prompt open; a second backs out', async () => {
    const stdin = fakeTtyStdin()
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
            subject: 'cli.prompt.subject.setFilter',
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

/**
 * The library's English strings, as `ask()` replaces them. The English rows pin
 * the catalog to the library's text and layout — except the select hint ("Use
 * the arrow keys.") and the text-prompt error ("Please enter a valid value"),
 * which the catalog rewords on purpose. The pseudo rows prove each string is
 * the catalog's, with the key names (which stay English) left untouched.
 */
describe('promptLibraryStrings', () => {
  test('every prompt gets the strings shared across types, in English', () => {
    expect(promptLibraryStrings('confirm')).toStrictEqual({
      noMatches: 'no matches found',
      active: 'on',
      inactive: 'off',
      yes: 'yes',
      no: 'no',
      yesOption: '(Y/n)',
      noOption: '(y/N)',
      warn: '- This option is disabled',
      error: 'Please enter a valid value',
    })
  })

  test('only a select gets the select hint', () => {
    expect(promptLibraryStrings('select').hint).toBe('- Use the arrow keys. Return to submit.')
    for (const type of ['autocomplete', 'multiselect', 'text', undefined] as const) {
      expect(promptLibraryStrings(type).hint).toBeUndefined()
    }
  })

  test("a multiselect's key list and disabled note keep the library's layout", () => {
    const multiselect = promptLibraryStrings('multiselect')
    expect(multiselect.instructions).toBe(
      '\nInstructions:\n' +
        '    ↑/↓: Highlight option\n' +
        '    ←/→/[space]: Toggle selection\n' +
        '    a: Toggle all\n' +
        '    enter/return: Complete answer',
    )
    // The multiselects' own default closes the note with a dash.
    expect(multiselect.warn).toBe('- This option is disabled -')
    // A `max` caps the selection, so there is no toggling every row at once.
    expect(promptLibraryStrings('multiselect', true).instructions).not.toContain('Toggle all')
    // The searchable variant lists its filter keys in that slot instead, and
    // ends on a newline as the library's own block does.
    expect(promptLibraryStrings('autocompleteMultiselect').instructions).toBe(
      '\nInstructions:\n' +
        '    ↑/↓: Highlight option\n' +
        '    ←/→/[space]: Toggle selection\n' +
        '    [a,b,c]/delete: Filter choices\n' +
        '    enter/return: Complete answer\n',
    )
    expect(promptLibraryStrings('select').instructions).toBeUndefined()
  })

  test("under the pseudo-locale every string is the catalog's, key names untouched", () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      const keys = pseudoString('cli.prompt.confirmKeys')
      expect(promptLibraryStrings('select')).toStrictEqual({
        noMatches: pseudoString('cli.prompt.noMatches'),
        active: pseudoString('cli.prompt.toggleOn'),
        inactive: pseudoString('cli.prompt.toggleOff'),
        hint: `- ${pseudoString('cli.prompt.selectHint').replace('{key}', 'Return')}`,
        warn: `- ${pseudoString('cli.prompt.disabledChoice')}`,
        yes: pseudoString('cli.prompt.confirmYes'),
        no: pseudoString('cli.prompt.confirmNo'),
        yesOption: keys.replace('{yesKey}', 'Y').replace('{noKey}', 'n'),
        noOption: keys.replace('{yesKey}', 'y').replace('{noKey}', 'N'),
        error: pseudoString('cli.prompt.invalidValue'),
      })
      const line = (key: Parameters<typeof pseudoString>[0], keys: string): string =>
        `    ${pseudoString(key).replace('{keys}', keys)}`
      expect(promptLibraryStrings('multiselect').instructions).toBe(
        [
          '',
          pseudoString('cli.prompt.instructions.heading'),
          line('cli.prompt.instructions.highlight', '↑/↓'),
          line('cli.prompt.instructions.toggle', '←/→/[space]'),
          line('cli.prompt.instructions.toggleAll', 'a'),
          line('cli.prompt.instructions.complete', 'enter/return'),
        ].join('\n'),
      )
      expect(promptLibraryStrings('autocompleteMultiselect').instructions).toContain(
        `${line('cli.prompt.instructions.filter', '[a,b,c]/delete')}\n`,
      )
    })
  })
})

describe('ask hands the library its strings', () => {
  test("a confirm draws the catalog's key hint, then its answer", async () => {
    await withSyntheticLocaleAsync('en-XA', pseudoCatalog(), async () => {
      const { drawn, answer } = await drawPrompt(
        { type: 'confirm', message: 'Save?', initial: true },
        'y',
      )

      expect(answer).toBe(true)
      const keys = pseudoString('cli.prompt.confirmKeys')
      expect(drawn).toContain(keys.replace('{yesKey}', 'Y').replace('{noKey}', 'n'))
      expect(drawn).toContain(pseudoString('cli.prompt.confirmYes'))
      // The library's own answer word never appears (the keys stay letters, so
      // only the answer can tell the two apart).
      expect(drawn).not.toContain('yes')
    })
  })

  test("a caller's own hint wins over the catalog's", async () => {
    const { drawn } = await drawPrompt(
      {
        type: 'select',
        message: 'Pick?',
        hint: 'Pick a row',
        choices: [{ title: 'A', value: 'a' }],
      },
      '\r',
    )
    expect(drawn).toContain('Pick a row')
    expect(drawn).not.toContain('Use the arrow keys')
  })

  test("a multiselect's max drops the toggle-all line from its key list", async () => {
    const choices = [{ title: 'A', value: 'a' }]
    const open = await drawPrompt({ type: 'multiselect', message: 'Pick?', choices }, '\r')
    expect(open.drawn).toContain('a: Toggle all')
    const capped = await drawPrompt(
      { type: 'multiselect', message: 'Pick?', choices, max: 1 },
      '\r',
    )
    expect(capped.drawn).toContain('Complete answer')
    expect(capped.drawn).not.toContain('Toggle all')
  })
})
