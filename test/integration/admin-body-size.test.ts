import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Card } from '../../src/card/card'
import { createSetPrintingChange } from '../../src/changes/change-event'
import { toWireChange, type WireChange } from '../../src/changes/wire-changes'
import { handleListSave } from '../../src/admin/api/list-save'
import { handleLogin } from '../../src/admin/api/auth-login'
import { MAX_BODY_SIZE, type ApiErrorResponse } from '../../src/api/http'
import { MAX_PRICE_BODY_BYTES } from '../../src/api/card-prices'
import { MAX_EDIT_BODY_SIZE } from '../../src/admin/validation'
import { MAX_SITE_REQUEST_BODY_SIZE, startSiteServer } from '../../src/serve/server'
import type { StaticSiteServer } from '../../src/serve/static'
import {
  bindWorkspace,
  snapshotTree,
  writeDeckFile,
  type BoundWorkspace,
} from '../helpers/workspace'
import { hashOf, listSaveRequest } from '../helpers/list-save'

/**
 * Request-body budgets on the routes that hold them. Each route measures its
 * body as it reads it (`readBodyText`), so the budget holds whatever the
 * request declares — including no size at all, which is what a chunked upload
 * and every in-process caller (the MCP dispatcher, `import-changes`) send. The
 * reader's own cases (malformed and boundary sizes, cancelling the stream) are
 * pinned in test/unit/api/http.test.ts; this file pins which budget each route
 * is on, and the servers' runtime ceiling over real HTTP.
 */

const CARD_COUNT = 150
const SAVE_URL = 'http://localhost/api/deck/big-deck/save'

let ws: BoundWorkspace
let filePath: string

/** A deck card that definitely names a printing, so the fixture needs no assertions. */
type PinnedCard = Card & { collectorNumber: string; cardId: number }

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

/** One set-printing change per card — what "re-pin every printing" sends. */
function repinEveryCard(): WireChange[] {
  return deckCards('m10').map((card) =>
    toWireChange(
      createSetPrintingChange(card.name, {
        set: 'm10',
        collectorNumber: card.collectorNumber,
        cardId: card.cardId,
      }),
    ),
  )
}

/**
 * An endless body of `x` bytes, streamed with no declared size. Only a reader
 * that counts what it reads can ever finish with it.
 */
function endlessBody(): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(64 * 1024).fill(0x78)
  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      controller.enqueue(chunk)
    },
  })
}

/** A finite stream of `bytes` bytes, so `fetch` sends it chunked. */
function chunkedBody(bytes: number): ReadableStream<Uint8Array> {
  const chunkSize = 64 * 1024
  let sent = 0
  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (sent >= bytes) {
        controller.close()
        return
      }
      const size = Math.min(chunkSize, bytes - sent)
      controller.enqueue(new Uint8Array(size).fill(0x78))
      sent += size
    },
  })
}

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  filePath = await writeDeckFile(ws.dir, 'big-deck', { name: 'Big Deck', cards: deckCards('lea') })
})

afterEach(async () => {
  await ws.dispose()
})

describe('admin request-body budgets', () => {
  // A save rides on the edit budget, not the credential-sized default: a route
  // that forgot to pass its budget would refuse this ordinary edit as too large.
  test('a save re-pinning every card in the deck is accepted, not refused as too large', async () => {
    const req = listSaveRequest('deck', 'big-deck', repinEveryCard(), {
      contentHash: await hashOf(filePath),
    })
    // The premise: the body really is past the default cap, which measures bytes.
    expect(Buffer.byteLength(await req.clone().text())).toBeGreaterThan(MAX_BODY_SIZE)

    const resp = await handleListSave(req, 'deck')
    expect(resp.status).toBe(200)

    // The write really happened — a 200 that saved nothing would pass a status check.
    const saved = await fs.readFile(filePath, 'utf-8')
    expect(saved).toContain('1 Test Card 1 (M10:1) &1')
    expect(saved).toContain(`1 Test Card ${CARD_COUNT} (M10:${CARD_COUNT}) &${CARD_COUNT}`)
  })

  // An undeclared body — a chunked upload, or any in-process caller's `Request`
  // — is counted as it arrives, so even one that never ends is refused once it
  // passes the budget.
  test('an endless body with no declared size is refused past the edit budget and writes nothing', async () => {
    const before = await snapshotTree(ws.dir)
    const req = new Request(SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: endlessBody(),
    })
    expect(req.headers.get('Content-Length')).toBeNull()

    const resp = await handleListSave(req, 'deck')

    expect(resp.status).toBe(413)
    expect(((await resp.json()) as ApiErrorResponse).message).toContain(
      `limit ${MAX_EDIT_BODY_SIZE} bytes`,
    )
    // The whole tree, not just the list file: a refusal that still appended a
    // changelog entry or refreshed a `.sha256` sidecar would pass a file check.
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })

  test('a credential route keeps the tight cap', async () => {
    // No declared size: the credential route measures too.
    const req = new Request('http://localhost/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'x'.repeat(MAX_BODY_SIZE) }),
    })
    // An address no other suite locks out: `handleLogin` consults the global
    // rate limiter before the size cap, and that limiter is process-wide.
    const resp = await handleLogin(req, '10.99.0.1')

    expect(resp.status).toBe(413)
    expect(((await resp.json()) as ApiErrorResponse).message).toContain(
      `limit ${MAX_BODY_SIZE} bytes`,
    )
  })
})

describe('server body ceiling', () => {
  let server: StaticSiteServer | undefined

  afterEach(async () => {
    await server?.stop(true)
    server = undefined
  })

  // The runtime ceiling (`maxRequestBodySize`) is a second line under the
  // per-route budgets. Over real HTTP: a chunked body (no `Content-Length`) on a
  // route that reads it meets the route's own budget first — the ceiling sits
  // just above the largest budget so the route answers with its JSON refusal —
  // and a declared body past the ceiling is refused by the runtime itself, on a
  // path whose handler never reads a body and would otherwise answer 200, which
  // only the ceiling can do.
  test('the hosted site server refuses oversized bodies, chunked or declared', async () => {
    const distDir = path.join(ws.dir, 'dist')
    await fs.mkdir(distDir, { recursive: true })
    await fs.writeFile(path.join(distDir, 'index.html'), '<!DOCTYPE html><title>Ritual</title>')
    server = startSiteServer({ port: 0, hostname: '127.0.0.1', distDir })
    const base = `http://127.0.0.1:${server.port}`

    const chunked = await fetch(`${base}/api/card-prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: chunkedBody(MAX_SITE_REQUEST_BODY_SIZE + 64 * 1024),
    })
    expect(chunked.status).toBe(413)
    // The route's refusal (its JSON envelope, naming its budget), not the
    // runtime's bare 413.
    expect(((await chunked.json()) as ApiErrorResponse).message).toContain(
      `limit ${MAX_PRICE_BODY_BYTES} bytes`,
    )

    const atCeiling = await fetch(`${base}/`, {
      method: 'POST',
      body: 'x'.repeat(MAX_SITE_REQUEST_BODY_SIZE),
    })
    expect(atCeiling.status).toBe(200)
    // Past the ceiling the runtime answers from the headers alone and may close
    // the connection while a client is still uploading, so this leg sends the
    // headers only, over a raw socket, and reads the status line back.
    expect(await statusForDeclaredBody(Number(server.port), MAX_SITE_REQUEST_BODY_SIZE + 1)).toBe(
      413,
    )
  })
})

/**
 * The status a server answers a POST that *declares* `contentLength` bytes,
 * sending no body: what a runtime ceiling decides on before reading anything.
 */
async function statusForDeclaredBody(port: number, contentLength: number): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>()
  let received = ''
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: {
      data(_socket, chunk) {
        received += new TextDecoder().decode(chunk)
        const status = /^HTTP\/1\.1 (\d{3})/.exec(received)
        if (status) resolve(Number(status[1]))
      },
      error(_socket, error) {
        reject(error)
      },
      close() {
        reject(new Error(`Connection closed before a status line: ${JSON.stringify(received)}`))
      },
    },
  })
  socket.write(`POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: ${contentLength}\r\n\r\n`)
  try {
    return await promise
  } finally {
    socket.end()
  }
}
