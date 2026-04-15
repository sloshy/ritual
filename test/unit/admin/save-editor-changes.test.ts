import { describe, it, expect, beforeEach } from 'bun:test'
import { saveEditorChanges } from '../../../src/admin/site/hooks/saveEditorChanges'
import type { EditorStatusActions } from '../../../src/admin/site/hooks/useEditorStatus'

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

  it('calls saveStart then saveSuccess on success', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async () =>
      ({
        json: async () => ({ success: true }),
      }) as Response) as any

    await saveEditorChanges('/api/test/save', { data: 'test' }, statusActions, discardAll)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      { method: 'saveSuccess', args: ['Changes saved successfully'] },
    ])
    expect(discardCalled).toBe(true)
  })

  it('calls saveError when response has success=false', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async () =>
      ({
        json: async () => ({ success: false, error: 'Conflict' }),
      }) as Response) as any

    await saveEditorChanges('/api/test/save', { data: 'test' }, statusActions, discardAll)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      { method: 'saveError', args: ['Conflict'] },
    ])
    expect(discardCalled).toBe(false)
  })

  it('calls saveError with fallback message when no error provided', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async () =>
      ({
        json: async () => ({ success: false }),
      }) as Response) as any

    await saveEditorChanges('/api/test/save', {}, statusActions, discardAll)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      { method: 'saveError', args: ['Save failed'] },
    ])
  })

  it('calls saveError on network failure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => {
      throw new Error('Network error')
    }) as any

    await saveEditorChanges('/api/test/save', {}, statusActions, discardAll)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      { method: 'saveError', args: ['Failed to save changes'] },
    ])
    expect(discardCalled).toBe(false)
  })

  it('sends correct request configuration', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  it('returns data on success', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async () =>
      ({
        json: async () => ({ success: true, contentHash: 'abc123' }),
      }) as Response) as any

    const result = await saveEditorChanges('/api/test/save', {}, statusActions, discardAll)

    expect(result).toEqual({ success: true, contentHash: 'abc123' })
  })

  it('returns undefined on network failure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => {
      throw new Error('Network error')
    }) as any

    const result = await saveEditorChanges('/api/test/save', {}, statusActions, discardAll)

    expect(result).toBeUndefined()
  })

  it('handles 409 conflict response', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  it('uses message field as fallback when error is absent', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async () =>
      ({
        status: 400,
        json: async () => ({ success: false, message: 'Bad request data' }),
      }) as Response) as any

    await saveEditorChanges('/api/test/save', {}, statusActions, discardAll)

    expect(calls).toEqual([
      { method: 'saveStart', args: [] },
      { method: 'saveError', args: ['Bad request data'] },
    ])
  })
})
