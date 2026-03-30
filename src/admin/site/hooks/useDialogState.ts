import { type Accessor, createSignal } from 'solid-js'

export type DialogState = {
  showChanges: Accessor<boolean>
  showDiscard: Accessor<boolean>
  showSearchModal: Accessor<boolean>
  openChanges: () => void
  closeChanges: () => void
  openDiscard: () => void
  closeDiscard: () => void
  openSearchModal: () => void
  closeSearchModal: () => void
}

export function useDialogState(): DialogState {
  const [showChanges, setShowChanges] = createSignal(false)
  const [showDiscard, setShowDiscard] = createSignal(false)
  const [showSearchModal, setShowSearchModal] = createSignal(false)

  const openChanges = () => setShowChanges(true)
  const closeChanges = () => setShowChanges(false)
  const openDiscard = () => setShowDiscard(true)
  const closeDiscard = () => setShowDiscard(false)
  const openSearchModal = () => setShowSearchModal(true)
  const closeSearchModal = () => setShowSearchModal(false)

  return {
    showChanges,
    showDiscard,
    showSearchModal,
    openChanges,
    closeChanges,
    openDiscard,
    closeDiscard,
    openSearchModal,
    closeSearchModal,
  }
}
