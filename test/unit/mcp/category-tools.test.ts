import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import type { Client } from '@modelcontextprotocol/client'
import {
  categoriesSidecarPath,
  type CardCategoriesJson,
} from '../../../src/list/card-categories-sidecar'
import { cachedPrintingRef, setupMcpClient, shoeboxPath, type McpTestSession } from './harness'
import { writeUnreadableCategoriesSidecar } from '../../helpers/card-categories'
import { expectSchemaRejection, toolData } from '../../mcp-test-utils'

/**
 * Wiring-only coverage for card categories across the MCP surface, per the test
 * layering policy: the category grammar, the sidecar's order resolution, the
 * three apply engines and the save-time prune are all pinned at the engine
 * layer (`test/unit/card-categories*.test.ts`,
 * `test/unit/admin/save-helpers.test.ts`, `test/integration/save-tail.test.ts`).
 * What belongs here is that the tool schemas accept a canonical category and
 * refuse everything else, that the three `apply_changes` actions reach the
 * handlers, and that a category comes back out of `get_list` at both levels.
 */

/** The shape refusal `cardCategorySchema` emits for anything not canonical. */
const CATEGORY_SHAPE_REFUSAL = /Not a canonical category: a category is non-empty plain text/

/** What a `get_list` cards body carries for a flat list, as this suite reads it. */
type FlatCategoriesBody = {
  entries: { name: string; categories?: string[] }[]
  categories?: CardCategoriesJson
}

/** What a `get_list` cards body carries for a deck, as this suite reads it. */
type DeckCategoriesBody = {
  deck: { sections: { cards: { name: string; categories?: string[] }[] }[] }
  categories?: CardCategoriesJson
}

/** Seed the shoebox with two of the harness's cached cards, neither categorized. */
async function seedCollection(session: McpTestSession): Promise<void> {
  const ref = await cachedPrintingRef('Sol Ring')
  await fs.writeFile(
    shoeboxPath(session),
    `# Shoebox\n\n- Sol Ring (${ref}) &1\n- Lightning Bolt (${ref}) &2\n`,
  )
}

/** The collection's sidecar as JSON, which is what the save actually wrote. */
async function readSidecar(session: McpTestSession): Promise<CardCategoriesJson> {
  const raw = await fs.readFile(categoriesSidecarPath(shoeboxPath(session)), 'utf-8')
  return JSON.parse(raw) as CardCategoriesJson
}

/** One `apply_changes` batch against the seeded shoebox — only `changes` varies. */
function applyToShoebox(client: Client, ...changes: unknown[]): ReturnType<Client['callTool']> {
  return client.callTool({
    name: 'apply_changes',
    arguments: { listType: 'collection', slug: 'shoebox', changes },
  })
}

/** The seeding change three tests start from. */
const RAMP_SOL_RING = { action: 'set-categories', cardName: 'Sol Ring', categories: ['Ramp'] }

function getCollection(client: Client): ReturnType<Client['callTool']> {
  return client.callTool({
    name: 'get_list',
    arguments: { listType: 'collection', slug: 'shoebox', view: 'cards' },
  })
}

describe('card categories over MCP', () => {
  let session: McpTestSession
  let client: Client

  beforeEach(async () => {
    session = await setupMcpClient('category-tools-test')
    client = session.client
    await seedCollection(session)
  })

  afterEach(async () => {
    await session.close()
  })

  test('apply_changes set-categories writes the sidecar, and get_list reads it back at both levels', async () => {
    const applied = await applyToShoebox(client, {
      action: 'set-categories',
      cardName: 'Sol Ring',
      categories: ['Ramp', 'Artifacts'],
    })
    // The batch is all-or-nothing, so `applied` is the whole batch or an error;
    // every outcome below is asserted against the sidecar and the load body.
    expect(toolData<{ applied: number }>(applied).applied).toBe(1)
    expect(await readSidecar(session)).toEqual({
      order: ['Ramp', 'Artifacts'],
      cards: { 'Sol Ring': ['Ramp', 'Artifacts'] },
    })

    const body = toolData<FlatCategoriesBody>(await getCollection(client))
    expect(body.categories?.cards['Sol Ring']).toEqual(['Ramp', 'Artifacts'])
    const solRing = body.entries.find((entry) => entry.name === 'Sol Ring')!
    expect(solRing.categories).toEqual(['Ramp', 'Artifacts'])
    // Absent means none on a card that has none — bun's `toEqual` ignores an
    // undefined-valued key, so the presence of the key is what is asserted.
    const bolt = body.entries.find((entry) => entry.name === 'Lightning Bolt')!
    expect('categories' in bolt).toBe(false)
  })

  test('the two list-level actions carry no card', async () => {
    await applyToShoebox(client, {
      action: 'set-categories',
      cardName: 'Sol Ring',
      categories: ['Ramp', 'Artifacts'],
    })
    const applied = await applyToShoebox(
      client,
      { action: 'rename-category', category: 'Ramp', newCategory: 'Mana Ramp' },
      { action: 'set-category-order', order: ['Artifacts', 'Mana Ramp'] },
    )
    toolData(applied)
    expect(await readSidecar(session)).toEqual({
      order: ['Artifacts', 'Mana Ramp'],
      cards: { 'Sol Ring': ['Mana Ramp', 'Artifacts'] },
    })
  })

  test('an empty categories array clears the card', async () => {
    await applyToShoebox(client, RAMP_SOL_RING)
    const cleared = await applyToShoebox(client, {
      action: 'set-categories',
      cardName: 'Sol Ring',
      categories: [],
    })
    toolData(cleared)

    const body = toolData<FlatCategoriesBody>(await getCollection(client))
    const solRing = body.entries.find((entry) => entry.name === 'Sol Ring')!
    expect('categories' in solRing).toBe(false)
    // The list keeps its vocabulary, so the list-level field is still reported —
    // only the card's own assignment is gone.
    expect(body.categories?.cards).toEqual({})
    expect(body.categories?.order).toEqual(['Ramp'])
  })

  test('a deck reports categories on its cards and on the list', async () => {
    const applied = await client.callTool({
      name: 'apply_changes',
      arguments: {
        listType: 'deck',
        slug: 'test-deck',
        changes: [{ action: 'set-categories', cardName: 'Sol Ring', categories: ['Ramp'] }],
      },
    })
    toolData(applied)

    const body = toolData<DeckCategoriesBody>(
      await client.callTool({
        name: 'get_list',
        arguments: { listType: 'deck', slug: 'test-deck', view: 'cards' },
      }),
    )
    expect(body.categories?.cards['Sol Ring']).toEqual(['Ramp'])
    const cards = body.deck.sections.flatMap((section) => section.cards)
    expect(cards.find((card) => card.name === 'Sol Ring')?.categories).toEqual(['Ramp'])
    expect('categories' in cards.find((card) => card.name === 'Lightning Bolt')!).toBe(false)
  })

  test('the schemas refuse anything that is not a canonical category', async () => {
    // The tag sigil, surrounding whitespace, and the separator a person types
    // between two names — the three ways a category typed as prose differs from
    // its stored form.
    for (const category of ['#Ramp', ' Ramp', 'a,b']) {
      expectSchemaRejection(
        await applyToShoebox(client, {
          action: 'set-categories',
          cardName: 'Sol Ring',
          categories: [category],
        }),
        CATEGORY_SHAPE_REFUSAL,
      )
    }
    // A missing `categories` is a schema error: an omitted whole list is not a
    // clear, which is what `[]` says.
    // Matched against the field path rather than the bare word: the action
    // literal `set-categories` appears in the union's own error text, so
    // /categories/ alone would pass for an unrelated refusal.
    expectSchemaRejection(
      await applyToShoebox(client, { action: 'set-categories', cardName: 'Sol Ring' }),
      /categories[\s\S]*(required|expected array|invalid_type)/i,
    )
    expectSchemaRejection(
      await applyToShoebox(client, { action: 'rename-category', category: 'Ramp' }),
      /newCategory/,
    )
  })

  test('removing the last copy prunes the name, and the mutation says so', async () => {
    await applyToShoebox(client, RAMP_SOL_RING)
    const removed = await client.callTool({
      name: 'remove_card',
      arguments: { listType: 'collection', slug: 'shoebox', cardName: 'Sol Ring', cardId: 1 },
    })
    expect(toolData<{ prunedCategories?: string[] }>(removed).prunedCategories).toEqual([
      'Sol Ring',
    ])
  })

  test('an unreadable sidecar reaches the tool result as categoryWarnings', async () => {
    await writeUnreadableCategoriesSidecar(shoeboxPath(session))
    const body = toolData<{ categoryWarnings?: string[]; categories?: CardCategoriesJson }>(
      await getCollection(client),
    )
    expect(body.categoryWarnings).toHaveLength(1)
    // Nothing to report at the list level, and absent means none: an
    // undefined-valued key would advertise a field the schema says is there.
    expect('categories' in body).toBe(false)
  })
})
