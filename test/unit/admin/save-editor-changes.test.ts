import { describe, it, expect, afterEach, beforeEach } from 'bun:test'
import { saveEditorChanges } from '../../../src/editor/saveEditorChanges'
import {
  renderStatus,
  type EditorStatusActions,
  type EditorStatusMessage,
} from '../../../src/editor/useEditorStatus'
import { tDynamic } from '../../../src/i18n/t'
import { currentLocale } from '../../../src/i18n/runtime'
import { stubFetch, type StubbedFetch } from '../../helpers/stub-fetch'
import { apiMessage } from '../../../src/api/result'

describe('saveEditorChanges', () => {
  type Call = { method: string; args: unknown[] }
  let calls: Call[]
  let statusActions: EditorStatusActions

  /**
   * What a stored status message renders to. The status store holds
   * `{ key, params }` so a locale switch can re-render it, but what these cases
   * are about is the wording the user ends up seeing, so they assert on that.
   */
  const shown = (message: EditorStatusMessage): string =>
    renderStatus((key, params) => tDynamic(currentLocale(), key, params), message)

  // Every case below installs its own stub. Restored after each one, or the
  // last stub — a 400 refusal — leaks into every test file that runs after this
  // one in the same `bun test` process.
  let stubbed: StubbedFetch | undefined
  afterEach(() => {
    stubbed?.restore()
    stubbed = undefined
  })

  /** Answer every save POST with `body`, at `status` when the case is about one. */
  function stubSave(body: unknown, status?: number): void {
    stubbed?.restore()
    stubbed = stubFetch({ '/api/': () => Response.json(body, status ? { status } : undefined) })
  }

  beforeEach(() => {
    calls = []
    statusActions = {
      loadStart: () => calls.push({ method: 'loadStart', args: [] }),
      loadSuccess: () => calls.push({ method: 'loadSuccess', args: [] }),
      loadError: (error) => calls.push({ method: 'loadError', args: [shown(error)] }),
      saveStart: () => calls.push({ method: 'saveStart', args: [] }),
      saveSuccess: (message) => calls.push({ method: 'saveSuccess', args: [shown(message)] }),
      saveError: (error) => calls.push({ method: 'saveError', args: [shown(error)] }),
      setError: (error) => calls.push({ method: 'setError', args: [shown(error)] }),
    }
  })

  it('calls saveStart then saveSuccess on success and returns the response data', async () => {
    stubSave({ success: true, contentHash: 'abc123' })

    const result = await saveEditorChanges('/api/test/save', { data: 'test' }, statusActions)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      { method: 'saveSuccess', args: ['Changes saved successfully'] },
    ])
    expect(result).toEqual({ success: true, contentHash: 'abc123' })
  })

  it('appends a dropped-note report to the success status when the save dropped notes', async () => {
    stubSave({
      success: true,
      contentHash: 'abc123',
      droppedNotes: [{ cardName: 'Sol Ring', cardId: 3, note: 'from trade' }],
    })

    await saveEditorChanges('/api/test/save', { data: 'test' }, statusActions)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      {
        method: 'saveSuccess',
        args: ['Changes saved successfully. Note dropped on merge: Sol Ring ("from trade").'],
      },
    ])
  })

  it('resolves saveError message via message ?? fallback on failure responses', async () => {
    type SaveErrorCase = {
      response: { success: boolean; message?: string }
      expected: string
    }
    const cases: SaveErrorCase[] = [
      { response: { success: false, message: 'Bad request data' }, expected: 'Bad request data' },
      { response: { success: false }, expected: 'Save failed' },
    ]

    for (const { response, expected } of cases) {
      calls = []
      stubSave(response)

      await saveEditorChanges('/api/test/save', {}, statusActions)

      expect(calls).toEqual([
        { method: 'saveStart', args: [] },
        { method: 'saveError', args: [expected] },
      ])
    }
  })

  it('calls saveError on network failure and returns undefined', async () => {
    stubbed = stubFetch({
      '/api/': () => {
        throw new Error('Network error')
      },
    })

    const result = await saveEditorChanges('/api/test/save', {}, statusActions)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      { method: 'saveError', args: ['Failed to save changes'] },
    ])
    expect(result).toBeUndefined()
  })

  it('sends correct request configuration', async () => {
    stubSave({ success: true })

    const body = { changes: [{ action: 'add', cardName: 'Sol Ring' }], contentHash: 'abc123' }
    await saveEditorChanges('/api/collection/my-col/save', body, statusActions)

    const sent = stubbed?.sent[0]
    expect(sent?.url).toBe('/api/collection/my-col/save')
    expect(sent?.method).toBe('POST')
    expect(sent?.init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(sent?.init?.credentials).toBe('same-origin')
    expect(sent?.init?.body).toBe(JSON.stringify(body))
  })

  it('handles 409 conflict response', async () => {
    stubSave(
      {
        success: false,
        conflict: true,
        message: 'Deck has been modified since you loaded it. Please reload.',
      },
      409,
    )

    const result = await saveEditorChanges('/api/test/save', {}, statusActions)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      {
        method: 'saveError',
        args: ['Deck has been modified since you loaded it. Please reload.'],
      },
    ])
    expect(result).toEqual({
      success: false,
      conflict: true,
      message: 'Deck has been modified since you loaded it. Please reload.',
    })
  })

  it('handles conflict flag without 409 status', async () => {
    stubSave({ success: false, conflict: true }, 200)

    const result = await saveEditorChanges('/api/test/save', {}, statusActions)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      {
        method: 'saveError',
        args: ['Content has been modified. Please reload to continue editing.'],
      },
    ])
    expect(result?.conflict).toBe(true)
  })

  it('stores its own wording and a keyed refusal unrendered, and keyless prose as text', async () => {
    const recorded: EditorStatusMessage[] = []
    const capture: EditorStatusActions = {
      ...statusActions,
      saveSuccess: (message) => recorded.push(message),
      saveError: (error) => recorded.push(error),
    }

    stubSave({ success: true })
    await saveEditorChanges('/api/test/save', {}, capture)

    stubSave({ success: false, message: 'Bad request data' }, 400)
    await saveEditorChanges('/api/test/save', {}, capture)

    // A refusal carrying a key this bundle knows is held by its key, so a
    // language switch relabels it like the editor's own wording.
    const conflict = apiMessage('admin.api.save.conflict', { listType: 'deck' })
    stubSave({ success: false, conflict: true, ...conflict }, 409)
    await saveEditorChanges('/api/test/save', {}, capture)

    expect(recorded).toEqual([
      { kind: 'key', key: 'ui.editor.saveSuccess', params: undefined },
      { kind: 'text', text: 'Bad request data' },
      { kind: 'key', key: 'admin.api.save.conflict', params: { listType: 'deck' } },
    ])
  })
})
