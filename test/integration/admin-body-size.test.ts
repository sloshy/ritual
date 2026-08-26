import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import type { Card } from '../../src/card/card'
import type { DeckData } from '../../src/list/deck'
import { createSetPrintingChange, type ChangeEvent } from '../../src/changes/change-event'
import { handleDeckSave } from '../../src/admin/api/deck-save'
import { handleCollectionSave } from '../../src/admin/api/collection-save'
import { handleWantedListSave } from '../../src/admin/api/wanted-save'
import { handleLogin } from '../../src/admin/api/auth-login'
import { validateBodySize } from '../../src/admin/api/save-helpers'
import { computeHash } from '../../src/changes/content-hash'
import { MAX_BODY_SIZE, MAX_LIST_BODY_SIZE } from '../../src/admin/validation'
import {
  bindWorkspace,
  snapshotTree,
  writeDeckFile,
  type BoundWorkspace,
} from './helpers/workspace'

/**
 * The request-body cap is split in two: routes whose body scales with a list get
 * a large budget, credential routes keep the tight one. The split exists because
 * re-pinning the printing of every card in a deck is one ordinary edit whose
 * save runs an order of magnitude past the credential-sized cap — it used to
 * come back as a bare "Request body too large".
 *
 * These requests set `Content-Length` themselves. A `Request` built in-process
 * has none (the header is added by the HTTP client, and the handlers read the
 * header rather than measuring the body), so a test that omits it exercises no
 * cap at all and passes whatever the limit is set to.
 */

const CARD_COUNT = 100

let ws: BoundWorkspace
let filePath: string
let contentHash: string

/** POST `body` with the `Content-Length` a real client would have sent. */
function post(url: string, body: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
  })
}

/** A deck card that definitely names a printing, so the fixture needs no assertions. */
type PinnedCard = Card & { collectorNumber: string }

/** A deck of distinctly-named cards, every one pinned to a printing in `set`. */
function deckCards(set: string): PinnedCard[] {
  return Array.from({ length: CARD_COUNT }, (_, i) => ({
    name: `Test Card ${i + 1}`,
    quantity: 1,
    set,
    collectorNumber: String(i + 1),
    cardId: i + 1,
  }))
}

function deckPayload(set: string): DeckData {
  return { name: 'Big Deck', sections: [{ name: 'Main', cards: deckCards(set) }] }
}

/** One set-printing change per card — what "re-pin every printing" actually sends. */
function repinEveryCard(): ChangeEvent[] {
  return deckCards('m10').map((card) =>
    createSetPrintingChange(card.name, {
      set: 'm10',
      collectorNumber: card.collectorNumber,
      cardId: card.cardId,
    }),
  )
}

function saveBody(changes: ChangeEvent[], deck: DeckData): string {
  return JSON.stringify({ changes, deck, frontMatter: { name: 'Big Deck' }, contentHash })
}

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  filePath = await writeDeckFile(ws.dir, 'big-deck', {
    frontMatter: { name: 'Big Deck' },
    cards: deckCards('lea'),
  })
  contentHash = computeHash(await fs.readFile(filePath, 'utf-8'))
})

afterEach(async () => {
  await ws.dispose()
})

describe('admin request-body cap', () => {
  test('a save re-pinning every card in the deck is accepted, not refused as too large', async () => {
    const body = saveBody(repinEveryCard(), deckPayload('m10'))
    // The premise: this is one ordinary edit that the credential-sized cap refused.
    // Asserted through the gate itself, not just on the byte count — if the
    // request ever stopped carrying its `Content-Length`, no cap would be
    // consulted and this test would keep passing at any limit.
    expect(Buffer.byteLength(body)).toBeGreaterThan(MAX_BODY_SIZE)
    expect(
      validateBodySize(post('http://localhost/api/deck/big-deck/save', body), MAX_BODY_SIZE)
        ?.status,
    ).toBe(413)

    const resp = await handleDeckSave(post('http://localhost/api/deck/big-deck/save', body))
    expect(resp.status).toBe(200)

    // The write really happened — a 200 that saved nothing would pass a status check.
    const saved = await fs.readFile(filePath, 'utf-8')
    expect(saved).toContain('1 Test Card 1 (M10:1) &1')
    expect(saved).toContain(`1 Test Card ${CARD_COUNT} (M10:${CARD_COUNT}) &${CARD_COUNT}`)
  })

  test('the larger cap is still a cap — a body past it is refused and writes nothing', async () => {
    const before = await snapshotTree(ws.dir)
    // Inert padding: the body is refused in the route prologue before it is ever
    // parsed, so which field carries the bulk is arbitrary. Sized off the
    // constant so the test cannot rot if the budget is retuned — which does mean
    // its cost scales with the budget.
    const body = JSON.stringify({
      changes: [],
      deck: deckPayload('lea'),
      frontMatter: { name: 'Big Deck', description: 'x'.repeat(MAX_LIST_BODY_SIZE) },
      contentHash,
    })

    const resp = await handleDeckSave(post('http://localhost/api/deck/big-deck/save', body))
    expect(resp.status).toBe(413)
    // The whole tree, not just the list file: a refusal that still appended a
    // changelog entry or refreshed a `.sha256` sidecar would pass a file check.
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })

  // The regression this guards is silent: `validateBodySize`'s `maxBytes`
  // defaults to MAX_BODY_SIZE, so a list route that forgets to pass the larger
  // constant reverts to the credential cap with no type error. Each handler is
  // asked for a body over the credential cap but under the list one, and must
  // reach its *next* gate (a 400 for the empty payload) rather than refuse it.
  test.each([
    ['deck', handleDeckSave, 'http://localhost/api/deck/big-deck/save'],
    ['collection', handleCollectionSave, 'http://localhost/api/collection/binder/save'],
    ['wanted', handleWantedListSave, 'http://localhost/api/wanted/wishlist/save'],
  ])(
    'the %s save route is on the list cap, not the credential cap',
    async (_label, handler, url) => {
      const req = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(MAX_BODY_SIZE + 1),
        },
        body: '{}',
      })

      expect((await handler(req)).status).toBe(400)
    },
  )

  // Executable documentation of the cap's one real limitation, so that switching
  // to measuring the body — which would be a behavior change for the MCP
  // dispatcher and every in-process caller, not just a hardening — fails here
  // and gets decided deliberately rather than discovered.
  test('a request that declares no size is not capped at all', () => {
    const oversized = JSON.stringify({ pad: 'x'.repeat(MAX_LIST_BODY_SIZE) })
    const req = new Request('http://localhost/api/deck/big-deck/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversized,
    })

    expect(req.headers.get('Content-Length')).toBeNull()
    expect(validateBodySize(req, MAX_BODY_SIZE)).toBeNull()
  })

  // A header that is present but unparseable must not read as "fits".
  test('a malformed declared size is refused', () => {
    const req = new Request('http://localhost/api/deck/big-deck/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': 'lots' },
      body: '{}',
    })

    expect(validateBodySize(req, MAX_BODY_SIZE)?.status).toBe(413)
  })

  test('a credential route keeps the tight cap', async () => {
    const body = JSON.stringify({ username: 'admin', password: 'x'.repeat(MAX_BODY_SIZE) })
    // An address no other suite locks out: `handleLogin` consults the global
    // rate limiter before the size cap, and that limiter is process-wide.
    const resp = await handleLogin(post('http://localhost/api/login', body), '10.99.0.1')

    expect(resp.status).toBe(413)
  })
})
