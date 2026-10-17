/**
 * `POST /api/login/archidekt`'s refusals, whatever language the server process
 * runs in.
 *
 * The admin Archidekt Login page re-renders a refusal from its key in the
 * reader's language, so the route answers in English plus the key — run under
 * the full pseudo-locale, where every catalog message changes, so a sentence
 * rendered in the process's language could not pass for English. (German is
 * not a leg: the bodies carry no `Intl` figure.) The status says whose failure
 * it was: `401` when Archidekt refused the credentials, `502` when Archidekt
 * failed, `500` when this server did. The wording itself is pinned in
 * test/unit/auth/ArchidektAuth.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleArchidektLogin } from '../../src/admin/api/login'
import type { ApiErrorResponse } from '../../src/api/http'
import { pseudoCatalog, withGuardedLocaleAsync } from '../helpers/sync-text'
import { stubFetch, type StubbedFetch } from '../helpers/stub-fetch'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

const LOGIN_URL = 'https://archidekt.com/api/rest-auth/login/'

/** What Archidekt answers a login with the wrong password. */
const BAD_CREDENTIALS = '{"non_field_errors":["Unable to log in with provided credentials."]}'

let ws: BoundWorkspace
let stubbed: StubbedFetch | undefined

beforeEach(async () => {
  ws = await bindWorkspace()
})

afterEach(async () => {
  stubbed?.restore()
  stubbed = undefined
  await ws.dispose()
})

/** Serve the login endpoint with `reply`. */
function archidektAnswers(reply: () => Response): void {
  stubbed = stubFetch({ [LOGIN_URL]: reply })
}

/** The route's answer to `body`, under the pseudo-locale: its status and parsed body. */
async function login(body: Record<string, unknown>): Promise<[number, ApiErrorResponse]> {
  const response = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () =>
    handleArchidektLogin(
      new Request('http://localhost/api/login/archidekt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  )
  return [response.status, (await response.json()) as ApiErrorResponse]
}

const CREDENTIALS = { username: 'tester', password: 'wrong' }

describe('Archidekt login API (Integration)', () => {
  test('refused credentials answer 401 with Archidekt’s reason, in English with the key', async () => {
    archidektAnswers(() => new Response(BAD_CREDENTIALS, { status: 400 }))

    expect(await login(CREDENTIALS)).toEqual([
      401,
      {
        success: false,
        message:
          'Archidekt answered the login with HTTP 400: Unable to log in with provided credentials.',
        messageKey: 'domain.sync.auth.loginFailedWithReason',
        messageParams: { status: 400, reason: 'Unable to log in with provided credentials.' },
      },
    ])
    expect(stubbed?.sent.map((sent) => [sent.url, sent.body])).toEqual([[LOGIN_URL, CREDENTIALS]])
  })

  test.each<[string, () => Response, ApiErrorResponse]>([
    [
      'a server error',
      () => new Response('<html>Bad Gateway</html>', { status: 503 }),
      {
        success: false,
        message: 'Archidekt answered the login with HTTP 503',
        messageKey: 'domain.sync.auth.loginFailed',
        messageParams: { status: 503 },
      },
    ],
    [
      'a rate limit',
      () => new Response('', { status: 429 }),
      {
        success: false,
        message: 'Archidekt answered the login with HTTP 429',
        messageKey: 'domain.sync.auth.loginFailed',
        messageParams: { status: 429 },
      },
    ],
    [
      'a reply without a session',
      () => Response.json(null),
      {
        success: false,
        message: 'Archidekt answered the login without a usable session',
        messageKey: 'domain.sync.auth.loginReplyInvalid',
      },
    ],
    [
      'a success reply that is not JSON',
      () => new Response('<html>Welcome</html>', { status: 200 }),
      {
        success: false,
        message: 'Archidekt answered the login without a usable session',
        messageKey: 'domain.sync.auth.loginReplyInvalid',
      },
    ],
  ])('Archidekt failing with %s answers 502', async (_label, reply, body) => {
    archidektAnswers(reply)

    expect(await login(CREDENTIALS)).toEqual([502, body])
  })

  test('a token that cannot be stored is this server’s failure: 500, the error as raised', async () => {
    archidektAnswers(() => Response.json({ access_token: 'a', refresh_token: 'r' }))
    // A file where the private logins directory should be: the save cannot write.
    await fs.writeFile(path.join(ws.dir, '.logins'), 'not a directory')

    const [status, body] = await login(CREDENTIALS)

    expect(status).toBe(500)
    expect(body).toEqual({ success: false, message: expect.stringContaining('ENOTDIR') })
  })

  test('missing credentials are a 400 that never reaches Archidekt', async () => {
    archidektAnswers(() => new Response(BAD_CREDENTIALS, { status: 400 }))

    expect(await login({ username: 'tester' })).toEqual([
      400,
      {
        success: false,
        message: '"username" and "password" are required.',
        messageKey: 'admin.api.field.credentialsRequired',
      },
    ])
    expect(stubbed?.sent).toEqual([])
  })
})
