import { describe, expect, test } from 'bun:test'
import { printingRetarget } from '../../src/editor/printing-retarget'
import { makeContextInfo } from '../test-utils'

const target = makeContextInfo({
  cardName: 'Sol Ring',
  cardIds: [4],
  set: 'lea',
  collectorNumber: '161',
  finish: 'nonfoil',
  condition: 'NM',
})

describe('printingRetarget', () => {
  test('the tile’s own printing is nothing to change', () => {
    expect(
      printingRetarget(
        target,
        { set: 'LEA', collectorNumber: '161', condition: 'NM' },
        'compare-condition',
      ),
    ).toBeNull()
  })

  test('a new printing yields both tuples, the language riding along on the new one', () => {
    expect(
      printingRetarget(
        target,
        { set: 'm21', collectorNumber: '199', language: 'ja' },
        'compare-condition',
      ),
    ).toEqual({
      newPrinting: {
        set: 'm21',
        collectorNumber: '199',
        finish: undefined,
        condition: undefined,
        language: 'ja',
      },
      currentPrinting: { set: 'lea', collectorNumber: '161', finish: 'nonfoil', condition: 'NM' },
    })
  })

  test('comparing conditions, a condition change alone is a retarget', () => {
    const retarget = printingRetarget(
      target,
      { set: 'lea', collectorNumber: '161', condition: 'LP' },
      'compare-condition',
    )
    expect(retarget?.newPrinting.condition).toBe('LP')
  })

  test('ignoring conditions (wanted lists) a condition is neither compared nor carried', () => {
    expect(
      printingRetarget(
        target,
        { set: 'lea', collectorNumber: '161', condition: 'LP' },
        'ignore-condition',
      ),
    ).toBeNull()
    const retarget = printingRetarget(
      target,
      { set: 'm21', collectorNumber: '199', condition: 'LP' },
      'ignore-condition',
    )
    expect(retarget?.newPrinting.condition).toBeUndefined()
    expect(retarget?.currentPrinting.condition).toBeUndefined()
  })
})
