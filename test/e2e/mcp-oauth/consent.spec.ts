import { test, expect, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The MCP OAuth consent page in a real browser. The in-process integration
 * tests set `Origin` and cookies by hand; only a browser shows what it really
 * sends with the form (an `Origin: null` under `Referrer-Policy: no-referrer`
 * once made sign-in impossible) and whether the CSP lets the approval's
 * redirect through to the client.
 *
 * Each run starts its own `ritual mcp --transport http --oauth` on a free port
 * in a synthetic workspace with a synthetic admin account. The client's
 * callback is a real local server (on IPv4 and on `[::1]`) rather than an
 * intercepted route: Playwright does not intercept the hops of a redirect, so
 * an intercepted `https://claude.ai/...` would really be fetched.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const USERNAME = 'owner'
const PASSWORD = 'correct horse battery'
const VERIFIER = 'v'.repeat(64)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
let workspace: string
let server: ChildProcess
let origin: string
let callbacks: http.Server[] = []
/** Every request the callback servers received, newest last. */
const reached: URL[] = []
let redirect: string
let ipv6Redirect: string

/** A local stand-in for the client's callback, recording where the browser was sent. */
function callbackServer(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const callback = http.createServer((request, response) => {
      reached.push(new URL(request.url ?? '/', `http://${request.headers.host ?? host}`))
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('client reached')
    })
    callback.once('error', reject)
    callback.listen(0, host, () => {
      const address = callback.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      callbacks.push(callback)
      resolve(
        host.includes(':')
          ? `http://[${host}]:${port}/callback`
          : `http://${host}:${port}/callback`,
      )
    })
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const up = await fetch(url).then(
      (response) => response.ok,
      () => false,
    )
    if (up) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`MCP OAuth server at ${url} never came up`)
}

test.beforeAll(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ritual-e2e-oauth-'))
  fs.writeFileSync(
    path.join(workspace, 'ritual.config.json'),
    JSON.stringify({ deckDir: './decks', collectionDir: './collections', wantedDir: './wanted' }),
  )
  execFileSync(
    'bun',
    [
      'run',
      'index.ts',
      '--base-dir',
      workspace,
      'admin',
      'setup',
      '--username',
      USERNAME,
      '--password-stdin',
    ],
    { cwd: repoRoot, input: `${PASSWORD}\n`, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const port = await freePort()
  origin = `http://127.0.0.1:${port}`
  server = spawn(
    'bun',
    [
      'run',
      'index.ts',
      '--base-dir',
      workspace,
      'mcp',
      '--transport',
      'http',
      '--oauth',
      '--public-url',
      origin,
      '-p',
      String(port),
    ],
    { cwd: repoRoot, stdio: 'ignore', env: { ...process.env, RITUAL_MCP_TOKEN: '' } },
  )
  await waitForServer(`${origin}/.well-known/oauth-authorization-server`)
  redirect = await callbackServer('localhost')
  ipv6Redirect = await callbackServer('::1')
})

test.afterAll(() => {
  server?.kill()
  for (const callback of callbacks) callback.close()
  callbacks = []
  if (workspace?.startsWith(path.join(os.tmpdir(), 'ritual-e2e-oauth-'))) {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

async function register(redirectUri: string): Promise<string> {
  const response = await fetch(`${origin}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirectUri] }),
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { client_id: string }).client_id
}

function authorizeUrl(clientId: string, redirectUri: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'browser-state',
  })
  return `${origin}/oauth/authorize?${query}`
}

/** The last callback request, once the browser shows the client's page. */
async function clientReached(page: Page): Promise<URL> {
  await expect(page.locator('body')).toHaveText('client reached')
  const last = reached.at(-1)
  if (last === undefined) throw new Error('the callback server saw no request')
  return last
}

async function signIn(page: Page): Promise<void> {
  await page.fill('#username', USERNAME)
  await page.fill('#password', PASSWORD)
}

test('signing in and allowing sends the browser back to the client with a code', async ({
  page,
}) => {
  const clientId = await register(redirect)
  await page.goto(authorizeUrl(clientId, redirect))
  await expect(page.locator('h1')).toHaveText('Allow Claude to use Ritual?')
  await signIn(page)
  await page.click('button[value="approve"]')
  const callback = await clientReached(page)
  expect(callback.origin + callback.pathname).toBe(redirect)
  expect(callback.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(callback.searchParams.get('state')).toBe('browser-state')
  expect(callback.searchParams.get('iss')).toBe(origin)
})

test('a wrong password stays on the page with an error, then the right one succeeds', async ({
  page,
}) => {
  const clientId = await register(redirect)
  await page.goto(authorizeUrl(clientId, redirect))
  await page.fill('#username', USERNAME)
  await page.fill('#password', 'not the password')
  await page.click('button[value="approve"]')
  await expect(page.locator('[role="alert"]')).toHaveText('Those sign-in details are not correct.')
  await signIn(page)
  await page.click('button[value="approve"]')
  expect((await clientReached(page)).searchParams.has('code')).toBe(true)
})

test('deny sends the client access_denied without asking for credentials', async ({ page }) => {
  const clientId = await register(redirect)
  await page.goto(authorizeUrl(clientId, redirect))
  await page.click('button[value="deny"]')
  const callback = await clientReached(page)
  expect(callback.searchParams.get('error')).toBe('access_denied')
  expect(callback.searchParams.has('code')).toBe(false)
})

test('an IPv6 loopback redirect is not blocked by the page’s CSP', async ({ page }) => {
  const clientId = await register(ipv6Redirect)
  await page.goto(authorizeUrl(clientId, ipv6Redirect))
  await signIn(page)
  await page.click('button[value="approve"]')
  const callback = await clientReached(page)
  expect(callback.hostname).toBe('[::1]')
  expect(callback.searchParams.has('code')).toBe(true)
})
