import { describe, expect, test } from 'bun:test'
import { createSyncEventRenderer } from '../../src/commands/sync-render-event'
import { createScopedIndenter } from '../../src/commands/sync-helpers'
import type { ScriptingOptions } from '../../src/cli/output'
import type { Logger } from '../../src/util/logger'
import type { SyncDirection, SyncEvent, SyncSubjectKind } from '../../src/sync/common'
import '../../src/i18n/register/cli'

/**
 * The console text both sync commands print, pinned byte for byte — this is the
 * only coverage of the wording and the indentation, and the renderer is shared,
 * so a change here changes what `deck-sync` and `collection-sync` both say.
 */

/** One captured line, as `level: text`. */
type CapturedLine = { level: 'info' | 'warn' | 'error'; text: string }

type Capture = { logger: Logger; lines: CapturedLine[] }

function capture(): Capture {
  const lines: CapturedLine[] = []
  const logger = {
    info: (text: string) => lines.push({ level: 'info', text }),
    warn: (text: string) => lines.push({ level: 'warn', text }),
    error: (text: string) => lines.push({ level: 'error', text }),
    debug: () => {},
  } as unknown as Logger
  return { logger, lines }
}

/** One result payload stands in for both engines' — the renderer never reads it. */
type Result = { name: string }

/** How a test run is rendered: the scripting flags and `--verbose`. */
type RenderOptions = {
  scripting?: ScriptingOptions
  verbose?: boolean
}

/** What a run printed, and whether the renderer withheld any `detail` line. */
type Rendered = { lines: CapturedLine[]; detailHidden: boolean }

function renderRun(
  subject: SyncSubjectKind,
  direction: SyncDirection,
  events: SyncEvent<Result>[],
  { scripting = { output: 'text', quiet: false }, verbose }: RenderOptions = {},
): Rendered {
  const { logger, lines } = capture()
  const indent = createScopedIndenter(scripting)
  const renderer = createSyncEventRenderer<Result>({
    subject,
    direction,
    logger,
    indent,
    verbose,
  })
  for (const event of events) renderer.onEvent(event)
  return { lines, detailHidden: renderer.detailHidden() }
}

function render(
  subject: SyncSubjectKind,
  direction: SyncDirection,
  events: SyncEvent<Result>[],
  options: RenderOptions = {},
): CapturedLine[] {
  return renderRun(subject, direction, events, options).lines
}

const UNREADABLE: SyncEvent<Result> = {
  kind: 'unreadable-lines',
  items: [{ name: 'Alpha', file: 'alpha.md', warnings: ['line 3: junk', 'line 9: junk'] }],
}

const SOURCE_BLOCK = '  alpha.md ("Alpha"):\n    line 3: junk\n    line 9: junk'

describe('createSyncEventRenderer', () => {
  test('indents an item’s log lines under the header that opened it', () => {
    expect(
      render('deck', 'pull', [
        { kind: 'log', level: 'warn', item: null, message: 'before any header' },
        { kind: 'item-start', item: 'Alpha', index: 0, total: 2 },
        { kind: 'log', level: 'info', item: 'Alpha', message: 'Changes: +1' },
        { kind: 'log', level: 'warn', item: 'Alpha', message: 'careful' },
        { kind: 'log', level: 'error', item: 'Alpha', message: 'nope' },
        { kind: 'log', level: 'info', item: 'Beta', message: 'never started' },
        { kind: 'item-result', result: { name: 'Alpha' } },
      ]),
    ).toEqual([
      // Run-level lines, and lines for an item whose header never printed, sit flush left.
      { level: 'warn', text: 'before any header' },
      { level: 'info', text: 'Syncing "Alpha" (pull)...' },
      { level: 'info', text: '  Changes: +1' },
      { level: 'warn', text: '  careful' },
      { level: 'error', text: '  nope' },
      { level: 'info', text: 'never started' },
      // A result prints nothing — the closing tally and the report carry it.
    ])
  })

  test('drops the indent when the headers themselves were not printed', () => {
    expect(
      render(
        'collection',
        'push',
        [
          { kind: 'item-start', item: 'Alpha', index: 0, total: 1 },
          { kind: 'log', level: 'info', item: 'Alpha', message: 'Changes: +1' },
        ],
        { scripting: { output: 'json', quiet: false } },
      ),
    ).toEqual([
      { level: 'info', text: 'Syncing "Alpha" (push)...' },
      { level: 'info', text: 'Changes: +1' },
    ])
  })

  describe('detail lines', () => {
    const DETAIL_RUN: SyncEvent<Result>[] = [
      { kind: 'item-start', item: 'Alpha', index: 0, total: 1 },
      { kind: 'log', level: 'info', item: 'Alpha', message: 'Changes: +2' },
      { kind: 'log', level: 'detail', item: 'Alpha', message: '+ 1 Sol Ring to Main' },
      { kind: 'log', level: 'detail', item: 'Alpha', message: '+ 1 Island to Main' },
    ]

    test('print indented as info under --verbose', () => {
      expect(renderRun('deck', 'pull', DETAIL_RUN, { verbose: true })).toEqual({
        lines: [
          { level: 'info', text: 'Syncing "Alpha" (pull)...' },
          { level: 'info', text: '  Changes: +2' },
          { level: 'info', text: '  + 1 Sol Ring to Main' },
          { level: 'info', text: '  + 1 Island to Main' },
        ],
        detailHidden: false,
      })
    })

    test('are withheld without --verbose, and the renderer says so', () => {
      expect(renderRun('deck', 'pull', DETAIL_RUN)).toEqual({
        lines: [
          { level: 'info', text: 'Syncing "Alpha" (pull)...' },
          { level: 'info', text: '  Changes: +2' },
        ],
        detailHidden: true,
      })
    })

    test('a run with no detail lines has nothing withheld', () => {
      expect(renderRun('deck', 'pull', DETAIL_RUN.slice(0, 2)).detailHidden).toBe(false)
    })
  })

  test('warns about unreadable lines in the deck sync’s wording', () => {
    // Deck wording is direction-invariant; only the collection sync varies it.
    expect(render('deck', 'pull', [UNREADABLE])).toEqual(render('deck', 'push', [UNREADABLE]))
    expect(render('deck', 'push', [UNREADABLE])).toEqual([
      {
        level: 'warn',
        text: [
          '1 deck contains lines Ritual cannot read.',
          'Syncing rewrites the deck file, so these lines would be removed:',
          SOURCE_BLOCK,
        ].join('\n'),
      },
    ])
  })

  test('warns per direction in the collection sync’s wording', () => {
    expect(render('collection', 'pull', [UNREADABLE])[0]).toEqual({
      level: 'warn',
      text: [
        '1 collection list contains lines Ritual cannot read.',
        'A pull rewrites the list file, so these lines would be removed:',
        SOURCE_BLOCK,
      ].join('\n'),
    })
    expect(render('collection', 'push', [UNREADABLE])[0]).toEqual({
      level: 'warn',
      text: [
        '1 collection list contains lines Ritual cannot read.',
        'A push treats the list file as the truth, so the cards on these lines would be removed from your Archidekt collection:',
        SOURCE_BLOCK,
      ].join('\n'),
    })
  })
})
