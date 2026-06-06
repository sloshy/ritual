import { describe, it, expect } from 'bun:test'
import { outdatedCardNames, type PriceCardRef } from '../../src/site/usePriceRefresh'

const REFS: PriceCardRef[] = [
  { id: 'id-a', name: 'A' },
  { id: 'id-b', name: 'B' },
  { id: 'id-c', name: 'C' },
]
const BAKED_DATE = '2020-01-01T00:00:00.000Z'
const REFRESHED = Date.parse('2026-01-01T00:00:00.000Z')

describe('outdatedCardNames', () => {
  it('is empty when every card shares the build date (no refresh yet)', () => {
    expect(outdatedCardNames(REFS, () => null, BAKED_DATE)).toEqual([])
  })

  it('flags cards left at the build price after a partial refresh', () => {
    const updatedAt = (id: string) => (id === 'id-a' ? REFRESHED : null)
    expect(outdatedCardNames(REFS, updatedAt, BAKED_DATE)).toEqual(['B', 'C'])
  })

  it('is empty once every card has been refreshed', () => {
    expect(outdatedCardNames(REFS, () => REFRESHED, BAKED_DATE)).toEqual([])
  })

  it('treats an absent (undefined) card as build-dated', () => {
    const updatedAt = (id: string) => (id === 'id-c' ? REFRESHED : undefined)
    expect(outdatedCardNames(REFS, updatedAt, BAKED_DATE)).toEqual(['A', 'B'])
  })

  it('dedupes repeated names, preserving first-seen order', () => {
    const refs: PriceCardRef[] = [
      { id: 'id-a', name: 'A' },
      { id: 'id-a2', name: 'A' },
      { id: 'id-b', name: 'B' },
    ]
    const updatedAt = (id: string) => (id === 'id-b' ? REFRESHED : null)
    expect(outdatedCardNames(refs, updatedAt, BAKED_DATE)).toEqual(['A'])
  })

  it('handles a missing build date without throwing', () => {
    const updatedAt = (id: string) => (id === 'id-a' ? REFRESHED : null)
    expect(outdatedCardNames(REFS, updatedAt, undefined)).toEqual(['B', 'C'])
  })
})
