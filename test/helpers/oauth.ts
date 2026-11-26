import { s256Challenge } from '../../src/mcp/oauth/pkce'
import type { Clock, RandomSource } from '../../src/mcp/oauth/secrets'
import { isOAuthStoreProblem, OAuthStore } from '../../src/auth/mcp-oauth/store'
import { writeLoginFile } from './workspace'

/** A clock the test moves by hand. Starts at the real time: the SDK's bearer check reads `Date.now()` too. */
export type ManualClock = {
  clock: Clock
  advance(ms: number): void
}

export function manualClock(start: number = Date.now()): ManualClock {
  let now = start
  return {
    clock: () => now,
    advance: (ms) => {
      now += ms
    },
  }
}

/** A random source that yields distinct, predictable bytes: secret N is all bytes N. */
export function sequentialRandom(): RandomSource {
  let counter = 0
  return (size) => {
    counter += 1
    return new Uint8Array(size).fill(counter % 256)
  }
}

/** A PKCE verifier and its S256 challenge. */
export type PkcePair = { verifier: string; challenge: string }

export function pkcePair(seed: string = 'a'): PkcePair {
  const verifier = seed.repeat(64).slice(0, 64)
  return { verifier, challenge: s256Challenge(verifier) }
}

export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
export const PUBLIC_ORIGIN = 'https://mcp.example.com'
export const MCP_RESOURCE = `${PUBLIC_ORIGIN}/mcp`

/** Open the bound workspace's OAuth store, failing the test on a state problem. */
export async function openStore(): Promise<OAuthStore> {
  const store = await OAuthStore.open()
  if (isOAuthStoreProblem(store)) throw new Error(`unexpected state problem: ${store.problem}`)
  return store
}

/** The synthetic admin account the OAuth tests sign in with. */
export const ADMIN_USERNAME = 'owner'
export const ADMIN_PASSWORD = 'correct horse battery'

/**
 * Seed `dir`'s admin account directly (bcrypt at the lowest cost), for a CLI
 * test whose workspace is not bound in this process.
 */
export async function seedAdminAccount(dir: string): Promise<void> {
  const passwordHash = await Bun.password.hash(ADMIN_PASSWORD, { algorithm: 'bcrypt', cost: 4 })
  await writeLoginFile(
    dir,
    'admin-auth.json',
    JSON.stringify({ username: ADMIN_USERNAME, passwordHash }),
  )
}
