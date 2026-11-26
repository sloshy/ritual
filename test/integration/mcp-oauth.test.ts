import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { createAdminUser, resetAdminPassword, setTotpSecret } from '../../src/admin/auth'
import { generateTotp, resetTotpReplayState } from '../../src/admin/totp'
import { handleLogin } from '../../src/admin/api/auth-login'
import {
  MAX_TOTP_FAILURES_PER_WINDOW,
  TOTP_BUDGET_KEY,
  TOTP_BUDGET_WINDOW_MINUTES,
  globalTotpBudget,
} from '../../src/admin/login-attempt'
import { globalRateLimiter, RateLimiter } from '../../src/admin/rate-limit'
import {
  ACCESS_TOKEN_TTL_MS,
  AUTHORIZATION_CODE_TTL_MS,
  MAX_CLIENTS,
  MAX_REGISTRATIONS_PER_WINDOW,
  PENDING_AUTHORIZATION_TTL_MS,
  REFRESH_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
} from '../../src/mcp/oauth/policy'
import type { OAuthStore } from '../../src/auth/mcp-oauth/store'
import { runHttpServer, UNAUTHORIZED_ERROR_CODE, type McpHttpServer } from '../../src/mcp/run'
import {
  createFingerprintReader,
  type FingerprintSource,
} from '../../src/auth/mcp-oauth/credential-fingerprint'
import type { McpPublicUrl } from '../../src/mcp/public-url'
import { captureConsole } from '../helpers/capture'
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  CLAUDE_REDIRECT,
  MCP_RESOURCE,
  PUBLIC_ORIGIN,
  manualClock,
  openStore,
  pkcePair,
  seedAdminAccount,
  type ManualClock,
  type PkcePair,
} from '../helpers/oauth'
import {
  bindWorkspace,
  withWorkspace,
  writeConfig,
  writeDeckFile,
  writeLoginFile,
  type BoundWorkspace,
} from '../helpers/workspace'
import { binaryPath, ensureBinary, LOCALE_ENV, runCli, withTempDir } from './helpers/cli'
import { freePort, postToolsList, withBusyPort } from './helpers/mcp-http'

const PUBLIC_URL: McpPublicUrl = { origin: PUBLIC_ORIGIN, hostname: 'mcp.example.com' }
const STATIC_TOKEN = 'static-secret-token'
const LOOPBACK = '127.0.0.1'
/** Admin settings for the suite: no failed-attempt delay, so lockout cases run fast. */
const ADMIN_CONFIG = { failedAuthDelayMs: 0 }

/** A running OAuth-enabled endpoint, its store, and the clock it reads. */
type Harness = {
  ws: BoundWorkspace
  server: McpHttpServer
  store: OAuthStore
  time: ManualClock
}

type StartOptions = {
  token?: string
  publicUrl?: McpPublicUrl
  /** Delay every read of the admin credential fingerprint by this long. */
  slowFingerprintMs?: number
  /** Shrink the consent-page table, so filling it takes a handful of requests. */
  maxPending?: number
  maxPendingPerAddress?: number
  /**
   * Draw on the process-wide TOTP budget the admin login uses, instead of the
   * harness's own: only for the test that pins the two share it.
   */
  sharedTotpBudget?: boolean
}

/** The default fingerprint reader, slowed down to widen an await for a race test. */
function slowFingerprint(ms: number): FingerprintSource {
  const read = createFingerprintReader()
  return async () => {
    await Bun.sleep(ms)
    return read()
  }
}

async function startServer(
  harness: Pick<Harness, 'time'>,
  options: StartOptions = {},
): Promise<[McpHttpServer, OAuthStore]> {
  const store = await openStore()
  const server = await runHttpServer({
    port: 0,
    host: LOOPBACK,
    auth: {
      kind: 'oauth',
      store,
      clock: harness.time.clock,
      // Its own budget, so a wrong code here never reaches the process-wide one.
      ...(options.sharedTotpBudget === true
        ? {}
        : { totpBudget: new RateLimiter(harness.time.clock) }),
      ...(options.maxPending === undefined ? {} : { maxPending: options.maxPending }),
      ...(options.maxPendingPerAddress === undefined
        ? {}
        : { maxPendingPerAddress: options.maxPendingPerAddress }),
      ...(options.token === undefined ? {} : { token: options.token }),
      ...(options.slowFingerprintMs === undefined
        ? {}
        : { fingerprint: slowFingerprint(options.slowFingerprintMs) }),
    },
    publicUrl: options.publicUrl ?? PUBLIC_URL,
  })
  return [server, store]
}

async function startHarness(options: StartOptions = {}): Promise<Harness> {
  const ws = await bindWorkspace({ dirs: ['decks'], config: { admin: ADMIN_CONFIG }, init: true })
  await writeDeckFile(ws.dir, 'starter', {
    name: 'Starter',
    cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
  })
  await createAdminUser(ADMIN_USERNAME, ADMIN_PASSWORD)
  resetTotpReplayState()
  const time = manualClock()
  const [server, store] = await startServer({ time }, options)
  return { ws, server, store, time }
}

async function restart(harness: Harness, options: StartOptions = {}): Promise<void> {
  await harness.server.stop(true)
  const [server, store] = await startServer(harness, options)
  harness.server = server
  harness.store = store
}

async function stopHarness(harness: Harness): Promise<void> {
  await harness.server.stop(true)
  await harness.ws.dispose()
}

function at(server: McpHttpServer, pathAndQuery: string): string {
  return `http://${LOOPBACK}:${server.port}${pathAndQuery}`
}

const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' }

function form(values: Record<string, string>): RequestInit {
  return { method: 'POST', headers: FORM, body: new URLSearchParams(values).toString() }
}

/** POST a tools/list to `/mcp` with `authorization` (or none). */
function listTools(server: McpHttpServer, authorization?: string): Promise<Response> {
  return postToolsList(
    at(server, '/mcp'),
    authorization === undefined ? {} : { Authorization: authorization },
  )
}

type Registered = { client_id: string; grant_types: string[] }

function registerRequest(
  server: McpHttpServer,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(at(server, '/oauth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: [CLAUDE_REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
}

async function register(server: McpHttpServer): Promise<string> {
  const response = await registerRequest(server)
  expect(response.status).toBe(201)
  return ((await response.json()) as Registered).client_id
}

/** The query of an authorization request for `clientId`, `overrides` applied (`null` drops one). */
function authorizeQuery(
  clientId: string,
  pkce: PkcePair,
  overrides: Record<string, string | null> = {},
): string {
  const values: Record<string, string | null> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CLAUDE_REDIRECT,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state: 'state-123',
    resource: MCP_RESOURCE,
    ...overrides,
  }
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) if (value !== null) search.set(name, value)
  return search.toString()
}

/** A consent page as the browser received it: its hidden fields and the CSRF cookie. */
type ConsentPage = {
  response: Response
  html: string
  requestId: string
  csrf: string
  cookie: string
}

async function openConsent(
  server: McpHttpServer,
  query: string,
  headers: Record<string, string> = {},
): Promise<ConsentPage> {
  const response = await fetch(at(server, `/oauth/authorize?${query}`), {
    redirect: 'manual',
    headers,
  })
  const html = await response.text()
  const field = (name: string): string =>
    new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? ''
  const cookie = (response.headers.get('Set-Cookie') ?? '').split(';')[0] ?? ''
  return { response, html, requestId: field('request_id'), csrf: field('csrf'), cookie }
}

/** Submit a consent form like the browser would: same origin, with the cookie. */
function submitConsent(
  server: McpHttpServer,
  page: ConsentPage,
  values: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(at(server, '/oauth/authorize'), {
    method: 'POST',
    redirect: 'manual',
    headers: { ...FORM, Origin: PUBLIC_ORIGIN, Cookie: page.cookie, ...headers },
    body: new URLSearchParams({
      request_id: page.requestId,
      csrf: page.csrf,
      ...values,
    }).toString(),
  })
}

const APPROVE = { action: 'approve', username: ADMIN_USERNAME, password: ADMIN_PASSWORD }
const WRONG = { ...APPROVE, password: 'wrong password' }

function codeFrom(answer: Response): string {
  expect(answer.status).toBe(302)
  const location = new URL(answer.headers.get('Location') ?? '')
  expect(location.origin + location.pathname).toBe(CLAUDE_REDIRECT)
  expect(location.searchParams.get('state')).toBe('state-123')
  expect(location.searchParams.get('iss')).toBe(PUBLIC_ORIGIN)
  return location.searchParams.get('code') ?? ''
}

/** Run the browser half of the flow and return the authorization code. */
async function authorize(server: McpHttpServer, clientId: string, pkce: PkcePair): Promise<string> {
  const page = await openConsent(server, authorizeQuery(clientId, pkce))
  expect(page.response.status).toBe(200)
  return codeFrom(await submitConsent(server, page, APPROVE))
}

type TokenBody = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
}

type TokenReply = { status: number; body: TokenBody; response: Response }

async function token(server: McpHttpServer, init: RequestInit): Promise<TokenReply> {
  const response = await fetch(at(server, '/oauth/token'), init)
  return { status: response.status, body: (await response.json()) as TokenBody, response }
}

function exchange(
  server: McpHttpServer,
  clientId: string,
  code: string,
  pkce: PkcePair,
  overrides: Record<string, string> = {},
): Promise<TokenReply> {
  return token(
    server,
    form({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: CLAUDE_REDIRECT,
      code_verifier: pkce.verifier,
      resource: MCP_RESOURCE,
      ...overrides,
    }),
  )
}

function refresh(
  server: McpHttpServer,
  clientId: string,
  refreshToken: string,
): Promise<TokenReply> {
  return token(
    server,
    form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
  )
}

/** A connected client: its id, the code it redeemed, and its tokens. */
type Connection = { clientId: string; code: string; tokens: TokenBody }

/** Register (unless given a client), authorize and exchange. */
async function connect(server: McpHttpServer, existingClient?: string): Promise<Connection> {
  const clientId = existingClient ?? (await register(server))
  const pkce = pkcePair()
  const code = await authorize(server, clientId, pkce)
  const { status, body } = await exchange(server, clientId, code, pkce)
  expect(status).toBe(200)
  return { clientId, code, tokens: body }
}

async function mcpStatus(server: McpHttpServer, accessToken: string | undefined): Promise<number> {
  return (await listTools(server, `Bearer ${accessToken}`)).status
}

async function auditLines(ws: BoundWorkspace): Promise<string[]> {
  const text = await fs.readFile(path.join(ws.dir, '.logins', 'admin-audit.log'), 'utf-8')
  return text.trim().split('\n')
}

describe('MCP OAuth — the complete flow', () => {
  let harness: Harness
  beforeEach(async () => {
    harness = await startHarness()
  })
  afterEach(async () => stopHarness(harness))

  test('discovery → register → consent → token → /mcp → refresh → replay revokes', async () => {
    const { server } = harness
    // Unauthenticated /mcp: a 401 pointing at the protected-resource metadata,
    // the JSON-RPC body contract unchanged.
    const challenge = await listTools(server)
    expect(challenge.status).toBe(401)
    expect(challenge.headers.get('WWW-Authenticate')).toBe(
      `Bearer resource_metadata="${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource"`,
    )
    expect(((await challenge.json()) as { error: { code: number } }).error.code).toBe(
      UNAUTHORIZED_ERROR_CODE,
    )

    for (const wellKnown of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const prm = await fetch(at(server, wellKnown))
      expect(prm.status).toBe(200)
      expect(await prm.json()).toMatchObject({
        resource: MCP_RESOURCE,
        authorization_servers: [PUBLIC_ORIGIN],
      })
    }
    const asm = await fetch(at(server, '/.well-known/oauth-authorization-server'))
    expect(await asm.json()).toMatchObject({
      issuer: PUBLIC_ORIGIN,
      authorization_endpoint: `${PUBLIC_ORIGIN}/oauth/authorize`,
      token_endpoint: `${PUBLIC_ORIGIN}/oauth/token`,
      registration_endpoint: `${PUBLIC_ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    })

    const registered = await registerRequest(server)
    const { client_id: clientId, grant_types } = (await registered.json()) as Registered
    expect(grant_types).toEqual(['authorization_code', 'refresh_token'])
    const pkce = pkcePair()
    const page = await openConsent(server, authorizeQuery(clientId, pkce))
    expect(page.html).toContain('Allow Claude to use Ritual?')
    expect(page.html).toContain('<code>claude.ai</code>')
    const headers = page.response.headers
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('Cache-Control')).toBe('no-store')
    // Not `no-referrer`: that makes browsers post the form with `Origin: null`.
    expect(headers.get('Referrer-Policy')).toBe('same-origin')
    // An https issuer gets the `__Host-` cookie, pinned to this exact origin.
    expect(headers.get('Set-Cookie')).toMatch(
      /^__Host-ritual_oauth_csrf=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Secure$/,
    )

    const answer = await submitConsent(server, page, APPROVE)
    expect(answer.headers.get('Referrer-Policy')).toBe('no-referrer')
    const code = codeFrom(answer)
    const issued = await exchange(server, clientId, code, pkce)
    expect(issued.status).toBe(200)
    expect(issued.response.headers.get('Cache-Control')).toBe('no-store')
    const tokens = issued.body
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'mcp' })

    expect(await mcpStatus(server, tokens.access_token)).toBe(200)

    const rotated = await refresh(server, clientId, tokens.refresh_token ?? '')
    expect(rotated.status).toBe(200)
    expect(rotated.body.refresh_token).not.toBe(tokens.refresh_token)
    expect(await mcpStatus(server, rotated.body.access_token)).toBe(200)

    // The rotated-away token again, after the grace window: refused, and the
    // whole grant goes with it.
    harness.time.advance(REFRESH_GRACE_MS)
    const replay = await refresh(server, clientId, tokens.refresh_token ?? '')
    expect([replay.status, replay.body.error]).toEqual([400, 'invalid_grant'])
    expect((await refresh(server, clientId, rotated.body.refresh_token ?? '')).body.error).toBe(
      'invalid_grant',
    )
    const revoked = await listTools(server, `Bearer ${rotated.body.access_token}`)
    expect(revoked.status).toBe(401)
    expect(revoked.headers.get('WWW-Authenticate')).toContain('error="invalid_token"')
  })

  test('the state survives a restart: a refresh token issued before it still works', async () => {
    const { tokens, clientId } = await connect(harness.server)
    await restart(harness)
    const next = await refresh(harness.server, clientId, tokens.refresh_token ?? '')
    expect(next.status).toBe(200)
    expect(await mcpStatus(harness.server, tokens.access_token)).toBe(200)
    expect(await mcpStatus(harness.server, next.body.access_token)).toBe(200)
    // Only digests reach the disk.
    const file = await fs.readFile(path.join(harness.ws.dir, '.logins', 'mcp-oauth.json'), 'utf-8')
    for (const secret of [tokens.access_token, tokens.refresh_token, next.body.refresh_token]) {
      expect(file).not.toContain(secret ?? '')
    }
  })

  test('after the public URL changes, the old tokens are refused and their grant dropped', async () => {
    const { tokens, clientId } = await connect(harness.server)
    await restart(harness, {
      publicUrl: { origin: 'https://moved.example.com', hostname: 'moved.example.com' },
    })
    const access = await listTools(harness.server, `Bearer ${tokens.access_token}`)
    expect(access.status).toBe(401)
    expect(access.headers.get('WWW-Authenticate')).toContain('error="invalid_token"')
    const old = await refresh(harness.server, clientId, tokens.refresh_token ?? '')
    expect([old.status, old.body.error]).toEqual([400, 'invalid_grant'])
    expect(harness.store.state.grants).toEqual([])
  })

  test('no password, token or code reaches the console or the audit log', async () => {
    const captured = await captureConsole(['log', 'warn', 'error'], async () => {
      const connection = await connect(harness.server)
      const { clientId, tokens } = connection
      await refresh(harness.server, clientId, tokens.refresh_token ?? '')
      harness.time.advance(REFRESH_GRACE_MS)
      // A replay is the one event the server logs.
      await refresh(harness.server, clientId, tokens.refresh_token ?? '')
      return connection
    })
    const { code, tokens } = captured.result
    const consoleText = captured.all.join('\n')
    expect(consoleText).toContain('already-used refresh token')
    const audit = (await auditLines(harness.ws)).join('\n')
    expect(audit).toContain('MCP client authorized via OAuth')
    for (const text of [consoleText, audit]) {
      expect(text).not.toContain(ADMIN_PASSWORD)
      expect(text).not.toContain(code)
      expect(text).not.toContain(tokens.refresh_token ?? '')
      expect(text).not.toContain(tokens.access_token ?? '')
    }
  })
})

describe('MCP OAuth — the authorize endpoint', () => {
  let harness: Harness
  let clientId: string
  const pkce = pkcePair()
  beforeEach(async () => {
    harness = await startHarness()
    clientId = await register(harness.server)
  })
  afterEach(async () => stopHarness(harness))

  function open(headers: Record<string, string> = {}): Promise<ConsentPage> {
    return openConsent(harness.server, authorizeQuery(clientId, pkce), headers)
  }

  test('an unregistered redirect URI or an unknown client gets the same page, never a redirect', async () => {
    const badRedirect = await openConsent(
      harness.server,
      authorizeQuery(clientId, pkce, { redirect_uri: 'https://evil.example/cb' }),
    )
    const unknownClient = await openConsent(harness.server, authorizeQuery('no-such-client', pkce))
    for (const page of [badRedirect, unknownClient]) {
      expect(page.response.status).toBe(400)
      expect(page.response.headers.get('Location')).toBeNull()
      expect(page.html).not.toContain('<form')
      // Error pages carry the same protective headers as the consent page.
      expect(page.response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
      expect(page.response.headers.get('X-Frame-Options')).toBe('DENY')
      expect(page.response.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(badRedirect.html).toBe(unknownClient.html)
  })

  test('a request without PKCE, or with plain, is sent back with invalid_request and its state', async () => {
    const downgrades: Record<string, string | null>[] = [
      { code_challenge: null },
      { code_challenge_method: 'plain' },
    ]
    for (const overrides of downgrades) {
      const page = await openConsent(harness.server, authorizeQuery(clientId, pkce, overrides))
      expect(page.response.status).toBe(302)
      const location = new URL(page.response.headers.get('Location') ?? '')
      expect(location.origin + location.pathname).toBe(CLAUDE_REDIRECT)
      expect(location.searchParams.get('error')).toBe('invalid_request')
      expect(location.searchParams.get('state')).toBe('state-123')
    }
  })

  test('deny returns access_denied to the client', async () => {
    const answer = await submitConsent(harness.server, await open(), { action: 'deny' })
    const location = new URL(answer.headers.get('Location') ?? '')
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('state')).toBe('state-123')
    expect(location.searchParams.has('code')).toBe(false)
  })

  test('a page takes one answer: a second approval, or an approval after deny, is refused', async () => {
    const page = await open()
    codeFrom(await submitConsent(harness.server, page, APPROVE))
    expect((await submitConsent(harness.server, page, APPROVE)).status).toBe(400)
    const denied = await open()
    expect((await submitConsent(harness.server, denied, { action: 'deny' })).status).toBe(302)
    const after = await submitConsent(harness.server, denied, APPROVE)
    expect(after.status).toBe(400)
    expect(await after.text()).toContain('This sign-in page has expired')
  })

  test('a page expires after its lifetime', async () => {
    const page = await open()
    harness.time.advance(PENDING_AUTHORIZATION_TTL_MS + 1)
    const answer = await submitConsent(harness.server, page, APPROVE)
    expect(answer.status).toBe(400)
    expect(await answer.text()).toContain('This sign-in page has expired')
  })

  test('the consent form refuses a missing or foreign cookie, a wrong CSRF token and a foreign Origin', async () => {
    const page = await open()
    const noCookie = await submitConsent(harness.server, page, APPROVE, { Cookie: '' })
    const wrongCsrf = await submitConsent(harness.server, { ...page, csrf: 'forged' }, APPROVE)
    // Another browser's cookie: a real one, but not the one this page was shown with.
    const other = await open()
    const otherCookie = await submitConsent(harness.server, page, APPROVE, { Cookie: other.cookie })
    // A local origin passes the loopback rebinding check but is still not the issuer.
    const foreign = await submitConsent(harness.server, page, APPROVE, {
      Origin: 'http://localhost:1234',
    })
    const nullOrigin = await submitConsent(harness.server, page, APPROVE, { Origin: 'null' })
    for (const answer of [noCookie, wrongCsrf, otherCookie, foreign, nullOrigin]) {
      expect(answer.status).toBe(403)
      expect(answer.headers.get('Location')).toBeNull()
    }
    // The genuine form still works afterwards.
    expect((await submitConsent(harness.server, page, APPROVE)).status).toBe(302)
  })

  test('a wrong password re-renders the page; the third failure spends it', async () => {
    const page = await open()
    const wrong = await submitConsent(harness.server, page, WRONG)
    expect(wrong.status).toBe(401)
    const html = await wrong.text()
    expect(html).toContain('Those sign-in details are not correct.')
    expect(html).not.toContain('wrong password')
    expect((await submitConsent(harness.server, page, WRONG)).status).toBe(401)
    const third = await submitConsent(harness.server, page, WRONG)
    expect(third.status).toBe(401)
    expect(await third.text()).toContain('Too many failed sign-ins on this page')
    // Spent: even the right password needs a new page now.
    expect((await submitConsent(harness.server, page, APPROVE)).status).toBe(400)
    // And each failure was audited.
    const failed = (await auditLines(harness.ws)).filter((line) => line.includes('"success":false'))
    expect(failed).toHaveLength(3)
  })

  test('repeated failures across pages lock sign-in, even for the right password', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const page = await open()
      expect((await submitConsent(harness.server, page, WRONG)).status).toBe(401)
    }
    const locked = await submitConsent(harness.server, await open(), APPROVE)
    expect(locked.status).toBe(429)
    expect(await locked.text()).toContain('Too many failed attempts.')
  })

  test('a burst of parallel guesses is checked no more often than the limit allows', async () => {
    const page = await open()
    const guesses = Array.from({ length: 40 }, (_, i) => ({ ...WRONG, password: `wrong-${i}` }))
    guesses[37] = APPROVE
    const answers = await Promise.all(guesses.map((g) => submitConsent(harness.server, page, g)))
    expect(answers.some((answer) => answer.status === 302)).toBe(false)
    // Every check that ran is audited; at most the limit (5) ran.
    const audited = await auditLines(harness.ws)
    expect(audited.length).toBeLessThanOrEqual(5)
    expect(audited.every((line) => line.includes('"success":false'))).toBe(true)
  })

  test('with TOTP on, a right password with a missing or wrong code is a counted, generic failure', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    await setTotpSecret(secret)
    const page = await open()
    expect(page.html).toMatch(/name="totp"[^>]* required/)
    const wrongPasswordHtml = await (await submitConsent(harness.server, page, WRONG)).text()
    const noCode = await submitConsent(harness.server, page, APPROVE)
    expect(noCode.status).toBe(401)
    const noCodeHtml = await noCode.text()
    // The same page as a wrong password: nothing tells a guesser the password was right.
    const errorOf = (html: string): string => /role="alert">([^<]*)</.exec(html)?.[1] ?? ''
    expect(errorOf(noCodeHtml)).toBe(errorOf(wrongPasswordHtml))
    const wrongCode = await submitConsent(harness.server, await open(), {
      ...APPROVE,
      totp: '000000',
    })
    expect(wrongCode.status).toBe(401)
    const audit = (await auditLines(harness.ws)).filter((line) => line.includes('Invalid TOTP'))
    expect(audit).toHaveLength(2)
    const right = await submitConsent(harness.server, await open(), {
      ...APPROVE,
      totp: await generateTotp(secret),
    })
    codeFrom(right)
  })

  test('the admin login and the consent page share one budget of wrong codes', async () => {
    await restart(harness, { sharedTotpBudget: true })
    const secret = 'JBSWY3DPEHPK3PXP'
    await setTotpSecret(secret)
    // Addresses no other suite uses: both login limiters are process-wide.
    const ips = Array.from({ length: MAX_TOTP_FAILURES_PER_WINDOW }, (_, i) => `10.97.0.${i + 1}`)
    globalTotpBudget.recordSuccess(TOTP_BUDGET_KEY)
    try {
      // Spent through `POST /api/login` alone…
      for (const ip of ips) {
        const request = new Request('http://localhost/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: ADMIN_USERNAME,
            password: ADMIN_PASSWORD,
            totpCode: '000000',
          }),
        })
        expect((await handleLogin(request, ip)).status).toBe(401)
      }
      // …so the consent page refuses even the right password and code, with a
      // time to come back.
      const refused = await submitConsent(harness.server, await open(), {
        ...APPROVE,
        totp: await generateTotp(secret),
      })
      expect(refused.status).toBe(429)
      expect(refused.headers.get('Location')).toBeNull()
      const retryAfter = Number(refused.headers.get('Retry-After'))
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(TOTP_BUDGET_WINDOW_MINUTES * 60)
    } finally {
      globalTotpBudget.recordSuccess(TOTP_BUDGET_KEY)
      for (const ip of ips) globalRateLimiter.recordSuccess(ip)
    }
  })

  test('the admin IP and User-Agent deny lists guard the consent page', async () => {
    await writeConfig(harness.ws.dir, { admin: { ...ADMIN_CONFIG, ipDenyList: [LOOPBACK] } })
    const blocked = await open()
    expect(blocked.response.status).toBe(403)
    expect(blocked.html).not.toContain('<form')
    await writeConfig(harness.ws.dir, { admin: { ...ADMIN_CONFIG, userAgentDenyList: ['*evil*'] } })
    expect((await open({ 'User-Agent': 'evil-scanner' })).response.status).toBe(403)
    expect((await open({ 'User-Agent': 'Mozilla/5.0' })).response.status).toBe(200)
  })

  test('one address cannot flood out another’s open page, and is itself rate-limited', async () => {
    await writeConfig(harness.ws.dir, { admin: { ...ADMIN_CONFIG, trustProxy: true } })
    const owner = await open({ 'X-Forwarded-For': '198.51.100.1' })
    const flood = await Promise.all(
      Array.from({ length: 40 }, () => open({ 'X-Forwarded-For': '203.0.113.66' })),
    )
    const statuses = flood.map((page) => page.response.status)
    expect(statuses.filter((status) => status === 200)).toHaveLength(30)
    expect(statuses.filter((status) => status === 429)).toHaveLength(10)
    codeFrom(
      await submitConsent(harness.server, owner, APPROVE, { 'X-Forwarded-For': '198.51.100.1' }),
    )
    // The flooding address kept only its ten newest pages.
    const oldest = flood[0]!
    expect(
      (await submitConsent(harness.server, oldest, APPROVE, { 'X-Forwarded-For': '203.0.113.66' }))
        .status,
    ).toBe(400)
  })

  test('junk requests cost nothing: only a valid consent page counts against the address', async () => {
    for (let i = 0; i < 40; i++) {
      expect(
        (await openConsent(harness.server, authorizeQuery('no-such-client', pkce))).response.status,
      ).toBe(400)
    }
    expect((await open()).response.status).toBe(200)
  })

  test('a full page table makes room from the heaviest address: the owner and a newcomer still sign in', async () => {
    // The real caps (2000 pages, 10 per address) at a scale a test can fill.
    const maxPending = 6
    const maxPendingPerAddress = 2
    await restart(harness, { maxPending, maxPendingPerAddress })
    await writeConfig(harness.ws.dir, { admin: { ...ADMIN_CONFIG, trustProxy: true } })
    const from = (address: string): Record<string, string> => ({ 'X-Forwarded-For': address })
    const owner = await open(from('198.51.100.1'))
    // A full share of pages from each of three attacker addresses: the table
    // fills (with the owner's page) one page before the last attacker is done.
    // Opened one at a time, so creation order is known; the clock stands
    // still, so it decides.
    const attackers = maxPending / maxPendingPerAddress
    const attacker = (i: number): string => `10.0.0.${i + 1}`
    const opened: ConsentPage[][] = []
    for (let i = 0; i < attackers; i++) {
      const batch: ConsentPage[] = []
      for (let page = 0; page < maxPendingPerAddress; page++) {
        batch.push(await open(from(attacker(i))))
      }
      opened.push(batch)
    }
    expect(opened.flat().every((page) => page.response.status === 200)).toBe(true)
    // The last attacker page found the table full: of the addresses tied for
    // the most pages, the first attacker held the oldest, and lost it.
    const firstOldest = opened[0]![0]!
    const evicted = await submitConsent(harness.server, firstOldest, APPROVE, from(attacker(0)))
    expect(evicted.status).toBe(400)
    expect(await evicted.text()).toContain('This sign-in page has expired')
    // A newcomer gets a page at once, pushing out the next heaviest oldest.
    const newcomer = await open(from('192.0.2.77'))
    expect(newcomer.response.status).toBe(200)
    codeFrom(await submitConsent(harness.server, newcomer, APPROVE, from('192.0.2.77')))
    // The owner's single page was never the one to go.
    codeFrom(await submitConsent(harness.server, owner, APPROVE, from('198.51.100.1')))
    // The second attacker's oldest went for the newcomer; its newer pages stayed.
    const second = opened[1]!
    expect(
      (await submitConsent(harness.server, second[0]!, APPROVE, from(attacker(1)))).status,
    ).toBe(400)
    codeFrom(await submitConsent(harness.server, second[1]!, APPROVE, from(attacker(1))))
  })

  test('an unusable state file answers 503, once logged, never a stack per request', async () => {
    await fs.writeFile(path.join(harness.ws.dir, '.logins', 'mcp-oauth.json'), '{garbage')
    const captured = await captureConsole(['error'], async () => {
      const registered = await registerRequest(harness.server)
      const page = await open()
      const again = await registerRequest(harness.server)
      return [registered, page.response, again] as const
    })
    const [registered, page, again] = captured.result
    expect([registered.status, again.status, page.status]).toEqual([503, 503, 503])
    expect(((await registered.json()) as TokenBody).error).toBe('temporarily_unavailable')
    expect(captured.all).toHaveLength(1)
    expect(captured.all[0]).toContain('mcp-oauth.json')
  })

  test('the OAuth routes sit behind the loopback Host check', async () => {
    const response = await registerRequest(harness.server, { Host: 'evil.example' })
    expect(response.status).toBe(403)
  })

  test('a malformed Host header is a 400, not a server error', async () => {
    const reply = await rawRequest(
      harness.server.port,
      'GET /.well-known/oauth-authorization-server HTTP/1.1\r\nHost: [bad\r\n\r\n',
    )
    expect(reply).toMatch(/^HTTP\/1\.1 4\d\d/)
  })
})

/** Send `text` as a raw HTTP request and return the first chunk of the reply. */
function rawRequest(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect(port, LOOPBACK, () => socket.write(text))
    let reply = ''
    socket.on('data', (chunk) => {
      reply += chunk.toString()
      socket.end()
    })
    socket.on('end', () => resolve(reply))
    socket.on('error', () => resolve(reply))
    setTimeout(() => {
      socket.destroy()
      resolve(reply)
    }, 2000)
  })
}

describe('MCP OAuth — browser-based clients (CORS)', () => {
  let harness: Harness
  beforeEach(async () => {
    harness = await startHarness()
  })
  afterEach(async () => stopHarness(harness))

  test('the token endpoint answers a foreign-origin preflight, and registration accepts one', async () => {
    const preflight = await fetch(at(harness.server, '/oauth/token'), {
      method: 'OPTIONS',
      headers: { Origin: 'https://inspector.example', 'Access-Control-Request-Method': 'POST' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const registered = await registerRequest(harness.server, { Origin: 'https://claude.ai' })
    expect(registered.status).toBe(201)
    expect(registered.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const metadata = await fetch(at(harness.server, '/.well-known/oauth-authorization-server'), {
      headers: { Origin: 'https://claude.ai' },
    })
    expect(metadata.status).toBe(200)
  })

  test('/mcp itself still refuses a foreign Origin', async () => {
    const response = await postToolsList(at(harness.server, '/mcp'), {
      Origin: 'https://evil.example',
    })
    expect(response.status).toBe(403)
  })
})

describe('MCP OAuth — the token endpoint', () => {
  let harness: Harness
  let clientId: string
  const pkce = pkcePair()
  beforeEach(async () => {
    harness = await startHarness()
    clientId = await register(harness.server)
  })
  afterEach(async () => stopHarness(harness))

  test('a replayed code is refused and revokes the tokens the first exchange issued', async () => {
    const code = await authorize(harness.server, clientId, pkce)
    const first = await exchange(harness.server, clientId, code, pkce)
    expect(await mcpStatus(harness.server, first.body.access_token)).toBe(200)
    const replay = await exchange(harness.server, clientId, code, pkce)
    expect([replay.status, replay.body.error]).toEqual([400, 'invalid_grant'])
    expect(await mcpStatus(harness.server, first.body.access_token)).toBe(401)
  })

  test('a code replayed while the first exchange is still in flight: neither gets tokens', async () => {
    // A slow credential check widens every await of the first exchange, so the
    // replay is sure to land inside it.
    await restart(harness, { slowFingerprintMs: 30 })
    const code = await authorize(harness.server, clientId, pkce)
    const [a, b] = await Promise.all([
      exchange(harness.server, clientId, code, pkce),
      exchange(harness.server, clientId, code, pkce),
    ])
    expect([a.status, a.body.error, b.status, b.body.error]).toEqual([
      400,
      'invalid_grant',
      400,
      'invalid_grant',
    ])
    expect((await harness.store.read()).grants).toEqual([])
  })

  test('a code presented with another registered client is invalid_grant, and spent', async () => {
    const otherClient = await register(harness.server)
    const code = await authorize(harness.server, clientId, pkce)
    const stolen = await exchange(harness.server, otherClient, code, pkce, {
      client_id: otherClient,
    })
    expect([stolen.status, stolen.body.error]).toEqual([400, 'invalid_grant'])
    expect((await exchange(harness.server, clientId, code, pkce)).body.error).toBe('invalid_grant')
  })

  test.each([
    ['another redirect URI', { redirect_uri: 'https://claude.ai/other' }],
    ['the wrong verifier', { code_verifier: pkcePair('b').verifier }],
  ])('a code presented with %s is invalid_grant, and spent', async (_label, overrides) => {
    const code = await authorize(harness.server, clientId, pkce)
    const wrong = await exchange(harness.server, clientId, code, pkce, overrides)
    expect([wrong.status, wrong.body.error]).toEqual([400, 'invalid_grant'])
    expect((await exchange(harness.server, clientId, code, pkce)).body.error).toBe('invalid_grant')
  })

  test('a code older than its lifetime is invalid_grant', async () => {
    const code = await authorize(harness.server, clientId, pkce)
    harness.time.advance(AUTHORIZATION_CODE_TTL_MS + 1)
    expect((await exchange(harness.server, clientId, code, pkce)).body.error).toBe('invalid_grant')
  })

  test('an expired access token is refused; a refresh token outlives it, then expires too', async () => {
    const { tokens } = await connect(harness.server, clientId)
    harness.time.advance(ACCESS_TOKEN_TTL_MS + 1)
    expect(await mcpStatus(harness.server, tokens.access_token)).toBe(401)
    const next = await refresh(harness.server, clientId, tokens.refresh_token ?? '')
    expect(next.status).toBe(200)
    harness.time.advance(REFRESH_TOKEN_TTL_MS + 1)
    const lapsed = await refresh(harness.server, clientId, next.body.refresh_token ?? '')
    expect([lapsed.status, lapsed.body.error]).toEqual([400, 'invalid_grant'])
  })

  test('two refreshes at once both get the same new tokens, and the grant survives', async () => {
    const { tokens } = await connect(harness.server, clientId)
    const [a, b] = await Promise.all([
      refresh(harness.server, clientId, tokens.refresh_token ?? ''),
      refresh(harness.server, clientId, tokens.refresh_token ?? ''),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(b.body).toEqual(a.body)
    expect(await mcpStatus(harness.server, a.body.access_token)).toBe(200)
    expect((await refresh(harness.server, clientId, a.body.refresh_token ?? '')).status).toBe(200)
  })

  test('a retried refresh within the window gets the same answer; after it, the old token revokes', async () => {
    const { tokens } = await connect(harness.server, clientId)
    const first = await refresh(harness.server, clientId, tokens.refresh_token ?? '')
    harness.time.advance(REFRESH_GRACE_MS - 1)
    const retry = await refresh(harness.server, clientId, tokens.refresh_token ?? '')
    expect([retry.status, retry.body]).toEqual([200, first.body])
    // Another client presenting the same token is not a retry.
    const otherClient = await register(harness.server)
    expect((await refresh(harness.server, otherClient, tokens.refresh_token ?? '')).status).toBe(
      400,
    )
    harness.time.advance(1)
    const late = await refresh(harness.server, clientId, tokens.refresh_token ?? '')
    expect([late.status, late.body.error]).toEqual([400, 'invalid_grant'])
    expect(await mcpStatus(harness.server, first.body.access_token)).toBe(401)
  })

  test('after a restart, a retry within the window is refused but revokes nothing', async () => {
    const { tokens } = await connect(harness.server, clientId)
    const first = await refresh(harness.server, clientId, tokens.refresh_token ?? '')
    await restart(harness)
    const retry = await refresh(harness.server, clientId, tokens.refresh_token ?? '')
    expect([retry.status, retry.body.error]).toEqual([400, 'invalid_grant'])
    expect(await mcpStatus(harness.server, first.body.access_token)).toBe(200)
  })

  test('a failed write un-spends a code, unless a replay came meanwhile', async () => {
    const loginsDir = path.join(harness.ws.dir, '.logins')
    const blockWrites = (): Promise<void> => fs.chmod(loginsDir, 0o500)
    const allowWrites = (): Promise<void> => fs.chmod(loginsDir, 0o700)
    // Alone: the exchange fails with a server error, and a retry succeeds.
    const code = await authorize(harness.server, clientId, pkce)
    await blockWrites()
    const failed = await exchange(harness.server, clientId, code, pkce).finally(allowWrites)
    expect([failed.status, failed.body.error]).toEqual([500, 'server_error'])
    expect((await exchange(harness.server, clientId, code, pkce)).status).toBe(200)
    // With a replay racing the failing write: the code is gone for good.
    const raced = await authorize(harness.server, clientId, pkce)
    await blockWrites()
    const [first, second] = await Promise.all([
      exchange(harness.server, clientId, raced, pkce),
      exchange(harness.server, clientId, raced, pkce),
    ]).finally(allowWrites)
    expect([first.status, second.status].sort()).toEqual([400, 500])
    expect((await exchange(harness.server, clientId, raced, pkce)).body.error).toBe('invalid_grant')
  })

  test('revoking all grants, then one through a replay, leaves the others working', async () => {
    const first = await connect(harness.server, clientId)
    const second = await connect(harness.server, clientId)
    const grants = harness.server.oauth
    if (grants === undefined) throw new Error('expected the OAuth server')
    expect(await grants.revokeAllGrants()).toBe(2)
    expect(await mcpStatus(harness.server, first.tokens.access_token)).toBe(401)
    expect(await mcpStatus(harness.server, second.tokens.access_token)).toBe(401)

    const third = await connect(harness.server, clientId)
    const fourth = await connect(harness.server, clientId)
    expect((await refresh(harness.server, clientId, third.tokens.refresh_token ?? '')).status).toBe(
      200,
    )
    harness.time.advance(REFRESH_GRACE_MS)
    const replay = await refresh(harness.server, clientId, third.tokens.refresh_token ?? '')
    expect(replay.body.error).toBe('invalid_grant')
    expect(await mcpStatus(harness.server, third.tokens.access_token)).toBe(401)
    expect(await mcpStatus(harness.server, fourth.tokens.access_token)).toBe(200)
  })

  test('a client with a code outstanding is never evicted from a full registry', async () => {
    const page = await openConsent(harness.server, authorizeQuery(clientId, pkce))
    const code = codeFrom(await submitConsent(harness.server, page, APPROVE))
    // Fill the registry with clients that hold grants, but leave this client
    // the only one without: it would be the first to go, but it holds a code.
    await harness.store.update(harness.time.clock(), (draft) => {
      for (let i = draft.clients.length; i < MAX_CLIENTS; i++) {
        draft.clients.push({
          clientId: `filler-${i}`,
          redirectUris: [CLAUDE_REDIRECT],
          createdAt: 0,
          grantedAt: 1,
        })
      }
    })
    expect((await registerRequest(harness.server)).status).toBe(503)
    expect((await exchange(harness.server, clientId, code, pkce)).status).toBe(200)
  })

  test('an open consent page protects nothing: its client can be evicted, and the page then fails cleanly', async () => {
    // This client is the oldest without a grant; only an open page holds it.
    const page = await openConsent(harness.server, authorizeQuery(clientId, pkce))
    await harness.store.update(harness.time.clock(), (draft) => {
      for (let i = draft.clients.length; i < MAX_CLIENTS; i++) {
        draft.clients.push({
          clientId: `filler-${i}`,
          redirectUris: [CLAUDE_REDIRECT],
          createdAt: harness.time.clock(),
        })
      }
    })
    expect((await registerRequest(harness.server)).status).toBe(201)
    expect(harness.store.state.clients.map((c) => c.clientId)).not.toContain(clientId)
    const answer = await submitConsent(harness.server, page, APPROVE)
    expect(answer.status).toBe(400)
    expect(await answer.text()).toContain('This sign-in page has expired')
    expect(harness.store.state.grants).toEqual([])
  })

  test('protocol refusals', async () => {
    const json = await token(harness.server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token' }),
    })
    expect([json.status, json.body.error]).toEqual([400, 'invalid_request'])
    const unknownGrant = await token(harness.server, form({ grant_type: 'client_credentials' }))
    expect([unknownGrant.status, unknownGrant.body.error]).toEqual([400, 'unsupported_grant_type'])
    const secret = await token(
      harness.server,
      form({
        grant_type: 'refresh_token',
        refresh_token: 'x',
        client_id: clientId,
        client_secret: 'shh',
      }),
    )
    expect([secret.status, secret.body.error]).toEqual([401, 'invalid_client'])
    const basic = await token(harness.server, {
      ...form({ grant_type: 'refresh_token', refresh_token: 'x', client_id: clientId }),
      headers: { ...FORM, Authorization: 'Basic Y2xpZW50OnNlY3JldA==' },
    })
    expect([basic.status, basic.body.error]).toEqual([401, 'invalid_client'])
    const target = await token(
      harness.server,
      form({
        grant_type: 'refresh_token',
        refresh_token: 'x',
        client_id: clientId,
        resource: 'https://other.example/mcp',
      }),
    )
    expect([target.status, target.body.error]).toEqual([400, 'invalid_target'])
    const repeated = await token(harness.server, {
      method: 'POST',
      headers: FORM,
      body: 'grant_type=refresh_token&grant_type=refresh_token',
    })
    expect([repeated.status, repeated.body.error]).toEqual([400, 'invalid_request'])
    const noVerifier = await token(
      harness.server,
      form({
        grant_type: 'authorization_code',
        code: 'c',
        client_id: clientId,
        redirect_uri: CLAUDE_REDIRECT,
      }),
    )
    expect([noVerifier.status, noVerifier.body.error]).toEqual([400, 'invalid_request'])
    const huge = await token(
      harness.server,
      form({ grant_type: 'refresh_token', pad: 'x'.repeat(20_000) }),
    )
    expect([huge.status, huge.body.error]).toEqual([413, 'invalid_request'])
  })
})

describe('MCP OAuth — registration', () => {
  let harness: Harness
  beforeEach(async () => {
    harness = await startHarness()
  })
  afterEach(async () => stopHarness(harness))

  test('refuses a javascript: redirect URI', async () => {
    const response = await fetch(at(harness.server, '/oauth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['javascript:alert(1)'] }),
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as TokenBody).error).toBe('invalid_redirect_uri')
  })

  test('is rate-limited per address, with Retry-After', async () => {
    for (let i = 0; i < MAX_REGISTRATIONS_PER_WINDOW; i++) {
      expect((await registerRequest(harness.server)).status).toBe(201)
    }
    const limited = await registerRequest(harness.server)
    expect(limited.status).toBe(429)
    expect(((await limited.json()) as TokenBody).error).toBe('temporarily_unavailable')
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  test('a registry full of clients holding grants answers 503', async () => {
    await harness.store.update(harness.time.clock(), (draft) => {
      for (let i = 0; i < MAX_CLIENTS; i++) {
        draft.clients.push({
          clientId: `c-${i}`,
          redirectUris: [CLAUDE_REDIRECT],
          createdAt: 0,
          grantedAt: 1,
        })
      }
    })
    const full = await registerRequest(harness.server)
    expect(full.status).toBe(503)
    expect(((await full.json()) as TokenBody).error).toBe('temporarily_unavailable')
  })
})

describe('MCP OAuth — revocation while running', () => {
  let harness: Harness
  beforeEach(async () => {
    harness = await startHarness()
  })
  afterEach(async () => stopHarness(harness))

  test('a state file deleted between requests is honoured: everything revoked, nothing written back', async () => {
    const { clientId, tokens } = await connect(harness.server)
    const file = path.join(harness.ws.dir, '.logins', 'mcp-oauth.json')
    await fs.rm(file)
    expect(await mcpStatus(harness.server, tokens.access_token)).toBe(401)
    expect((await refresh(harness.server, clientId, tokens.refresh_token ?? '')).body.error).toBe(
      'invalid_grant',
    )
    // The client is gone too: a client must register again.
    expect(
      (await openConsent(harness.server, authorizeQuery(clientId, pkcePair()))).response.status,
    ).toBe(400)
    await fs.access(file).then(
      () => {
        throw new Error('the deleted state file was written back')
      },
      () => undefined,
    )
  })

  test('changing the admin password revokes every grant and outstanding code, keeping the clients', async () => {
    const { clientId, tokens } = await connect(harness.server)
    const pkce = pkcePair()
    const code = await authorize(harness.server, clientId, pkce)
    await resetAdminPassword('a brand new password')
    expect(await mcpStatus(harness.server, tokens.access_token)).toBe(401)
    expect((await refresh(harness.server, clientId, tokens.refresh_token ?? '')).body.error).toBe(
      'invalid_grant',
    )
    const exchanged = await exchange(harness.server, clientId, code, pkce)
    expect([exchanged.status, exchanged.body.error]).toEqual([400, 'invalid_grant'])
    expect(harness.store.state.clients.map((c) => c.clientId)).toContain(clientId)
    // The dead grant is gone from disk at the server's next write.
    expect(harness.store.state.grants).toEqual([])
  })

  test('turning TOTP on revokes, turning it off revokes, starting an enrollment does not', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const first = await connect(harness.server)
    await setTotpSecret(`pending:${secret}`)
    expect(await mcpStatus(harness.server, first.tokens.access_token)).toBe(200)
    await setTotpSecret(secret)
    expect(await mcpStatus(harness.server, first.tokens.access_token)).toBe(401)
    // Approved with TOTP on, then TOTP turned off.
    const clientId = await register(harness.server)
    const pkce = pkcePair()
    const page = await openConsent(harness.server, authorizeQuery(clientId, pkce))
    const code = codeFrom(
      await submitConsent(harness.server, page, { ...APPROVE, totp: await generateTotp(secret) }),
    )
    const second = await exchange(harness.server, clientId, code, pkce)
    expect(await mcpStatus(harness.server, second.body.access_token)).toBe(200)
    await setTotpSecret(null)
    expect(await mcpStatus(harness.server, second.body.access_token)).toBe(401)
  })

  test('no account file, no OAuth: every token is refused while it is missing', async () => {
    const { tokens } = await connect(harness.server)
    const auth = path.join(harness.ws.dir, '.logins', 'admin-auth.json')
    const saved = await fs.readFile(auth, 'utf-8')
    await fs.rm(auth)
    expect(await mcpStatus(harness.server, tokens.access_token)).toBe(401)
    await fs.writeFile(auth, saved)
    expect(await mcpStatus(harness.server, tokens.access_token)).toBe(200)
  })

  test('a password reset from another process wins against a client refreshing all the while', async () => {
    // The race the derived check closes: the server keeps writing its state
    // while another process changes the credentials. Run it many times.
    for (let round = 0; round < 8; round++) {
      const { clientId, tokens } = await connect(harness.server)
      let current = tokens
      let stop = false
      let refreshed = 0
      const loop = (async (): Promise<void> => {
        while (!stop) {
          const next = await refresh(harness.server, clientId, current.refresh_token ?? '')
          if (next.status !== 200) break
          current = next.body
          refreshed += 1
        }
      })()
      await Bun.sleep(30)
      const result = await runCli(
        ['admin', 'reset-password', '--password-stdin'],
        harness.ws.dir,
        undefined,
        `${ADMIN_PASSWORD}-${round}\n`,
      )
      expect(result.exitCode).toBe(0)
      // From the moment the reset is on disk, nothing the client holds works.
      const after = await refresh(harness.server, clientId, current.refresh_token ?? '')
      expect(after.body.error).toBe('invalid_grant')
      expect(await mcpStatus(harness.server, current.access_token)).toBe(401)
      stop = true
      await loop
      expect(refreshed).toBeGreaterThan(0)
      expect(harness.store.state.grants.filter((g) => g.clientId === clientId)).toEqual([])
      // Back to the suite's password for the next round's sign-in.
      await resetAdminPassword(ADMIN_PASSWORD)
    }
  }, 60_000)
})

describe('MCP OAuth — beside a static token', () => {
  let harness: Harness
  beforeEach(async () => {
    harness = await startHarness({ token: STATIC_TOKEN })
  })
  afterEach(async () => stopHarness(harness))

  test('both the static token and an OAuth access token are accepted on /mcp', async () => {
    expect((await listTools(harness.server, `Bearer ${STATIC_TOKEN}`)).status).toBe(200)
    const { tokens } = await connect(harness.server)
    expect(await mcpStatus(harness.server, tokens.access_token)).toBe(200)
    expect((await listTools(harness.server, 'Bearer wrong')).status).toBe(401)
  })
})

const NO_TOKEN = { RITUAL_MCP_TOKEN: undefined }

function mcpOAuthArgs(port: string, ...extra: string[]): string[] {
  return ['mcp', '--transport', 'http', '--oauth', '-p', port, ...extra]
}

/** Trust the proxy in a CLI test's workspace, as a tunnel deployment must. */
function trustProxy(dir: string): Promise<void> {
  return writeConfig(dir, { admin: { trustProxy: true } })
}

describe('MCP OAuth — CLI gates', () => {
  test('ritual mcp --oauth without --public-url is a usage error', async () => {
    await withBusyPort(LOOPBACK, async (port) => {
      await withTempDir(async (dir) => {
        const result = await runCli(mcpOAuthArgs(port), dir, NO_TOKEN)
        expect(result.exitCode).toBe(2)
        expect(result.stderr).toContain('--oauth needs the public URL')
      })
    })
  })

  test('ritual mcp --oauth with a non-loopback http public URL is a usage error', async () => {
    await withBusyPort(LOOPBACK, async (port) => {
      await withTempDir(async (dir) => {
        const result = await runCli(
          mcpOAuthArgs(port, '--public-url', 'http://mcp.example.com'),
          dir,
          NO_TOKEN,
        )
        expect(result.exitCode).toBe(2)
        expect(result.stderr).toContain('needs an https:// public URL')
      })
    })
  })

  test('ritual mcp --oauth with a loopback http public URL but a wide bind is a usage error', async () => {
    await withBusyPort('0.0.0.0', async (port) => {
      await withTempDir(async (dir) => {
        const result = await runCli(
          mcpOAuthArgs(port, '--host', '0.0.0.0', '--public-url', 'http://127.0.0.1:8000'),
          dir,
          NO_TOKEN,
        )
        expect(result.exitCode).toBe(2)
        expect(result.stderr).toContain('only allowed for testing on a loopback bind')
      })
    })
  })

  test('ritual mcp --oauth behind a proxy without admin.trustProxy refuses, naming the fix', async () => {
    await withBusyPort(LOOPBACK, async (port) => {
      await withTempDir(async (dir) => {
        await seedAdminAccount(dir)
        const result = await runCli(
          mcpOAuthArgs(port, '--public-url', PUBLIC_ORIGIN),
          dir,
          NO_TOKEN,
        )
        expect(result.exitCode).toBe(2)
        expect(result.stderr).toContain('admin.trustProxy is off')
        expect(result.stderr).toContain("'ritual config set admin.trustProxy true'")
      })
    })
  })

  test('ritual mcp --oauth with a loopback public URL (local testing) needs no admin.trustProxy', async () => {
    await withBusyPort(LOOPBACK, async (port) => {
      await withTempDir(async (dir) => {
        await seedAdminAccount(dir)
        const result = await runCli(
          mcpOAuthArgs(port, '--public-url', `http://127.0.0.1:${port}`),
          dir,
          NO_TOKEN,
        )
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain(`Failed to start the server on ${LOOPBACK}:${port}`)
      })
    })
  })

  test('ritual mcp --oauth without an admin account refuses and says how to create one', async () => {
    await withBusyPort(LOOPBACK, async (port) => {
      await withTempDir(async (dir) => {
        await trustProxy(dir)
        const result = await runCli(
          mcpOAuthArgs(port, '--public-url', PUBLIC_ORIGIN),
          dir,
          NO_TOKEN,
        )
        expect(result.exitCode).toBe(3)
        expect(result.stderr).toContain("Create it with 'ritual admin setup'")
      })
    })
  })

  test('ritual mcp --oauth with an admin account needs no token: it reaches the bind', async () => {
    await withBusyPort(LOOPBACK, async (port) => {
      await withTempDir(async (dir) => {
        await seedAdminAccount(dir)
        await trustProxy(dir)
        const result = await runCli(
          mcpOAuthArgs(port, '--public-url', PUBLIC_ORIGIN),
          dir,
          NO_TOKEN,
        )
        // Exit 1 at the busy port: past every gate, and not the tokenless refusal (exit 2).
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain(`Failed to start the server on ${LOOPBACK}:${port}`)
        expect(result.stderr).not.toContain('Refusing to serve MCP without authentication')
      })
    })
  })

  test('a damaged state file is a startup error, not a reset', async () => {
    await withBusyPort(LOOPBACK, async (port) => {
      await withTempDir(async (dir) => {
        await seedAdminAccount(dir)
        await trustProxy(dir)
        await writeLoginFile(dir, 'mcp-oauth.json', '{"version": 1, "clients": 5, "grants": []}')
        const result = await runCli(
          mcpOAuthArgs(port, '--public-url', PUBLIC_ORIGIN),
          dir,
          NO_TOKEN,
        )
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('the value at clients is missing or malformed')
      })
    })
  })

  test('ritual admin --mcp --mcp-oauth needs no token: it reaches the admin-account check', async () => {
    await withBusyPort(LOOPBACK, async (adminPort) => {
      await withBusyPort(LOOPBACK, async (mcpPort) => {
        await withWorkspace(async (dir) => {
          await trustProxy(dir)
          // Busy ports and no refresh: a gate that stopped refusing would fail
          // at once at the bind instead of downloading a cache and serving.
          const result = await runCli(
            [
              'admin',
              '--host',
              LOOPBACK,
              '-p',
              adminPort,
              '--refresh',
              'never',
              '--mcp',
              '--mcp-port',
              mcpPort,
              '--mcp-oauth',
              '--mcp-public-url',
              PUBLIC_ORIGIN,
            ],
            dir,
            NO_TOKEN,
          )
          expect(result.exitCode).toBe(3)
          expect(result.stderr).toContain('--mcp-oauth signs clients in')
          expect(result.stderr).not.toContain('requires authentication')
        })
      })
    })
  })

  test('ritual admin --mcp with neither a token nor --mcp-oauth names both ways out', async () => {
    await withBusyPort(LOOPBACK, async (adminPort) => {
      await withWorkspace(async (dir) => {
        const result = await runCli(
          ['admin', '--host', LOOPBACK, '-p', adminPort, '--refresh', 'never', '--mcp'],
          dir,
          NO_TOKEN,
        )
        expect(result.exitCode).toBe(2)
        expect(result.stderr).toContain('--mcp-token')
        expect(result.stderr).toContain('--mcp-oauth')
      })
    })
  })
})

describe('MCP OAuth — embedded in ritual admin', () => {
  test('ritual admin --mcp --mcp-oauth serves the protected-resource metadata on the MCP port', async () => {
    await ensureBinary()
    await withWorkspace(async (dir) => {
      await seedAdminAccount(dir)
      await trustProxy(dir)
      const adminPort = await freePort()
      const mcpPort = await freePort()
      const proc = Bun.spawn(
        [
          binaryPath,
          'admin',
          '--host',
          LOOPBACK,
          '-p',
          String(adminPort),
          '--refresh',
          'never',
          '--mcp',
          '--mcp-port',
          String(mcpPort),
          '--mcp-oauth',
          '--mcp-public-url',
          PUBLIC_ORIGIN,
        ],
        {
          cwd: dir,
          env: { ...process.env, RITUAL_BASE_DIR: undefined, ...LOCALE_ENV, ...NO_TOKEN },
          stdout: 'ignore',
          stderr: 'ignore',
        },
      )
      try {
        const url = `http://${LOOPBACK}:${mcpPort}/.well-known/oauth-protected-resource`
        let body: unknown
        for (let attempt = 0; attempt < 120 && body === undefined; attempt++) {
          body = await fetch(url).then(
            (response) => (response.ok ? response.json() : undefined),
            () => undefined,
          )
          if (body === undefined) await Bun.sleep(250)
        }
        expect(body).toMatchObject({
          resource: MCP_RESOURCE,
          authorization_servers: [PUBLIC_ORIGIN],
        })
      } finally {
        proc.kill()
        await proc.exited
      }
    })
  }, 60_000)
})
