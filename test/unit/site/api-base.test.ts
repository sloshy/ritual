import { describe, test, expect, afterEach, beforeEach } from 'bun:test'
import {
  apiActive,
  apiBase,
  apiDegraded,
  apiUrl,
  dataUrl,
  detailPath,
  detailUrl,
  reportDataFetchError,
  resetApiBase,
  setApiBase,
} from '../../../src/list-view/api-base'

describe('api-base', () => {
  beforeEach(() => {
    resetApiBase()
  })

  // Module-level signals survive across test files in one process; leave the
  // static default behind for whoever runs next.
  afterEach(() => {
    resetApiBase()
  })

  test('normalizes trailing slashes off the base', () => {
    setApiBase('https://api.example.com//')
    expect(apiBase()).toBe('https://api.example.com')
  })

  test('dataUrl stays relative for static and same-origin, prefixed for a remote base', () => {
    expect(dataUrl('index.json')).toBe('index.json')
    setApiBase('')
    expect(dataUrl('index.json')).toBe('index.json')
    setApiBase('https://api.example.com')
    expect(dataUrl('index.json')).toBe('https://api.example.com/index.json')
  })

  test('apiUrl is root-relative same-origin and absolute for a remote base', () => {
    setApiBase('')
    expect(apiUrl('api/autocomplete?q=x')).toBe('/api/autocomplete?q=x')
    setApiBase('http://localhost:3000')
    expect(apiUrl('api/autocomplete?q=x')).toBe('http://localhost:3000/api/autocomplete?q=x')
  })

  test('detailPath maps each list type; detailUrl applies the base', () => {
    expect(detailPath('deck', 'my-deck')).toBe('decks/my-deck.json')
    expect(detailPath('collection', 'binder')).toBe('collections/binder.json')
    expect(detailPath('wanted', 'wants')).toBe('wanted/wants.json')
    setApiBase('https://api.example.com')
    expect(detailUrl('deck', 'my-deck')).toBe('https://api.example.com/decks/my-deck.json')
  })

  test('reportDataFetchError degrades only for a remote base, one-way', () => {
    reportDataFetchError(new Error('static mode'))
    expect(apiDegraded()).toBeFalse()

    setApiBase('')
    reportDataFetchError(new Error('same-origin'))
    expect(apiDegraded()).toBeFalse()
    expect(apiActive()).toBeTrue()

    setApiBase('https://api.example.com')
    reportDataFetchError(new Error('network down'))
    expect(apiDegraded()).toBeTrue()
    expect(apiBase()).toBeNull()

    // One-way: later errors keep the degraded static state.
    reportDataFetchError(new Error('again'))
    expect(apiBase()).toBeNull()
  })

  test('aborts never degrade', () => {
    setApiBase('https://api.example.com')
    reportDataFetchError(new DOMException('aborted', 'AbortError'))
    expect(apiDegraded()).toBeFalse()
    expect(apiBase()).toBe('https://api.example.com')
  })
})
