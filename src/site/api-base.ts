import { createSignal } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { ListType } from '../list-type'
import { isAbortError } from './utils'

/**
 * The public site's single "is there a live backend?" switch. `useSiteData`
 * resolves it from `index.json`'s `apiBaseUrl` field on boot; every data,
 * search, and price path reads it reactively:
 *
 * - `null` — fully static site (baked JSON, browser→Scryfall search).
 * - `''`   — same-origin live API (`ritual serve --api`).
 * - a URL  — split deployment: static CDN build + separately hosted API.
 *
 * Degradation is one-way and whole-app: when a configured non-empty base stops
 * answering, {@link reportDataFetchError} drops the base back to `null` so all
 * consumers (data URLs, search provider, prices, the live badge) fall back to
 * static behavior together. Refreshing the page retries the live backend.
 */
const [apiBaseSignal, setApiBaseSignal] = createSignal<string | null>(null)
const [apiDegradedSignal, setApiDegradedSignal] = createSignal(false)

export const apiBase: Accessor<string | null> = apiBaseSignal

/** True once a configured live backend proved unreachable and the fallback engaged. */
export const apiDegraded: Accessor<boolean> = apiDegradedSignal

/** Set the resolved API base (normalizing away trailing slashes); `null` = static. */
export function setApiBase(url: string | null): void {
  setApiBaseSignal(url === null ? null : url.replace(/\/+$/, ''))
}

/** True while a live backend (same-origin or remote) is in use. */
export function apiActive(): boolean {
  return apiBaseSignal() !== null
}

/** Reset to the static state. Intended for tests. */
export function resetApiBase(): void {
  setApiBaseSignal(null)
  setApiDegradedSignal(false)
}

/**
 * URL for an app-relative data path (`index.json`, `decks/x.json`): prefixed
 * with the API base while live, relative (baked file) otherwise.
 */
export function dataUrl(path: string): string {
  const base = apiBaseSignal()
  if (base === null || base === '') return path
  return `${base}/${path}`
}

/** URL for an `api/...` endpoint path. Only meaningful while {@link apiActive}. */
export function apiUrl(path: string): string {
  const base = apiBaseSignal()
  if (base === null || base === '') return `/${path}`
  return `${base}/${path}`
}

/** The app-relative detail JSON path for a list. */
export function detailPath(kind: ListType, slug: string): string {
  if (kind === 'deck') return `decks/${slug}.json`
  if (kind === 'collection') return `collections/${slug}.json`
  return `wanted/${slug}.json`
}

/** {@link dataUrl} applied to {@link detailPath}. */
export function detailUrl(kind: ListType, slug: string): string {
  return dataUrl(detailPath(kind, slug))
}

/**
 * Report a failed data fetch. No-op unless a non-empty base is active (the
 * same-origin and static modes have no distinct fallback copy to switch to)
 * and the error is a real failure rather than an abort. One-way for the
 * session: flips the app back to static mode and raises {@link apiDegraded}.
 */
export function reportDataFetchError(error: unknown): void {
  const base = apiBaseSignal()
  if (base === null || base === '') return
  if (isAbortError(error)) return
  setApiBaseSignal(null)
  setApiDegradedSignal(true)
}
