import fs from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { ensureLoginsDir, getLoginsDir } from '../logins-dir'
import { MIN_PASSWORD_LENGTH } from './validation'

interface AdminCredentials {
  username: string
  passwordHash: string
  totpSecret?: string
}

function getAuthFilePath(): string {
  return path.join(getLoginsDir(), 'admin-auth.json')
}

async function readCredentials(): Promise<AdminCredentials> {
  const content = await fs.readFile(getAuthFilePath(), 'utf-8')
  return JSON.parse(content) as AdminCredentials
}

export async function adminUserExists(): Promise<boolean> {
  try {
    await fs.access(getAuthFilePath())
    return true
  } catch {
    return false
  }
}

export async function createAdminUser(username: string, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  if (await adminUserExists()) {
    throw new Error('Admin user already exists')
  }

  const passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 })

  await ensureLoginsDir()
  const credentials: AdminCredentials = { username, passwordHash }
  await fs.writeFile(getAuthFilePath(), JSON.stringify(credentials, null, 2), {
    mode: 0o600,
  })
}

/**
 * Replace the stored admin password hash (and optionally the username) in
 * place. Everything else in the credentials file — most importantly a
 * `totpSecret`, including a stuck `pending:` enrollment — is preserved
 * verbatim. Returns the effective username after the reset.
 */
export async function resetAdminPassword(password: string, username?: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const credentials = await readCredentials()
  credentials.passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 })
  if (username !== undefined) {
    credentials.username = username
  }

  await fs.writeFile(getAuthFilePath(), JSON.stringify(credentials, null, 2), { mode: 0o600 })
  return credentials.username
}

export async function verifyAdminUser(username: string, password: string): Promise<boolean> {
  try {
    const credentials = await readCredentials()

    const usernameBuffer = Buffer.from(username)
    const storedBuffer = Buffer.from(credentials.username)
    const usernameMatch =
      usernameBuffer.length === storedBuffer.length && timingSafeEqual(usernameBuffer, storedBuffer)

    // Always run password verify to prevent timing side-channel leaks
    const passwordMatch = await Bun.password.verify(password, credentials.passwordHash)
    return usernameMatch && passwordMatch
  } catch {
    return false
  }
}

export async function getAdminUsername(): Promise<string | null> {
  try {
    const credentials = await readCredentials()
    return credentials.username
  } catch {
    return null
  }
}

export async function isTotpEnabled(): Promise<boolean> {
  try {
    const credentials = await readCredentials()
    return (
      typeof credentials.totpSecret === 'string' &&
      credentials.totpSecret.length > 0 &&
      !credentials.totpSecret.startsWith('pending:')
    )
  } catch {
    return false
  }
}

export async function getTotpSecret(): Promise<string | null> {
  try {
    const credentials = await readCredentials()
    return credentials.totpSecret ?? null
  } catch {
    return null
  }
}

export async function setTotpSecret(secret: string | null): Promise<void> {
  const credentials = await readCredentials()

  if (secret === null) {
    delete credentials.totpSecret
  } else {
    credentials.totpSecret = secret
  }

  await fs.writeFile(getAuthFilePath(), JSON.stringify(credentials, null, 2), { mode: 0o600 })
}
