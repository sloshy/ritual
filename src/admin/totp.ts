import { subtle } from 'node:crypto'

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buffer: Uint8Array): string {
  let result = ''
  let bits = 0
  let value = 0

  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      bits -= 5
      result += BASE32_CHARS[(value >>> bits) & 0x1f]
    }
  }

  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f]
  }

  return result
}

export function base32Decode(encoded: string): Uint8Array {
  const cleaned = encoded.replace(/[= ]/g, '').toUpperCase()
  const bytes: number[] = []
  let bits = 0
  let value = 0

  for (const char of cleaned) {
    const index = BASE32_CHARS.indexOf(char)
    if (index === -1) continue
    value = (value << 5) | index
    bits += 5

    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 0xff)
    }
  }

  return new Uint8Array(bytes)
}

export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return base32Encode(bytes)
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  // Uint8Array.buffer is typed as ArrayBufferLike in TS 5.7+ (may be
  // SharedArrayBuffer), but the WebCrypto API requires ArrayBuffer.
  // At runtime these are always plain ArrayBuffers, so the cast is safe.
  const cryptoKey = await subtle.importKey(
    'raw',
    key.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const signature = await subtle.sign('HMAC', cryptoKey, message.buffer as ArrayBuffer)
  return new Uint8Array(signature)
}

function intToBytes(num: number): Uint8Array {
  const bytes = new Uint8Array(8)
  for (let i = 7; i >= 0; i--) {
    bytes[i] = num & 0xff
    num = Math.floor(num / 256)
  }
  return bytes
}

async function generateHotp(secret: Uint8Array, counter: number): Promise<string> {
  const counterBytes = intToBytes(counter)
  const hash = await hmacSha1(secret, counterBytes)

  const offset = hash[hash.length - 1]! & 0x0f
  const code =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff)

  return (code % 1_000_000).toString().padStart(6, '0')
}

export async function generateTotp(secret: string, timeStep: number = 30): Promise<string> {
  const secretBytes = base32Decode(secret)
  const counter = Math.floor(Date.now() / 1000 / timeStep)
  return generateHotp(secretBytes, counter)
}

let lastUsedCounter = 0

export function resetTotpReplayState(): void {
  lastUsedCounter = 0
}

export async function verifyTotp(
  secret: string,
  code: string,
  timeStep: number = 30,
  window: number = 1,
): Promise<boolean> {
  const secretBytes = base32Decode(secret)
  const counter = Math.floor(Date.now() / 1000 / timeStep)

  // Check current and adjacent time windows to handle clock skew
  for (let i = -window; i <= window; i++) {
    const c = counter + i
    if (c <= lastUsedCounter) continue // replay protection
    const expected = await generateHotp(secretBytes, c)
    if (expected === code) {
      lastUsedCounter = c
      return true
    }
  }

  return false
}

export function buildTotpUri(secret: string, username: string, issuer: string = 'Ritual'): string {
  const encodedIssuer = encodeURIComponent(issuer)
  const encodedUser = encodeURIComponent(username)
  return `otpauth://totp/${encodedIssuer}:${encodedUser}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`
}
