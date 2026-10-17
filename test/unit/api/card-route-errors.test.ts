import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  AUTOCOMPLETE_TOOL,
  handleCardDetails,
  type CardDetailsFailure,
} from '../../../src/api/card-details'
import { MCP_TOOL_NAMES } from '../../../src/mcp/tools/names'
import {
  clearCacheServerAddressOverride,
  setCacheServerAddressOverride,
} from '../../../src/cache/config'
import { keyedMessage } from '../../helpers/api-message'
import { stubFetch, type StubbedFetch } from '../../helpers/stub-fetch'
import { withSyntheticLocaleAsync } from '../../helpers/sync-text'
import { syncMessage, SyncMessageError } from '../../../src/sync/message'

/**
 * A card route whose lookup fails inside the cache layer — here a remote cache
 * server (`--cache-server`) answering 500 — answers like every other route: in
 * English plus the key, never in the server's own UI language. MCP
 * (`get_card_details`) and both sites read this body.
 */
describe('card routes behind a failing cache server', () => {
  let stubbed: StubbedFetch

  beforeEach(() => {
    setCacheServerAddressOverride('http://cache.test:4000')
    stubbed = stubFetch({
      'http://cache.test:4000/': () => new Response('boom', { status: 500 }),
    })
  })

  afterEach(() => {
    stubbed.restore()
    clearCacheServerAddressOverride()
  })

  test('card details answers the cache error in English with its key', async () => {
    const resp = await withSyntheticLocaleAsync(
      'xx',
      { 'domain.cache.serverRequestFailedWithBody': 'CACHE KAPUTT {status}' },
      async () => {
        // Vacuity guard: this process words the cache error in the synthetic language.
        const local = new SyncMessageError(
          syncMessage('domain.cache.serverRequestFailedWithBody', {
            status: 500,
            method: 'GET',
            url: 'u',
            body: 'b',
          }),
        )
        expect(local.message).toBe('CACHE KAPUTT 500')
        return handleCardDetails(new Request('http://localhost/api/card-details?name=Sol%20Ring'))
      },
    )

    expect(resp.status).toBe(500)
    const body = (await resp.json()) as CardDetailsFailure
    expect(body.card).toBeNull()
    expect(body.messageKey).toBe('domain.cache.serverRequestFailedWithBody')
    // English, and the same sentence its key re-renders to — not the synthetic text.
    expect(keyedMessage(body)).toStartWith(
      'Cache server request failed (500) GET http://cache.test:4000/',
    )
    expect(body.message).toEndWith(': boom')
  })
})

// An unknown name's refusal tells the reader which MCP tool resolves a partial
// name; a rename of that tool must not leave the pointer stale.
test('card details points at an MCP tool the server registers', () => {
  expect<readonly string[]>(MCP_TOOL_NAMES).toContain(AUTOCOMPLETE_TOOL)
})
