import { createApiSearchProvider } from '../../editor/search-provider'
import { createBuylistFetcher, type BuylistFetcher } from '../../site/buylist-quotes'
import type { CardPriceResponse } from '../../api/card-price'
import type { CardArtRef } from '../../card-art'
import type { ListType } from '../../list-type'
import { t } from '../../i18n/t'
import type { CardArtSaveResponse } from '../api/art'
import type {
  DeckMetadataRequest,
  FlatListMetadataRequest,
  MetadataResponse,
} from '../api/metadata'
import type { ApiErrorResponse } from '../api/save-helpers'

/**
 * Admin-side wiring for the shared editor: the strategies that talk to the admin
 * server's API (search, list/data loads, prices). The public site provides its
 * own Scryfall/preloaded equivalents instead.
 */

/** Shared admin card-search backend (hits `/api/autocomplete` + `/api/card-printings`). */
export const adminSearch = createApiSearchProvider()

/**
 * Quote transport for the admin site: same request as the public one, but
 * carrying the session cookie the admin routes require.
 */
export const adminBuylistFetcher: BuylistFetcher = createBuylistFetcher({
  url: '/api/buylist/quotes',
  credentials: 'same-origin',
})

/** Fetch and parse a JSON payload from an admin API endpoint (same-origin credentials). */
export function fetchAdminJson(url: string, signal?: AbortSignal): Promise<unknown> {
  return fetch(url, { credentials: 'same-origin', signal }).then((r) => r.json())
}

/** What a custom-art write did: nothing more to say, or the sentence explaining the refusal. */
export type CardArtWriteResult = { ok: true } | { ok: false; message: string }

/**
 * `PUT /api/art/:type/:slug` — set (or, with `null`, clear) one card's custom
 * art.
 *
 * Shared by the dialog that writes immediately and by the editors' staged
 * flush after a save, so both report a refusal in the server's own words rather
 * than each inventing a message for the same 400.
 */
export async function putCardArt(
  listType: ListType,
  slug: string,
  cardId: number,
  art: CardArtRef | null,
): Promise<CardArtWriteResult> {
  try {
    const resp = await fetch(`/api/art/${listType}/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId, art }),
    })
    const body = (await resp.json()) as CardArtSaveResponse | ApiErrorResponse
    if (!resp.ok || !body.success) {
      return {
        ok: false,
        message:
          body.success === false
            ? body.message
            : t('admin.art.saveFailed', { status: resp.status }),
      }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * What a front-matter write did: the file's new front matter and content hash,
 * or the server's own sentence about why it refused.
 */
export type ListMetadataWriteResult =
  | { ok: true; frontMatter: Record<string, unknown>; contentHash: string }
  | { ok: false; message: string }

/**
 * The body a metadata write sends, typed as the route's own request shapes so a
 * misspelled key — or `labels` on a wanted list — is a compile error here rather
 * than a 400 at runtime.
 */
export type ListMetadataBody = DeckMetadataRequest | FlatListMetadataRequest

/**
 * `PUT /api/metadata/:type/:slug` — write one or more front-matter keys of a
 * list (its default labels, its cover image) without touching a card line.
 *
 * Every admin dialog that edits front matter goes through here rather than
 * fetching for itself, so they share one refusal wording and one place the
 * request shape is stated. `body` carries the keys being written plus the
 * editor session's `contentHash`; the returned hash **must** be adopted into
 * that session, or the next card save 409s against the file this write just
 * rewrote.
 */
export async function putListMetadata(
  listType: ListType,
  slug: string,
  body: ListMetadataBody,
): Promise<ListMetadataWriteResult> {
  try {
    const resp = await fetch(`/api/metadata/${listType}/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const parsed = (await resp.json()) as MetadataResponse | ApiErrorResponse
    if (!resp.ok || !parsed.success) {
      return {
        ok: false,
        message:
          parsed.success === false
            ? parsed.message
            : t('admin.metadata.saveFailed', { status: resp.status }),
      }
    }
    return { ok: true, frontMatter: parsed.frontMatter, contentHash: parsed.contentHash }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** Fetch a card's prices from the admin price API; null on failure or an unsuccessful response. */
export async function fetchCardPrice(cardName: string): Promise<CardPriceResponse | null> {
  try {
    const resp = await fetch(`/api/card-price?name=${encodeURIComponent(cardName)}`, {
      credentials: 'same-origin',
    })
    const data = (await resp.json()) as CardPriceResponse
    return data.success ? data : null
  } catch {
    return null
  }
}
