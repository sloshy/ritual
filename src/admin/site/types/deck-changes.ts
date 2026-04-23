import type { DeckData } from '../../../types'
import type { ChangeInput } from '../../../change-event'
import { isCondition } from '../../../finish-condition'

export function applyChangeToDeck(deck: DeckData, change: ChangeInput): DeckData {
  const sections = deck.sections.map((s) => ({
    ...s,
    cards: s.cards.map((c) => ({ ...c })),
  }))

  const isCommander = (name: string) => name.toLowerCase().includes('commander')
  const isSideboard = (name: string) => name.toLowerCase().includes('sideboard')

  // Find a card by cardId first (precise), then fall back to name match
  const findCard = (sectionList: typeof sections) => {
    if (change.cardId !== undefined) {
      for (const section of sectionList) {
        const idx = section.cards.findIndex((c) => c.cardId === change.cardId)
        if (idx !== -1) return { section, idx, card: section.cards[idx]! }
      }
    }
    for (const section of sectionList) {
      const idx = section.cards.findIndex((c) => c.name === change.cardName)
      if (idx !== -1) return { section, idx, card: section.cards[idx]! }
    }
    return null
  }

  switch (change.action) {
    case 'add': {
      // Find existing card to increment quantity
      const found = findCard(sections)
      if (found) {
        found.card.quantity += 1
        return { ...deck, sections }
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
        condition: change.condition && isCondition(change.condition) ? change.condition : undefined,
        cardId: change.cardId,
      })
      return { ...deck, sections }
    }

    case 'remove': {
      const found = findCard(sections)
      if (found) {
        found.card.quantity -= 1
        if (found.card.quantity <= 0) {
          found.section.cards.splice(found.idx, 1)
        }
        return { ...deck, sections }
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
        const idx =
          change.cardId !== undefined
            ? section.cards.findIndex((c) => c.cardId === change.cardId)
            : section.cards.findIndex((c) => c.name === change.cardName)
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

      const idx =
        change.cardId !== undefined
          ? commanderSection.cards.findIndex((c) => c.cardId === change.cardId)
          : commanderSection.cards.findIndex((c) => c.name === change.cardName)
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
      const found = findCard(sections)
      if (found) {
        found.card.finish = change.finish
        return { ...deck, sections }
      }
      return { ...deck, sections }
    }

    case 'move-from':
    case 'move-to':
      // Move events are managed by the CLI move command and are not applied via the admin UI
      return { ...deck, sections }
  }
}
