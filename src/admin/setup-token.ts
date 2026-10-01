import { randomBytes } from 'node:crypto'
import { secretsEqual } from '../util/secret-compare'
import { SETUP_TOKEN_PARAM } from './validation'

/**
 * Pins the setup token instead of drawing a random one. For automation that
 * creates the first account over HTTP (the e2e suite, a provisioning script),
 * which cannot read the token off the server's terminal.
 */
export const SETUP_TOKEN_ENV = 'RITUAL_ADMIN_SETUP_TOKEN'

let setupToken: string | undefined

/**
 * The one-time secret `POST /api/setup` requires while no admin account
 * exists.
 *
 * Without it, whoever reached a fresh server first — anyone on the LAN, since
 * `ritual admin` binds every interface — could create the account. The token is
 * printed only to the terminal that started the server, so creating the account
 * proves access to that terminal (or its `docker logs`). Drawn once per process;
 * once an account exists the setup route refuses regardless, so the token needs
 * no expiry of its own.
 */
export function getSetupToken(): string {
  setupToken ??= drawSetupToken(process.env)
  return setupToken
}

/**
 * The token for a process with environment `env`: the pinned value when one is
 * set — trimmed, like the form trims what it sends, so a padded pin can still
 * match — otherwise 144 random bits.
 */
export function drawSetupToken(env: NodeJS.ProcessEnv): string {
  return env[SETUP_TOKEN_ENV]?.trim() || randomBytes(18).toString('base64url')
}

/** Whether `supplied` is this process's setup token. */
export function isSetupToken(supplied: unknown): boolean {
  return typeof supplied === 'string' && secretsEqual(supplied, getSetupToken())
}

/**
 * The browser URL that opens the setup form with the token filled in. The host
 * a wildcard bind listens on is not one a browser can open, so `0.0.0.0` (and
 * `::`) are shown as `localhost`.
 */
export function setupUrl(host: string, port: number): string {
  const bare = host.replace(/^\[(.*)\]$/, '$1')
  const shownHost = bare === '0.0.0.0' || bare === '::' ? 'localhost' : bare
  // An IPv6 literal goes in brackets, without a zone id (`fe80::1%eth0`), which
  // a URL cannot carry.
  const urlHost = shownHost.includes(':') ? `[${shownHost.replace(/%.*$/, '')}]` : shownHost
  const url = new URL(`http://${urlHost}:${port}/`)
  url.searchParams.set(SETUP_TOKEN_PARAM, getSetupToken())
  return url.toString()
}
