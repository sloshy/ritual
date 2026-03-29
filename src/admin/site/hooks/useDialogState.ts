import { useState, useCallback } from 'preact/hooks'

export type DialogState = {
  showChanges: boolean
  showDiscard: boolean
  showSearchModal: boolean
  openChanges: () => void
  closeChanges: () => void
  openDiscard: () => void
  closeDiscard: () => void
  openSearchModal: () => void
  closeSearchModal: () => void
}

export function useDialogState(): DialogState {
  const [showChanges, setShowChanges] = useState(false)
  const [showDiscard, setShowDiscard] = useState(false)
  const [showSearchModal, setShowSearchModal] = useState(false)

  const openChanges = useCallback(() => setShowChanges(true), [])
  const closeChanges = useCallback(() => setShowChanges(false), [])
  const openDiscard = useCallback(() => setShowDiscard(true), [])
  const closeDiscard = useCallback(() => setShowDiscard(false), [])
  const openSearchModal = useCallback(() => setShowSearchModal(true), [])
  const closeSearchModal = useCallback(() => setShowSearchModal(false), [])

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
