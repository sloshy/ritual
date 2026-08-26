import { describe, test, expect } from 'bun:test'
import {
  applyConditionUpdate,
  defaultPrintingFinish,
  displayFinish,
  printingFinishes,
} from '../../src/card/finish-condition'
import type { ConditionUpdate } from '../../src/changes/change-event'
import { makeScryfallCard } from '../test-utils'

describe('printingFinishes', () => {
  test('returns the valid finishes of a printing', () => {
    expect(printingFinishes(makeScryfallCard({ finishes: ['nonfoil', 'foil'] }))).toEqual([
      'nonfoil',
      'foil',
    ])
  })

  test('filters out unknown finish strings', () => {
    expect(printingFinishes(makeScryfallCard({ finishes: ['nonfoil', 'glossy'] }))).toEqual([
      'nonfoil',
    ])
  })

  test('falls back to nonfoil when no usable finish data exists', () => {
    expect(printingFinishes(makeScryfallCard({ finishes: [] }))).toEqual(['nonfoil'])
  })
})

describe('defaultPrintingFinish', () => {
  test('prefers nonfoil wherever it appears in the list', () => {
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: ['nonfoil', 'foil'] }))).toBe(
      'nonfoil',
    )
    // Order-independence is the whole point of the rule: taking the first finish
    // would answer 'foil' here.
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: ['foil', 'nonfoil'] }))).toBe(
      'nonfoil',
    )
  })

  test('falls back to the first finish for foil-only and etched-only printings', () => {
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: ['foil'] }))).toBe('foil')
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: ['etched', 'foil'] }))).toBe('etched')
  })

  test('falls back to nonfoil when the printing lists no usable finishes', () => {
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: [] }))).toBe('nonfoil')
    expect(defaultPrintingFinish(makeScryfallCard({ finishes: ['glossy'] }))).toBe('nonfoil')
  })
})

/**
 * The one answer to "what finish is this copy?" for every caller (pricing, the
 * sync diff, buylist quote keys, the copies filter). Callers that disagree ask
 * for a card under one key and look it up under another, so each branch — and
 * the order they are tried in — is pinned here rather than per call site.
 */
describe('displayFinish', () => {
  test("a stated finish wins, even one the printing doesn't offer", () => {
    // The nonfoil-only printing is the point: an implementation that validated
    // the stated finish against the printing would answer 'nonfoil' here. The
    // entry records what the owner physically has, and Scryfall's finish list
    // does not overrule it.
    expect(displayFinish(makeScryfallCard({ finishes: ['nonfoil'] }), 'foil')).toBe('foil')
    // A stated finish is consulted before the printing is, so it survives having
    // no printing at all — the only case that pins that branch order.
    expect(displayFinish(null, 'etched')).toBe('etched')
  })

  test("an unstated finish takes the printing's default", () => {
    // Foil-only, so a hardcoded 'nonfoil' fails: this pins the delegation to
    // `defaultPrintingFinish`, whose own cases are covered above.
    expect(displayFinish(makeScryfallCard({ finishes: ['foil'] }), undefined)).toBe('foil')
  })

  test('an unstated finish with no printing to ask is nonfoil', () => {
    // null and undefined are the same case: lookups return one or the other.
    expect(displayFinish(null, undefined)).toBe('nonfoil')
    expect(displayFinish(undefined, undefined)).toBe('nonfoil')
  })
})

/**
 * The one place the `NONE` condition-clear sentinel is interpreted, shared by
 * every apply path (`set-card`, the editor engines, the admin save).
 */
describe('applyConditionUpdate', () => {
  test('an absent update leaves the current grade alone', () => {
    expect(applyConditionUpdate(undefined, 'LP')).toBe('LP')
    expect(applyConditionUpdate(undefined, undefined)).toBeUndefined()
  })

  test('a grade replaces the current one', () => {
    expect(applyConditionUpdate('MP', 'LP')).toBe('MP')
    expect(applyConditionUpdate('NM', undefined)).toBe('NM')
  })

  test("'NONE' clears the recorded grade", () => {
    expect(applyConditionUpdate('NONE', 'LP')).toBeUndefined()
  })

  test('an unrecognized value that crossed a wire boundary clears rather than being written through', () => {
    // The parameter type rejects this at compile time; the cast stands in for a
    // value that arrived as untyped JSON from the admin API or an MCP client.
    expect(applyConditionUpdate('MINT' as ConditionUpdate, 'LP')).toBeUndefined()
  })
})
