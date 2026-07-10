import { describe, it, expect, beforeEach } from 'bun:test'
import { saveEditorChanges } from '../../../src/editor/saveEditorChanges'
import type { EditorStatusActions } from '../../../src/editor/useEditorStatus'

describe('saveEditorChanges', () => {
  type Call = { method: string; args: unknown[] }
  let calls: Call[]
  let discardCalled: boolean
  let statusActions: EditorStatusActions

  const discardAll = () => {
    discardCalled = true
  }

  beforeEach(() => {
    calls = []
    discardCalled = false
    statusActions = {
      loadStart: () => calls.push({ method: 'loadStart', args: [] }),
      loadSuccess: () => calls.push({ method: 'loadSuccess', args: [] }),
      loadError: (error) => calls.push({ method: 'loadError', args: [error] }),
      saveStart: () => calls.push({ method: 'saveStart', args: [] }),
      saveSuccess: (message) => calls.push({ method: 'saveSuccess', args: [message] }),
      saveError: (error) => calls.push({ method: 'saveError', args: [error] }),
      setError: (error) => calls.push({ method: 'setError', args: [error] }),
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
})
