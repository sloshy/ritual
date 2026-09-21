import { createSignal, onCleanup, type Accessor } from 'solid-js'
import type { SelectedCard } from '../list-view/useCardSelection'
import { selectionToText, selectionToCsv } from '../list-view/selection-export'
import { selectionToCartCsv } from './sell-value'
import { useT } from '../ui/i18n'
import { buyerName } from '../buylist'
import { cartBuyer } from '../list-view/sell-mode'

/** Which copy button was pressed — the feedback lands on that button. */
export type SelectionCopyKind = 'text' | 'csv' | 'cart'

/** The result of the most recent copy, shown on its button until it times out. */
type SelectionCopyOutcome = { kind: SelectionCopyKind; ok: boolean }

export interface SelectionCopy {
  /**
   * The label for a copy button: the confirmation ("Copied!" / "Copy failed")
   * while that button's copy is being reported, otherwise its action name.
   * Reactive — read it inside JSX.
   */
  label: (kind: SelectionCopyKind) => string
  /**
   * The confirmation prefixed with its action name, for a visually hidden live
   * region; '' when idle. Naming the action keeps back-to-back copies distinct,
   * so the second one is announced too.
   */
  announcement: Accessor<string>
  /** The state class for a copy button (`is-copied` / `is-copy-failed`), or ''. */
  stateClass: (kind: SelectionCopyKind) => string
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
 * Copy a card selection to the clipboard as text or CSV, confirming on the
 * pressed button itself — where the user is already looking. Shared by the selection dropdown menu and the "view all" modal so the
 * two copy paths stay identical.
 */
export function useSelectionCopy(getCards: () => SelectedCard[]): SelectionCopy {
  const t = useT()
  const [outcome, setOutcome] = createSignal<SelectionCopyOutcome | null>(null)
  const [cartWarnings, setCartWarnings] = createSignal<string[]>([])
  let timer: ReturnType<typeof setTimeout> | null = null

  const flash = (next: SelectionCopyOutcome) => {
    if (timer !== null) clearTimeout(timer)
    setOutcome(next)
    timer = setTimeout(() => {
      setOutcome(null)
      timer = null
    }, 1500)
  }
  onCleanup(() => {
    if (timer !== null) clearTimeout(timer)
  })

  const write = async (kind: SelectionCopyKind, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      flash({ kind, ok: true })
    } catch {
      flash({ kind, ok: false })
    }
  }

  const run = (kind: SelectionCopyKind, build: (cards: SelectedCard[]) => string) =>
    write(kind, build(getCards()))

  const message = (result: SelectionCopyOutcome): string =>
    result.ok ? t('site.export.copied') : t('site.export.copyFailed')

  const idle = (kind: SelectionCopyKind): string => {
    if (kind === 'text') return t('site.selection.copyText')
    if (kind === 'csv') return t('site.selection.copyCsv')
    const buyer = cartBuyer()
    return t('site.selection.copyCart', { buyer: buyer ? buyerName(buyer) : '' })
  }

  const reported = (kind: SelectionCopyKind): SelectionCopyOutcome | null => {
    const current = outcome()
    return current?.kind === kind ? current : null
  }

  // The cart builder also reports advisory problems (etched exported as foil,
  // CK's per-upload caps). Surfacing them is not optional: silently handing over
  // a mis-exported or unimportable file is worse than not offering the copy.
  const copyCart = async (): Promise<void> => {
    const cart = selectionToCartCsv(getCards())
    setCartWarnings(cart.warnings)
    await write('cart', cart.csv)
  }

  return {
    label: (kind) => {
      const current = reported(kind)
      return current ? message(current) : idle(kind)
    },
    announcement: () => {
      const current = outcome()
      return current ? `${idle(current.kind)}: ${message(current)}` : ''
    },
    stateClass: (kind) => {
      const current = reported(kind)
      if (!current) return ''
      return current.ok ? 'is-copied' : 'is-copy-failed'
    },
    copyText: () => run('text', selectionToText),
    copyCsv: () => run('csv', selectionToCsv),
    copyCart,
    cartWarnings,
  }
}
