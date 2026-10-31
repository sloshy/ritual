import { describe, expect, test } from 'bun:test'
import {
  advisoryMessages,
  rewriteBlockingMessages,
  unreadableContentMessage,
  unreadableLines,
  unreadableProblems,
} from '../../src/list/unreadable-content'
import { renderSyncMessage, syncMessage } from '../../src/sync/message'
import type { ParsedListContent } from '../../src/list/unreadable-content'
import { parseCollectionFile } from '../../src/list/collection-file'
import { parseWantedListFile } from '../../src/list/wanted-file'
import { parseDeckText } from '../../src/importers/text-file'
import { keyedMessage } from '../helpers/api-message'
import { expectLocaleInForce, pseudoCatalog, withSyntheticLocale } from '../helpers/sync-text'

/** The one unreadable line's warning, as the parser records it. */
const SKIPPED = syncMessage('domain.import.text.malformedLine', { line: 'x' })

/** A parse with one unreadable line and a five-line fenced block. */
const PARSED: ParsedListContent = {
  fencedLines: 5,
  notices: [{ severity: 'warning', message: SKIPPED }],
}

/** A parse with nothing unreadable but `fencedLines` of fenced content. */
function fencedOnly(fencedLines: number): ParsedListContent {
  return { fencedLines, notices: [] }
}

describe('unreadableContentMessage', () => {
  test('names the file, the action, and every entry — and claims no line count', () => {
    const message = keyedMessage(
      unreadableContentMessage('/lists/binder.md', unreadableProblems(PARSED), 'saving'),
    )
    expect(message).toBe(
      '/lists/binder.md holds content the parser cannot re-emit, and saving would delete it ' +
        '(releasing any &N ids it carries). Fix the file first — Skipped malformed line: x; ' +
        'Fenced code block content (5 lines) — read as prose, but a whole-file rewrite would delete it',
    )
  })

  test('each action has its own sentence', () => {
    for (const action of ['moving', 'appending'] as const) {
      const message = unreadableContentMessage('/l.md', unreadableProblems(PARSED), action)
      expect(keyedMessage(message)).toContain(`and ${action} would delete it`)
    }
  })

  test('renders whole in the reader’s language, the fenced-block entry included', () => {
    const message = unreadableContentMessage('/l.md', unreadableProblems(PARSED), 'saving')
    const rendered = withSyntheticLocale('en-XA', pseudoCatalog(), () => renderSyncMessage(message))
    // Vacuity guard: the pseudo-locale really did change the sentence.
    expect(rendered).not.toBe(message.message)
    expect(rendered).not.toContain('holds content the parser cannot re-emit')
    expect(rendered).not.toContain('Fenced code block content')
    // The file rides through as it is; the parser's warning renders in the
    // reader's language too, the line it quotes untouched.
    expect(rendered).toContain('/l.md')
    expect(rendered).not.toContain('Skipped malformed line')
    expect(rendered).toContain(': x')
    // The English the API answers with does not follow the locale.
    expect(message.message).toContain('Fenced code block content (5 lines)')
  })
})

describe('unreadableLines', () => {
  test('is the English of the warning notices when nothing is fenced, advisories left out', () => {
    const parsed: ParsedListContent = {
      fencedLines: 0,
      notices: [
        { severity: 'advisory', message: syncMessage('domain.list.frontMatter.notMapping') },
        { severity: 'warning', message: SKIPPED },
      ],
    }
    expect(unreadableLines(parsed)).toEqual(['Skipped malformed line: x'])
  })

  test('adds one English line accounting for fenced content a rewrite would delete', () => {
    expect(unreadableLines(fencedOnly(1))).toEqual([
      'Fenced code block content (1 line) — read as prose, but a whole-file rewrite would delete it',
    ])
    expect(unreadableLines(fencedOnly(4))[0]).toContain('(4 lines)')
  })

  test('stays English whatever the UI language', () => {
    const lines = withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      // Vacuity guard: the pseudo-locale is in force, so English here is a choice.
      expectLocaleInForce(locale)
      return unreadableLines(fencedOnly(2))
    })
    expect(lines[0]).toContain('Fenced code block content (2 lines)')
  })
})

describe('unreadableProblems', () => {
  test('is unreadableLines as message params: every entry keyed, nested unrendered', () => {
    const problems = unreadableProblems(PARSED)
    expect(problems[0]).toEqual({
      messageKey: 'domain.import.text.malformedLine',
      messageParams: { line: 'x' },
    })
    expect(problems[1]).toEqual({
      messageKey: 'domain.list.fencedContent',
      messageParams: { count: 5 },
    })
    expect(unreadableProblems(fencedOnly(0))).toEqual([])
  })
})

/**
 * The parsers still expose their English `warnings` string channel beside the
 * notices the gates read. Pinned here so the two can never drift: a parser's
 * `warnings` is exactly the English of its warning notices, in order.
 */
describe('a parser’s warnings are its warning notices', () => {
  const BAD_LINES = ['not a card line', '- Sol Ring [jp]', '- Sol Ring [foil] [foil]']

  test.each([
    ['a collection', () => parseCollectionFile(`# Binder\n\n${BAD_LINES.join('\n')}\n`)],
    ['a wanted list', () => parseWantedListFile(`# Wants\n\n${BAD_LINES.join('\n')}\n`)],
    ['a deck', () => parseDeckText('# Burn\n\nnot a card\n1 Sol Ring [jp]\n', 'Burn')],
  ])('on %s', (_label, parse) => {
    const parsed = parse()
    expect(parsed.warnings.length).toBeGreaterThan(1)
    expect([...parsed.warnings]).toEqual(
      parsed.notices
        .filter((notice) => notice.severity === 'warning')
        .map((notice) => notice.message.message),
    )
  })
})

describe('rewriteBlockingMessages and advisoryMessages', () => {
  test('split a parse by severity: the lines a rewrite would lose, and the words about read lines', () => {
    const advisory = syncMessage('domain.import.text.malformedLine', { line: 'read' })
    const parsed: ParsedListContent = {
      fencedLines: 3,
      notices: [
        { severity: 'warning', message: SKIPPED },
        { severity: 'advisory', message: advisory },
      ],
    }
    expect(rewriteBlockingMessages(parsed)).toEqual([SKIPPED])
    expect(advisoryMessages(parsed)).toEqual([advisory])
  })
})
