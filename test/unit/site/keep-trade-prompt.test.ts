import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  acknowledgeKeepPrompt,
  confirmKeepAdd,
  keepPromptAcknowledged,
  pendingKeepTradePrompt,
} from '../../../src/site/keep-trade-prompt'
import { addEntryToLeftGuarded, leftCards, setLeftCards } from '../../../src/site/useTradeState'
import type { TradeSearchEntry } from '../../../src/site/useTradeData'
import { normalizeCardName } from '../../../src/card/term-match'
import { denyLocalStorage, makeScryfallCard, stubLocalStorage } from '../../test-utils'

stubLocalStorage()
beforeEach(() => {
  setLeftCards([])
})
afterEach(() => {
  // Never leave a dangling pending prompt for the next test file.
  pendingKeepTradePrompt()?.onCancel()
})

function makeEntry(overrides: Partial<TradeSearchEntry> = {}): TradeSearchEntry {
  const card = makeScryfallCard()
  return {
    name: card.name,
    nameKey: normalizeCardName(card.name),
    set: card.set,
    collectorNumber: card.collector_number,
    finish: 'nonfoil',
    scryfallCard: card,
    sourceName: 'My Collection',
    sourceKind: 'collection',
    maxQty: 1,
    cardIds: [1],
    ...overrides,
  }
}

describe('confirmKeepAdd', () => {
  test('resolves true immediately for unlabeled and non-keep entries', async () => {
    expect(await confirmKeepAdd('Sol Ring', undefined)).toBe(true)
    expect(await confirmKeepAdd('Sol Ring', ['sale', 'trade'])).toBe(true)
    expect(pendingKeepTradePrompt()).toBeNull()
  })

  test('a keep entry opens the dialog; confirming resolves true and sets the forever flag', async () => {
    const answer = confirmKeepAdd('Sol Ring', ['keep'])
    const prompt = pendingKeepTradePrompt()
    expect(prompt?.cardName).toBe('Sol Ring')
    prompt!.onConfirm()
    expect(await answer).toBe(true)
    expect(keepPromptAcknowledged()).toBe(true)
    // Acknowledged: the next keep add never prompts again.
    expect(await confirmKeepAdd('Sol Ring', ['keep'])).toBe(true)
    expect(pendingKeepTradePrompt()).toBeNull()
  })

  test('cancelling resolves false without setting the flag', async () => {
    const answer = confirmKeepAdd('Sol Ring', ['keep'])
    pendingKeepTradePrompt()!.onCancel()
    expect(await answer).toBe(false)
    expect(keepPromptAcknowledged()).toBe(false)
  })

  test('a storage failure degrades to asking, never to blocking', async () => {
    denyLocalStorage()
    expect(keepPromptAcknowledged()).toBe(false)
    acknowledgeKeepPrompt() // must not throw
    const answer = confirmKeepAdd('Sol Ring', ['keep'])
    pendingKeepTradePrompt()!.onConfirm()
    expect(await answer).toBe(true)
  })

  test('a second keep add while the dialog is open resolves false, not a clobber', async () => {
    const first = confirmKeepAdd('Sol Ring', ['keep'])
    const prompt = pendingKeepTradePrompt()
    // Overwriting the pending prompt would leave `first` unresolved forever.
    expect(await confirmKeepAdd('Mox Ruby', ['keep'])).toBe(false)
    expect(pendingKeepTradePrompt()).toBe(prompt)
    prompt!.onConfirm()
    expect(await first).toBe(true)
  })
})

describe('addEntryToLeftGuarded', () => {
  test('adds an unlabeled entry without prompting', async () => {
    expect(await addEntryToLeftGuarded(makeEntry(), 'usd')).toBe(true)
    expect(leftCards()).toHaveLength(1)
  })

  test('a keep entry adds only after confirmation, and carries its labels onto the row', async () => {
    const adding = addEntryToLeftGuarded(makeEntry({ labels: ['keep'] }), 'usd')
    expect(leftCards()).toHaveLength(0)
    pendingKeepTradePrompt()!.onConfirm()
    expect(await adding).toBe(true)
    expect(leftCards()[0]!.labels).toEqual(['keep'])
  })

  test('declining leaves the trade untouched', async () => {
    const adding = addEntryToLeftGuarded(makeEntry({ labels: ['keep'] }), 'usd')
    pendingKeepTradePrompt()!.onCancel()
    expect(await adding).toBe(false)
    expect(leftCards()).toHaveLength(0)
  })
})
