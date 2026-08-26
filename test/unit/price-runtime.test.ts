import { describe, expect, test } from 'bun:test'
import { priceLookupFor } from '../../src/pricing/price-runtime'
import { REFRESH_MODES, type RefreshMode } from '../../src/cache/refresh'
import { getCachedCardPrintings, getCardPrintings } from '../../src/scryfall'

/**
 * Which printings lookup a price run binds. Asserted by identity rather than by
 * behavior: offline the two lookups return the same nothing, and the difference
 * that matters — one makes a per-card request, the other cannot — is only
 * observable as wall-clock time.
 */
describe('priceLookupFor', () => {
  test('never uses the cache-only lookup, so no uncached name is fetched', () => {
    expect(priceLookupFor('never')).toBe(getCachedCardPrintings)
  })

  test.each(REFRESH_MODES.filter((mode) => mode !== 'never'))(
    '%s keeps the network-backed lookup',
    (mode: RefreshMode) => {
      expect(priceLookupFor(mode)).toBe(getCardPrintings)
    },
  )

  test('no mode keeps the network lookup — the admin and MCP callers pass none', () => {
    expect(priceLookupFor(undefined)).toBe(getCardPrintings)
  })
})
