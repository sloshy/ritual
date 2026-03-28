// Re-export shim — canonical location is src/change-event.ts
export type {
  ChangeAction,
  ChangeEvent,
  ChangeInput,
  CardPrintingOptions,
} from '../../../change-event'
export {
  createChangeId,
  createChangeEvent,
  areOppositeChanges,
  isAdditiveChange,
  formatChange,
} from '../../../change-event'

import type { DeckData } from '../../../types'
import type { ChangeInput } from '../../../change-event'

export function applyChangeToDeck(deck: DeckData, change: ChangeInput): DeckData {
  const sections = deck.sections.map((s) => ({
    ...s,
    cards: s.cards.map((c) => ({ ...c })),
  }))

  const isCommander = (name: string) => name.toLowerCase().includes('commander')
  const isSideboard = (name: string) => name.toLowerCase().includes('sideboard')

  switch (change.action) {
    case 'add': {
      // Find existing card in any section and increment, or add to first main section
      for (const section of sections) {
        const existing = section.cards.find((c) => c.name === change.cardName)
        if (existing) {
          existing.quantity += 1
          return { ...deck, sections }
        }
      }

      // No existing entry — add to first non-commander, non-sideboard section
      let targetSection = sections.find((s) => !isCommander(s.name) && !isSideboard(s.name))
      if (!targetSection) {
        targetSection = { name: 'Main', cards: [] }
        sections.push(targetSection)
      }
      targetSection.cards.push({
        quantity: 1,
        name: change.cardName,
        set: change.set,
        collectorNumber: change.collectorNumber,
        finish: change.finish,
        condition: change.condition,
      })
      return { ...deck, sections }
    }

    case 'remove': {
      for (const section of sections) {
        const idx = section.cards.findIndex((c) => c.name === change.cardName)
        if (idx !== -1) {
          const card = section.cards[idx]
          if (card) {
            card.quantity -= 1
            if (card.quantity <= 0) {
              section.cards.splice(idx, 1)
            }
          }
          return { ...deck, sections }
        }
      }
      return { ...deck, sections }
    }

    case 'set-commander': {
      let commanderSection = sections.find((s) => isCommander(s.name))
      if (!commanderSection) {
        commanderSection = { name: 'Commander', cards: [] }
        sections.unshift(commanderSection)
      }

      for (const section of sections) {
        const idx = section.cards.findIndex((c) => c.name === change.cardName)
        if (idx !== -1 && section !== commanderSection) {
          const [removed] = section.cards.splice(idx, 1)
          if (removed) {
            commanderSection.cards.push(removed)
          }
          return { ...deck, sections }
        }
      }

      return { ...deck, sections }
    }

    case 'unset-commander': {
      const commanderSection = sections.find((s) => isCommander(s.name))
      if (!commanderSection) return { ...deck, sections }

      const idx = commanderSection.cards.findIndex((c) => c.name === change.cardName)
      if (idx === -1) return { ...deck, sections }

      const [removed] = commanderSection.cards.splice(idx, 1)
      if (!removed) return { ...deck, sections }

      let targetSection = sections.find((s) => !isCommander(s.name) && !isSideboard(s.name))
      if (!targetSection) {
        targetSection = { name: 'Main', cards: [] }
        sections.push(targetSection)
      }
      targetSection.cards.push(removed)
      return { ...deck, sections }
    }

    case 'set-finish': {
      for (const section of sections) {
        const card = section.cards.find((c) => c.name === change.cardName)
        if (card) {
          card.finish = change.finish
          return { ...deck, sections }
        }
      }
      return { ...deck, sections }
    }
  }
}
