import { describe, expect, test } from 'bun:test'
import {
  unreadableContentMessage,
  unreadableLines,
  unreadableProblems,
} from '../../src/list/unreadable-content'
import { renderSyncMessage } from '../../src/sync/message'
import { keyedMessage } from '../helpers/api-message'
import { expectLocaleInForce, pseudoCatalog, withSyntheticLocale } from '../helpers/sync-text'

/** A parse with one unreadable line and a five-line fenced block. */
const PARSED = { warnings: ['Skipped malformed line: x'], fencedLines: 5 }

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
    // The file and the parser's own (keyless) warning ride through as they are.
    expect(rendered).toContain('/l.md')
    expect(rendered).toContain('Skipped malformed line: x')
    // The English the API answers with does not follow the locale.
    expect(message.message).toContain('Fenced code block content (5 lines)')
  })
})

describe('unreadableLines', () => {
  test('passes parse warnings through untouched when nothing is fenced', () => {
    expect(unreadableLines({ warnings: ['Skipped malformed line: x'], fencedLines: 0 })).toEqual([
      'Skipped malformed line: x',
    ])
  })

  test('adds one English line accounting for fenced content a rewrite would delete', () => {
    expect(unreadableLines({ warnings: [], fencedLines: 1 })).toEqual([
      'Fenced code block content (1 line) — read as prose, but a whole-file rewrite would delete it',
    ])
    expect(unreadableLines({ warnings: [], fencedLines: 4 })[0]).toContain('(4 lines)')
  })

  test('stays English whatever the UI language', () => {
    const lines = withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      // Vacuity guard: the pseudo-locale is in force, so English here is a choice.
      expectLocaleInForce(locale)
      return unreadableLines({ warnings: [], fencedLines: 2 })
    })
    expect(lines[0]).toContain('Fenced code block content (2 lines)')
  })
})

describe('unreadableProblems', () => {
  test('is unreadableLines as message params: the warnings as text, the fenced entry keyed', () => {
    const problems = unreadableProblems(PARSED)
    expect(problems[0]).toBe('Skipped malformed line: x')
    expect(problems[1]).toEqual({
      messageKey: 'domain.list.fencedContent',
      messageParams: { count: 5 },
    })
    expect(unreadableProblems({ warnings: [], fencedLines: 0 })).toEqual([])
  })
})
