import { describe, expect, test } from 'bun:test'
import { resolveMcpToken } from '../../../src/mcp/token'
import { ENV_VAR } from '../../../src/util/cli-tokens'

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
    const saved = process.env[ENV_VAR.mcpToken]
    try {
      process.env[ENV_VAR.mcpToken] = 'env-default'
      expect(resolveMcpToken(undefined)).toBe('env-default')
    } finally {
      if (saved === undefined) delete process.env[ENV_VAR.mcpToken]
      else process.env[ENV_VAR.mcpToken] = saved
    }
  })
})
