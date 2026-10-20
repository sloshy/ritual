import { resolveStringOverride } from '../config/env-override'
import { t } from '../i18n/t'
import { EXAMPLE } from '../util/cli-tokens'

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
  return resolveStringOverride(cliValue, envValue)
}

/** A rejected `--cache-server` / `RITUAL_CACHE_SERVER` value and why. */
export type CacheServerAddressError = { error: string }

export function isCacheServerAddressError(
  value: string | CacheServerAddressError,
): value is CacheServerAddressError {
  return typeof value !== 'string'
}

/**
 * Parse a cache-server address into its base URL, or describe why it is not a
 * usable one. Both the `--cache-server` argParser and the env-var path go
 * through this so a bad value is a usage error either way.
 */
export function parseCacheServerBaseUrl(address: string): string | CacheServerAddressError {
  const normalizedAddress = normalizeCacheServerAddress(address)
  if (!normalizedAddress) {
    return { error: t('cli.cacheServer.addressEmpty', { example: EXAMPLE.cacheServerHost }) }
  }

  const withProtocol = CACHE_SERVER_PROTOCOL_RE.test(normalizedAddress)
    ? normalizedAddress
    : `http://${normalizedAddress}`
  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    return { error: t('cli.cacheServer.addressInvalid', { example: EXAMPLE.cacheServerHost, exampleUrl: EXAMPLE.cacheServerUrl }) }
  }
  if (!parsed.hostname || !parsed.port) {
    return { error: t('cli.cacheServer.addressInvalid', { example: EXAMPLE.cacheServerHost, exampleUrl: EXAMPLE.cacheServerUrl }) }
  }

  return `${parsed.protocol}//${parsed.host}`
}

export function toCacheServerBaseUrl(address: string): string {
  const parsed = parseCacheServerBaseUrl(address)
  if (isCacheServerAddressError(parsed)) {
    throw new Error(parsed.error)
  }
  return parsed
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
