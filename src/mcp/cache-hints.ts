import type { CacheHint } from '@modelcontextprotocol/server'

/**
 * Cacheable-result policy for protocol revision 2026-07-28 (ignored on 2025-era
 * responses). Every response reflects one user's local workspace, hence
 * `private` on both constants.
 */

/** List *contents* change on every mutation — reads and enumerations are never cacheable. */
export const NEVER_CACHE: CacheHint = { ttlMs: 0, cacheScope: 'private' }

/** The tool/template/discovery catalog is fixed for a given binary — a long TTL is honest. */
export const STATIC_CATALOG_CACHE: CacheHint = { ttlMs: 3_600_000, cacheScope: 'private' }
