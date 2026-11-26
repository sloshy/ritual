import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { adminAuthPath } from '../logins-dir'
import { isRecord } from '../../util/json'

/**
 * The admin credentials an OAuth approval was made with, as one opaque value:
 * SHA-256 over the stored password hash and the *active* TOTP secret (a
 * `pending:` enrollment is not active, so starting one changes nothing).
 *
 * Each grant and authorization code records the fingerprint current when the
 * owner approved it, and every token check, refresh and code exchange
 * compares it with the fingerprint of `admin-auth.json` as it is now. Changing
 * the password or turning TOTP on or off — from any process, through any
 * route — therefore revokes everything at once, without the OAuth server or
 * the credential writers ever touching each other's files.
 */
export function credentialFingerprint(
  passwordHash: string,
  totpSecret: string | undefined,
): string {
  const active = totpSecret === undefined || totpSecret.startsWith('pending:') ? '' : totpSecret
  return createHash('sha256').update(`${passwordHash}\0${active}`, 'utf8').digest('base64url')
}

/** The fingerprint of an `admin-auth.json` text, or `undefined` when it is not a usable account. */
export function fingerprintOfCredentialsText(text: string): string | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(raw) || typeof raw.passwordHash !== 'string' || raw.passwordHash === '') {
    return undefined
  }
  const totp =
    typeof raw.totpSecret === 'string' && raw.totpSecret !== '' ? raw.totpSecret : undefined
  return credentialFingerprint(raw.passwordHash, totp)
}

/** What identifies one version of the credentials file. */
type FileIdentity = { ino: number; mtimeMs: number; size: number }

/** The cached fingerprint and the file version it was read from. */
type CachedFingerprint = { identity: FileIdentity; fingerprint: string | undefined }

/** Reads the current admin credential fingerprint. */
export type FingerprintSource = () => Promise<string | undefined>

/**
 * A reader of the current fingerprint that costs one `stat` per call: the
 * file is re-read only when its inode, mtime or size changed (every writer
 * replaces it by rename). A missing, unreadable or invalid file has no
 * fingerprint, which refuses everything: OAuth fails closed.
 */
export function createFingerprintReader(file: () => string = adminAuthPath): FingerprintSource {
  let cached: CachedFingerprint | undefined
  return async () => {
    const path = file()
    let identity: FileIdentity
    try {
      const stat = await fs.stat(path)
      identity = { ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size }
    } catch {
      cached = undefined
      return undefined
    }
    if (
      cached !== undefined &&
      cached.identity.ino === identity.ino &&
      cached.identity.mtimeMs === identity.mtimeMs &&
      cached.identity.size === identity.size
    ) {
      return cached.fingerprint
    }
    let fingerprint: string | undefined
    try {
      fingerprint = fingerprintOfCredentialsText(await fs.readFile(path, 'utf-8'))
    } catch {
      fingerprint = undefined
    }
    cached = { identity, fingerprint }
    return fingerprint
  }
}
