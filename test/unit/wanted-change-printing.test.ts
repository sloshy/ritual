import { describe, expect, test } from 'bun:test'
import { createSignal } from 'solid-js'
import { applyWantedChangePrinting } from '../../src/editor/wanted-config'
import type { ChangePrintingTools } from '../../src/editor/editor-config'
import type { WantedListCardEntry } from '../../src/list/site-data'
import { makeContextInfo } from '../test-utils'

type SetPrintingCall = Parameters<ChangePrintingTools['setPrinting']>

/** Tools that record set-printing calls and refuse everything else. */
function recordingTools(calls: SetPrintingCall[]): ChangePrintingTools {
  const refuse = (): never => {
    throw new Error('not expected on this path')
  }
  return {
    setPrinting: (...args) => calls.push(args),
    addCard: refuse,
    decrementCard: refuse,
    allocateId: refuse,
  }
}

describe('applyWantedChangePrinting', () => {
  test('a condition-only difference is no change: wanted lines carry no condition', () => {
    const entry: WantedListCardEntry = {
      name: 'Sol Ring',
      set: 'lea',
      collectorNumber: '161',
      price: 0,
      fileOrder: 0,
      section: 'Main',
      state: 'printing',
      cardId: 1,
    }
    const [data, setData] = createSignal<WantedListCardEntry[] | null>([entry])
    const calls: SetPrintingCall[] = []
    applyWantedChangePrinting({
      data: [entry],
      original: [entry],
      target: makeContextInfo({
        cardName: 'Sol Ring',
        cardIds: [1],
        set: 'lea',
        collectorNumber: '161',
        condition: 'NM',
      }),
      count: 1,
      options: { set: 'lea', collectorNumber: '161', condition: 'LP' },
      tools: recordingTools(calls),
      setData,
    })
    expect(calls).toEqual([])
    expect(data()).toEqual([entry])
  })
})
