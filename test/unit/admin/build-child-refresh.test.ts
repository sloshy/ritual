import { describe, expect, test } from 'bun:test'
import { buildChildRefreshMode } from '../../../src/admin/api/build-site'

describe('buildChildRefreshMode', () => {
  test.each([
    // The child has no terminal, so a question it would decline is answered yes.
    ['ask', 'auto'],
    // Every other mode is the server's own choice, passed through.
    ['auto', 'auto'],
    ['no-bulk', 'no-bulk'],
    ['never', 'never'],
  ] as const)('a server running --refresh %s builds with --refresh %s', (server, child) => {
    expect(buildChildRefreshMode(server)).toBe(child)
  })
})
