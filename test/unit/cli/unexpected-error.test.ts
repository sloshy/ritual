import { describe, expect, test } from 'bun:test'
import {
  debugTrace,
  isDebugEnabled,
  isEnvironmentFailure,
  unexpectedErrorText,
} from '../../../src/cli/unexpected-error'
import { t } from '../../../src/i18n/t'

/**
 * The classifier behind the "This looks like a bug" line, and the trace
 * `RITUAL_DEBUG` prints. Where the line is printed, and in which output mode,
 * is pinned through `runCommandAction` in `action.test.ts`.
 */

const withCode = (code: unknown, error: Error = new Error('failed')): Error =>
  Object.assign(error, { code })

describe('isEnvironmentFailure', () => {
  test.each<[string, unknown, boolean]>([
    ['an errno failure', withCode('EACCES'), true],
    ['a Bun network failure', withCode('ConnectionRefused'), true],
    ['a TLS hostname mismatch', withCode('ERR_TLS_CERT_ALTNAME_INVALID'), true],
    ['an unverifiable certificate', withCode('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), true],
    ['a cancelled request', new DOMException('aborted', 'AbortError'), true],
    ['a timed-out request', new DOMException('timed out', 'TimeoutError'), true],
    [
      'a wrapper whose cause is an errno failure',
      new Error('could not read the file', { cause: withCode('ENOENT') }),
      true,
    ],
    ['a Node argument check', withCode('ERR_INVALID_ARG_TYPE', new TypeError('bad')), false],
    ["an application's own lowercase code", withCode('not_found'), false],
    ['a plain Error', new Error('undefined is not an object'), false],
    ['an empty code', withCode(''), false],
    ['a numeric code', withCode(1), false],
    ['a thrown string', 'boom', false],
  ])('%s → %p', (_label, error, expected) => {
    expect(isEnvironmentFailure(error)).toBe(expected)
  })
})

describe('isDebugEnabled', () => {
  test.each<[string, boolean]>([
    ['', false],
    ['1', true],
    ['true', true],
    ['0', false],
    ['off', false],
  ])('RITUAL_DEBUG=%p → %p', (value, expected) => {
    expect(isDebugEnabled(value)).toBe(expected)
  })
})

describe('debugTrace', () => {
  test('a cyclic cause chain stops at the depth cap and says so', () => {
    const error = new Error('loops')
    error.cause = error
    const lines = debugTrace(error).split('\n')
    expect(lines.filter((line) => line.startsWith('Caused by: Error: loops'))).toHaveLength(5)
    expect(lines.at(-1)).toBe(t('cli.unexpected.causeTruncated'))
  })

  test('a non-Error cause is printed as text, and a null cause ends the chain', () => {
    expect(debugTrace(new Error('outer', { cause: 'disk on fire' }))).toContain(
      'Caused by: disk on fire',
    )
    expect(debugTrace(new Error('outer', { cause: null }))).not.toContain('Caused by')
  })
})

describe('unexpectedErrorText', () => {
  const context = { debug: true, issuesUrl: 'https://example.test/issues' }

  test('under RITUAL_DEBUG, a failure of the machine is its trace with no report line', () => {
    const text = unexpectedErrorText(withCode('EACCES', new Error('EACCES: denied')), context)
    expect(text).toStartWith('Error: EACCES: denied\n')
    expect(text).not.toContain(context.issuesUrl)
  })
})
