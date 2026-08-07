import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/client'
import { cardCache } from '../../../src/cache'
import { setupMcpClient, type McpTestSession } from './harness'
import { expectSchemaRejection, toolData } from '../../mcp-test-utils'

/**
 * Wiring-only coverage for card languages across the MCP surface, per the test
 * layering policy: language *semantics* (the `[ja]` token grammar, the
 * absent-means-en rule, apply-engine behavior) are pinned on the engine
 * (test/unit/card-language.test.ts, the change/apply suites); what belongs here
 * is that the tool schemas accept/reject the vocabulary and that a language
 * survives the in-process handler round trip onto the file.
 */

/** Seed the shoebox with the harness's cached Sol Ring (an English line). */
async function seedCollection(session: McpTestSession): Promise<string> {
  const printings = (await cardCache.get('Sol Ring')) ?? []
  const printing = printings[0]!
  const printingRef = `${printing.set.toUpperCase()}:${printing.collector_number}`
  await fs.writeFile(
    path.join(session.env.dir, 'collections', 'shoebox.md'),
    `# Shoebox\n\n- Sol Ring (${printingRef}) &1\n`,
  )
  return printingRef
}

function shoeboxPath(session: McpTestSession): string {
  return path.join(session.env.dir, 'collections', 'shoebox.md')
}

describe('card languages over MCP', () => {
  let session: McpTestSession
  let client: Client

  beforeEach(async () => {
    session = await setupMcpClient('language-tools-test')
    client = session.client
  })

  afterEach(async () => {
    await session.close()
  })

  test('apply_changes set-language writes the [ja] token onto the line', async () => {
    await seedCollection(session)
    const result = await client.callTool({
      name: 'apply_changes',
      arguments: {
        listType: 'collection',
        slug: 'shoebox',
        changes: [{ action: 'set-language', cardName: 'Sol Ring', cardId: 1, language: 'ja' }],
      },
    })
    const data = toolData<{ applied: number }>(result)
    expect(data.applied).toBe(1)
    const content = await fs.readFile(shoeboxPath(session), 'utf-8')
    expect(content).toContain('[ja] &1')
  })

  test('add_card carries a language onto the new line', async () => {
    const printingRef = await seedCollection(session)
    const [set, collectorNumber] = printingRef.split(':')
    const result = await client.callTool({
      name: 'add_card',
      arguments: {
        listType: 'collection',
        slug: 'shoebox',
        cardName: 'Sol Ring',
        set,
        collectorNumber,
        condition: 'LP',
        language: 'ja',
      },
    })
    expect(toolData<{ applied: number }>(result).applied).toBe(1)
    const content = await fs.readFile(shoeboxPath(session), 'utf-8')
    expect(content).toContain(`- Sol Ring (${printingRef}) [LP] [ja] &2`)
  })

  test('the schemas reject a code outside the language vocabulary', async () => {
    expectSchemaRejection(
      await client.callTool({
        name: 'add_card',
        arguments: {
          listType: 'collection',
          slug: 'shoebox',
          cardName: 'Sol Ring',
          set: 'lea',
          collectorNumber: '1',
          language: 'xx',
        },
      }),
      /language/,
    )
    expectSchemaRejection(
      await client.callTool({
        name: 'apply_changes',
        arguments: {
          listType: 'collection',
          slug: 'shoebox',
          // "jp" is a printed-code alias the CLI normalizes; the tool schema is
          // canonical codes only, so it must be rejected rather than guessed.
          changes: [{ action: 'set-language', cardName: 'Sol Ring', language: 'jp' }],
        },
      }),
      /language/,
    )
  })

  test('apply_changes set-language on a wanted list leaves the other entry’s token alone', async () => {
    // Regression pin for the MCP wanted write path: `toWantedCardEntries` must
    // carry each parsed entry's language, or a save that touches entry &1 would
    // re-serialize entry &2 bare and silently erase its [ja] token.
    const wishlistPath = path.join(session.env.dir, 'wanted', 'wishlist.md')
    await fs.writeFile(wishlistPath, '# Wishlist\n\n- Sol Ring &1\n- Lightning Bolt [ja] &2\n')
    const result = await client.callTool({
      name: 'apply_changes',
      arguments: {
        listType: 'wanted',
        slug: 'wishlist',
        changes: [{ action: 'set-language', cardName: 'Sol Ring', cardId: 1, language: 'de' }],
      },
    })
    expect(toolData<{ applied: number }>(result).applied).toBe(1)
    const content = await fs.readFile(wishlistPath, 'utf-8')
    expect(content).toContain('- Sol Ring [de] &1')
    expect(content).toContain('- Lightning Bolt [ja] &2')
  })

  test('get_card_printings reports the languages rollup', async () => {
    const result = await client.callTool({
      name: 'get_card_printings',
      arguments: { name: 'Sol Ring' },
    })
    const data = toolData<{ languages: string[] }>(result)
    // Presence + shape only: the rollup's fold/order semantics are pinned at
    // the card-printings API integration layer, not re-tested through MCP.
    expect(Array.isArray(data.languages)).toBe(true)
    expect(data.languages.length).toBeGreaterThan(0)
    expect(data.languages).toContain('en')
  })
})
