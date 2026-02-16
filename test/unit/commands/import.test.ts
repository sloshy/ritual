import { describe, expect, test } from 'bun:test'
import { resolveMoxfieldUserAgent } from '../../../src/commands/import'

describe('import command helpers', () => {
  test('resolveMoxfieldUserAgent prefers CLI option over env var', () => {
    const resolved = resolveMoxfieldUserAgent('cli-agent', 'env-agent')
    expect(resolved).toBe('cli-agent')
  })

  test('resolveMoxfieldUserAgent falls back to env var', () => {
    const resolved = resolveMoxfieldUserAgent(undefined, 'env-agent')
    expect(resolved).toBe('env-agent')
  })

  test('resolveMoxfieldUserAgent trims values and rejects empty values', () => {
    expect(resolveMoxfieldUserAgent('  cli-agent  ', 'env-agent')).toBe('cli-agent')
    expect(resolveMoxfieldUserAgent('   ', '  env-agent  ')).toBe('env-agent')
    expect(resolveMoxfieldUserAgent('   ', '   ')).toBeUndefined()
  })
})
