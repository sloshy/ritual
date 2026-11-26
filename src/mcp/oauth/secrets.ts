import { createHash, randomBytes } from 'node:crypto'

/** Where random bytes come from; injectable so tests can mint predictable secrets. */
export type RandomSource = (size: number) => Uint8Array

/** The process's cryptographic random source. */
export const cryptoRandom: RandomSource = (size) => new Uint8Array(randomBytes(size))

/** Where the current time comes from, in epoch milliseconds; injectable for tests. */
export type Clock = () => number

/** The real clock. */
export const systemClock: Clock = () => Date.now()

/** The bytes of entropy in every token, code, client id and CSRF token. */
const SECRET_BYTES = 32

/**
 * The shape of every secret {@link newSecret} mints: base64url without
 * padding, four characters per three bytes rounded up (43 for 32 bytes).
 */
export const SECRET_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((SECRET_BYTES * 4) / 3)}}$`)

/** A fresh opaque secret: 32 random bytes, base64url without padding. */
export function newSecret(random: RandomSource): string {
  return Buffer.from(random(SECRET_BYTES)).toString('base64url')
}

/**
 * The form a secret is stored and looked up in: its SHA-256, base64url. A
 * leaked state file therefore holds nothing a client could present. Lookups
 * go through a map keyed by this digest, so no stored secret is ever compared
 * byte by byte against a presented one.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('base64url')
}
