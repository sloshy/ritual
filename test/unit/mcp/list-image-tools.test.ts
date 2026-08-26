import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CallToolResult, Client } from '@modelcontextprotocol/client'
import type { ListImageRef } from '../../../src/list/list-image'
import { MCP_TOOL_NAMES } from '../../../src/mcp/tools/names'
import { setupMcpClient, type McpTestSession } from './harness'
import { expectSchemaRejection, toolData, toolError } from '../../mcp-test-utils'

/**
 * Wiring-only coverage for a list's cover image over MCP, per the test layering
 * policy: the `image:` grammar is pinned on the engine
 * (test/unit/list-image.test.ts) and every route refusal on the handler
 * (test/integration/list-image-api.test.ts). What belongs here is that
 * `set_list_metadata` accepts the field at all, that its schema refuses a body
 * the route would have to, and that one happy path reaches the file and comes
 * back out of `get_list` — which is the wiring the four modes travel on.
 */

/** `set_list_metadata`'s result, as an agent reads it. */
type MetadataResult = { slug: string; frontMatter: Record<string, unknown> }

/** A `get_list` cards view, projected down to what cover coverage reads. */
type ListView = { image?: ListImageRef; warnings: string[] }

describe('list cover images over MCP', () => {
  let session: McpTestSession
  let client: Client

  beforeEach(async () => {
    session = await setupMcpClient('list-image-tools-test')
    client = session.client
  })

  afterEach(async () => {
    await session.close()
  })

  async function setImage(listType: string, slug: string, image: unknown): Promise<CallToolResult> {
    return await client.callTool({
      name: 'set_list_metadata',
      arguments: { listType, slug, image },
    })
  }

  async function getList(listType: string, slug: string): Promise<ListView> {
    return toolData<ListView>(
      await client.callTool({
        name: 'get_list',
        arguments: { listType, slug, view: 'cards' },
      }),
    )
  }

  test('set_list_metadata is registered and writes a card cover a get_list reads back', async () => {
    // The one happy path: the deck fixture's `&1` is its commander line.
    const result = await setImage('deck', 'test-deck', { card: 1 })
    const data = toolData<MetadataResult>(result)
    expect(data.frontMatter.image).toEqual({ card: 1 })

    const file = await fs.readFile(path.join(session.env.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(file).toContain('image:\n  card: 1')
    // Card lines are untouched by a front-matter write.
    expect(file).toContain('1 Sol Ring &1')

    expect((await getList('deck', 'test-deck')).image).toEqual({ card: 1 })
  })

  test('null clears the cover back to the built-in rule', async () => {
    await setImage('deck', 'test-deck', { url: 'https://example.com/cover.png' })
    const cleared = toolData<MetadataResult>(await setImage('deck', 'test-deck', null))
    expect(cleared.frontMatter.image).toBeUndefined()
    expect((await getList('deck', 'test-deck')).image).toBeUndefined()
  })

  test('a wanted list takes the cover the tool no longer claims it cannot have', async () => {
    const data = toolData<MetadataResult>(
      await setImage('wanted', 'wishlist', { file: 'alters/wishlist.png' }),
    )
    expect(data.frontMatter.image).toEqual({ file: 'alters/wishlist.png' })
    expect((await getList('wanted', 'wishlist')).image).toEqual({ file: 'alters/wishlist.png' })
  })

  test('the schema refuses a scalar, a zero id, and two modes at once', async () => {
    expectSchemaRejection(await setImage('deck', 'test-deck', '&12'), /image/)
    expectSchemaRejection(await setImage('deck', 'test-deck', { card: 0 }), /image/)
    expectSchemaRejection(await setImage('deck', 'test-deck', { card: 1, file: 'x.png' }), /image/)
  })

  test('a card id the list does not carry is the route’s 400, not a schema rejection', async () => {
    const payload = toolError(await setImage('deck', 'test-deck', { card: 99 }))
    expect(payload.message).toContain('&99')
  })

  test('the cover is written through the existing metadata tool', () => {
    expect(MCP_TOOL_NAMES).toContain('set_list_metadata')
  })
})
