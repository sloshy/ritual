import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import prompts from 'prompts'
import { deleteConfirmationText, runDelete } from '../../../src/commands/delete'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'
import { stubTty } from '../../test-utils'
import { captureStream } from '../../helpers/capture'

// The confirmation refuses to prompt without a terminal; these tests simulate an
// interactive session via prompts.inject, so pretend stdin is a TTY.
stubTty({ stdin: true })

describe('deleteConfirmationText', () => {
  test('names the resolved target, its path, and the string that will pass', () => {
    const text = deleteConfirmationText('deck', 'Modern Burn', 'decks/Modern Burn.md')
    expect(text.notice).toBe(
      "About to delete deck 'Modern Burn' (decks/Modern Burn.md) and its sidecar files.",
    )
    expect(text.prompt).toBe("Type 'Modern Burn' to confirm:")
  })

  test('quotes the display name, not the file name, when they differ', () => {
    // The colon cannot be in the file name, so the expected confirmation and the
    // file disagree — exactly the case a blind prompt used to strand the user in.
    const text = deleteConfirmationText(
      'deck',
      "Atraxa: Praetors' Voice",
      "decks/Atraxa Praetors' Voice.md",
    )
    expect(text.prompt).toBe("Type 'Atraxa: Praetors' Voice' to confirm:")
    expect(text.notice).toContain("decks/Atraxa Praetors' Voice.md")
  })

  test('uses the human label for each list type', () => {
    expect(deleteConfirmationText('collection', 'Binder', 'p').notice).toStartWith(
      "About to delete collection 'Binder'",
    )
    expect(deleteConfirmationText('wanted', 'To Buy', 'p').notice).toStartWith(
      "About to delete wanted list 'To Buy'",
    )
  })
})

describe('the interactive delete confirmation', () => {
  let ws: BoundWorkspace
  let filePath: string

  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: ['collections'], config: false })
    filePath = path.join(ws.dir, 'collections', "Atraxa Praetors' Voice.md")
    // A display name the file name cannot hold: the confirmation has to quote
    // the display name, which is the whole point of showing the notice first.
    await fs.writeFile(filePath, "# Atraxa: Praetors' Voice\n\n")
  })

  afterEach(async () => {
    await ws.dispose()
  })

  test('writes the notice to stderr and asks for the display name', async () => {
    // The notice goes straight to stderr, not through `console`.
    const stderr = await captureStream('stderr', () => {
      prompts.inject(["Atraxa: Praetors' Voice"])
      return runDelete('praetors', 'collection', undefined, { output: 'text', quiet: false })
    })

    expect(stderr).toContain(
      "About to delete collection 'Atraxa: Praetors' Voice' (" + filePath + ')',
    )
    // The confirmation matched, so the list is gone.
    expect(await Bun.file(filePath).exists()).toBe(false)
  })

  test('a typed name that does not match the display name deletes nothing', async () => {
    let thrown: unknown
    await captureStream('stderr', async () => {
      prompts.inject(["Atraxa Praetors' Voice"])
      try {
        await runDelete('praetors', 'collection', undefined, { output: 'text', quiet: false })
      } catch (error) {
        thrown = error
      }
    })
    expect((thrown as Error).message).toContain("Expected 'Atraxa: Praetors' Voice'")
    expect(await Bun.file(filePath).exists()).toBe(true)
  })
})
