import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { confirmUnreadableDecks } from '../../src/commands/deck-sync'
import type { UnreadableDeck } from '../../src/deck-sync/engine'
import { MemoryLogger } from '../../src/util/logger'
import { setNoInputOverride } from '../../src/util/no-input'
import type { ScriptingOptions } from '../../src/commands/scripting'

/**
 * The CLI's answer to "may these decks sync even though the save would delete
 * lines the parser could not read?". The prompt itself needs a terminal, so what
 * is pinned here is every path that decides *without* asking.
 */

const DECKS: UnreadableDeck[] = [
  { name: 'Winota Stax', file: 'winota-stax.md', warnings: ['Skipped malformed line: junk'] },
]

const TEXT: ScriptingOptions = { output: 'text', quiet: false }
const JSON_OUTPUT: ScriptingOptions = { output: 'json', quiet: false }

type Asked = { answer: boolean; logged: string }

/** Ask without `--yes`, capturing what the CLI told the user. */
async function ask(scripting: ScriptingOptions): Promise<Asked> {
  const logger = new MemoryLogger()
  const answer = await confirmUnreadableDecks(DECKS, false, scripting, logger)
  return { answer, logged: logger.entries.map((entry) => String(entry.args[0])).join('\n') }
}

let originalIsTty: boolean | undefined

beforeEach(() => {
  originalIsTty = process.stdin.isTTY
  // Each case isolates one reason a prompt cannot run, so the terminal itself
  // must look available — otherwise they would all pass for the same incidental
  // reason (`bun test` has no TTY).
  process.stdin.isTTY = true
})

afterEach(() => {
  // `isTTY` is optional on the stream type but always a boolean once assigned.
  process.stdin.isTTY = originalIsTty === true
  setNoInputOverride(undefined)
})

describe('confirmUnreadableDecks', () => {
  test('--yes answers up front, without needing a terminal', async () => {
    process.stdin.isTTY = false
    setNoInputOverride(true)
    expect(await confirmUnreadableDecks(DECKS, true, TEXT, new MemoryLogger())).toBe(true)
  })

  test('refuses under --no-input and points at the flag', async () => {
    setNoInputOverride(true)
    const { answer, logged } = await ask(TEXT)
    expect(answer).toBe(false)
    expect(logged).toContain('pass --yes')
  })

  test('refuses without a terminal to prompt on', async () => {
    setNoInputOverride(false)
    process.stdin.isTTY = false
    expect((await ask(TEXT)).answer).toBe(false)
  })

  test('refuses when json output owns stdout, where a prompt cannot run', async () => {
    setNoInputOverride(false)
    expect((await ask(JSON_OUTPUT)).answer).toBe(false)
  })
})
