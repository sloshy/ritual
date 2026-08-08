import { describe, it, expect, afterEach, beforeEach } from 'bun:test'
import { saveEditorChanges } from '../../../src/editor/saveEditorChanges'
import {
  renderStatus,
  type EditorStatusActions,
  type EditorStatusMessage,
} from '../../../src/editor/useEditorStatus'
import { tDynamic } from '../../../src/i18n/t'
import { currentLocale } from '../../../src/i18n/runtime'

describe('saveEditorChanges', () => {
  type Call = { method: string; args: unknown[] }
  let calls: Call[]
  let discardCalled: boolean
  let statusActions: EditorStatusActions

  const discardAll = () => {
    discardCalled = true
  }

  /**
   * What a stored status message renders to. The status store holds
   * `{ key, params }` so a locale switch can re-render it, but what these cases
   * are about is the wording the user ends up seeing, so they assert on that.
   */
  const shown = (message: EditorStatusMessage): string =>
    renderStatus((key, params) => tDynamic(currentLocale(), key, params), message)

  // Every case below installs its own `globalThis.fetch` stub. Restored after
  // each one, or the last stub — a 400 refusal — leaks into every test file that
  // runs after this one in the same `bun test` process.
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  beforeEach(() => {
    calls = []
    discardCalled = false
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
    globalThis.fetch = (async () =>
      ({
        json: async () => ({ success: true, contentHash: 'abc123' }),
      }) as Response) as any

    const result = await saveEditorChanges(
      '/api/test/save',
      { data: 'test' },
      statusActions,
      discardAll,
    )

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      { method: 'saveSuccess', args: ['Changes saved successfully'] },
    ])
    expect(discardCalled).toBe(true)
    expect(result).toEqual({ success: true, contentHash: 'abc123' })
  })

  it('appends a dropped-note report to the success status when the save dropped notes', async () => {
    globalThis.fetch = (async () =>
      ({
        json: async () => ({
          success: true,
          contentHash: 'abc123',
          droppedNotes: [{ cardName: 'Sol Ring', cardId: 3, note: 'from trade' }],
        }),
      }) as Response) as any

    await saveEditorChanges('/api/test/save', { data: 'test' }, statusActions, discardAll)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      {
        method: 'saveSuccess',
        args: ['Changes saved successfully. Note dropped on merge: Sol Ring ("from trade").'],
      },
    ])
  })

  it('resolves saveError message via error ?? message ?? fallback on failure responses', async () => {
    type SaveErrorCase = {
      response: { success: boolean; error?: string; message?: string }
      expected: string
    }
    const cases: SaveErrorCase[] = [
      { response: { success: false, error: 'Conflict' }, expected: 'Conflict' },
      { response: { success: false, message: 'Bad request data' }, expected: 'Bad request data' },
      { response: { success: false }, expected: 'Save failed' },
    ]

    for (const { response, expected } of cases) {
      calls = []
      discardCalled = false
      globalThis.fetch = (async () =>
        ({
          json: async () => response,
        }) as Response) as any

      await saveEditorChanges('/api/test/save', {}, statusActions, discardAll)

      expect(calls).toEqual([
        { method: 'saveStart', args: [] },
        { method: 'saveError', args: [expected] },
      ])
      expect(discardCalled).toBe(false)
    }
  })

  it('calls saveError on network failure and returns undefined', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Network error')
    }) as any

    const result = await saveEditorChanges('/api/test/save', {}, statusActions, discardAll)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      { method: 'saveError', args: ['Failed to save changes'] },
    ])
    expect(discardCalled).toBe(false)
    expect(result).toBeUndefined()
  })

  it('sends correct request configuration', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit = {}

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = input as string
      capturedInit = init ?? {}
      return {
        json: async () => ({ success: true }),
      } as Response
    }) as any

    const body = { changes: [1, 2], entries: ['a'] }
    await saveEditorChanges('/api/collection/my-col/save', body, statusActions, discardAll)

    expect(capturedUrl).toBe('/api/collection/my-col/save')
    expect(capturedInit.method).toBe('POST')
    expect(capturedInit.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(capturedInit.credentials).toBe('same-origin')
    expect(capturedInit.body).toBe(JSON.stringify(body))
  })

  it('handles 409 conflict response', async () => {
    globalThis.fetch = (async () =>
      ({
        status: 409,
        json: async () => ({
          success: false,
          conflict: true,
          message: 'Deck has been modified since you loaded it. Please reload.',
        }),
      }) as Response) as any

    const result = await saveEditorChanges('/api/test/save', {}, statusActions, discardAll)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      {
        method: 'saveError',
        args: ['Deck has been modified since you loaded it. Please reload.'],
      },
    ])
    expect(discardCalled).toBe(false)
    expect(result).toEqual({
      success: false,
      conflict: true,
      message: 'Deck has been modified since you loaded it. Please reload.',
    })
  })

  it('handles conflict flag without 409 status', async () => {
    globalThis.fetch = (async () =>
      ({
        status: 200,
        json: async () => ({ success: false, conflict: true }),
      }) as Response) as any

    const result = await saveEditorChanges('/api/test/save', {}, statusActions, discardAll)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      {
        method: 'saveError',
        args: ['Content has been modified. Please reload to continue editing.'],
      },
    ])
    expect(result?.conflict).toBe(true)
  })

  it('stores its own wording unrendered, and server prose as text', async () => {
    const recorded: EditorStatusMessage[] = []
    const capture: EditorStatusActions = {
      ...statusActions,
      saveSuccess: (message) => recorded.push(message),
      saveError: (error) => recorded.push(error),
    }

    globalThis.fetch = (async () => ({ json: async () => ({ success: true }) }) as Response) as any
    await saveEditorChanges('/api/test/save', {}, capture, discardAll)

    globalThis.fetch = (async () =>
      ({
        status: 400,
        json: async () => ({ success: false, error: 'Bad request data' }),
      }) as Response) as any
    await saveEditorChanges('/api/test/save', {}, capture, discardAll)

    expect(recorded).toEqual([
      { kind: 'key', key: 'ui.editor.saveSuccess', params: undefined },
      { kind: 'text', text: 'Bad request data' },
    ])
  })
})
