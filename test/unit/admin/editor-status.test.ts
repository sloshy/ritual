import { describe, test, expect } from 'bun:test'
import {
  statusReducer,
  initialStatus,
  type EditorStatus,
  type StatusAction,
} from '../../../src/admin/site/hooks/useEditorStatus'

describe('statusReducer', () => {
  test('initialStatus has all fields at defaults', () => {
    expect(initialStatus).toEqual({
      loading: false,
      error: null,
      saving: false,
      saveStatus: null,
    })
  })

  test('LOAD_START sets loading true and clears error/saveStatus', () => {
    const prev: EditorStatus = {
      loading: false,
      error: 'old error',
      saving: false,
      saveStatus: 'old status',
    }
    const next = statusReducer(prev, { type: 'LOAD_START' })
    expect(next).toEqual({
      loading: true,
      error: null,
      saving: false,
      saveStatus: null,
    })
  })

  test('LOAD_SUCCESS sets loading false without touching other fields', () => {
    const prev: EditorStatus = {
      loading: true,
      error: null,
      saving: false,
      saveStatus: null,
    }
    const next = statusReducer(prev, { type: 'LOAD_SUCCESS' })
    expect(next.loading).toBe(false)
    expect(next.error).toBeNull()
  })

  test('LOAD_ERROR sets loading false and error message', () => {
    const prev: EditorStatus = { loading: true, error: null, saving: false, saveStatus: null }
    const next = statusReducer(prev, { type: 'LOAD_ERROR', error: 'network failure' })
    expect(next.loading).toBe(false)
    expect(next.error).toBe('network failure')
  })

  test('SAVE_START sets saving true and clears saveStatus', () => {
    const prev: EditorStatus = {
      loading: false,
      error: null,
      saving: false,
      saveStatus: 'previous save ok',
    }
    const next = statusReducer(prev, { type: 'SAVE_START' })
    expect(next.saving).toBe(true)
    expect(next.saveStatus).toBeNull()
  })

  test('SAVE_SUCCESS sets saving false and saveStatus message', () => {
    const prev: EditorStatus = { loading: false, error: null, saving: true, saveStatus: null }
    const next = statusReducer(prev, { type: 'SAVE_SUCCESS', message: 'Saved!' })
    expect(next.saving).toBe(false)
    expect(next.saveStatus).toBe('Saved!')
  })

  test('SAVE_ERROR sets saving false and error', () => {
    const prev: EditorStatus = { loading: false, error: null, saving: true, saveStatus: null }
    const next = statusReducer(prev, { type: 'SAVE_ERROR', error: 'Save failed' })
    expect(next.saving).toBe(false)
    expect(next.error).toBe('Save failed')
  })

  test('SET_ERROR only sets error without touching loading/saving', () => {
    const prev: EditorStatus = { loading: false, error: null, saving: false, saveStatus: 'ok' }
    const next = statusReducer(prev, { type: 'SET_ERROR', error: 'list fetch failed' })
    expect(next.error).toBe('list fetch failed')
    expect(next.loading).toBe(false)
    expect(next.saving).toBe(false)
    expect(next.saveStatus).toBe('ok')
  })

  test('LOAD_ERROR after SAVE preserves saving state', () => {
    const prev: EditorStatus = { loading: true, error: null, saving: true, saveStatus: null }
    const next = statusReducer(prev, { type: 'LOAD_ERROR', error: 'oops' })
    expect(next.loading).toBe(false)
    expect(next.saving).toBe(true) // saving is independent
    expect(next.error).toBe('oops')
  })

  test('all actions return a new object (immutability)', () => {
    const actions: StatusAction[] = [
      { type: 'LOAD_START' },
      { type: 'LOAD_SUCCESS' },
      { type: 'LOAD_ERROR', error: 'e' },
      { type: 'SAVE_START' },
      { type: 'SAVE_SUCCESS', message: 'm' },
      { type: 'SAVE_ERROR', error: 'e' },
      { type: 'SET_ERROR', error: 'e' },
    ]
    for (const action of actions) {
      const next = statusReducer(initialStatus, action)
      expect(next).not.toBe(initialStatus)
    }
  })
})
