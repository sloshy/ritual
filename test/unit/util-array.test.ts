import { describe, expect, test } from 'bun:test'
import { swapNeighbour } from '../../src/util/array'

describe('swapNeighbour', () => {
  test('swaps the entry with its neighbour in either direction', () => {
    expect(swapNeighbour(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(swapNeighbour(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
  })

  test('an out-of-range move is a no-op copy, never a truncation', () => {
    const list = ['a', 'b']
    expect(swapNeighbour(list, 0, -1)).toEqual(['a', 'b'])
    expect(swapNeighbour(list, 1, 1)).toEqual(['a', 'b'])
    expect(swapNeighbour(list, 0, -1)).not.toBe(list)
  })
})
