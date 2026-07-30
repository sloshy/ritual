import { afterEach, describe, expect, test } from 'bun:test'
import { Command } from 'commander'
import {
  addDryRunOption,
  canPromptWithOutput,
  classifyFileReadError,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  parseEnumFlag,
  parseFields,
  parseOutputFormat,
  projectFields,
} from '../../../src/commands/scripting'
import type { ScriptingOptions } from '../../../src/commands/scripting'
import { setNoInputOverride } from '../../../src/no-input'
import { stubTty } from '../../test-utils'

type WritableTarget = {
  write: (chunk: string | Uint8Array, ...args: unknown[]) => boolean
}

async function captureOutput(
  stream: 'stdout' | 'stderr',
  run: () => Promise<void> | void,
): Promise<string> {
  const target = process[stream] as unknown as WritableTarget
  const originalWrite = target.write
  let output = ''

  target.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
    const callback = args.find((arg): arg is () => void => typeof arg === 'function')
    if (callback) callback()
    return true
  }

  try {
    await run()
  } finally {
    target.write = originalWrite
  }

  return output
}

describe('scripting command helpers', () => {
  test('parseOutputFormat accepts text, json, and ndjson', () => {
    expect(parseOutputFormat('text')).toBe('text')
    expect(parseOutputFormat('json')).toBe('json')
    expect(parseOutputFormat('ndjson')).toBe('ndjson')
    expect(parseOutputFormat('JSON')).toBe('json')
  })

  test('parseOutputFormat rejects unsupported formats', () => {
    expect(() => parseOutputFormat('yaml')).toThrow(
      "Invalid output format 'yaml'. Use one of: text, json, ndjson.",
    )
  })

  test('parseEnumFlag lowercases and returns a member', () => {
    expect(parseEnumFlag('PUSH', ['push', 'pull'], 'direction')).toBe('push')
    expect(parseEnumFlag('pull', ['push', 'pull'], 'direction')).toBe('pull')
  })

  test('parseEnumFlag rejects non-members with the unified message', () => {
    expect(() => parseEnumFlag('sideways', ['push', 'pull'], 'direction')).toThrow(
      "Invalid direction 'sideways'. Use one of: push, pull.",
    )
  })

  test('addDryRunOption registers -n/--dry-run', () => {
    const command = addDryRunOption(new Command('x'), 'Preview only')
    command.parse(['-n'], { from: 'user' })
    expect(command.opts().dryRun).toBe(true)

    const long = addDryRunOption(new Command('y'), 'Preview only')
    long.parse([], { from: 'user' })
    expect(long.opts().dryRun).toBeUndefined()
  })

  test('normalizeScriptingOptions applies defaults', () => {
    expect(normalizeScriptingOptions({})).toEqual({ output: 'text', quiet: false })
    expect(normalizeScriptingOptions({ quiet: true }, 'json')).toEqual({
      output: 'json',
      quiet: true,
    })
  })

  test('parseFields parses comma-separated fields', () => {
    expect(parseFields('name,set,prices.usd')).toEqual(['name', 'set', 'prices.usd'])
  })

  test('projectFields projects nested paths for records', () => {
    const projected = projectFields(
      {
        name: 'Sol Ring',
        set: 'lea',
        prices: { usd: '1.00', usd_foil: '2.00' },
      },
      ['name', 'prices.usd'],
    )

    expect(projected).toEqual({ name: 'Sol Ring', prices: { usd: '1.00' } })
  })

  test('projectFields projects arrays of records', () => {
    const projected = projectFields(
      [
        { name: 'A', set: 'x' },
        { name: 'B', set: 'y' },
      ],
      ['name'],
    )

    expect(projected).toEqual([{ name: 'A' }, { name: 'B' }])
  })

  test('emitOutput writes arrays as ndjson', async () => {
    const output = await captureOutput('stdout', () => {
      emitOutput([{ name: 'Sol Ring' }, { name: 'Arcane Signet' }], {
        output: 'ndjson',
        quiet: false,
      })
    })

    expect(output).toBe('{"name":"Sol Ring"}\n{"name":"Arcane Signet"}\n')
  })

  test('emitError writes structured json errors', async () => {
    const output = await captureOutput('stderr', () => {
      emitError('not_found', 'No results found.', { output: 'json', quiet: false }, { page: 1 })
    })

    const parsed = JSON.parse(output) as {
      error: { code: string; message: string; details: { page: number } }
    }
    expect(parsed.error.code).toBe('not_found')
    expect(parsed.error.message).toBe('No results found.')
    expect(parsed.error.details.page).toBe(1)
  })

  test('classifyFileReadError maps a missing file to not-found', () => {
    const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' })
    expect(classifyFileReadError(enoent)).toEqual({
      errorCode: 'not_found',
      exitCode: ExitCode.NotFound,
    })
  })

  test('classifyFileReadError maps any other failure to a runtime error', () => {
    const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    expect(classifyFileReadError(eacces)).toEqual({
      errorCode: 'runtime_error',
      exitCode: ExitCode.RuntimeError,
    })
    expect(classifyFileReadError(new Error('plain'))).toEqual({
      errorCode: 'runtime_error',
      exitCode: ExitCode.RuntimeError,
    })
  })
})

/**
 * `bun test` never has a terminal, so the gate is supplied one and then loses a
 * single condition per case — otherwise it reads `false` for the wrong reason
 * and any clause could be deleted without a failure.
 */
describe('canPromptWithOutput', () => {
  stubTty({ stdin: true })
  afterEach(() => setNoInputOverride(undefined))

  const TEXT: ScriptingOptions = { output: 'text', quiet: false }

  test('text output on a terminal with prompts enabled can ask', () => {
    expect(canPromptWithOutput(TEXT)).toBe(true)
  })

  test('--no-input answers every question up front', () => {
    setNoInputOverride(true)
    expect(canPromptWithOutput(TEXT)).toBe(false)
  })

  test('scripted output owns stdout, so there is nowhere to prompt', () => {
    for (const output of ['json', 'ndjson'] as const) {
      expect(canPromptWithOutput({ output, quiet: false })).toBe(false)
    }
  })

  test('a piped stdin has nobody to answer', () => {
    process.stdin.isTTY = false
    expect(canPromptWithOutput(TEXT)).toBe(false)
  })
})
