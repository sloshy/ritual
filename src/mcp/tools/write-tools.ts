import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  createAddChange,
  createRemoveChange,
  createSetCommanderChange,
  createSetNoteChange,
  createSetPrintingChange,
} from '../../change-event'
import { callApi } from '../dispatch'
import { mutateCollection, mutateDeck, mutateList, mutateWanted } from '../mutations'
import { jsonResult, textResult } from '../result'
import {
  cardIdField,
  cardNameField,
  collectorNumberField,
  conditionField,
  conditionSchema,
  finishField,
  finishSchema,
  listTypeSchema,
  sectionField,
  setField,
  slugField,
} from '../schemas'

const moveSchema = z.object({
  cardKey: z.string().describe('Opaque key from move_candidates.'),
  toType: listTypeSchema.describe('Destination list type.'),
  toSlug: z.string().describe('Destination list slug.'),
  set: setField,
  collectorNumber: collectorNumberField,
  finish: finishSchema.optional(),
  condition: conditionSchema.optional(),
})

/**
 * Register the write tools: creating lists, importing decks/CSV, card-level edits
 * (add/remove/set-note/set-printing/set-commander), and committing cross-list moves.
 * Card edits go through {@link mutateDeck}/{@link mutateCollection}/{@link mutateWanted},
 * which load-then-save inside the one call so the agent never manages content hashes.
 *
 * Most of these are additive, but `import_deck` and `import_csv` can replace an
 * existing list of the same name, so both carry the SDK's `destructiveHint` — the
 * hint reflects what the tool is capable of, not what its default mode does.
 */
export function registerWriteTools(server: McpServer): void {
  server.registerTool(
    'create_deck',
    {
      title: 'Create deck',
      description: 'Create a new, empty deck.',
      inputSchema: {
        name: z.string().min(1).describe('Display name.'),
        format: z.string().optional().describe('Deck format; defaults to commander.'),
      },
    },
    async ({ name, format }) =>
      jsonResult(await callApi('POST', '/api/deck/create', { name, format })),
  )

  server.registerTool(
    'create_collection',
    {
      title: 'Create collection',
      description: 'Create a new, empty collection.',
      inputSchema: { name: z.string().min(1).describe('Display name.') },
    },
    async ({ name }) => jsonResult(await callApi('POST', '/api/collection/create', { name })),
  )

  server.registerTool(
    'create_wanted',
    {
      title: 'Create wanted list',
      description: 'Create a new, empty wanted list.',
      inputSchema: { name: z.string().min(1).describe('Display name.') },
    },
    async ({ name }) => jsonResult(await callApi('POST', '/api/wanted/create', { name })),
  )

  server.registerTool(
    'import_deck',
    {
      title: 'Import deck',
      description: 'Import a deck from a supported URL or from pasted decklist text.',
      inputSchema: {
        mode: z.enum(['url', 'text']).describe('Import source.'),
        url: z.string().optional().describe('Deck URL (mode "url").'),
        content: z.string().optional().describe('Decklist text (mode "text").'),
        name: z.string().optional().describe('Name for the imported deck (mode "text").'),
        overwrite: z.boolean().optional().describe('Overwrite an existing deck of the same name.'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mode, url, content, name, overwrite }) => {
      const body = mode === 'url' ? { mode, url, overwrite } : { mode, content, name, overwrite }
      return jsonResult(await callApi('POST', '/api/import-deck', body))
    },
  )

  server.registerTool(
    'import_csv',
    {
      title: 'Import CSV',
      description:
        'Import cards from CSV text into a deck, collection, or wanted list — creating a new list, ' +
        'overwriting one, or appending to an existing one. Columns map to card fields via a ' +
        '1-based spec like "name=1,set=2,collector-number=3" (fields: name, set, collector-number, ' +
        'condition, finish, section, quantity). Values are normalized (e.g. "Near Mint" → NM, ' +
        '"F" → foil). Rows that fail validation are reported back; the rest still import.',
      inputSchema: {
        listType: listTypeSchema,
        name: z
          .string()
          .min(1)
          .describe('New list name (create/overwrite) or an existing list (append).'),
        mode: z
          .enum(['create', 'overwrite', 'append'])
          .optional()
          .describe('Defaults to "create", which fails if the list already exists.'),
        format: z
          .string()
          .optional()
          .describe('Deck format; required when creating or overwriting a deck.'),
        content: z.string().min(1).describe('Raw CSV text.'),
        columns: z
          .string()
          .min(1)
          .describe('Column mapping spec, e.g. "name=1,set=2,collector-number=3,quantity=4".'),
        hasHeader: z
          .boolean()
          .optional()
          .describe('Whether the first row is a header row. Defaults to true.'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ listType, name, mode, format, content, columns, hasHeader }) =>
      jsonResult(
        await callApi('POST', '/api/import-csv', {
          listType,
          name,
          mode,
          format,
          content,
          columns,
          hasHeader,
        }),
      ),
  )

  server.registerTool(
    'add_card_to_deck',
    {
      title: 'Add card to deck',
      description: 'Add a card to a deck (increments quantity if it already exists).',
      inputSchema: {
        slug: slugField,
        cardName: cardNameField,
        set: setField,
        collectorNumber: collectorNumberField,
        finish: finishField,
        condition: conditionField,
        section: sectionField,
      },
    },
    async ({ slug, cardName, set, collectorNumber, finish, condition, section }) => {
      const change = createAddChange(cardName, {
        set,
        collectorNumber,
        finish,
        condition,
        section,
      })
      return textResult((await mutateDeck(slug, change)).message)
    },
  )

  server.registerTool(
    'remove_card_from_deck',
    {
      title: 'Remove card from deck',
      description: 'Remove one copy of a card from a deck (deletes the line at quantity 0).',
      inputSchema: {
        slug: slugField,
        cardName: cardNameField,
        cardId: cardIdField,
        set: setField,
        collectorNumber: collectorNumberField,
        finish: finishField,
        condition: conditionField,
      },
    },
    async ({ slug, cardName, cardId, set, collectorNumber, finish, condition }) => {
      const change = createRemoveChange(cardName, {
        cardId,
        set,
        collectorNumber,
        finish,
        condition,
      })
      return textResult((await mutateDeck(slug, change)).message)
    },
  )

  server.registerTool(
    'add_card_to_collection',
    {
      title: 'Add card to collection',
      description: 'Add a card to a collection. Supply set + collectorNumber to pin the printing.',
      inputSchema: {
        slug: slugField,
        cardName: cardNameField,
        set: setField,
        collectorNumber: collectorNumberField,
        finish: finishField,
        condition: conditionField,
        section: sectionField,
      },
    },
    async ({ slug, cardName, set, collectorNumber, finish, condition, section }) => {
      const change = createAddChange(cardName, {
        set,
        collectorNumber,
        finish,
        condition,
        section,
      })
      return textResult((await mutateCollection(slug, change)).message)
    },
  )

  server.registerTool(
    'add_card_to_wanted',
    {
      title: 'Add card to wanted list',
      description:
        'Add a card to a wanted list. Printing fields are optional (name-only is allowed).',
      inputSchema: {
        slug: slugField,
        cardName: cardNameField,
        set: setField,
        collectorNumber: collectorNumberField,
        finish: finishField,
        section: sectionField,
      },
    },
    async ({ slug, cardName, set, collectorNumber, finish, section }) => {
      const change = createAddChange(cardName, {
        set,
        collectorNumber,
        finish,
        section,
      })
      return textResult((await mutateWanted(slug, change)).message)
    },
  )

  server.registerTool(
    'set_card_note',
    {
      title: 'Set card note',
      description: 'Set (or, with an empty string, clear) the note on a card in any list.',
      inputSchema: {
        listType: listTypeSchema,
        slug: slugField,
        cardName: cardNameField,
        cardId: cardIdField,
        note: z.string().describe('Note text. Empty string clears the note.'),
      },
    },
    async ({ listType, slug, cardName, cardId, note }) => {
      const change = createSetNoteChange(cardName, { note, cardId })
      return textResult((await mutateList(listType, slug, change)).message)
    },
  )

  server.registerTool(
    'set_card_printing',
    {
      title: 'Set card printing',
      description:
        'Set the printing (set/collector number/finish/condition) of a card in any list. ' +
        'Omit set and collectorNumber to clear the specific printing.',
      inputSchema: {
        listType: listTypeSchema,
        slug: slugField,
        cardName: cardNameField,
        cardId: cardIdField,
        set: setField,
        collectorNumber: collectorNumberField,
        finish: finishField,
        condition: conditionField,
      },
    },
    async ({ listType, slug, cardName, cardId, set, collectorNumber, finish, condition }) => {
      const change = createSetPrintingChange(cardName, {
        set,
        collectorNumber,
        finish,
        condition,
        cardId,
      })
      return textResult((await mutateList(listType, slug, change)).message)
    },
  )

  server.registerTool(
    'set_commander',
    {
      title: 'Set commander',
      description: 'Move a card into a deck’s Commander section.',
      inputSchema: { slug: slugField, cardName: cardNameField, cardId: cardIdField },
    },
    async ({ slug, cardName, cardId }) => {
      const change = createSetCommanderChange(cardName, { cardId })
      return textResult((await mutateDeck(slug, change)).message)
    },
  )

  server.registerTool(
    'move_cards',
    {
      title: 'Move cards',
      description:
        'Move cards between lists. Each move references a cardKey from move_candidates and a ' +
        'destination type + slug. Set/collector number/finish/condition override the printing on arrival.',
      inputSchema: { moves: z.array(moveSchema).min(1).describe('Moves to apply atomically.') },
    },
    async ({ moves }) => jsonResult(await callApi('POST', '/api/move/commit', { moves })),
  )
}
