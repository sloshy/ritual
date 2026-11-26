import { describe, expect, test } from 'bun:test'
import { parseHttpUrl, type HttpUrlProblem } from '../../../src/util/http-url'

type Row = { raw: string; expected: string | HttpUrlProblem }

/** The parsed URL's `href`, or the problem as returned. */
function outcome(raw: string): string | HttpUrlProblem {
  const parsed = parseHttpUrl(raw)
  return parsed instanceof URL ? parsed.href : parsed
}

describe('parseHttpUrl', () => {
  test('accepts absolute http(s) URLs and reports every other value by its problem', () => {
    const rows: Row[] = [
      { raw: 'https://example.com/a?b#c', expected: 'https://example.com/a?b#c' },
      { raw: 'HTTP://Example.com', expected: 'http://example.com/' },
      { raw: 'example.com', expected: { problem: 'invalid' } },
      { raw: '', expected: { problem: 'invalid' } },
      { raw: '/relative/path', expected: { problem: 'invalid' } },
      { raw: 'https://bad host', expected: { problem: 'invalid' } },
      { raw: 'ftp://example.com', expected: { problem: 'scheme' } },
      { raw: 'file:///etc/passwd', expected: { problem: 'scheme' } },
      { raw: 'javascript:alert(1)', expected: { problem: 'scheme' } },
    ]
    for (const { raw, expected } of rows) {
      expect({ raw, parsed: outcome(raw) }).toEqual({ raw, parsed: expected })
    }
  })
})
