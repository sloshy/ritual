import { describe, expect, test } from 'bun:test'
import { escapeHtml } from '../../../src/util/html-escape'

describe('escapeHtml', () => {
  test('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  test('escapes ampersands first, so an existing entity is not left live', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})
