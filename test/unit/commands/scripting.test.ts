import { describe, expect, test } from 'bun:test'
import {
  ExitCode,
  emitError,
  emitOutput,
  normalizeScriptingOptions,
  parseFields,
  parseOutputFormat,
  projectFields,
} from '../../../src/commands/scripting'

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

  target.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
    const callback = args.find((arg): arg is () => void => typeof arg === 'function')
    if (callback) callback()
    return true
  }) as WritableTarget['write']

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
    expect(() => parseOutputFormat('yaml')).toThrow("Invalid output format 'yaml'.")
  })

  test('normalizeScriptingOptions applies defaults', () => {
    expect(normalizeScriptingOptions({})).toEqual({ output: 'text', quiet: false })
    expect(normalizeScriptingOptions({ quiet: true }, 'json')).toEqual({
      output: 'json',
      quiet: true,
    })
  })

  test('exit code constants are stable', () => {
    expect(ExitCode.RuntimeError).toBe(1)
    expect(ExitCode.UsageError).toBe(2)
    expect(ExitCode.NotFound).toBe(3)
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
})
