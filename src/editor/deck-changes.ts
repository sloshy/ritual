import type { DeckData } from '../types'
import type { ChangeInput, PrintingTuple } from '../change-event'
import { isSamePrinting } from '../change-event'
import { findOrCreateSection, isCommanderSection, resolveDefaultAddSection } from '../deck-format'
import { isCondition } from '../finish-condition'
import { noteOrUndefined } from '../note-helpers'

export function applyChangeToDeck(deck: DeckData, change: ChangeInput): DeckData {
  const sections = deck.sections.map((s) => ({
    ...s,
    cards: s.cards.map((c) => ({ ...c })),
  }))

  // Section-meta changes carry no card; guard the reads so the closures type-check.
  const changeCardId = 'cardId' in change ? change.cardId : undefined
  const changeCardName = 'cardName' in change ? change.cardName : ''

  // Find a card by cardId first (precise), then fall back to name match
  const findCard = (sectionList: typeof sections) => {
    if (changeCardId !== undefined) {
      for (const section of sectionList) {
        const idx = section.cards.findIndex((c) => c.cardId === changeCardId)
        if (idx !== -1) return { section, idx, card: section.cards[idx]! }
      }
    }
    for (const section of sectionList) {
      const idx = section.cards.findIndex((c) => c.name === changeCardName)
      if (idx !== -1) return { section, idx, card: section.cards[idx]! }
    }
    return null
  }

  // For adds, an existing entry is matched by cardId first, then by name AND
  // identical printing. This keeps a card whose printing differs (e.g. after a
  // partial "change printing" split) as its own entry instead of merging it into
  // a same-named entry with a different set/finish/condition.
  const findCardForAdd = (sectionList: typeof sections, printing: PrintingTuple) => {
    if (changeCardId !== undefined) {
      for (const section of sectionList) {
        const idx = section.cards.findIndex((c) => c.cardId === changeCardId)
        if (idx !== -1) return { section, idx, card: section.cards[idx]! }
      }
    }
    for (const section of sectionList) {
      const idx = section.cards.findIndex(
        (c) => c.name === changeCardName && isSamePrinting(c, printing),
      )
      if (idx !== -1) return { section, idx, card: section.cards[idx]! }
    }
    return null
  }

  switch (change.action) {
    case 'add': {
      // Find existing card to increment quantity
      const found = findCardForAdd(sections, change)
      if (found) {
        found.card.quantity += 1
        return { ...deck, sections }
      }

      // No existing entry — add to the explicitly requested section if given, otherwise the
      // first non-commander, non-sideboard section.
      const targetSection = change.section
        ? findOrCreateSection(sections, change.section)
        : resolveDefaultAddSection(sections)
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
      let commanderSection = sections.find((s) => isCommanderSection(s.name))
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
      const commanderSection = sections.find((s) => isCommanderSection(s.name))
      if (!commanderSection) return { ...deck, sections }

      const idx =
        change.cardId !== undefined
          ? commanderSection.cards.findIndex((c) => c.cardId === change.cardId)
          : commanderSection.cards.findIndex((c) => c.name === change.cardName)
      if (idx === -1) return { ...deck, sections }

      const [removed] = commanderSection.cards.splice(idx, 1)
      if (!removed) return { ...deck, sections }

      resolveDefaultAddSection(sections).cards.push(removed)
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

    case 'set-printing': {
      const found = findCard(sections)
      if (found) {
        found.card.set = change.set
        found.card.collectorNumber = change.collectorNumber
        found.card.finish = change.finish
        if (change.condition !== undefined) {
          found.card.condition = isCondition(change.condition) ? change.condition : undefined
        }
        return { ...deck, sections }
      }
      return { ...deck, sections }
    }

    case 'set-note': {
      const found = findCard(sections)
      if (found) {
        found.card.note = noteOrUndefined(change.note)
        return { ...deck, sections }
      }
      return { ...deck, sections }
    }

    case 'add-section': {
      findOrCreateSection(sections, change.section)
      return { ...deck, sections }
    }

    case 'remove-section': {
      // Only remove an empty section; a non-empty one is left intact as a safety guard.
      const idx = sections.findIndex((s) => s.name === change.section && s.cards.length === 0)
      if (idx !== -1) sections.splice(idx, 1)
      return { ...deck, sections }
    }

    case 'rename-section': {
      const target = sections.find((s) => s.name === change.section)
      if (target) target.name = change.newSection
      return { ...deck, sections }
    }

    case 'set-section': {
      const found = findCard(sections)
      if (!found) return { ...deck, sections }
      if (found.section.name === change.section) return { ...deck, sections }
      const [moved] = found.section.cards.splice(found.idx, 1)
      if (!moved) return { ...deck, sections }
      findOrCreateSection(sections, change.section).cards.push(moved)
      return { ...deck, sections }
    }

    case 'move-from':
      // A move out of this deck removes one copy here; the destination write is
      // handled at save time (admin) or on import of the destination's change file.
      return applyChangeToDeck(deck, {
        action: 'remove',
        cardName: change.cardName,
        cardId: change.cardId,
        set: change.set,
        collectorNumber: change.collectorNumber,
        finish: change.finish,
        condition: change.condition,
      })

    case 'move-to':
      // A move into this deck adds the card (e.g. when importing a destination list's changes).
      return applyChangeToDeck(deck, {
        action: 'add',
        cardName: change.cardName,
        cardId: change.cardId,
        set: change.set,
        collectorNumber: change.collectorNumber,
        finish: change.finish,
        condition: change.condition,
      })
  }
}
