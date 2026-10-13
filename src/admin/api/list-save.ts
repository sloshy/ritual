import path from 'node:path'
import { dedupeDroppedNotes, type DroppedNote } from '../../list/move-staging'
import type { CardLabel } from '../../card/card-labels'
import type { SaveEffect } from '../../changes/save-effects'
import { apiMessage, isApiMessage, plainMessage, type ApiMessage } from '../../api/result'
import type { ChangeAction, ChangeEvent } from '../../changes/change-event'
import type { DeckData } from '../../list/deck'
import type { CollectionCardEntry, WantedListCardEntry } from '../../list/site-data'
import type { ListType } from '../../list/list-type'
import type { LineQuantities } from '../../changes/line-copies'
import type { ParsedListContent } from '../../list/markdown-fence'
import type { FlatListFrontMatter } from '../../list/flat-list-front-matter'
import {
  assignDeckCardIds,
  assignEntryIds,
  collectDeckCardIds,
  type EntryWithCardId,
} from '../../card/card-id'
import { serializeDeckToMarkdown, validateDeckFrontMatter } from '../../list/deck-file'
import { readFrontMatterMapping } from '../../list/front-matter-write'
import { computeDeckSaveEffects, computeEntrySaveEffects } from '../../changes/save-effects'
import { isRecord } from '../../util/json'
import { dirForType } from '../../list/resolve-list'
import { parseDeckText } from '../../importers/text-file'
import { parseCollectionFile } from '../../list/collection-file'
import { parseWantedListFile } from '../../list/wanted-file'
import { toWantedCardEntries } from '../../list/wanted-entries'
import { collectionToMarkdown, wantedToMarkdown } from '../../list/list-export'
import { parseTitleFromContent } from '../../list/section-format'
import { applyChangeToDeck, droppedMoveNote } from '../../changes/deck-changes'
import {
  applyChangeToCollection,
  findCollectionPrintingError,
  toCollectionCardEntries,
} from '../../changes/collection-changes'
import { applyChangeToWantedList } from '../../changes/wanted-changes'
import { replaySectionOrder } from '../../changes/change-event'
import {
  applyChangesCollectingMisses,
  describeUnmatchedChanges,
  listUnmatchedChanges,
  type ApplyChange,
} from '../../changes/apply-batch'
import { deckLineQuantities, entryLineQuantities } from '../../changes/line-copies'
import { decodeWireChanges } from '../../changes/wire-changes'
import { normalizeNote } from '../../card/note-helpers'
import { changeCardNames, refuseUnknownCardNames } from './card-name-check'
import { applyCrossListMoves } from '../../list/move-prepare'
import {
  apiError,
  badRequest,
  errorResponse,
  nestedRefusal,
  readJsonObjectBody,
  type ApiErrorResponse,
} from '../../api/http'
import { changeProblemMessage } from '../../changes/change-problem-message'
import { isNonEmpty, type SyncMessage } from '../../sync/message'
import {
  validateContentHash,
  finishListSave,
  listSaveOutcome,
  listSaveResponse,
  refuseLineBreaks,
  refuseUnreadableBaseline,
  type ListSaveTail,
} from './save-helpers'
import {
  resolveDeckFile,
  resolveFlatListFile,
  resolveListFileOrRefuse,
  type ResolveListFile,
} from './list-file'
import { parseSlugFromUrl } from './target'
import { MAX_EDIT_BODY_SIZE } from '../validation'

export type { ListSaveRequest } from '../../changes/wire-changes'

/**
 * Success body of `POST /api/{deck|collection|wanted}/:slug/save`.
 * `droppedNotes` reports notes discarded by the destination side of this save's
 * cross-list moves (deck quantity merges keep the existing line's note).
 */
export type ListSaveResponse = ApiMessage & {
  success: true
  contentHash: string
  droppedNotes: DroppedNote[]
  /**
   * What the save did to individual entries, with the `&N` ids it allocated.
   *
   * The response is the only place these can appear: ids are assigned at
   * serialization time, so a client that added a card learns its id here rather
   * than by re-reading the list.
   */
  effects: SaveEffect[]
  /**
   * Custom-art sidecars this save could not re-file — its own, or a move
   * destination's. The card lines were written either way, which is why this is
   * a warning channel and not a failure: the same field name the load routes
   * use, so a client reads sidecar trouble out of one place in both directions.
   * Omitted when every reconcile was clean.
   */
  artWarnings?: string[]
  /**
   * The categories sidecar this save could not read or write. The card lines
   * were written either way — a warning channel like {@link artWarnings}.
   * Omitted when the sidecar was written (or left alone) cleanly.
   */
  categoryWarnings?: string[]
  /**
   * Card names whose category assignments this save dropped, because the list no
   * longer holds a line of that name. Omitted when nothing was pruned.
   */
  prunedCategories?: string[]
}

/**
 * The 400 a save answers when a change does not apply to the list as it stands:
 * nothing is written, and `unmatched` names each change that missed (described
 * in English, plus the reason), so a client can say which edit is stale. The
 * summary's params nest (each change description is a message of its own), so
 * this is the nested refusal envelope.
 */
export type ListSaveRefusal = ApiErrorResponse & {
  unmatched: string[]
}

/** The list on disk, parsed: the baseline the events are replayed over. */
type ListBaseline<TData> = {
  parsed: ParsedListContent
  data: TData
  /** The subject of the changelog entry, commit and response: a deck's name, a flat list's slug. */
  subject: string
  /**
   * The list's display name — a deck's name, a flat list's `# Title` — which is
   * how a cross-list move names this list in the *other* list's events, and how
   * those refs resolve back (`findList` matches on it), so never the slug.
   */
  displayName: string
  /** Serialize the replayed list, ids already assigned. */
  serialize: (data: TData) => string
  /**
   * The list's front-matter default labels, read from the file: what an
   * incoming `move-to` measures the labels it carries against
   * (`ApplyChangeOptions.listLabels`).
   */
  listLabels?: CardLabel[]
}

/** A refusal raised while reading the baseline. */
type BaselineResult<TData> =
  { ok: true; baseline: ListBaseline<TData> } | { ok: false; response: Response }

/** Where the baseline comes from, beyond its text. */
type BaselineSource = {
  content: string
  slug: string
  /**
   * The name a list without a `# Title` goes by: its file name, as the load
   * route reports it — never the request's slug, which a loose lookup may have
   * matched (`winota-stax` → `Winota Stax.md`).
   */
  fallbackName: string
  changes: readonly ChangeEvent[]
}

/** What differs between the three list types; everything else is the shared route. */
interface ListSaveAdapter<TData> {
  type: ListType
  resolveFile: ResolveListFile
  readBaseline: (source: BaselineSource) => BaselineResult<TData>
  apply: ApplyChange<TData, ChangeEvent>
  lineQuantities: (data: TData) => LineQuantities
  cardIds: (data: TData) => number[]
  cardNames: (data: TData) => string[]
  /** Assign ids to every line, reporting what each line ended up with. */
  finalize: (before: TData, after: TData) => FinalizedList<TData>
  /** Refuse a batch this list type cannot take before any file is read. */
  refuseChanges?: (changes: readonly ChangeEvent[]) => SyncMessage | null
  /**
   * The note an incoming change would discard landing on the list as it stands
   * (a deck quantity-merge keeps the line's own note); flat lists never merge.
   */
  droppedNote?: (
    data: TData,
    change: ChangeEvent,
    listLabels: readonly CardLabel[] | undefined,
  ) => DroppedNote | undefined
}

type FinalizedList<TData> = { data: TData; effects: SaveEffect[]; cardNames: string[] }

function deckCardNames(deck: DeckData): string[] {
  return deck.sections.flatMap((section) => section.cards.map((card) => card.name))
}

const deckAdapter: ListSaveAdapter<DeckData> = {
  type: 'deck',
  resolveFile: resolveDeckFile,
  readBaseline: ({ content, fallbackName }) => {
    // Front matter first: the deck parse throws on unreadable YAML, and that
    // must be this refusal rather than an unexplained 500. It is the file's own,
    // never the client's — an editor session that saved a stale snapshot would
    // delete a cover image or default labels the metadata route wrote
    // mid-session — and unreadable front matter is refused rather than dropped,
    // which is what re-serializing without it would do.
    const frontMatter = readFrontMatterMapping(content)
    if (!frontMatter.ok) {
      const refusal =
        frontMatter.reason === 'invalid-yaml'
          ? apiMessage('admin.api.save.frontMatterUnreadable', { reason: frontMatter.detail })
          : apiMessage('admin.api.save.frontMatterNotMapping')
      return { ok: false, response: badRequest(refusal) }
    }
    const validated = validateDeckFrontMatter(frontMatter.data)
    const parsed = parseDeckText(content, fallbackName)
    return {
      ok: true,
      baseline: {
        parsed,
        data: parsed.deck,
        subject: parsed.deck.name,
        displayName: parsed.deck.name,
        serialize: (deck) => serializeDeckToMarkdown(deck, validated),
        listLabels: validated.labels,
      },
    }
  },
  // The replay hands every apply the file's own default (`baseline.listLabels`).
  apply: (deck, change, options) =>
    applyChangeToDeck(deck, change, { ...options, listLabels: options?.listLabels }),
  droppedNote: (deck, change, listLabels) => {
    if (change.action !== 'move-to') return undefined
    const note = droppedMoveNote(deck, change, { listLabels })
    return note === undefined
      ? undefined
      : { cardName: change.cardName, cardId: change.sourceCardId, note }
  },
  lineQuantities: deckLineQuantities,
  cardIds: collectDeckCardIds,
  cardNames: deckCardNames,
  finalize: (before, after) => {
    const { deck, assignments } = assignDeckCardIds(after)
    return {
      data: deck,
      effects: computeDeckSaveEffects({ before, after: deck, assignments }),
      cardNames: deckCardNames(deck),
    }
  },
}

/** A flat list's line, as far as the shared steps read it. */
type FlatEntry = EntryWithCardId & { name: string }

/** A flat list file as its parser returns it, as far as the save reads it. */
type ParsedFlatList<TParsedEntry> = ParsedListContent & {
  entries: TParsedEntry[]
  sectionOrder: string[]
  frontMatter?: FlatListFrontMatter
  /** The list's default card labels (collections), when legally declared. */
  labels?: CardLabel[]
}

/** What tells one flat list type from the other. */
type FlatListSpec<TParsedEntry, TEntry extends FlatEntry> = {
  type: Exclude<ListType, 'deck'>
  parse: (content: string) => ParsedFlatList<TParsedEntry>
  toEntries: (parsed: TParsedEntry[]) => TEntry[]
  toMarkdown: (
    title: string,
    entries: TEntry[],
    sectionOrder: string[],
    frontMatter?: FlatListFrontMatter,
  ) => string
  apply: ApplyChange<TEntry[], ChangeEvent>
  refuseChanges?: (changes: readonly ChangeEvent[]) => SyncMessage | null
}

function entryCardNames(entries: readonly FlatEntry[]): string[] {
  return entries.map((entry) => entry.name)
}

function entryCardIds(entries: readonly FlatEntry[]): number[] {
  return entries.flatMap((entry) => (entry.cardId === undefined ? [] : [entry.cardId]))
}

/** The adapter both flat lists share: one entry per copy, sectioned, titled. */
function flatListAdapter<TParsedEntry, TEntry extends FlatEntry>(
  spec: FlatListSpec<TParsedEntry, TEntry>,
): ListSaveAdapter<TEntry[]> {
  return {
    type: spec.type,
    resolveFile: resolveFlatListFile,
    readBaseline: ({ content, slug, fallbackName, changes }) => {
      const parsed = spec.parse(content)
      const title = parseTitleFromContent(content) ?? fallbackName
      // The file's order with the events' add/rename/remove-section replayed over
      // it — which is how an empty section the session added survives the write.
      const order = replaySectionOrder(parsed.sectionOrder, changes)
      return {
        ok: true,
        baseline: {
          parsed,
          data: spec.toEntries(parsed.entries),
          subject: slug,
          displayName: title,
          serialize: (entries) => spec.toMarkdown(title, entries, order, parsed.frontMatter),
          listLabels: parsed.labels,
        },
      }
    },
    apply: spec.apply,
    lineQuantities: entryLineQuantities,
    cardIds: entryCardIds,
    cardNames: entryCardNames,
    finalize: (before, after) => {
      const { entries, assignments } = assignEntryIds(after)
      return {
        data: entries,
        effects: computeEntrySaveEffects({ before, after: entries, assignments }),
        cardNames: entryCardNames(entries),
      }
    },
    refuseChanges: spec.refuseChanges,
  }
}

const collectionAdapter: ListSaveAdapter<CollectionCardEntry[]> = flatListAdapter({
  type: 'collection',
  parse: parseCollectionFile,
  toEntries: toCollectionCardEntries,
  toMarkdown: collectionToMarkdown,
  apply: applyChangeToCollection,
  refuseChanges: findCollectionPrintingError,
})

const wantedAdapter: ListSaveAdapter<WantedListCardEntry[]> = flatListAdapter({
  type: 'wanted',
  parse: parseWantedListFile,
  toEntries: toWantedCardEntries,
  toMarkdown: wantedToMarkdown,
  apply: applyChangeToWantedList,
})

/** The fields of a save request that are not the events themselves, checked. */
type SaveOptions = { contentHash: string; continueSession: boolean; validateCardNames: boolean }

function readSaveOptions(body: Record<string, unknown>): SaveOptions | ApiMessage {
  // The refusal says why a client may have no hash: a filtered or paged load
  // carries none, because only a full load shows the whole list the changes are
  // replayed over, so a client that did not realise its load was narrowed is
  // told how to get one.
  if (body.changes === undefined || typeof body.contentHash !== 'string') {
    return apiMessage('admin.api.save.fieldsRequired')
  }
  for (const flag of ['continueSession', 'validateCardNames'] as const) {
    if (body[flag] !== undefined && typeof body[flag] !== 'boolean') {
      return apiMessage('admin.api.field.notBoolean', { field: flag })
    }
  }
  return {
    contentHash: body.contentHash,
    continueSession: body.continueSession === true,
    validateCardNames: body.validateCardNames === true,
  }
}

/** The actions whose `note` lands on a card line: a `set-note`, and the moved copy's note on either half of a move. */
const NOTE_CARRYING_ACTIONS = [
  'set-note',
  'move-from',
  'move-to',
] as const satisfies readonly ChangeAction[]

/**
 * Trim each raw note-carrying change's note in place — a pasted trailing
 * newline is not part of the note — refusing one that holds control characters.
 * Runs before the line-break check, which would otherwise refuse that newline.
 */
function normalizeRawNotes(changes: unknown): Response | null {
  if (!Array.isArray(changes)) return null
  const items: readonly unknown[] = changes
  for (const change of items) {
    if (
      !isRecord(change) ||
      !(NOTE_CARRYING_ACTIONS as readonly unknown[]).includes(change.action) ||
      typeof change.note !== 'string'
    ) {
      continue
    }
    const result = normalizeNote(change.note)
    if (!result.ok) return badRequest(plainMessage(result.error))
    change.note = result.note
  }
  return null
}

/**
 * Refuse an `add` / `move-to` id beyond what this save could need: one past the
 * list's highest id for every change in the batch. An id is a hint the reducers
 * honour, and the id pool fills every number up to the highest one in the file,
 * so `&2000000000` would cost the next load of this list that many entries.
 */
function refuseRunawayIds(
  changes: readonly ChangeEvent[],
  baselineIds: number[],
): ApiMessage | null {
  const ceiling = Math.max(0, ...baselineIds) + changes.length
  for (const [index, change] of changes.entries()) {
    if (change.action !== 'add' && change.action !== 'move-to') continue
    if (change.cardId !== undefined && change.cardId > ceiling) {
      return apiMessage('admin.api.save.idPastCeiling', { index, id: change.cardId, ceiling })
    }
  }
  return null
}

async function saveList<TData>(req: Request, adapter: ListSaveAdapter<TData>): Promise<Response> {
  const { type } = adapter
  const parsedSlug = parseSlugFromUrl(req)
  if (!parsedSlug.ok) return apiError(parsedSlug.refusal, 400)
  const { slug } = parsedSlug

  const parsedBody = await readJsonObjectBody(req, MAX_EDIT_BODY_SIZE)
  if (!parsedBody.ok) return parsedBody.response
  const body = parsedBody.body
  const options = readSaveOptions(body)
  if (isApiMessage(options)) return apiError(options, 400)

  // Over the raw events, before decoding: the decoder refuses a line break
  // too, but in plain words, and this refusal carries a message key and the
  // JSON path for the editor to show in the reader's language.
  const noteError = normalizeRawNotes(body.changes)
  if (noteError) return noteError
  const lineBreakError = refuseLineBreaks({ changes: body.changes })
  if (lineBreakError) return lineBreakError

  const decoded = decodeWireChanges(body.changes, type, Date.now())
  if (!decoded.ok) return nestedRefusal(changeProblemMessage(decoded.problem))
  const changes = decoded.value
  const refusal = adapter.refuseChanges?.(changes) ?? null
  if (refusal) return nestedRefusal(refusal)

  const resolved = await resolveListFileOrRefuse(adapter.resolveFile, {
    slug,
    dir: dirForType(type),
    listType: type,
  })
  if (!resolved.ok) return resolved.response
  const { filePath } = resolved

  const hashCheck = await validateContentHash(filePath, options.contentHash, type)
  if (!hashCheck.valid) return hashCheck.response

  const read = adapter.readBaseline({
    content: hashCheck.content,
    slug,
    fallbackName: path.basename(filePath, '.md'),
    changes,
  })
  if (!read.ok) return read.response
  const { baseline } = read
  // A line this parse could not read is a line the save would delete, because
  // the write re-serializes the whole list — refuse instead.
  const unreadable = refuseUnreadableBaseline(filePath, baseline.parsed)
  if (unreadable) return unreadable

  const runaway = refuseRunawayIds(changes, adapter.cardIds(baseline.data))
  if (runaway) return apiError(runaway, 400)

  // Checked against the file, never the replayed list: that already holds the
  // change and would vouch for the very name being added.
  const nameError = await refuseUnknownCardNames(
    options.validateCardNames,
    changeCardNames(changes),
    () => adapter.cardNames(baseline.data),
  )
  if (nameError) return nameError

  // A miss means the caller's view of the list is wrong (the content hash only
  // guards against concurrent *file* edits). Refusing is the only honest
  // answer: a save that reported success while dropping changes would also
  // write a changelog entry for edits that never happened.
  // Replayed against the file's own default labels, so an incoming move writes
  // the minimal override; a `move-to` that merges onto a deck line with a
  // different note is recorded as it lands, the way the move engines report it.
  const replayDrops: DroppedNote[] = []
  const replayed = applyChangesCollectingMisses(baseline.data, changes, adapter.apply, {
    listLabels: baseline.listLabels,
    before: (current, change) => {
      const dropped = adapter.droppedNote?.(current, change, baseline.listLabels)
      if (dropped !== undefined) replayDrops.push(dropped)
    },
  })
  if (isNonEmpty(replayed.unmatched)) {
    const refused: ListSaveRefusal = {
      success: false,
      ...describeUnmatchedChanges(replayed.unmatched, { type, slug }),
      unmatched: listUnmatchedChanges(replayed.unmatched),
    }
    return Response.json(refused, { status: 400 })
  }

  // The other side of any cross-list moves goes first — the destination of each
  // `move-from`, the source of each `move-to` — every one validated in memory
  // before anything lands, so a bad destination or a source with no copy to
  // take aborts before this list is written.
  const previousLineQuantities = adapter.lineQuantities(baseline.data)
  const moves = await applyCrossListMoves(
    { type, name: baseline.displayName },
    filePath,
    changes,
    previousLineQuantities,
  )

  const finalized = adapter.finalize(baseline.data, replayed.data)
  const tail: ListSaveTail = {
    listType: type,
    filePath,
    content: baseline.serialize(finalized.data),
    changelogName: baseline.subject,
    changes,
    // Computed before the write: the tail re-files the list's custom art
    // against the ids these effects report as freed or renumbered.
    effects: finalized.effects,
    previousLineQuantities,
    continueSession: options.continueSession,
    extraFiles: moves.writtenFiles,
    adoptedArt: moves.adoptedArt,
    // The names the written content holds — what the categories sidecar (keyed
    // by card name) is pruned against.
    cardNames: finalized.cardNames,
  }
  const saved = await finishListSave(tail)
  const droppedNotes = dedupeDroppedNotes([...replayDrops, ...moves.droppedNotes])
  return Response.json(listSaveResponse(tail, listSaveOutcome(saved, { ...moves, droppedNotes })))
}

/**
 * `POST /api/{deck|collection|wanted}/:slug/save` — apply a batch of changes.
 *
 * The request carries only the changes (`ListSaveRequest`); the list never
 * travels. The route parses the file, replays the events over it with the same
 * reducers the editors use, and writes the result, so a save scales with the
 * edit rather than the list and a client cannot write content its events do not
 * describe. Front matter, the title, and the section order come from the file
 * (the order replayed over the events' section changes); front matter is edited
 * through the metadata route.
 */
export async function handleListSave(req: Request, type: ListType): Promise<Response> {
  try {
    switch (type) {
      case 'deck':
        return await saveList(req, deckAdapter)
      case 'collection':
        return await saveList(req, collectionAdapter)
      case 'wanted':
        return await saveList(req, wantedAdapter)
    }
  } catch (error) {
    return errorResponse(error)
  }
}
