import { createSignal, type Accessor } from 'solid-js'

// Touch selection mode, global like the selection store itself: once on, a
// plain tap on any selectable card toggles its selection instead of opening
// the card modal — the touch replacement for desktop's Ctrl/Cmd-click. Toggled
// from the toolbar's "Select" button (shown on coarse-pointer devices) and
// persists across navigation, mirroring how selections survive it too.

const [active, setActive] = createSignal(false)

/** Whether touch selection mode is on (taps select cards instead of opening them). */
export const selectionModeActive: Accessor<boolean> = active

export function toggleSelectionMode(): void {
  setActive((v) => !v)
}
