import type { ChangeEvent } from './deck-changes'
import type { WantedListCardEntry } from '../../../site/data-types'

type ChangeInput = Omit<ChangeEvent, 'id' | 'timestamp'> & {
  fileOrder?: number
}

export function applyChangeToWantedList(
  entries: WantedListCardEntry[],
  change: ChangeInput,
): WantedListCardEntry[] {
  switch (change.action) {
    case 'add': {
      const hasSet = Boolean(change.set && change.collectorNumber)
      const hasFinish = Boolean(change.finish)
      const state = !hasSet ? 'name-only' : hasFinish ? 'fully-specified' : 'printing'
      const newEntry: WantedListCardEntry = {
        name: change.cardName,
        set: change.set,
        collectorNumber: change.collectorNumber,
        finish: change.finish,
        price: 0,
        fileOrder: entries.length,
        state,
      }
      return [...entries, newEntry]
    }

    case 'remove': {
      if (change.fileOrder !== undefined) {
        const idx = entries.findIndex((e) => e.fileOrder === change.fileOrder)
        if (idx === -1) return entries
        return entries.filter((_, i) => i !== idx)
      }

      const idx = entries.findIndex((e) => {
        if (e.name !== change.cardName) return false
        if (change.set && e.set !== change.set) return false
        if (change.collectorNumber && e.collectorNumber !== change.collectorNumber) return false
        return true
      })
      if (idx === -1) return entries
      return entries.filter((_, i) => i !== idx)
    }

    case 'set-finish': {
      return entries.map((e) => {
        if (e.name === change.cardName) {
          const finish = change.finish ?? undefined
          const state = !e.set ? 'name-only' : finish ? 'fully-specified' : 'printing'
          return { ...e, finish, state }
        }
        return e
      })
    }

    case 'set-commander': {
      return entries
    }
  }
}
