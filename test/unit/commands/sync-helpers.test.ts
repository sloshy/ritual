import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  confirmUnreadableSync,
  describeUnreadable,
  loggerFor,
  type UnreadableSource,
  type UnreadableSubject,
} from '../../../src/commands/sync-helpers'
import { MemoryLogger, getLogger, resetLogger, setLogger } from '../../../src/logger'
import { setNoInputOverride } from '../../../src/no-input'
import type { ScriptingOptions } from '../../../src/commands/scripting'

/**
 * The CLI plumbing both sync commands share. The gate matrix of
 * {@link confirmUnreadableSync} is pinned through the deck command in
 * `deck-sync-confirm.test.ts`; what is pinned here is the text assembly and the
 * logger routing, plus the one message a run refused for unreadable lines has to
 * be able to print.
 */

const LISTS: UnreadableSubject = { one: 'collection list', many: 'collection lists' }
const DECKS: UnreadableSubject = { one: 'deck', many: 'decks' }

function source(name: string, warnings: string[]): UnreadableSource {
  return { name, file: `${name.toLowerCase().replace(/\s+/g, '-')}.md`, warnings }
}

describe('describeUnreadable', () => {
  test('agrees the noun and the verb with a single source', () => {
    const text = describeUnreadable([source('Blue Binder', ['Skipped: - ???'])], LISTS, 'Cost:')
    expect(text.split('\n')[0]).toBe('1 collection list contains lines Ritual cannot read.')
  })

  test('agrees the noun and the verb with several sources', () => {
    const text = describeUnreadable(
      [source('Blue Binder', ['Skipped: - ???']), source('Long Box', ['Skipped: - !!!'])],
      LISTS,
      'Cost:',
    )
    expect(text.split('\n')[0]).toBe('2 collection lists contain lines Ritual cannot read.')
  })

  test('lists every file and every line it could not read, under the consequence', () => {
    const text = describeUnreadable(
      [source('Winota Stax', ['Skipped malformed line: junk', 'Skipped malformed line: more'])],
      DECKS,
      'Syncing rewrites the deck file, so these lines would be removed:',
    )
    expect(text).toBe(
      [
        '1 deck contains lines Ritual cannot read.',
        'Syncing rewrites the deck file, so these lines would be removed:',
        '  winota-stax.md ("Winota Stax"):',
        '    Skipped malformed line: junk',
        '    Skipped malformed line: more',
      ].join('\n'),
    )
  })
})

describe('loggerFor', () => {
  const memory = new MemoryLogger()

  beforeEach(() => {
    memory.clear()
    setLogger(memory)
  })

  afterEach(() => {
    resetLogger()
  })

  test('text output logs progress through the ambient logger', () => {
    const logger = loggerFor({ output: 'text', quiet: false })
    expect(logger).toBe(getLogger())
    logger.info('syncing')
    expect(memory.entries.map((entry) => entry.level)).toEqual(['info'])
  })

  test('--quiet drops progress but keeps warnings and errors', () => {
    const logger = loggerFor({ output: 'text', quiet: true })
    logger.info('syncing')
    logger.progress('still syncing')
    logger.warn('careful')
    logger.error('broken')
    expect(memory.entries.map((entry) => entry.level)).toEqual(['warn', 'error'])
  })

  test('scripted output keeps stdout for the report, so nothing goes to the ambient logger', () => {
    for (const output of ['json', 'ndjson'] as const) {
      const logger = loggerFor({ output, quiet: false })
      logger.info('syncing')
      logger.progress('still syncing')
    }
    expect(memory.entries).toEqual([])
  })
})

const TEXT: ScriptingOptions = { output: 'text', quiet: false }

describe('confirmUnreadableSync', () => {
  let originalIsTty: boolean | undefined

  beforeEach(() => {
    originalIsTty = process.stdin.isTTY
    process.stdin.isTTY = true
  })

  afterEach(() => {
    process.stdin.isTTY = originalIsTty === true
    setNoInputOverride(undefined)
  })

  test('names the flag and the cost when there is nobody to ask', async () => {
    setNoInputOverride(true)
    const logger = new MemoryLogger()
    const answer = await confirmUnreadableSync({
      sources: [source('Blue Binder', ['Skipped: - ???'])],
      subject: LISTS,
      cost: 'removing those cards from your Archidekt collection',
      yes: false,
      scripting: TEXT,
      logger,
    })

    expect(answer).toBe(false)
    expect(logger.entries.map((entry) => String(entry.args[0]))).toEqual([
      'Confirmation required: pass --yes to sync these collection lists non-interactively (removing those cards from your Archidekt collection), or fix the lines first.',
    ])
  })
})
