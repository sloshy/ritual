import { describe, expect, test } from 'bun:test'
import { MCP_TOKEN_ENV, resolveMcpToken } from '../../../src/mcp/token'

describe('resolveMcpToken', () => {
  test('prefers an explicit CLI value over the env value', () => {
    expect(resolveMcpToken('from-cli', 'from-env')).toBe('from-cli')
  })

  test('falls back to the env value when the CLI value is absent', () => {
    expect(resolveMcpToken(undefined, 'from-env')).toBe('from-env')
  })

  test('falls back to the env value when the CLI value is blank', () => {
    expect(resolveMcpToken('   ', 'from-env')).toBe('from-env')
  })

  test('returns undefined when neither source is set', () => {
    expect(resolveMcpToken(undefined, undefined)).toBeUndefined()
  })

  test('treats a blank env value as absent', () => {
    expect(resolveMcpToken(undefined, '   ')).toBeUndefined()
  })

  test('trims surrounding whitespace from a CLI token', () => {
    expect(resolveMcpToken('  secret  ', undefined)).toBe('secret')
  })

  test('trims surrounding whitespace from an env token', () => {
    expect(resolveMcpToken(undefined, '  secret  ')).toBe('secret')
  })

  test('defaults the env value to RITUAL_MCP_TOKEN', () => {
    const saved = process.env[MCP_TOKEN_ENV]
    try {
      process.env[MCP_TOKEN_ENV] = 'env-default'
      expect(resolveMcpToken(undefined)).toBe('env-default')
    } finally {
      if (saved === undefined) delete process.env[MCP_TOKEN_ENV]
      else process.env[MCP_TOKEN_ENV] = saved
    }
  })
})
