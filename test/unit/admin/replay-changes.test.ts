import { describe, it, expect } from 'bun:test'
import { replayChanges } from '../../../src/admin/site/hooks/reconcile-undo'

describe('replayChanges', () => {
  type SimpleEntry = { name: string; quantity: number }

  const applyChange = (entries: SimpleEntry[], change: { action: string; cardName: string }) => {
    if (change.action === 'add') {
      const existing = entries.find((e) => e.name === change.cardName)
      if (existing) {
        return entries.map((e) =>
          e.name === change.cardName ? { ...e, quantity: e.quantity + 1 } : e,
        )
      }
      return [...entries, { name: change.cardName, quantity: 1 }]
    }
    if (change.action === 'remove') {
      return entries
        .map((e) => (e.name === change.cardName ? { ...e, quantity: e.quantity - 1 } : e))
        .filter((e) => e.quantity > 0)
    }
    return entries
  }

  it('returns original data when no changes', () => {
    const original = [{ name: 'Lightning Bolt', quantity: 4 }]
    const result = replayChanges(original, [], applyChange)
    expect(result).toEqual(original)
  })

  it('applies a single add change', () => {
    const original: SimpleEntry[] = []
    const changes = [{ action: 'add', cardName: 'Lightning Bolt' }]
    const result = replayChanges(original, changes, applyChange)
    expect(result).toEqual([{ name: 'Lightning Bolt', quantity: 1 }])
  })

  it('applies multiple changes in order', () => {
    const original: SimpleEntry[] = [{ name: 'Lightning Bolt', quantity: 2 }]
    const changes = [
      { action: 'add', cardName: 'Lightning Bolt' },
      { action: 'add', cardName: 'Counterspell' },
      { action: 'remove', cardName: 'Lightning Bolt' },
    ]
    const result = replayChanges(original, changes, applyChange)
    expect(result).toEqual([
      { name: 'Lightning Bolt', quantity: 2 },
      { name: 'Counterspell', quantity: 1 },
    ])
  })

  it('does not mutate original data', () => {
    const original = [{ name: 'Lightning Bolt', quantity: 1 }]
    const originalCopy = [...original.map((e) => ({ ...e }))]
    replayChanges(original, [{ action: 'add', cardName: 'Lightning Bolt' }], applyChange)
    expect(original).toEqual(originalCopy)
  })
})
