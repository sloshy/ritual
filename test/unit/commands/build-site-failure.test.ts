import { describe, expect, test } from 'bun:test'
import { CommanderError } from 'commander'
import { buildFailure } from '../../../src/commands/build-site'
import { CancelledError, CardCommandError, ExitCode } from '../../../src/util/errors'
import { SyncMessageError, syncMessage } from '../../../src/sync/message'
import { pseudoCatalog, pseudoString, withSyntheticLocale } from '../../helpers/sync-text'

/** What a cold network throws from inside the build: system text, no key. */
const OFFLINE = new Error('getaddrinfo ENOTFOUND api.scryfall.com')

/** The framed failure, asserted to be a structured refusal. */
function framed(err: unknown): CardCommandError {
  const failure = buildFailure(err)
  if (!(failure instanceof CardCommandError)) throw new Error('expected a CardCommandError')
  return failure
}

/** A broken pipe as Node reports one: an error carrying `code: 'EPIPE'`. */
function brokenPipe(): Error {
  return Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
}

describe('buildFailure', () => {
  test('frames an unexpected failure, its own text nested as the reason', () => {
    const failure = framed(OFFLINE)
    expect(failure.message).toBe('Build failed: getaddrinfo ENOTFOUND api.scryfall.com')
    expect(failure.exitCode).toBe(ExitCode.RuntimeError)
    expect(failure.messageRef).toEqual({
      key: 'cli.buildSite.failed',
      params: { reason: OFFLINE.message },
    })
  })

  test('words the frame in the CLI’s language', () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), () => {
      expect(framed(OFFLINE).message).toBe(
        pseudoString('cli.buildSite.failed').replace('{reason}', OFFLINE.message),
      )
    })
  })

  // Each already says what it is, and keeps its own exit code: framing one
  // would say "Build failed" twice, or turn a usage error (exit 2) into exit 1.
  const passedThrough: [string, () => unknown][] = [
    ['a catalog-worded refusal', () => new CardCommandError('usage_error', 'worded', 2)],
    [
      'an engine failure raised from a key',
      () => new SyncMessageError(syncMessage('cli.buildSite.nothingToBuild')),
    ],
    ['a cancellation', () => new CancelledError(syncMessage('cli.buildSite.nothingToBuild'))],
    ['an error Commander raised', () => new CommanderError(2, 'commander.error', 'printed')],
    ['a broken pipe', brokenPipe],
  ]
  test.each(passedThrough)('passes %s through untouched', (_name, make) => {
    const err = make()
    expect(buildFailure(err)).toBe(err)
  })
})
