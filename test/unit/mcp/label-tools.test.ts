import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/client'
import { cardCache } from '../../../src/cache'
import { setupMcpClient, type McpTestSession } from './harness'
import { expectSchemaRejection, toolData } from '../../mcp-test-utils'

/**
 * Wiring-only coverage for card labels across the MCP surface, per the test
 * layering policy: label *semantics* (grammar, exclusivity, effective
 * resolution) are pinned on the engine (test/unit/card-labels.test.ts and
 * friends); what belongs here is that the tools accept/reject the vocabulary
 * and that the values round-trip through the in-process handlers.
 */

/** Seed the shoebox with the harness's cached Sol Ring, labeled `[keep]`, under a sale default. */
async function seedLabeledCollection(session: McpTestSession): Promise<string> {
  const printings = (await cardCache.get('Sol Ring')) ?? []
  const printing = printings[0]!
  const printingRef = `${printing.set.toUpperCase()}:${printing.collector_number}`
  await fs.writeFile(
    path.join(session.env.dir, 'collections', 'shoebox.md'),
    `---\nlabels: [sale]\n---\n\n# Shoebox\n\n- Sol Ring (${printingRef}) [keep] &1\n`,
  )
  return printingRef
}

describe('card labels over MCP', () => {
  let session: McpTestSession
  let client: Client

  beforeEach(async () => {
    session = await setupMcpClient('label-tools-test')
    client = session.client
  })

  afterEach(async () => {
    await session.close()
  })

  test('get_list carries the list default and per-entry overrides', async () => {
    await seedLabeledCollection(session)
    const result = await client.callTool({
      name: 'get_list',
      arguments: { listType: 'collection', slug: 'shoebox', view: 'cards' },
    })
    const data = toolData<{ labels?: string[]; entries: { labels?: string[] }[] }>(result)
    expect(data.labels).toEqual(['sale'])
    expect(data.entries[0]!.labels).toEqual(['keep'])
  })

  test('apply_changes set-label rewrites the override', async () => {
    await seedLabeledCollection(session)
    const result = await client.callTool({
      name: 'apply_changes',
      arguments: {
        listType: 'collection',
        slug: 'shoebox',
        changes: [
          { action: 'set-label', cardName: 'Sol Ring', cardId: 1, labels: ['trade', 'sale'] },
        ],
      },
    })
    const data = toolData<{ applied: number }>(result)
    expect(data.applied).toBe(1)
    const content = await fs.readFile(
      path.join(session.env.dir, 'collections', 'shoebox.md'),
      'utf-8',
    )
    expect(content).toContain('[sale,trade] &1')
  })

  test('apply_changes add carries a label override onto the new line', async () => {
    const printingRef = await seedLabeledCollection(session)
    const result = await client.callTool({
      name: 'apply_changes',
      arguments: {
        listType: 'collection',
        slug: 'shoebox',
        changes: [
          {
            action: 'add',
            cardName: 'Sol Ring',
            set: printingRef.split(':')[0],
            collectorNumber: printingRef.split(':')[1],
            labels: ['keep'],
          },
        ],
      },
    })
    expect(toolData<{ applied: number }>(result).applied).toBe(1)
    const content = await fs.readFile(
      path.join(session.env.dir, 'collections', 'shoebox.md'),
      'utf-8',
    )
    expect(content).toContain(`- Sol Ring (${printingRef}) [keep] &2`)
  })

  test('set_list_metadata writes a collection default', async () => {
    const result = await client.callTool({
      name: 'set_list_metadata',
      arguments: { listType: 'collection', slug: 'shoebox', labels: ['keep'] },
    })
    const data = toolData<{ frontMatter: Record<string, unknown> }>(result)
    expect(data.frontMatter).toEqual({ labels: ['keep'] })
  })

  test('the schemas reject labels off-vocabulary or on the wrong list type', async () => {
    expectSchemaRejection(
      await client.callTool({
        name: 'set_list_metadata',
        arguments: { listType: 'deck', slug: 'test-deck', labels: ['sale'] },
      }),
      'labels apply to collections only',
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
          labels: ['bogus'],
        },
      }),
      /labels/,
    )
    expectSchemaRejection(
      await client.callTool({
        name: 'apply_changes',
        arguments: {
          listType: 'deck',
          slug: 'test-deck',
          changes: [{ action: 'add', cardName: 'Sol Ring', labels: ['sale'] }],
        },
      }),
      'add labels apply to collections only',
    )
  })

  test('export_cards filters by effective labels', async () => {
    await seedLabeledCollection(session)
    const result = await client.callTool({
      name: 'export_cards',
      arguments: {
        lists: [{ listType: 'collection', name: 'shoebox' }],
        filters: { labels: ['keep'] },
        format: 'text',
      },
    })
    const data = toolData<{ entryCount: number; content: string }>(result)
    expect(data.entryCount).toBe(1)
    expect(data.content).toContain('Sol Ring')
  })
})
