import { afterEach, describe, expect, test } from 'bun:test'
import { runCommandAction } from '../../../src/cli/action'
import {
  isStdoutClosed,
  resetStdoutClosed,
  type ErrorEnvelope,
  type ScriptingOptions,
} from '../../../src/cli/output'
import { CardCommandError, ExitCode } from '../../../src/util/errors'
import { captureStream } from '../../helpers/capture'
import { captureExitCode } from '../../helpers/cli'

const TEXT: ScriptingOptions = { output: 'text', quiet: false }
const JSON_OUT: ScriptingOptions = { output: 'json', quiet: false }

/** What one `runCommandAction` run wrote to stderr, and the exit code it left. */
type Run = { stderr: string; exitCode: number }

/** The stderr document `emitError` writes under `--output json`. */
type ErrorDocument = { error: ErrorEnvelope }

/**
 * Drive `runCommandAction` with a body that runs `before` (whatever the command
 * had already recorded) and then rejects with `thrown`.
 */
async function runThrowing(
  scripting: ScriptingOptions,
  thrown: unknown,
  before?: () => void,
): Promise<Run> {
  let exitCode = 0
  const stderr = await captureStream('stderr', async () => {
    exitCode = await captureExitCode(() =>
      runCommandAction(scripting, async () => {
        before?.()
        throw thrown
      }),
    )
  })
  return { stderr, exitCode }
}

function envelopeOf(stderr: string): ErrorEnvelope {
  return (JSON.parse(stderr) as ErrorDocument).error
}

function brokenPipe(): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error('write EPIPE')
  error.code = 'EPIPE'
  return error
}

afterEach(() => {
  resetStdoutClosed()
})

describe('runCommandAction', () => {
  test('a clean body writes nothing and leaves the exit code alone', async () => {
    let ran = false
    let exitCode = 0
    const stderr = await captureStream('stderr', async () => {
      exitCode = await captureExitCode(() =>
        runCommandAction(JSON_OUT, async () => {
          ran = true
        }),
      )
    })
    expect(ran).toBe(true)
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
  })

  test('a broken pipe latches stdout closed and keeps the code the body recorded', async () => {
    const { stderr, exitCode } = await runThrowing(JSON_OUT, brokenPipe(), () => {
      process.exitCode = ExitCode.NotFound
    })
    expect(stderr).toBe('')
    expect(exitCode).toBe(ExitCode.NotFound)
    expect(isStdoutClosed()).toBe(true)
  })

  test('a CardCommandError keeps its own code, key and exit code under --output json', async () => {
    // The prose and the key are deliberately unrelated here: the envelope
    // carries them as independent channels rather than re-rendering the key.
    const thrown = new CardCommandError(
      'not_found',
      'No deck named Foo',
      ExitCode.NotFound,
      { name: 'Foo' },
      { key: 'errors.resolveList.typeConflict', params: { type: 'deck' } },
    )
    const { stderr, exitCode } = await runThrowing(JSON_OUT, thrown)
    expect(envelopeOf(stderr)).toEqual({
      code: 'not_found',
      messageKey: 'errors.resolveList.typeConflict',
      messageParams: { type: 'deck' },
      message: 'No deck named Foo',
      details: { name: 'Foo' },
    })
    expect(exitCode).toBe(ExitCode.NotFound)
    expect(isStdoutClosed()).toBe(false)
  })

  test('a CardCommandError is a bare message line under --output text', async () => {
    const thrown = new CardCommandError(
      'usage_error',
      'Pick one of --a or --b',
      ExitCode.UsageError,
    )
    const { stderr, exitCode } = await runThrowing(TEXT, thrown)
    expect(stderr).toBe('Pick one of --a or --b\n')
    expect(exitCode).toBe(ExitCode.UsageError)
  })

  test('an unexpected throw becomes a runtime_error envelope with no key and no details', async () => {
    const { stderr, exitCode } = await runThrowing(JSON_OUT, new Error('EISDIR: read failed'))
    // The keys must be *absent*, not present-and-undefined: `ErrorEnvelope`
    // promises a keyless failure serializes byte-identically to one that never
    // had the fields.
    expect(Object.keys(envelopeOf(stderr)).sort()).toEqual(['code', 'message'])
    expect(envelopeOf(stderr).message).toBe('EISDIR: read failed')
    expect(exitCode).toBe(ExitCode.RuntimeError)
    expect(isStdoutClosed()).toBe(false)
  })

  test('a non-Error throw is stringified rather than crashing the catch-all', async () => {
    const { stderr, exitCode } = await runThrowing(TEXT, 'boom')
    expect(stderr).toBe('boom\n')
    expect(exitCode).toBe(ExitCode.RuntimeError)
  })

  test('an unexpected throw is a bare message line under --output text', async () => {
    const { stderr, exitCode } = await runThrowing(TEXT, new Error('EISDIR: read failed'))
    expect(stderr).toBe('EISDIR: read failed\n')
    expect(exitCode).toBe(ExitCode.RuntimeError)
  })
})
