import { describe, expect, it } from 'bun:test'
import { buildMainChoices, type EditorState } from '../../../src/commands/history'
import { choiceSearchAliases } from '../../../src/cli/menu-search'

describe('buildMainChoices', () => {
  const state = (undoDepth: number): EditorState => ({
    header: '# Changes\n',
    sets: [
      { timestamp: '2026-07-13T10:00:00.000Z', lines: ['- Added Sol Ring &1'], events: [] },
      { timestamp: '2026-07-12T10:00:00.000Z', lines: ['- Added Mox Ruby &2'], events: [] },
    ],
    originalSerialized: '',
    undoStack: Array.from({ length: undoDepth }, () => []),
  })

  it('lists the change sets, then undo, preview, and only then the destructive rewrite', () => {
    const values = buildMainChoices(state(2)).map((c) => c.value)
    expect(values).toEqual(['set:0', 'set:1', '__undo__', '__preview__', '__rewrite__', '__exit__'])
  })

  it('drops undo when nothing has been done, keeping rewrite below preview', () => {
    const values = buildMainChoices(state(0)).map((c) => c.value)
    expect(values).toEqual(['set:0', 'set:1', '__preview__', '__rewrite__', '__exit__'])
  })

  it('heads each set with a local date, findable by the ISO timestamp the file records', () => {
    const [newest] = buildMainChoices(state(0))
    expect(newest?.title).not.toContain('2026-07-13T10:00:00.000Z')
    expect(choiceSearchAliases(newest!)).toEqual(['2026-07-13T10:00:00.000Z'])
  })
})
