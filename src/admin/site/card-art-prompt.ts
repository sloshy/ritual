import { createSignal, type Accessor } from 'solid-js'
import type { CardArtRef } from '../../card-art'
import type { ListType } from '../../list-type'

/**
 * The "Set Custom Art…" dialog, opened from a card's context menu.
 *
 * A module-level singleton in the same spirit as `move-prompt.ts`: the three
 * editor pages open it with the card they targeted, and one
 * {@link CardArtModal} mounted in the app shell renders whatever is pending.
 * Admin-only, because the write goes straight to `PUT /api/art/:type/:slug` —
 * custom art is list metadata and never joins the deferred change pipeline the
 * public editor exports. The one exception is a card the session added, whose
 * line the route cannot find yet: see {@link CardArtPrompt.staged}.
 */

/** The card a pending custom-art edit targets, and what to do with the result. */
export type CardArtPrompt = {
  listType: ListType
  slug: string
  /** The card line's `&N` — the sidecar's key. */
  cardId: number
  /** Named in the dialog so the user can see which card they picked. */
  cardName: string
  /** The card's current reference, seeding the form; null when it has none. */
  current: CardArtRef | null
  /**
   * The card has no line in the saved file yet (this session added it), so the
   * art route would refuse its id. The dialog writes nothing and hands the
   * reference back to be staged with the pending changes, which the next save
   * flushes — see `src/editor/pending-art.ts`.
   */
  staged?: boolean
  /** Adopt the write into the page's in-memory art, so the tile re-renders. */
  onSaved: (art: CardArtRef | null) => void
}

const [pending, setPending] = createSignal<CardArtPrompt | null>(null)

/** The custom-art edit currently awaiting the user, or null. */
export const pendingCardArtPrompt: Accessor<CardArtPrompt | null> = pending

/** Open the custom-art dialog, replacing any prompt already open. */
export function promptCardArt(prompt: CardArtPrompt): void {
  setPending(prompt)
}

/** Dismiss the custom-art dialog without writing anything. */
export function closeCardArtPrompt(): void {
  setPending(null)
}
