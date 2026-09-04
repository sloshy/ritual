import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import type { Client } from '@modelcontextprotocol/client'
import { cachedPrintingRef, setupMcpClient, shoeboxPath, type McpTestSession } from './harness'
import { expectSchemaRejection, toolData } from '../../mcp-test-utils'

/**
 * Wiring-only coverage for card tags across the MCP surface, per the test
 * layering policy: the tag grammar, canonical form and the apply engines are
 * pinned on the engine (test/unit/card-tags.test.ts and
 * test/unit/card-tag-changes.test.ts); what belongs here is that the tool
 * schemas accept the canonical shape and refuse everything else, and that a
 * tag round-trips through the in-process handlers onto the line and back out
 * of the projection.
 */

/** The shape refusal `cardTagSchema` emits for anything not canonical. */
const TAG_SHAPE_REFUSAL = /Not a canonical tag: a tag is non-empty plain text/

/** Seed the shoebox with the harness's cached Sol Ring, tagged `ramp`. */
async function seedTaggedCollection(session: McpTestSession): Promise<string> {
  const printingRef = await cachedPrintingRef('Sol Ring')
  await fs.writeFile(shoeboxPath(session), `# Shoebox\n\n- Sol Ring (${printingRef}) #ramp &1\n`)
  return printingRef
}

function readShoebox(session: McpTestSession): Promise<string> {
  return fs.readFile(shoeboxPath(session), 'utf-8')
}

describe('card tags over MCP', () => {
  let session: McpTestSession
  let client: Client

  beforeEach(async () => {
    session = await setupMcpClient('tag-tools-test')
    client = session.client
  })

  afterEach(async () => {
    await session.close()
  })

  test('apply_changes add-tag / remove-tag rewrite the line, and get_list reads it back', async () => {
    await seedTaggedCollection(session)
    const added = await client.callTool({
      name: 'apply_changes',
      arguments: {
        listType: 'collection',
        slug: 'shoebox',
        changes: [{ action: 'add-tag', cardName: 'Sol Ring', cardId: 1, tag: 'Binder Trade' }],
      },
    })
    expect(toolData<{ applied: number }>(added).applied).toBe(1)
    // Canonical order on the line: the serializer sorts, whatever order the
    // events arrived in.
    expect(await readShoebox(session)).toContain('#Binder Trade, ramp &1')

    const removed = await client.callTool({
      name: 'apply_changes',
      arguments: {
        listType: 'collection',
        slug: 'shoebox',
        changes: [{ action: 'remove-tag', cardName: 'Sol Ring', cardId: 1, tag: 'ramp' }],
      },
    })
    expect(toolData<{ applied: number }>(removed).applied).toBe(1)
    const content = await readShoebox(session)
    expect(content).toContain('#Binder Trade &1')
    expect(content).not.toContain('ramp')

    const list = toolData<{ entries: { tags?: string[] }[] }>(
      await client.callTool({
        name: 'get_list',
        arguments: { listType: 'collection', slug: 'shoebox', view: 'cards' },
      }),
    )
    expect(list.entries[0]!.tags).toEqual(['Binder Trade'])
  })

  test('add_card starts the new card with its tags', async () => {
    const printingRef = await seedTaggedCollection(session)
    const [set, collectorNumber] = printingRef.split(':')
    const result = await client.callTool({
      name: 'add_card',
      arguments: {
        listType: 'collection',
        slug: 'shoebox',
        cardName: 'Sol Ring',
        set,
        collectorNumber,
        tags: ['staple'],
      },
    })
    expect(toolData<{ applied: number }>(result).applied).toBe(1)
    expect(await readShoebox(session)).toContain(`- Sol Ring (${printingRef}) #staple &2`)
  })

  test('a tag keeps its case: "Ramp" beside "ramp" is a second tag, not a duplicate', async () => {
    await seedTaggedCollection(session)
    const result = await client.callTool({
      name: 'apply_changes',
      arguments: {
        listType: 'collection',
        slug: 'shoebox',
        changes: [{ action: 'add-tag', cardName: 'Sol Ring', cardId: 1, tag: 'Ramp' }],
      },
    })
    expect(toolData<{ applied: number }>(result).applied).toBe(1)
    expect(await readShoebox(session)).toContain('#ramp, Ramp &1')
  })

  test('apply_changes add carries tags onto the new line', async () => {
    const printingRef = await seedTaggedCollection(session)
    const [set, collectorNumber] = printingRef.split(':')
    const result = await client.callTool({
      name: 'apply_changes',
      arguments: {
        listType: 'collection',
        slug: 'shoebox',
        changes: [{ action: 'add', cardName: 'Sol Ring', set, collectorNumber, tags: ['edh'] }],
      },
    })
    expect(toolData<{ applied: number }>(result).applied).toBe(1)
    expect(await readShoebox(session)).toContain(`- Sol Ring (${printingRef}) #edh &2`)
  })

  test('the schemas refuse anything that is not a canonical tag', async () => {
    // The sigil, surrounding whitespace, and a forbidden character — the ways
    // a tag typed as prose differs from its stored form. An agent sends the
    // value, never the token. (The HTTP save routes canonicalize these instead
    // — see test/integration/collection-save.test.ts — because a browser
    // editor forwards what a person typed; an agent is held to the stored form.)
    for (const tag of ['#Ramp', ' Ramp', 'a,b']) {
      expectSchemaRejection(
        await client.callTool({
          name: 'apply_changes',
          arguments: {
            listType: 'collection',
            slug: 'shoebox',
            changes: [{ action: 'add-tag', cardName: 'Sol Ring', tag }],
          },
        }),
        TAG_SHAPE_REFUSAL,
      )
    }
    // A missing `tag` is a schema error, never a coerced "undefined".
    expectSchemaRejection(
      await client.callTool({
        name: 'apply_changes',
        arguments: {
          listType: 'collection',
          slug: 'shoebox',
          changes: [{ action: 'add-tag', cardName: 'Sol Ring' }],
        },
      }),
      /tag/,
    )
    expectSchemaRejection(
      await client.callTool({
        name: 'add_card',
        arguments: {
          listType: 'collection',
          slug: 'shoebox',
          cardName: 'Sol Ring',
          set: 'lea',
          collectorNumber: '1',
          tags: ['#ramp'],
        },
      }),
      TAG_SHAPE_REFUSAL,
    )
    // An add has no tag set to clear, so an empty `tags` is refused rather
    // than meaning "none" (omit the field for that).
    expectSchemaRejection(
      await client.callTool({
        name: 'add_card',
        arguments: {
          listType: 'collection',
          slug: 'shoebox',
          cardName: 'Sol Ring',
          set: 'lea',
          collectorNumber: '1',
          tags: [],
        },
      }),
      /tags/,
    )
  })

  test('export_cards filters.tags selects the tagged line', async () => {
    const printingRef = await seedTaggedCollection(session)
    await fs.appendFile(shoeboxPath(session), `- Mox Opal (${printingRef}) &2\n`)
    const result = await client.callTool({
      name: 'export_cards',
      arguments: {
        lists: [{ listType: 'collection', name: 'shoebox' }],
        filters: { tags: ['ramp'] },
        format: 'text',
      },
    })
    const data = toolData<{ entryCount: number; content: string }>(result)
    expect(data.entryCount).toBe(1)
    expect(data.content).toContain('Sol Ring')
  })

  test('export_cards refuses a non-canonical filter tag at the schema', async () => {
    await seedTaggedCollection(session)
    expectSchemaRejection(
      await client.callTool({
        name: 'export_cards',
        arguments: {
          lists: [{ listType: 'collection', name: 'shoebox' }],
          filters: { tags: ['#ramp'] },
        },
      }),
      TAG_SHAPE_REFUSAL,
    )
  })
})
