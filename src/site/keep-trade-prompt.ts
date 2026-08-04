/**
 * The "marked To keep — add anyway?" guard on trade adds.
 *
 * A keep-labeled collection card can still be traded, but the first attempt to
 * put one in a trade raises a confirmation dialog. Confirming stores a flag in
 * localStorage, so the dialog appears **once ever** (per browser); declining
 * stores nothing, so the reminder returns next time. The KEEP badge on the
 * trade row shows regardless of the flag.
 *
 * Mechanics follow the two established patterns: the storage access is guarded
 * like `editor/edit-session-storage.ts` (private mode / disabled storage
 * degrades to "never acknowledged"), and the dialog is an imperative
 * module-level signal + promise like `printing-prompt.ts`, rendered once in the
 * public `app.tsx`. Trade-URL decoding writes the card signals directly and
 * never calls {@link confirmKeepAdd}, so restoring a shared trade stays silent.
 */

import { createSignal, type Accessor } from 'solid-js'
import type { CardLabel } from '../card-labels'

const STORAGE_KEY = 'ritual:site:keep-trade-ack'

/** localStorage, or null when unavailable (SSR, disabled, private mode). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** True once the user has confirmed a keep-labeled add and been told it won't ask again. */
export function keepPromptAcknowledged(): boolean {
  try {
    return storage()?.getItem(STORAGE_KEY) != null
  } catch {
    return false
  }
}

/** Record the acknowledgement; a storage failure degrades to asking again next time. */
export function acknowledgeKeepPrompt(): void {
  try {
    storage()?.setItem(STORAGE_KEY, '1')
  } catch {
    // Nothing to do — the dialog will simply show again.
  }
}

/** The pending dialog's contract, consumed by the app-level ConfirmDialog. */
export interface KeepTradePrompt {
  cardName: string
  onConfirm: () => void
  onCancel: () => void
}

const [pending, setPending] = createSignal<KeepTradePrompt | null>(null)

/** The keep-confirmation currently awaiting an answer, or null. */
export const pendingKeepTradePrompt: Accessor<KeepTradePrompt | null> = pending

/**
 * Gate one trade add on the keep confirmation. Resolves `true` immediately when
 * the entry is not keep-labeled or the dialog was already acknowledged;
 * otherwise opens the dialog and resolves with the user's answer. Confirming
 * sets the forever flag — cancelling does not.
 */
export function confirmKeepAdd(
  cardName: string,
  labels: readonly CardLabel[] | undefined,
): Promise<boolean> {
  if (!labels?.includes('keep') || keepPromptAcknowledged()) return Promise.resolve(true)
  // One dialog at a time: a second keep add while one is open would overwrite
  // the pending prompt and leave its promise unresolved forever.
  if (pending() !== null) return Promise.resolve(false)
  return new Promise((resolve) => {
    setPending({
      cardName,
      onConfirm: () => {
        acknowledgeKeepPrompt()
        setPending(null)
        resolve(true)
      },
      onCancel: () => {
        setPending(null)
        resolve(false)
      },
    })
  })
}
