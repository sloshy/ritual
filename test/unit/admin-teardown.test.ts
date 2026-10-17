import { describe, expect, test } from 'bun:test'
import { stopListeners, teardownFailures } from '../../src/commands/admin-teardown'

const LISTENERS = [
  { failure: 'cli.admin.teardownFailedMcp' },
  { failure: 'cli.admin.teardownFailedAdmin' },
] as const

const boom = new Error('port busy')
const rejected: PromiseSettledResult<unknown> = { status: 'rejected', reason: boom }
const fulfilled: PromiseSettledResult<unknown> = { status: 'fulfilled', value: undefined }

describe('teardownFailures', () => {
  test('names a failed MCP listener by its own sentence', () => {
    expect(teardownFailures(LISTENERS, [rejected, fulfilled])).toEqual([
      { failure: 'cli.admin.teardownFailedMcp', reason: boom },
    ])
  })

  test('names a failed admin server by its own sentence', () => {
    expect(teardownFailures(LISTENERS, [fulfilled, rejected])).toEqual([
      { failure: 'cli.admin.teardownFailedAdmin', reason: boom },
    ])
  })

  test('reports nothing when both closed', () => {
    expect(teardownFailures(LISTENERS, [fulfilled, fulfilled])).toEqual([])
  })
})

describe('stopListeners', () => {
  test('stops every listener even when one refuses', async () => {
    let adminStopped = false
    const failures = await stopListeners([
      { failure: 'cli.admin.teardownFailedMcp', stop: () => Promise.resolve() },
      {
        failure: 'cli.admin.teardownFailedAdmin',
        stop: () => {
          adminStopped = true
          return Promise.reject(boom)
        },
      },
    ])
    expect(adminStopped).toBe(true)
    expect(failures).toEqual([{ failure: 'cli.admin.teardownFailedAdmin', reason: boom }])
  })
})
