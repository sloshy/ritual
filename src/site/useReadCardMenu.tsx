import type { JSX } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import type { CardContextInfo } from '../list-view/card-context'
import { CardContextMenu } from '../editor/components/CardContextMenu'
import { findPrintingsAvailable } from '../list-view/find-printings'

/** A read-mode menu target: the card plus the ⋯ button's anchor rect. */
export interface ReadCardMenuTarget extends CardContextInfo {
  anchorRect: DOMRect
}

export interface UseReadCardMenuResult {
  /** Whether read-mode tiles should offer the ⋯ menu at all (it would be empty otherwise). */
  enabled: () => boolean
  open: (info: CardContextInfo, rect: DOMRect) => void
  /** The menu itself — render once at the page root. */
  element: () => JSX.Element
}

/**
 * The card ⋯ context menu for list pages *outside* edit mode. It carries no
 * edit actions — only the cross-list lookups (currently "Find other
 * printings") — so it is offered only where those are available: the public
 * site. The admin app mounts no FindPrintingsModal, leaving the menu empty,
 * so `enabled` reports false there and the tiles hide the ⋯ button.
 */
export function useReadCardMenu(): UseReadCardMenuResult {
  const [target, setTarget] = createSignal<ReadCardMenuTarget | null>(null)
  return {
    enabled: () => findPrintingsAvailable(),
    open: (info, rect) => setTarget({ ...info, anchorRect: rect }),
    element: () => (
      <Show when={target()}>
        {(menu) => (
          <CardContextMenu
            cardName={menu().cardName}
            card={menu().card}
            anchorRect={menu().anchorRect}
            hideCommander
            onClose={() => setTarget(null)}
          />
        )}
      </Show>
    ),
  }
}
