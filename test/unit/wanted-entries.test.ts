import { describe, expect, test } from 'bun:test'
import { toWantedCardEntries, type ParsedWantedEntry } from '../../src/editor/wanted-entries'

describe('toWantedCardEntries', () => {
  test('carries the language token through to the card-entry shape', () => {
    const parsed: ParsedWantedEntry[] = [
      { name: 'Shock', set: 'm21', collectorNumber: '159', language: 'ja' },
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263' },
    ]
    const entries = toWantedCardEntries(parsed)
    expect(entries[0]!.language).toBe('ja')
    // A bare line stays bare: no `en` is synthesized on the way through.
    expect(entries[1]!.language).toBeUndefined()
  })
})
