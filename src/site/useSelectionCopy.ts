import { createSignal, onCleanup, type Accessor } from 'solid-js'
import type { SelectedCard } from '../list-view/useCardSelection'
import { selectionToText, selectionToCsv } from '../list-view/selection-export'
import { selectionToCartCsv } from './sell-value'

export interface SelectionCopy {
  /** Transient status text ("Copied!" / "Error!"), or null. */
  status: Accessor<string | null>
  copyText: () => Promise<void>
  copyCsv: () => Promise<void>
  /**
   * Copy the selection as the buyer's sell-cart CSV — their own listing titles
   * and edition spellings, quantities capped at what they will take. Offered only in sell
   * mode with Card Kingdom selected; cards with no active offer are omitted.
   */
  copyCart: () => Promise<void>
  /** Warnings from the last cart copy (etched coercion, upload caps); empty otherwise. */
  cartWarnings: Accessor<string[]>
}

/**
 * Copy a card selection to the clipboard as text or CSV, flashing a transient
 * status. Shared by the selection dropdown menu and the "view all" modal so the
 * two copy paths stay identical.
 */
export function useSelectionCopy(getCards: () => SelectedCard[]): SelectionCopy {
  const [status, setStatus] = createSignal<string | null>(null)
  const [cartWarnings, setCartWarnings] = createSignal<string[]>([])
  let timer: ReturnType<typeof setTimeout> | null = null

  const flash = (text: string) => {
    if (timer !== null) clearTimeout(timer)
    setStatus(text)
    timer = setTimeout(() => {
      setStatus(null)
      timer = null
    }, 1500)
  }
  onCleanup(() => {
    if (timer !== null) clearTimeout(timer)
  })

  const run = async (build: (cards: SelectedCard[]) => string) => {
    try {
      await navigator.clipboard.writeText(build(getCards()))
      flash('Copied!')
    } catch {
      flash('Error!')
    }
  }

  // The cart builder also reports advisory problems (etched exported as foil,
  // CK's per-upload caps). Surfacing them is not optional: silently handing over
  // a mis-exported or unimportable file is worse than not offering the copy.
  const copyCart = async (): Promise<void> => {
    const cart = selectionToCartCsv(getCards())
    setCartWarnings(cart.warnings)
    await run(() => cart.csv)
  }

  return {
    status,
    copyText: () => run(selectionToText),
    copyCsv: () => run(selectionToCsv),
    copyCart,
    cartWarnings,
  }
}
