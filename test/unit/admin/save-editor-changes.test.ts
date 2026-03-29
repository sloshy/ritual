import { describe, it, expect, beforeEach } from 'bun:test'
import { saveEditorChanges } from '../../../src/admin/site/hooks/saveEditorChanges'
import type { StatusAction } from '../../../src/admin/site/hooks/useEditorStatus'

describe('saveEditorChanges', () => {
  let dispatched: StatusAction[]
  let discardCalled: boolean
  const dispatch = (action: StatusAction) => {
    dispatched.push(action)
  }
  const discardAll = () => {
    discardCalled = true
  }

  beforeEach(() => {
    dispatched = []
    discardCalled = false
  })

  it('dispatches SAVE_START then SAVE_SUCCESS on success', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async () =>
      ({
        json: async () => ({ success: true }),
      }) as Response) as any

    await saveEditorChanges('/api/test/save', { data: 'test' }, dispatch, discardAll)

    expect(dispatched).toEqual([
      { type: 'SAVE_START' },
      { type: 'SAVE_SUCCESS', message: 'Changes saved successfully' },
    ])
    expect(discardCalled).toBe(true)
  })

  it('dispatches SAVE_ERROR when response has success=false', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async () =>
      ({
        json: async () => ({ success: false, error: 'Conflict' }),
      }) as Response) as any

    await saveEditorChanges('/api/test/save', { data: 'test' }, dispatch, discardAll)

    expect(dispatched).toEqual([{ type: 'SAVE_START' }, { type: 'SAVE_ERROR', error: 'Conflict' }])
    expect(discardCalled).toBe(false)
  })

  it('dispatches SAVE_ERROR with fallback message when no error provided', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async () =>
      ({
        json: async () => ({ success: false }),
      }) as Response) as any

    await saveEditorChanges('/api/test/save', {}, dispatch, discardAll)

    expect(dispatched).toEqual([
      { type: 'SAVE_START' },
      { type: 'SAVE_ERROR', error: 'Save failed' },
    ])
  })

  it('dispatches SAVE_ERROR on network failure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => {
      throw new Error('Network error')
    }) as any

    await saveEditorChanges('/api/test/save', {}, dispatch, discardAll)

    expect(dispatched).toEqual([
      { type: 'SAVE_START' },
      { type: 'SAVE_ERROR', error: 'Failed to save changes' },
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
    await saveEditorChanges('/api/collection/my-col/save', body, dispatch, discardAll)

    expect(capturedUrl).toBe('/api/collection/my-col/save')
    expect(capturedInit.method).toBe('POST')
    expect(capturedInit.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(capturedInit.credentials).toBe('same-origin')
    expect(capturedInit.body).toBe(JSON.stringify(body))
  })
})
