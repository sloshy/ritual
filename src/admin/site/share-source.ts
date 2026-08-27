import { fetchAdminJson } from './editor-backend'
import {
  buildListShareKeys,
  type ListShareSource,
  type ShareEntryRef,
} from '../../site/list-shares'
import type { CombinedListRef } from '../../list-view/combined-list'
import type { ListShareKeys } from '../../site/card-filters'
import type { ApiErrorResponse } from '../../api/http'
import type {
  CollectionFullLoadResult,
  DeckFullLoadResult,
  WantedFullLoadResult,
} from '../api/load-results'

/** The transport `createAdminListShareSource` loads through — injectable for tests. */
export type AdminJsonFetcher = (url: string, signal?: AbortSignal) => Promise<unknown>

/**
 * Admin-side share source for the "Shares cards with" filters: the list's
 * saved contents via the credentialed load routes
 * (`GET /api/deck|collection|wanted/:slug`, default `view=full`), which carry
 * the entries plus the resolved cards map — the same two inputs the public
 * detail JSON provides, so membership semantics are identical on both sites.
 * In-memory editor sessions are deliberately not consulted (saved contents
 * only). The transport is injectable so tests can drive the branch and
 * failure handling without a server.
 */
export function createAdminListShareSource(
  fetchJson: AdminJsonFetcher = fetchAdminJson,
): ListShareSource {
  return {
    async load(ref: CombinedListRef): Promise<ListShareKeys | null> {
      try {
        const body = await fetchJson(`/api/${ref.type}/${encodeURIComponent(ref.slug)}`)
        if (ref.type === 'deck') {
          // The honest union: an error body is what the route actually sends
          // on failure, so the guard is a real narrowing rather than a check
          // the asserted type has already declared dead (the `putCardArt`
          // precedent in editor-backend.ts).
          const result = body as DeckFullLoadResult | ApiErrorResponse
          if (result.success !== true) return null
          const entries: ShareEntryRef[] = result.deck.sections.flatMap((section) => section.cards)
          return buildListShareKeys(entries, result.cards)
        }
        const result = body as CollectionFullLoadResult | WantedFullLoadResult | ApiErrorResponse
        if (result.success !== true) return null
        return buildListShareKeys(result.entries, result.cards)
      } catch (e) {
        console.error(`Share filter: failed to load ${ref.type}/${ref.slug}:`, e)
        return null
      }
    },
  }
}

/**
 * The admin site's share source over the real credentialed transport.
 * Registered at admin boot via `setListShareSource` in `app.tsx`.
 */
export const adminListShareSource: ListShareSource = createAdminListShareSource()
