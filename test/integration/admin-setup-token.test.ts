import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { handleSetup } from '../../src/admin/api/setup'
import { adminUserExists, getAdminUsername } from '../../src/admin/auth'
import { setupUrl } from '../../src/admin/setup-token'
import { SETUP_TOKEN_PARAM } from '../../src/admin/validation'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
})

afterEach(async () => {
  await ws.dispose()
})

type SetupBody = { username?: unknown; password?: unknown; setupToken?: unknown }

function setupRequest(body: SetupBody): Request {
  return new Request('http://localhost/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID = { username: 'owner', password: 'correct horse' }

describe('admin first-run setup token', () => {
  test.each([
    ['missing', undefined],
    ['empty', ''],
    ['wrong', 'not-the-token'],
    ['a number', 12345],
    ['an array', ['token']],
  ])('a %s token is refused with 403 and creates no account', async (_label, setupToken) => {
    const response = await handleSetup(setupRequest({ ...VALID, setupToken }))
    expect(response.status).toBe(403)
    expect(await adminUserExists()).toBe(false)
  })

  test('the token is checked before the field rules, so a probe learns nothing about them', async () => {
    const response = await handleSetup(setupRequest({ username: '', password: 'x' }))
    expect(response.status).toBe(403)
  })

  test('setup with the printed token creates the account, after which setup is closed', async () => {
    const printed = new URL(setupUrl('0.0.0.0', 8080))
    const setupToken = printed.searchParams.get(SETUP_TOKEN_PARAM) ?? ''

    const created = await handleSetup(setupRequest({ ...VALID, setupToken }))
    expect(created.status).toBe(200)
    expect(await getAdminUsername()).toBe('owner')

    // Once an account exists the route refuses outright, token or not.
    const again = await handleSetup(setupRequest({ ...VALID, setupToken }))
    expect(again.status).toBe(409)
  })
})
