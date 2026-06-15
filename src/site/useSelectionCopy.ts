import { createSignal, onCleanup, type Accessor } from 'solid-js'
import type { SelectedCard } from './useCardSelection'
import { selectionToText, selectionToCsv } from '../editor/list-export'

export interface SelectionCopy {
  /** Transient status text ("Copied!" / "Error!"), or null. */
  status: Accessor<string | null>
  copyText: () => Promise<void>
  copyCsv: () => Promise<void>
}

/**
 * Copy a card selection to the clipboard as text or CSV, flashing a transient
 * status. Shared by the selection dropdown menu and the "view all" modal so the
 * two copy paths stay identical.
 */
export function useSelectionCopy(getCards: () => SelectedCard[]): SelectionCopy {
  const [status, setStatus] = createSignal<string | null>(null)
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

  return {
    status,
    copyText: () => run(selectionToText),
    copyCsv: () => run(selectionToCsv),
  }
}
