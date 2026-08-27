import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Card } from '../../src/card/card'
import type { DeckData } from '../../src/list/deck'
import { createSetLanguageChange, type ChangeEvent } from '../../src/changes/change-event'
import { handleDeckSave } from '../../src/admin/api/deck-save'
import type { ListSaveResponse } from '../../src/admin/api/list-save'
import { computeHash } from '../../src/changes/content-hash'
import { bindWorkspace, writeDeckFile, type BoundWorkspace } from './helpers/workspace'

/**
 * The deck save route's language wiring: a `set-language` change round-trips
 * into the `[ja]` line token, the changelog line, and an `updated` effect, and
 * an unknown code on the unvalidated wire is refused before anything is
 * written. Apply/serialize semantics are pinned by the unit layers; this covers
 * the handler boundary (`normalizeRequestLanguages`).
 *
 * Plus the route's other baseline judgement call: which leftover content in the
 * file on disk refuses the save, and which the save is allowed to clear.
 */

let ws: BoundWorkspace
let filePath: string
let contentHash: string

/** A deck card as the unvalidated wire carries it: `language` deliberately un-narrowed. */
type WireDeckCard = Omit<Card, 'language'> & { language?: string }

/** One wire section of {@link WireDeck}. */
type WireDeckSection = { name: string; cards: WireDeckCard[] }

/** The deck payload as the client posts it — the handler is what validates it. */
type WireDeck = Omit<DeckData, 'sections'> & { sections: WireDeckSection[] }

/** The deck as the client would send it after applying a set-language to &1. */
function deckWithLanguage(language?: string): WireDeck {
  return {
    name: 'Burn',
    sections: [
      {
        name: 'Main',
        cards: [
          {
            name: 'Lightning Bolt',
            quantity: 2,
            set: 'lea',
            collectorNumber: '161',
            cardId: 1,
            ...(language !== undefined ? { language } : {}),
          },
        ],
      },
    ],
  }
}

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  filePath = await writeDeckFile(ws.dir, 'burn', {
    frontMatter: { name: 'Burn' },
    cards: [{ name: 'Lightning Bolt', quantity: 2, set: 'lea', collectorNumber: '161', cardId: 1 }],
  })
  contentHash = computeHash(await fs.readFile(filePath, 'utf-8'))
})

afterEach(async () => {
  await ws.dispose()
})

function save(changes: ChangeEvent[], deck: WireDeck): Promise<Response> {
  const req = new Request('http://localhost/api/deck/burn/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes, deck, frontMatter: { name: 'Burn' }, contentHash }),
  })
  return handleDeckSave(req)
}

describe('POST /api/deck/:slug/save — languages', () => {
  test('set-language writes the [ja] token, the changelog line, and an updated effect', async () => {
    const resp = await save(
      [createSetLanguageChange('Lightning Bolt', { language: 'ja', cardId: 1 })],
      deckWithLanguage('ja'),
    )
    expect(resp.status).toBe(200)

    expect(await fs.readFile(filePath, 'utf-8')).toContain('2 Lightning Bolt (LEA:161) [ja] &1')

    const changelog = await fs.readFile(path.join(ws.dir, 'decks', 'burn.changes.md'), 'utf-8')
    expect(changelog).toContain('- Set language of "Lightning Bolt" to Japanese &1')

    const body = (await resp.json()) as ListSaveResponse
    expect(body.effects).toHaveLength(1)
    expect(body.effects[0]).toMatchObject({
      action: 'updated',
      cardId: 1,
      name: 'Lightning Bolt',
    })
  })

  // The route's one 400 case: the full validation matrix (normalization,
  // missing-language, the entry-side refusal) is pinned on
  // `normalizeRequestLanguages` in test/unit/admin/save-helpers.test.ts; this
  // proves the route wires the validator — over both the change list and the
  // serialized deck entries — in front of its write.
  test('an unknown language code is a 400 that writes nothing', async () => {
    const before = await fs.readFile(filePath, 'utf-8')
    const resp = await save(
      [
        {
          id: 'x',
          timestamp: 0,
          action: 'set-language',
          cardName: 'Lightning Bolt',
          cardId: 1,
          // Not a Scryfall code — the cast is the point: the wire is unvalidated.
          language: 'xx',
        } as unknown as ChangeEvent,
      ],
      deckWithLanguage('xx'),
    )
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.success).toBe(false)
    expect(body.message).toContain('"xx"')
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
    expect(await fs.exists(path.join(ws.dir, 'decks', 'burn.changes.md'))).toBe(false)
  })
})

describe('POST /api/deck/:slug/save — labels', () => {
  /** The deck as the client sends it with a label override on &1 (wire = unvalidated). */
  function deckWithLabels(labels: string[]): WireDeck {
    const deck = deckWithLanguage()
    return {
      ...deck,
      sections: [{ name: 'Main', cards: [{ ...deck.sections[0]!.cards[0]!, labels }] }],
    } as WireDeck
  }

  test('a set-label change writes the [proxy] token and its changelog line', async () => {
    const resp = await save(
      [
        {
          id: 'l1',
          timestamp: 0,
          action: 'set-label',
          cardName: 'Lightning Bolt',
          cardId: 1,
          labels: ['proxy'],
        },
      ],
      deckWithLabels(['proxy']),
    )
    expect(resp.status).toBe(200)
    expect(await fs.readFile(filePath, 'utf-8')).toContain('2 Lightning Bolt (LEA:161) [proxy] &1')

    const changelog = await fs.readFile(path.join(ws.dir, 'decks', 'burn.changes.md'), 'utf-8')
    expect(changelog).toContain('- Set labels on "Lightning Bolt" &1 to [proxy]')
  })

  test('a label a deck cannot carry is a 400 that writes nothing', async () => {
    const before = await fs.readFile(filePath, 'utf-8')
    const resp = await save([], deckWithLabels(['sale']))
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as { success: boolean; message: string }
    expect(body.message).toContain('labels [sale] are not supported on a deck')
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
  })
})

describe('POST /api/deck/:slug/save — empty extras sections', () => {
  /** Append `header` to the deck on disk and re-hash, as a hand edit would leave it. */
  async function appendHeader(header: string): Promise<void> {
    await fs.writeFile(filePath, `${await fs.readFile(filePath, 'utf-8')}\n${header}\n`)
    contentHash = computeHash(await fs.readFile(filePath, 'utf-8'))
  }

  test('a baseline carrying a bare ## Maybeboard saves, and the write clears it', async () => {
    // The whole-file save refuses a baseline whose content it cannot re-emit.
    // An empty extras header is not such content — it holds nothing — so the
    // save goes through and the header is gone afterwards.
    await appendHeader('## Maybeboard')

    const resp = await save([], deckWithLanguage())

    expect(resp.status).toBe(200)
    expect(await fs.readFile(filePath, 'utf-8')).not.toContain('Maybeboard')
  })

  test('a baseline carrying a bare ## Sideboard is still refused', async () => {
    // The control: emptiness alone does not make a header droppable, and a
    // sideboard the user typed ahead of filling it must not vanish on save.
    await appendHeader('## Sideboard')
    const before = await fs.readFile(filePath, 'utf-8')

    const resp = await save([], deckWithLanguage())

    expect(resp.status).toBe(400)
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
  })
})
