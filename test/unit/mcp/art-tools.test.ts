import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/client'
import type { CardArtRef } from '../../../src/card-art'
import { setupMcpClient, type McpTestSession } from './harness'
import { expectSchemaRejection, toolData, toolError } from '../../mcp-test-utils'

/**
 * Wiring-only coverage for `set_card_art`, per the test layering policy: the
 * reference grammar is pinned on the engine (test/unit/card-art.test.ts) and
 * every route refusal on the handler (test/integration/admin-art.test.ts). What
 * belongs here is that the tool exists, that its schema refuses a body the route
 * would have to, and that one happy path reaches the sidecar and comes back out
 * of `get_list`.
 */

/** `set_card_art`'s result, as an agent reads it. */
type ArtResult = { slug: string; cardId: number; art: CardArtRef | null }

/** A `get_list` cards view, projected down to what art coverage reads. */
type ListView = {
  customArt?: Record<string, CardArtRef>
  labels?: string[]
  warnings: string[]
  artWarnings?: string[]
}

describe('set_card_art over MCP', () => {
  let session: McpTestSession
  let client: Client

  beforeEach(async () => {
    session = await setupMcpClient('art-tools-test')
    client = session.client
  })

  afterEach(async () => {
    await session.close()
  })

  /** Path of the deck's art sidecar in the throwaway workspace. */
  function sidecarPath(): string {
    return path.join(session.env.dir, 'decks', 'test-deck.art.json')
  }

  async function getDeck(): Promise<ListView> {
    return toolData<ListView>(
      await client.callTool({
        name: 'get_list',
        arguments: { listType: 'deck', slug: 'test-deck', view: 'cards' },
      }),
    )
  }

  test('records a file reference, reports it back, and clears it again', async () => {
    // The file must already exist under artDir — the route refuses a reference
    // with nothing behind it, and that refusal is what makes this leg real.
    await fs.mkdir(path.join(session.env.dir, 'art', 'proxies'), { recursive: true })
    await fs.writeFile(path.join(session.env.dir, 'art', 'proxies', 'sol-ring.jpg'), 'jpeg')

    const set = toolData<ArtResult>(
      await client.callTool({
        name: 'set_card_art',
        arguments: {
          listType: 'deck',
          slug: 'test-deck',
          cardId: 1,
          art: { file: 'proxies/sol-ring.jpg' },
        },
      }),
    )
    expect(set).toMatchObject({
      slug: 'test-deck',
      cardId: 1,
      art: { file: 'proxies/sol-ring.jpg' },
    })
    expect(JSON.parse(await fs.readFile(sidecarPath(), 'utf-8'))).toEqual({
      '1': { file: 'proxies/sol-ring.jpg' },
    })
    // The read side projects the raw reference back, keyed by the card's &N.
    expect((await getDeck()).customArt).toEqual({ '1': { file: 'proxies/sol-ring.jpg' } })

    const cleared = toolData<ArtResult>(
      await client.callTool({
        name: 'set_card_art',
        arguments: { listType: 'deck', slug: 'test-deck', cardId: 1, art: null },
      }),
    )
    expect(cleared.art).toBeNull()
    // The last entry going means the sidecar goes with it, not an empty object.
    expect(await Bun.file(sidecarPath()).exists()).toBe(false)
    expect((await getDeck()).customArt).toBeUndefined()
  })

  test('records a URL reference on a collection entry', async () => {
    await fs.writeFile(
      path.join(session.env.dir, 'collections', 'shoebox.md'),
      '# Shoebox\n\n- Sol Ring (LEA:270) &1\n',
    )
    const result = toolData<ArtResult>(
      await client.callTool({
        name: 'set_card_art',
        arguments: {
          listType: 'collection',
          slug: 'shoebox',
          cardId: 1,
          art: { url: 'https://example.com/art/sol-ring.png' },
        },
      }),
    )
    expect(result.art).toEqual({ url: 'https://example.com/art/sol-ring.png' })
  })

  test('the schema refuses a malformed reference and a card id that is not an &N', async () => {
    // Neither arm of the union matches an empty object, so the agent hears it
    // here rather than writing an entry the sidecar parser would reject.
    expectSchemaRejection(
      await client.callTool({
        name: 'set_card_art',
        arguments: { listType: 'deck', slug: 'test-deck', cardId: 1, art: {} },
      }),
      /art/,
    )
    // Both keys at once is the case the strict arms exist for: without them one
    // would be silently dropped instead of refused, and the route refuses it.
    expectSchemaRejection(
      await client.callTool({
        name: 'set_card_art',
        arguments: {
          listType: 'deck',
          slug: 'test-deck',
          cardId: 1,
          art: { file: 'a.jpg', url: 'https://example.com/a.png' },
        },
      }),
      /art/,
    )
    expectSchemaRejection(
      await client.callTool({
        name: 'set_card_art',
        arguments: { listType: 'deck', slug: 'test-deck', cardId: 1, art: { url: 'not-a-url' } },
      }),
      /art/,
    )
    // `art` is required, not optional: omitting it must not read as a clear.
    expectSchemaRejection(
      await client.callTool({
        name: 'set_card_art',
        arguments: { listType: 'deck', slug: 'test-deck', cardId: 1 },
      }),
      /art/,
    )
    // The card is addressed by &N alone, so the id is required and positive.
    expectSchemaRejection(
      await client.callTool({
        name: 'set_card_art',
        arguments: { listType: 'deck', slug: 'test-deck', cardId: 0, art: null },
      }),
      /cardId/,
    )
  })

  test('a broken sidecar reaches the agent as artWarnings, never as warnings', async () => {
    await fs.writeFile(sidecarPath(), '{ not json')

    const deck = await getDeck()

    expect((deck.artWarnings ?? []).join('\n')).toContain('not valid JSON')
    // `warnings` promises unreadable card lines, and a mutation refuses a list
    // that has any — bad art must never be mistaken for that.
    expect(deck.warnings).toEqual([])
    expect(deck.customArt).toBeUndefined()
  })

  test('a card the list does not hold is a tool error, and writes nothing', async () => {
    const error = toolError(
      await client.callTool({
        name: 'set_card_art',
        arguments: {
          listType: 'deck',
          slug: 'test-deck',
          cardId: 99,
          art: { url: 'https://example.com/a.png' },
        },
      }),
    )
    expect(error.message).toContain('99')
    expect(await Bun.file(sidecarPath()).exists()).toBe(false)
  })
})
