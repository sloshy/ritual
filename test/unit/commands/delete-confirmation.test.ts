import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import prompts from 'prompts'
import { deleteConfirmationText, runDelete } from '../../../src/commands/delete'
import { setBaseDir } from '../../../src/base-dir'
import { stubTty } from '../../test-utils'

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

/** Collect what the command writes to stderr — the notice does not go via console. */
type StderrCapture = { text: () => string; restore: () => void }
function captureStderr(): StderrCapture {
  const chunks: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
    return true
  }
  return {
    text: () => chunks.join(''),
    restore: () => {
      process.stderr.write = original
    },
  }
}

describe('the interactive delete confirmation', () => {
  const testDir = path.join(import.meta.dir, '../../.test-delete-confirm')
  const collectionsDir = path.join(testDir, 'collections')
  const filePath = path.join(collectionsDir, "Atraxa Praetors' Voice.md")

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(collectionsDir, { recursive: true })
    // A display name the file name cannot hold: the confirmation has to quote
    // the display name, which is the whole point of showing the notice first.
    await fs.writeFile(filePath, "# Atraxa: Praetors' Voice\n\n")
    setBaseDir(testDir)
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  test('writes the notice to stderr and asks for the display name', async () => {
    const stderr = captureStderr()
    prompts.inject(["Atraxa: Praetors' Voice"])
    try {
      await runDelete('praetors', 'collection', undefined, { output: 'text', quiet: false })
    } finally {
      stderr.restore()
    }

    expect(stderr.text()).toContain(
      "About to delete collection 'Atraxa: Praetors' Voice' (" + filePath + ')',
    )
    // The confirmation matched, so the list is gone.
    expect(await Bun.file(filePath).exists()).toBe(false)
  })

  test('a typed name that does not match the display name deletes nothing', async () => {
    const stderr = captureStderr()
    prompts.inject(["Atraxa Praetors' Voice"])
    let thrown: unknown
    try {
      await runDelete('praetors', 'collection', undefined, { output: 'text', quiet: false })
    } catch (error) {
      thrown = error
    } finally {
      stderr.restore()
    }
    expect((thrown as Error).message).toContain("Expected 'Atraxa: Praetors' Voice'")
    expect(await Bun.file(filePath).exists()).toBe(true)
  })
})
