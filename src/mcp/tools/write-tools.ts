import {
  fromJsonSchema,
  ProtocolError,
  ProtocolErrorCode,
  type McpServer,
} from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
  createAddChange,
  createChangeId,
  createRemoveChange,
  createSetPrintingChange,
  type CardChange,
  type ChangeEvent,
} from '../../change-event'
import { parseChangeBundle } from '../../editor/change-bundle'
import {
  isToSectionInvalid,
  TO_SECTION_DECK_ONLY_MESSAGE,
  type RemoveCommitItem,
  type RemoveCommitRequest,
  type SelectedMoveItem,
  type SelectedMoveRequest,
} from '../../admin/api/move'
import type { DeckCreateRequest } from '../../admin/api/deck-create'
import type { BundleImportResponse } from '../../admin/api/import-changes'
import type { ImportCsvRequest, ImportCsvResponse } from '../../admin/api/import-csv'
import type { ImportDeckResponse } from '../../admin/api/import-deck'
import type { ListCreateResponse } from '../../admin/api/list-lifecycle'
import type {
  CollectionMetadataRequest,
  DeckMetadataRequest,
  MetadataResponse,
} from '../../admin/api/metadata'
import type { MoveCommitResponse, RemoveCommitResponse } from '../../admin/api/move'
import { callApi, callApiData } from '../dispatch'
import type { ListChangeNotifier } from '../notify'
import { applyMutation, type MutationResult } from '../mutations'
import { runTool } from '../result'
import {
  CREATE_LIST_OUTPUT,
  IMPORT_CHANGE_BUNDLE_OUTPUT,
  IMPORT_CSV_OUTPUT,
  IMPORT_DECK_OUTPUT,
  MOVE_SELECTED_CARDS_OUTPUT,
  MUTATION_OUTPUT,
  REMOVE_SELECTED_CARDS_OUTPUT,
  SET_LIST_METADATA_OUTPUT,
} from '../schema-json'
import type { ListType } from '../../list-type'
import type { OmitSuccess } from '../types'
import {
  cardIdField,
  cardNameField,
  collectorNumberField,
  conditionField,
  conditionSchema,
  conditionUpdateField,
  conditionUpdateSchema,
  cardLabelSchema,
  copyIndexField,
  deckFormatSchema,
  finishField,
  finishSchema,
  labelsOverrideField,
  labelsUpdateField,
  languageField,
  languageSchema,
  listTypeSchema,
  quantityField,
  refineDeckOnlyFormat,
  sectionField,
  setField,
  slugField,
} from '../schemas'

/** `create_list` result: the new list's slug. */
export type CreateListResult = OmitSuccess<ListCreateResponse>

/** `import_deck` result: the deck that was written. */
export type ImportDeckResult = OmitSuccess<ImportDeckResponse>

/** `import_csv` result: rows imported, plus any that failed validation. */
export type ImportCsvResult = OmitSuccess<ImportCsvResponse>

/** `import_change_bundle` result: what each list in the bundle applied. */
export type ImportChangeBundleResult = OmitSuccess<BundleImportResponse>

/**
 * `set_list_metadata` result. The handler's `contentHash` is dropped: it is an
 * optimistic-concurrency token for a client that supplies one, and no agent does.
 */
export interface ListMetadataResult {
  slug: string
  frontMatter: Record<string, unknown>
}

/** `move_selected_cards` result: what the batch moved, skipped, and dropped. */
export type MoveSelectedResult = OmitSuccess<MoveCommitResponse>

/** `remove_selected_cards` result: what the batch removed and skipped. */
export type RemoveSelectedResult = OmitSuccess<RemoveCommitResponse>

/**
 * `POST /api/import-deck` body as the MCP tool builds it. Looser than the
 * handler's `ImportDeckRequest` union on purpose: the tool schema leaves
 * `url`/`content` optional so a missing one surfaces as the handler's own
 * 400 rather than a schema rejection with less context. `syncPrintings` is
 * forwarded on the text branch too, deliberately: a text-mode call that
 * carries it gets the handler's explanation of why it does not apply,
 * instead of the tool silently dropping the field.
 */
type ImportDeckBody = {
  mode: 'url' | 'text'
  url?: string
  content?: string
  name?: string
  overwrite?: boolean
  syncPrintings?: boolean
}

/**
 * How the batch tools address one entry that already exists: the list holding
 * it, the card's exact name, and — when the entry has them — the `&N` id and the
 * copy index that pin the individual line. `cardId` must match whenever the
 * entry has one (`get_list` shows it); a name-only item matches only entries
 * without an id.
 *
 * Shared by `move_selected_cards`' source half and every `remove_selected_cards`
 * item, which is also why {@link toEntryTarget} exists: the two schemas and the
 * one mapping onto the admin routes' spelling have to move together.
 */
const entryTargetFields = {
  listType: listTypeSchema.describe('List type of the entry.'),
  slug: slugField.describe('Slug of the list holding the entry.'),
  cardName: cardNameField.describe('Exact card name of the entry.'),
  cardId: cardIdField.describe(
    'The entry’s persistent card ID (the &N suffix). Required to match when the entry has one.',
  ),
  copyIndex: copyIndexField,
}

/** An entry-addressing item as {@link entryTargetFields} parses one. */
export interface EntryTargetInput {
  listType: ListType
  slug: string
  cardName: string
  cardId?: number
  copyIndex?: number
}

/**
 * Project the tool vocabulary onto the admin routes' (`listSlug`/`name`), which
 * `move_selected_cards` and `remove_selected_cards` both need and both used to
 * write out.
 */
export function toEntryTarget(item: EntryTargetInput): RemoveCommitItem {
  return {
    listType: item.listType,
    listSlug: item.slug,
    name: item.cardName,
    cardId: item.cardId,
    copyIndex: item.copyIndex,
  }
}

/**
 * One card move: an {@link entryTargetFields} source plus a destination list and
 * optional printing overrides applied on arrival.
 */
const moveItemSchema = z
  .object({
    ...entryTargetFields,
    toListType: listTypeSchema.describe('Destination list type.'),
    toSlug: z.string().min(1).describe('Destination list slug.'),
    toSection: z
      .string()
      .min(1)
      .optional()
      .describe('Destination deck section (deck destinations only; created when missing).'),
    set: setField,
    collectorNumber: collectorNumberField,
    finish: finishSchema.optional().describe('Override the finish on arrival.'),
    condition: conditionSchema.optional().describe('Override the condition on arrival.'),
    language: languageSchema
      .optional()
      .describe('Override the language on arrival ("en" = English).'),
  })
  .superRefine((val, ctx) => {
    if (isToSectionInvalid(val.toSection, val.toListType)) {
      ctx.addIssue({ code: 'custom', message: TO_SECTION_DECK_ONLY_MESSAGE })
    }
  })

/** One card removal: an {@link entryTargetFields} target and nothing else. */
const removeItemSchema = z.object(entryTargetFields)

/**
 * Fields shared by every card-level change in `apply_changes` that *targets* an
 * existing entry. The `add` branch spells its fields out instead: `cardId` is a
 * targeting field, and an add has nothing to target.
 *
 * A change's `id` and `timestamp` are deliberately absent: they are bookkeeping
 * the server generates, an agent has nothing better to put there, and the union
 * below expands to eight fully-written-out branches — so every field here costs
 * eight copies in the advertised schema.
 */
const changeBase = {
  cardName: cardNameField,
  cardId: cardIdField,
}

/**
 * The card-level {@link ChangeEvent} actions `apply_changes` accepts. Cross-list
 * moves (`move-from`/`move-to`) belong to `move_selected_cards` and are rejected
 * here; section-structural events are not agent-facing at all.
 */
const applyChangeSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    // No `cardId`: an id identifies an entry that already exists, and an add is
    // the one change that creates one. The server allocates the new entry's id.
    cardName: cardNameField,
    set: setField,
    collectorNumber: collectorNumberField,
    finish: finishSchema.optional(),
    condition: conditionSchema.optional(),
    language: languageField,
    labels: labelsOverrideField,
    section: sectionField,
  }),
  z.object({
    action: z.literal('remove'),
    ...changeBase,
    set: setField,
    collectorNumber: collectorNumberField,
    finish: finishSchema.optional(),
    condition: conditionSchema.optional(),
    language: languageSchema
      .optional()
      .describe('Match only entries with this language ("en" matches bare lines).'),
  }),
  z.object({ action: z.literal('set-finish'), ...changeBase, finish: finishSchema }),
  z.object({
    action: z.literal('set-printing'),
    ...changeBase,
    set: setField,
    collectorNumber: collectorNumberField,
    finish: finishSchema.optional(),
    // The only branch that accepts the `NONE` clear sentinel: an `add` records a
    // grade and has none to clear, and a `remove` matches on one.
    condition: conditionUpdateSchema.optional(),
    language: languageSchema
      .optional()
      .describe('Set the language along with the printing; omit to leave it alone.'),
  }),
  z.object({
    action: z.literal('set-language'),
    ...changeBase,
    language: languageSchema.describe(
      'The new language. "en" clears the line’s token (a bare line means English).',
    ),
  }),
  z.object({
    action: z.literal('set-note'),
    ...changeBase,
    note: z.string().describe('Note text. Empty string clears the note.'),
  }),
  z.object({
    action: z.literal('set-label'),
    ...changeBase,
    labels: labelsUpdateField,
  }),
  z.object({ action: z.literal('set-commander'), ...changeBase }),
  z.object({ action: z.literal('unset-commander'), ...changeBase }),
  z.object({
    action: z.literal('set-section'),
    ...changeBase,
    section: z.string().min(1).describe('Target section (created when missing).'),
  }),
])

type ApplyChangeInput = z.infer<typeof applyChangeSchema>

/** True only when `A` and `B` are mutually assignable (i.e. the same union). */
type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

// Compile-time exhaustiveness: every card-level ChangeEvent action must be either
// covered by applyChangeSchema or intentionally rejected here (the cross-list moves
// belong to move_selected_cards). A new card-level action added to change-event makes the
// Exclude<> below stop matching and fails this line until the action is classified.
void (true satisfies SameUnion<
  Exclude<CardChange['action'], ApplyChangeInput['action']>,
  'move-from' | 'move-to'
>)

/** Stamp the id and timestamp a change carries, yielding a full {@link ChangeEvent}. */
function toChangeEvent(input: ApplyChangeInput): ChangeEvent {
  return { ...input, id: createChangeId(), timestamp: Date.now() }
}

/**
 * Register the write tools: creating lists, importing decks/CSV/change bundles,
 * deck metadata, the common single-card edits (add/remove/set-printing), the
 * batch `apply_changes` primitive, and cross-list `move_selected_cards` /
 * `remove_selected_cards`. Card edits go through {@link applyMutation}, which loads
 * then saves inside the one call so the agent never manages content hashes.
 *
 * Note, section, and commander edits have no tool of their own: they are
 * `apply_changes` actions. `add_card`/`remove_card`/`set_card_printing` keep
 * theirs because a flat schema beats a tagged union for the common case, which
 * those three are and the others are not.
 *
 * Most of these are additive, but `import_deck` and `import_csv` can replace an
 * existing list of the same name, and `import_change_bundle`/`apply_changes` can remove
 * cards in bulk, so those carry the SDK's `destructiveHint` — the hint reflects
 * what the tool is capable of, not what its default mode does.
 */
export function registerWriteTools(server: McpServer, notifier: ListChangeNotifier): void {
  server.registerTool(
    'create_list',
    {
      title: 'Create list',
      description:
        'Create a new, empty deck, collection, or wanted list. Refused when a list of that ' +
        'type already exists under a name that resolves the same way (list names match ' +
        'ignoring case, accents, hyphens/underscores, apostrophes, and filename-illegal ' +
        'punctuation like `:`), so two lists can never share one addressable name.',
      inputSchema: z
        .object({
          listType: listTypeSchema,
          name: z.string().min(1).describe('Display name.'),
          format: deckFormatSchema
            .optional()
            .describe('Deck format (decks only; defaults to commander).'),
        })
        .superRefine(refineDeckOnlyFormat),
      outputSchema: fromJsonSchema<CreateListResult>(CREATE_LIST_OUTPUT),
    },
    async ({ listType, name, format }) =>
      runTool(async (): Promise<CreateListResult> => {
        const body: DeckCreateRequest = listType === 'deck' ? { name, format } : { name }
        const data = await callApiData<ListCreateResponse>('POST', `/api/${listType}/create`, body)
        notifier.notifyListsChanged()
        return data
      }),
  )

  server.registerTool(
    'import_deck',
    {
      title: 'Import deck',
      description:
        "Import a deck from a supported URL or from pasted decklist text (Ritual's own " +
        'format and MTG Arena/MTGO exports). Text lines the parser cannot read are skipped and ' +
        'reported in `warnings` — check it, because a non-empty array means part of the pasted ' +
        'text was not imported; `advisories` reports content that was read but is worth a ' +
        'word (a line that looked off, or an empty Maybeboard/Tokens section the write drops). ' +
        'A URL import must state `syncPrintings` — the CLI asks the user interactively, and ' +
        'this call is that decision, so ask the user when their intent is unclear.',
      inputSchema: z.object({
        mode: z.enum(['url', 'text']).describe('Import source.'),
        url: z.string().optional().describe('Deck URL (mode "url").'),
        content: z.string().optional().describe('Decklist text (mode "text").'),
        name: z.string().optional().describe('Name for the imported deck (mode "text").'),
        overwrite: z.boolean().optional().describe('Overwrite an existing deck of the same name.'),
        syncPrintings: z
          .boolean()
          .optional()
          .describe(
            'Required for mode "url" (the handler refuses a URL import without it): true keeps ' +
              'the exact printings — set, collector number, foil/etched finish — the source ' +
              'lists; false imports bare card names. Not accepted for mode "text", whose ' +
              'printings come from the pasted lines themselves.',
          ),
      }),
      outputSchema: fromJsonSchema<ImportDeckResult>(IMPORT_DECK_OUTPUT),
      annotations: { destructiveHint: true },
    },
    async ({ mode, url, content, name, overwrite, syncPrintings }) =>
      runTool(async (): Promise<ImportDeckResult> => {
        const body: ImportDeckBody =
          mode === 'url'
            ? { mode, url, overwrite, syncPrintings }
            : { mode, content, name, overwrite, syncPrintings }
        const data = await callApiData<ImportDeckResponse>('POST', '/api/import-deck', body)
        // An import can create a list, so the roster may have changed.
        notifier.notifyListsChanged()
        return data
      }),
  )

  server.registerTool(
    'import_csv',
    {
      title: 'Import CSV',
      description:
        'Import cards from CSV text into a deck, collection, or wanted list — creating a new list, ' +
        'overwriting one, or appending to an existing one. Columns map to card fields via a ' +
        '1-based spec like "name=1,set=2,collector-number=3" (fields: name, set, collector-number, ' +
        'condition, finish, language, section, quantity). Values are normalized (e.g. "Near Mint" ' +
        '→ NM, "F" → foil, "JP"/"Japanese" → ja; an empty language cell falls back to the ' +
        'configured defaultLanguage when that printing exists in it). Rows that fail validation ' +
        'are reported back and the rest still import, so a ' +
        'partially-failed import still succeeds — read failedCount and failures rather than ' +
        'treating the call as all-or-nothing.',
      inputSchema: z
        .object({
          listType: listTypeSchema,
          name: z
            .string()
            .min(1)
            .describe('New list name (create/overwrite) or an existing list (append).'),
          mode: z
            .enum(['create', 'overwrite', 'append'])
            .optional()
            .describe('Defaults to "create", which fails if the list already exists.'),
          format: deckFormatSchema
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
            .describe(
              "Whether the first row is a header row. Defaults to true; the result's `warnings` state which row that skipped and whether it actually looked like one, so pass false for a headerless export rather than losing its first card.",
            ),
        })
        .superRefine(refineDeckOnlyFormat),
      outputSchema: fromJsonSchema<ImportCsvResult>(IMPORT_CSV_OUTPUT),
      annotations: { destructiveHint: true },
    },
    async ({ listType, name, mode, format, content, columns, hasHeader }) =>
      runTool(async (): Promise<ImportCsvResult> => {
        const body: ImportCsvRequest = {
          listType,
          name,
          mode,
          format,
          content,
          columns,
          hasHeader,
        }
        const data = await callApiData<ImportCsvResponse>('POST', '/api/import-csv', body)
        // create/overwrite modes can add a list, so the roster may have changed.
        notifier.notifyListsChanged()
        return data
      }),
  )

  server.registerTool(
    'import_change_bundle',
    {
      title: 'Import change bundle',
      description:
        'Apply a change bundle exported from the site editor (format "ritual-change-bundle", ' +
        'one or more lists) to the underlying lists. Changes are re-targeted to current ' +
        'card IDs; ones whose target card no longer exists, or whose action cannot apply to ' +
        'the list, are reported as skipped conflicts.',
      inputSchema: z.object({
        json: z.string().min(1).describe('The exported change JSON, verbatim.'),
      }),
      outputSchema: fromJsonSchema<ImportChangeBundleResult>(IMPORT_CHANGE_BUNDLE_OUTPUT),
      annotations: { destructiveHint: true },
    },
    async ({ json }) =>
      runTool(async (): Promise<ImportChangeBundleResult> => {
        // Validate locally so a malformed payload surfaces as a clear message
        // instead of a generic HTTP 400; the route re-validates the same way.
        const bundle = parseChangeBundle(json)
        if (typeof bundle === 'string') {
          throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            `Invalid change bundle: ${bundle}`,
          )
        }
        const data = await callApiData<BundleImportResponse>('POST', '/api/import-changes', bundle)
        return data
      }),
  )

  server.registerTool(
    'set_list_metadata',
    {
      title: 'Set list metadata',
      description:
        'Write a list’s front matter. Decks: description, tags, format, and the Archidekt source ' +
        'link. Collections: labels — the default card labels ("sale"/"trade" combine; "keep" ' +
        'stands alone) every entry without its own override inherits. Only the fields you send ' +
        'are touched; null (or "" for description) clears one. Setting sourceId together with an ' +
        'archidekt.com sourceUrl is what makes a deck sync-linked, so it is what sync_decks then ' +
        'operates on; the two must name the SAME Archidekt deck once merged over what the file ' +
        'already carries, or the call is rejected. Wanted lists carry no front matter — use ' +
        'rename_list to change their display name. No changelog entry is recorded: the changelog ' +
        'is card-level, and metadata is not a card change.',
      inputSchema: z
        .object({
          listType: listTypeSchema.describe(
            'Deck fields for decks, labels for collections; wanted lists carry no front matter.',
          ),
          slug: slugField,
          description: z.string().nullable().optional().describe('null or "" clears it.'),
          tags: z.array(z.string().min(1)).nullable().optional().describe('null clears every tag.'),
          format: deckFormatSchema.nullable().optional(),
          sourceId: z
            .string()
            .min(1)
            .nullable()
            .optional()
            .describe(
              'The deck’s id on the source service; null unlinks it. For Archidekt it must be the ' +
                'deck id sourceUrl names.',
            ),
          sourceUrl: z
            .string()
            .url()
            .nullable()
            .optional()
            .describe('The deck’s URL on the source service; null unlinks it.'),
          labels: z
            .array(cardLabelSchema)
            .nullable()
            .optional()
            .describe(
              'The collection’s default card labels; null (or an empty array) clears them. ' +
                'Collections only.',
            ),
        })
        .superRefine((val, ctx) => {
          if (val.labels !== undefined && val.listType !== 'collection') {
            ctx.addIssue({ code: 'custom', message: 'labels apply to collections only.' })
          }
        }),
      outputSchema: fromJsonSchema<ListMetadataResult>(SET_LIST_METADATA_OUTPUT),
    },
    async ({ listType, slug, ...patch }) =>
      runTool(async (): Promise<ListMetadataResult> => {
        // Deck-field-on-collection misuse (and vice versa) is left to the
        // route's own 400 — validation lives once, in the handler.
        const body: DeckMetadataRequest | CollectionMetadataRequest = patch
        const data = (await callApi(
          'PUT',
          `/api/metadata/${listType}/${encodeURIComponent(slug)}`,
          body,
        )) as MetadataResponse
        return { slug: data.slug, frontMatter: data.frontMatter }
      }),
  )

  server.registerTool(
    'add_card',
    {
      title: 'Add card',
      description:
        'Add a card to any list (decks increment quantity if the same printing already exists). ' +
        'Supply set + collectorNumber to pin the printing. quantity adds that many copies in ' +
        'one save. Collections require set + collectorNumber together — an add without one is ' +
        'rejected. labels gives the new collection card a label override. language records a ' +
        'non-English copy; without it the configured defaultLanguage applies.',
      inputSchema: z
        .object({
          listType: listTypeSchema,
          slug: slugField,
          cardName: cardNameField,
          set: setField,
          collectorNumber: collectorNumberField,
          finish: finishField,
          condition: conditionField,
          language: languageField,
          labels: labelsOverrideField,
          section: sectionField,
          quantity: quantityField,
        })
        .superRefine((val, ctx) => {
          if (val.condition !== undefined && val.listType === 'wanted') {
            ctx.addIssue({
              code: 'custom',
              message: 'condition is not tracked on wanted lists.',
            })
          }
          if (val.labels !== undefined && val.listType !== 'collection') {
            ctx.addIssue({ code: 'custom', message: 'labels apply to collections only.' })
          }
        }),
      outputSchema: fromJsonSchema<MutationResult>(MUTATION_OUTPUT),
    },
    async ({
      listType,
      slug,
      cardName,
      set,
      collectorNumber,
      finish,
      condition,
      language,
      labels,
      section,
      quantity,
    }) =>
      runTool((): Promise<MutationResult> => {
        const changes: ChangeEvent[] = Array.from({ length: quantity }, () =>
          createAddChange(cardName, {
            set,
            collectorNumber,
            finish,
            condition,
            language,
            labels,
            section,
          }),
        )
        return applyMutation(listType, slug, changes)
      }),
  )

  server.registerTool(
    'remove_card',
    {
      title: 'Remove card',
      description:
        'Remove a card from any list. Decks remove quantity copies (deleting the line at zero); ' +
        'collections and wanted lists keep one entry per physical card, so quantity must stay 1 ' +
        'there — remove entries individually (disambiguate with cardId). All-or-nothing: if any ' +
        'requested copy cannot be matched (names are exact and case-sensitive), the whole call ' +
        'fails and nothing is saved.',
      inputSchema: z
        .object({
          listType: listTypeSchema,
          slug: slugField,
          cardName: cardNameField,
          cardId: cardIdField,
          set: setField,
          collectorNumber: collectorNumberField,
          finish: finishSchema.optional().describe('Match only entries with this finish.'),
          condition: conditionSchema.optional().describe('Match only entries with this condition.'),
          language: languageSchema
            .optional()
            .describe('Match only entries with this language ("en" matches bare lines).'),
          quantity: quantityField.describe('Copies to remove (decks only; default 1).'),
        })
        .superRefine((val, ctx) => {
          if (val.quantity > 1 && val.listType !== 'deck') {
            ctx.addIssue({
              code: 'custom',
              message:
                'Collections and wanted lists keep one entry per physical card; remove entries ' +
                'one at a time, using cardId to pick the exact entry.',
            })
          }
        }),
      outputSchema: fromJsonSchema<MutationResult>(MUTATION_OUTPUT),
    },
    async ({
      listType,
      slug,
      cardName,
      cardId,
      set,
      collectorNumber,
      finish,
      condition,
      language,
      quantity,
    }) =>
      runTool((): Promise<MutationResult> => {
        const changes: ChangeEvent[] = Array.from({ length: quantity }, () =>
          createRemoveChange(cardName, {
            cardId,
            set,
            collectorNumber,
            finish,
            condition,
            language,
          }),
        )
        return applyMutation(listType, slug, changes)
      }),
  )

  server.registerTool(
    'set_card_printing',
    {
      title: 'Set card printing',
      description:
        'Set the printing (set/collector number/finish/condition/language) of a card in any ' +
        'list. Omit set and collectorNumber to clear the specific printing on a deck or ' +
        'wanted-list card; collections require both together, so omitting them there is ' +
        'rejected. condition accepts a grade or "NONE" to clear a recorded grade. language ' +
        'sets the card’s language alongside the printing ("en" = English, which clears the ' +
        'line’s token); omitting it leaves the current language alone.',
      inputSchema: z.object({
        listType: listTypeSchema,
        slug: slugField,
        cardName: cardNameField,
        cardId: cardIdField,
        set: setField,
        collectorNumber: collectorNumberField,
        finish: finishField,
        condition: conditionUpdateField,
        language: languageSchema
          .optional()
          .describe('New language for the card; omit to leave the current language alone.'),
      }),
      outputSchema: fromJsonSchema<MutationResult>(MUTATION_OUTPUT),
    },
    async ({
      listType,
      slug,
      cardName,
      cardId,
      set,
      collectorNumber,
      finish,
      condition,
      language,
    }) =>
      runTool((): Promise<MutationResult> => {
        const change = createSetPrintingChange(cardName, {
          set,
          collectorNumber,
          finish,
          condition,
          language,
          cardId,
        })
        return applyMutation(listType, slug, [change])
      }),
  )

  server.registerTool(
    'apply_changes',
    {
      title: 'Apply changes',
      description:
        'Apply an ordered batch of card-level changes (add/remove/set-finish/set-printing/' +
        'set-language/set-note/set-label/set-commander/unset-commander/set-section) to one list ' +
        'atomically: ' +
        'one load, one save, one changelog block. The batch is all-or-nothing — if any change ' +
        'fails to match (names are exact and case-sensitive), nothing is saved — but a later ' +
        'change may target a card an earlier change in the same batch added. Change ids and ' +
        'timestamps are stamped by the server. On a collection, add and ' +
        'set-printing require set + collectorNumber together. For cross-list moves use ' +
        'move_selected_cards. ' +
        'This is also the only way to set or clear a card note (set-note), change a card’s ' +
        'language on its own (set-language — "en" clears the token, since a bare line means ' +
        'English), set or clear a collection card’s label override (set-label — collections ' +
        'only), move a card to a section (set-section), and set or clear a deck commander ' +
        '(set-commander/unset-commander); the commander actions apply to decks only and fail ' +
        'on a collection or wanted list. ' +
        'Flagged destructive because a batch CAN remove cards in bulk — the note, label, ' +
        'section, and commander actions are themselves additive; the hint reflects worst-case ' +
        'capability, not what your batch does.',
      inputSchema: z
        .object({
          listType: listTypeSchema,
          slug: slugField,
          changes: z.array(applyChangeSchema).min(1).describe('Changes to apply, in order.'),
        })
        .superRefine((val, ctx) => {
          if (
            val.listType !== 'collection' &&
            val.changes.some((c) => c.action === 'add' && c.labels !== undefined)
          ) {
            ctx.addIssue({ code: 'custom', message: 'add labels apply to collections only.' })
          }
        }),
      outputSchema: fromJsonSchema<MutationResult>(MUTATION_OUTPUT),
      // Like import_change_bundle: a change batch can remove cards in bulk.
      annotations: { destructiveHint: true },
    },
    async ({ listType, slug, changes }) =>
      runTool((): Promise<MutationResult> => {
        const events: ChangeEvent[] = changes.map(toChangeEvent)
        return applyMutation(listType, slug, events)
      }),
  )

  server.registerTool(
    'move_selected_cards',
    {
      title: 'Move selected cards',
      description:
        'Move cards between lists in one atomic batch. Each move names its source entry ' +
        '(listType + slug + cardName, with cardId/copyIndex to pin the exact entry) and a ' +
        'destination list; set/collectorNumber/finish/condition/language override the printing ' +
        'on arrival, and toSection picks a destination deck section. Unresolvable moves are ' +
        'skipped and counted; notes that a destination cannot keep are reported in droppedNotes.',
      inputSchema: z.object({
        moves: z.array(moveItemSchema).min(1).describe('Moves to apply atomically.'),
      }),
      outputSchema: fromJsonSchema<MoveSelectedResult>(MOVE_SELECTED_CARDS_OUTPUT),
    },
    async ({ moves }) =>
      runTool(async (): Promise<MoveSelectedResult> => {
        const body: SelectedMoveRequest = {
          moves: moves.map(
            (m): SelectedMoveItem => ({
              ...toEntryTarget(m),
              toType: m.toListType,
              toSlug: m.toSlug,
              toSection: m.toSection,
              set: m.set,
              collectorNumber: m.collectorNumber,
              finish: m.finish,
              condition: m.condition,
              language: m.language,
            }),
          ),
          validateCardNames: true,
        }
        const data = await callApiData<MoveCommitResponse>('POST', '/api/move/selected', body)
        return data
      }),
  )

  server.registerTool(
    'remove_selected_cards',
    {
      title: 'Remove selected cards',
      description:
        'Remove a batch of cards across lists in one atomic pass. Each item names its entry by ' +
        'listType + slug + cardName, with cardId/copyIndex to pin the exact entry. Unresolvable ' +
        'items are skipped and counted.',
      inputSchema: z.object({
        removes: z.array(removeItemSchema).min(1).describe('Cards to remove atomically.'),
      }),
      outputSchema: fromJsonSchema<RemoveSelectedResult>(REMOVE_SELECTED_CARDS_OUTPUT),
    },
    async ({ removes }) =>
      runTool(async (): Promise<RemoveSelectedResult> => {
        const body: RemoveCommitRequest = {
          removes: removes.map(toEntryTarget),
          validateCardNames: true,
        }
        const data = await callApiData<RemoveCommitResponse>('POST', '/api/remove/commit', body)
        return data
      }),
  )
}
