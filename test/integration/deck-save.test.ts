import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Card, DeckData } from '../../src/types'
import { createSetLanguageChange, type ChangeEvent } from '../../src/change-event'
import { handleDeckSave } from '../../src/admin/api/deck-save'
import type { ListSaveResponse } from '../../src/admin/api/move-save'
import { computeHash } from '../../src/content-hash'
import { bindWorkspace, writeDeckFile, type BoundWorkspace } from './helpers/workspace'

/**
 * The deck save route's language wiring: a `set-language` change round-trips
 * into the `[ja]` line token, the changelog line, and an `updated` effect, and
 * an unknown code on the unvalidated wire is refused before anything is
 * written. Apply/serialize semantics are pinned by the unit layers; this covers
 * the handler boundary (`normalizeRequestLanguages`).
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
