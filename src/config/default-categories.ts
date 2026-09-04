/**
 * The configured `defaultCategories` vocabulary as this app instance knows it:
 * the public site applies the value baked into `index.json`, the admin SPA the
 * value it fetched from `/api/config`. Empty until config arrives, and empty is
 * a legitimate configured value — a list's own vocabulary is always the primary
 * source of suggestions, so an app that never learns the defaults simply offers
 * fewer of them.
 *
 * The `search-debounce.ts` sibling, minus the test-seam global: nothing races on
 * a vocabulary. Browser-safe (no node imports).
 *
 * Backed by a **signal**, unlike that sibling: the admin SPA resolves
 * `/api/config` asynchronously at page mount, so a dialog opened before the
 * response lands must pick the vocabulary up when it arrives rather than capture
 * an empty list for the life of the page.
 */

import { createSignal } from 'solid-js'
import type { CardCategory } from '../card/card-categories'

const [configured, setConfigured] = createSignal<readonly CardCategory[]>([])

/** Apply the configured vocabulary. Called at app boot on both sites. */
export function setDefaultCategories(categories: readonly CardCategory[]): void {
  setConfigured(() => categories)
}

/** The configured vocabulary; `[]` when none is configured or none has arrived. */
export const defaultCategories = configured

/** Clear the applied value. Intended for tests. */
export function resetDefaultCategories(): void {
  setConfigured(() => [])
}
