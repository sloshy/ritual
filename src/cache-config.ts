const CACHE_SERVER_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//

let cacheServerOverride: string | undefined
let hasCacheServerOverride = false

function normalizeCacheServerAddress(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  return normalized
}

export function resolveCacheServerAddress(
  cliValue: string | undefined,
  envValue: string | undefined = process.env.RITUAL_CACHE_SERVER,
): string | undefined {
  const cli = normalizeCacheServerAddress(cliValue)
  if (cli) return cli
  return normalizeCacheServerAddress(envValue)
}

export function toCacheServerBaseUrl(address: string): string {
  const normalizedAddress = normalizeCacheServerAddress(address)
  if (!normalizedAddress) {
    throw new Error('Cache server must be a non-empty hostname and port (example: localhost:4000).')
  }

  const withProtocol = CACHE_SERVER_PROTOCOL_RE.test(normalizedAddress)
    ? normalizedAddress
    : `http://${normalizedAddress}`
  const parsed = new URL(withProtocol)
  if (!parsed.hostname || !parsed.port) {
    throw new Error(
      'Cache server must include hostname and port (example: localhost:4000 or http://localhost:4000).',
    )
  }

  return `${parsed.protocol}//${parsed.host}`
}

export function setCacheServerAddressOverride(address: string | undefined): void {
  cacheServerOverride = normalizeCacheServerAddress(address)
  hasCacheServerOverride = true
}

export function clearCacheServerAddressOverride(): void {
  cacheServerOverride = undefined
  hasCacheServerOverride = false
}

export function getConfiguredCacheServerAddress(): string | undefined {
  if (hasCacheServerOverride) {
    return cacheServerOverride
  }
  return normalizeCacheServerAddress(process.env.RITUAL_CACHE_SERVER)
}

export function getCacheServerBaseUrl(): string | undefined {
  const configured = getConfiguredCacheServerAddress()
  if (!configured) return undefined
  return toCacheServerBaseUrl(configured)
}
