import * as fs from 'node:fs/promises'
import path from 'node:path'
import {
  createAddChange,
  createRemoveChange,
  createSetNoteChange,
  createSetPrintingChange,
  type AddRemoveOptions,
  type ChangeEvent,
  type MoveToChange,
} from '../changes/change-event'
import type { CollectionCardEntry, WantedListCardEntry } from '../list/site-data'
import { DEFAULT_SECTION } from '../list/deck'
import type { ScryfallCard } from '../scryfall/types'
import { parseTitleFromContent } from '../list/section-format'
import { unreadableLines } from '../list/markdown-fence'
import { writeFileWithHash } from '../changes/content-hash'
import {
  allocateId,
  collectExistingIds,
  createIdPool,
  releaseId,
  repackSessionIds,
  type CardIdPool,
} from '../card/card-id'
import { applyChangeToCollection } from '../changes/collection-changes'
import { applyChangeToWantedList } from '../changes/wanted-changes'
import { collectionToMarkdown, wantedToMarkdown } from '../list/list-export'
import { getCardPrintings } from '../scryfall'
import {
  findCheapestPrinting,
  formatCheapestPrintingDisplay,
  formatSpecificPrintingPrice,
} from '../pricing/price-currency'
import { getDefaultCurrency } from '../config/ritual-config'
import { t } from '../i18n/t'
import { trackAdd, trackAnotherCopy, trackEdit } from '../changes/session-changelog'
import { parseCollectionFile, type CollectionEntry } from '../list/collection-file'
import { parseWantedListFile, type WantedListEntry } from './wanted-helpers'
import type { FlatListFrontMatter } from '../list/flat-list-front-matter'
import type { CardArtRef } from '../list/card-art'
import {
  commitSessionArt,
  createSessionArtChanges,
  noteArtArrival,
  noteArtRepack,
  warnUnreconciledArt,
  type SessionArtChanges,
} from './session-art'
import type { CardSessionContext, SessionAddItem } from './card-session'
import type { EditUndoEntry } from './edit-undo'
import type { ApplyChange } from '../changes/apply-batch'

/** The minimal entry shape the flat-list session machinery relies on. */
export type FlatListEntry = { section: string; cardId?: number }

/**
 * In-memory session model for the flat list types (collections and wanted
 * lists), mirroring how the admin editor works: parse the file into entries
 * once, apply each edit as a {@link ChangeEvent} in memory, and re-serialize the
 * whole file in canonical form when the session is explicitly saved. Card IDs
 * come from a {@link CardIdPool} seeded at load, so removals' IDs are reused and
 * the file is never re-read mid-session.
 */
export type FlatListSession<E extends FlatListEntry> = {
  filePath: string
  /** The `# Title` H1, preserved on every save. */
  title: string
  entries: E[]
  /** Section names in file order, including empty sections. */
  sectionOrder: string[]
  /** The file's front-matter block (a collection's `labels:` default), preserved on every save. */
  frontMatter?: FlatListFrontMatter
  pool: CardIdPool
  /** Whether the in-memory entries differ from what was last written to disk. */
  dirty: boolean
  /**
   * Pending `<list>.art.json` edits, applied by the same save that writes the
   * entries — the sidecar is keyed by `&N`, and this session reuses the ids its
   * removals free.
   */
  art: SessionArtChanges
  apply: ApplyChange<E[], ChangeEvent>
  serialize: FlatListSerialize<E>
}

/** A flat list's whole-file serializer: title + entries + sections + preserved front matter. */
type FlatListSerialize<E> = (
  title: string,
  entries: E[],
  sectionOrder: string[],
  frontMatter?: FlatListFrontMatter,
) => string

export type CollectionSession = FlatListSession<CollectionCardEntry>
export type WantedSession = FlatListSession<WantedListCardEntry>

/** Assign pool-allocated IDs to any entries that lack one (persisted on the first save). */
function assignMissingIds<E extends FlatListEntry>(entries: E[]): CardIdPool {
  const pool = createIdPool(collectExistingIds(entries))
  for (const entry of entries) {
    if (entry.cardId === undefined) entry.cardId = allocateId(pool)
  }
  return pool
}

/**
 * An empty session for a flat list that does not exist on disk yet. It starts
 * dirty, so the list's creation is itself a pending change: saving the session
 * writes the file, exiting without saving never creates it.
 */
export function newCollectionSession(filePath: string, title: string): CollectionSession {
  return newFlatListSession(filePath, title, applyChangeToCollection, collectionToMarkdown)
}

/** An empty session for a wanted list that does not exist on disk yet. */
export function newWantedSession(filePath: string, title: string): WantedSession {
  return newFlatListSession(filePath, title, applyChangeToWantedList, wantedToMarkdown)
}

function newFlatListSession<E extends FlatListEntry>(
  filePath: string,
  title: string,
  apply: ApplyChange<E[], ChangeEvent>,
  serialize: FlatListSerialize<E>,
): FlatListSession<E> {
  return {
    filePath,
    title,
    entries: [],
    sectionOrder: [],
    pool: createIdPool([]),
    dirty: true,
    art: createSessionArtChanges(),
    apply,
    serialize,
  }
}

/**
 * Map parsed collection entries to the editor entry shape the serializers work
 * with, defaulting the fields the file format leaves implicit (finish, condition)
 * and fields the CLI doesn't price (price, fileOrder).
 */
function collectionEntriesFromParse(entries: CollectionEntry[]): CollectionCardEntry[] {
  return entries.map((e, i) => ({
    name: e.name,
    set: e.set,
    collectorNumber: e.collectorNumber,
    finish: e.finish ?? 'nonfoil',
    condition: e.condition ?? 'NM',
    // The written token only — never resolved to `en`, so a re-serialize
    // round-trips bare lines as bare lines.
    language: e.language,
    labels: e.labels,
    price: 0,
    fileOrder: i,
    section: e.section,
    note: e.note,
    cardId: e.cardId,
  }))
}

/** Map parsed wanted-list entries to the editor entry shape, deriving each entry's state. */
function wantedEntriesFromParse(entries: WantedListEntry[]): WantedListCardEntry[] {
  return entries.map((e, i) => ({
    name: e.name,
    set: e.set,
    collectorNumber: e.collectorNumber,
    finish: e.finish,
    language: e.language,
    price: 0,
    fileOrder: i,
    section: e.section,
    note: e.note,
    state: !e.set || !e.collectorNumber ? 'name-only' : e.finish ? 'fully-specified' : 'printing',
    cardId: e.cardId,
  }))
}

/**
 * A flat-list file read from disk: its raw content, its title (the `# Title` H1,
 * falling back to the file's basename), its entries in the editor entry shape
 * with missing IDs assigned, and the parser's skipped-line warnings.
 */
export type ParsedFlatListFile<E extends FlatListEntry> = {
  content: string
  title: string
  entries: E[]
  sectionOrder: string[]
  /** The file's front-matter block, carried so every re-serialize preserves it. */
  frontMatter?: FlatListFrontMatter
  warnings: string[]
  /**
   * Non-blocking notices about lines that parsed but almost certainly do not say
   * what the author meant — today, a card name that starts with a quantity.
   * Kept apart from `warnings` because a re-serialize preserves these lines
   * verbatim, so they must not gate the whole-file rewrite the way unreadable
   * lines do.
   */
  advisories: string[]
  pool: CardIdPool
}

/** What a flat-list parser produces, structurally common to collections and wanted lists. */
type FlatListParse<Raw> = {
  entries: Raw[]
  sectionOrder: string[]
  frontMatter?: FlatListFrontMatter
  warnings: string[]
  fencedLines: number
  advisories: string[]
}

/**
 * The shared read→parse→map→assign-IDs→title prelude behind every consumer of a
 * collection or wanted-list file (the edit sessions here, the `cleanup` command),
 * so the two can never disagree about how a file's entries and title are derived.
 */
async function readFlatListFile<Raw, E extends FlatListEntry>(
  filePath: string,
  parse: (content: string) => FlatListParse<Raw>,
  entriesFromParse: (entries: Raw[]) => E[],
): Promise<ParsedFlatListFile<E>> {
  const content = await fs.readFile(filePath, 'utf-8')
  const parsed = parse(content)
  const entries = entriesFromParse(parsed.entries)
  return {
    content,
    title: parseTitleFromContent(content) ?? path.basename(filePath, '.md'),
    entries,
    sectionOrder: parsed.sectionOrder,
    frontMatter: parsed.frontMatter,
    // Fenced code blocks join the parse warnings here: every consumer of this
    // read re-serializes the whole file, which would delete the block.
    warnings: unreadableLines(parsed),
    advisories: parsed.advisories,
    pool: assignMissingIds(entries),
  }
}

/** Read and parse a collection file into editor-shaped entries. */
export function readCollectionFile(
  filePath: string,
): Promise<ParsedFlatListFile<CollectionCardEntry>> {
  return readFlatListFile(filePath, parseCollectionFile, collectionEntriesFromParse)
}

/** Read and parse a wanted-list file into editor-shaped entries. */
export function readWantedFile(filePath: string): Promise<ParsedFlatListFile<WantedListCardEntry>> {
  return readFlatListFile(filePath, parseWantedListFile, wantedEntriesFromParse)
}

/** Load a collection file into a session model, surfacing any parse warnings. */
export async function loadCollectionSession(filePath: string): Promise<CollectionSession> {
  const file = await readCollectionFile(filePath)
  for (const warning of [...file.warnings, ...file.advisories]) console.warn(warning)
  return {
    filePath,
    title: file.title,
    entries: file.entries,
    sectionOrder: file.sectionOrder,
    frontMatter: file.frontMatter,
    pool: file.pool,
    dirty: false,
    art: createSessionArtChanges(),
    apply: applyChangeToCollection,
    serialize: collectionToMarkdown,
  }
}

/** Load a wanted-list file into a session model, surfacing any parse warnings. */
export async function loadWantedSession(filePath: string): Promise<WantedSession> {
  const file = await readWantedFile(filePath)
  for (const warning of [...file.warnings, ...file.advisories]) console.warn(warning)
  return {
    filePath,
    title: file.title,
    entries: file.entries,
    sectionOrder: file.sectionOrder,
    frontMatter: file.frontMatter,
    pool: file.pool,
    dirty: false,
    art: createSessionArtChanges(),
    apply: applyChangeToWantedList,
    serialize: wantedToMarkdown,
  }
}

/**
 * The section new cards are added to: the file's last section, preserving the
 * historical append-at-end-of-file behavior of the CLI commands.
 */
export function flatListTargetSection<E extends FlatListEntry>(
  session: FlatListSession<E>,
): string {
  return session.sectionOrder[session.sectionOrder.length - 1] ?? DEFAULT_SECTION
}

/**
 * Apply a change to the session's in-memory entries. The file is not touched —
 * call {@link persistFlatListSession} (the session's Save or save-and-exit actions) to write it.
 *
 * Note: `remove` changes shrink the entry array but do not release the entry's ID
 * back to {@link FlatListSession.pool} — the edit-mode removal flow
 * (`removeFlatListEntry` in `flat-list-edit.ts`) owns that bookkeeping.
 */
export function applyFlatListChange<E extends FlatListEntry>(
  session: FlatListSession<E>,
  change: ChangeEvent,
): void {
  session.entries = session.apply(session.entries, change)
  session.dirty = true
}

/**
 * Receive the destination side of a cross-list move on an open flat-list
 * session: the moved card arrives as a fresh entry with an id from this
 * list's own pool (the event's cardId is the source list's, kept for its
 * changelog only) in the session's target section — the same placement a
 * regular add gets. Shared by the collection and wanted strategies so the
 * "how a moved card lands" rule exists once.
 *
 * `art` is the moved card's custom art in the source list, which follows it onto
 * the id allocated here — the in-memory counterpart of what `applyAddToStaged`'s
 * reported id lets the on-disk move paths do.
 */
export function receiveFlatListMove<E extends FlatListEntry>(
  session: FlatListSession<E>,
  change: MoveToChange,
  art?: CardArtRef,
): void {
  const cardId = allocateId(session.pool)
  applyFlatListChange(
    session,
    createAddChange(change.cardName, {
      set: change.set,
      collectorNumber: change.collectorNumber,
      finish: change.finish,
      condition: change.condition,
      language: change.language,
      cardId,
      section: flatListTargetSection(session),
    }),
  )
  if (art) noteArtArrival(session.art, cardId, art)
}

/**
 * Write the session's in-memory entries back to its file in canonical form,
 * creating the list directory when the session is a new one whose file has
 * never existed. The list's custom-art sidecar is re-filed in the same step, so
 * the ids the session freed never carry their art onto the cards that take them.
 */
export async function persistFlatListSession<E extends FlatListEntry>(
  session: FlatListSession<E>,
): Promise<void> {
  await fs.mkdir(path.dirname(session.filePath), { recursive: true })
  await writeFileWithHash(
    session.filePath,
    session.serialize(session.title, session.entries, session.sectionOrder, session.frontMatter),
  )
  session.dirty = false
  warnUnreconciledArt(await commitSessionArt(session.filePath, session.art))
}

// ── Shared strategy operations ──────────────────────────────────────

/** Everything needed to render and re-add the last added entry. */
export type LastAddSnapshot = { options: AddRemoveOptions; note?: string }

/** Mutable holder for the last added entry's snapshot, owned by each strategy. */
export type LastAddState = { snapshot: LastAddSnapshot | null }

/** How to report the price of a fresh add: the cheapest printing, or a specific one. */
export type PriceDisplay = { kind: 'cheapest' } | { kind: 'specific'; printing: ScryfallCard }

/** The printing fields of an add, before the session fills in the card ID and section. */
export type FlatListPrintingOptions = Omit<AddRemoveOptions, 'cardId' | 'section'>

/** Ties a flat-list session to its strategy-local snapshot state and line renderer. */
export type FlatListStrategyContext<E extends FlatListEntry> = {
  session: FlatListSession<E>
  state: LastAddState
  /** Render a freshly-added card's canonical line from its add snapshot (pre-persistence). */
  renderLine: (name: string, snapshot: LastAddSnapshot, cardId: number) => string
  /** Render an already-persisted entry as its canonical line, for the discard picker. */
  renderEntry: (entry: E) => string
  /** Card ids added this session, in add order (drives the undo/discard menu). */
  sessionAdds: number[]
  /** Linear undo stack for edit-mode operations, oldest first. */
  editUndo: EditUndoEntry[]
  /**
   * Session-start snapshots of entries touched in edit mode, keyed by card id.
   * Used so an entry edited back to its original state drops out of the
   * changelog entirely (the consolidate* "latest wins" comparisons).
   */
  originals: Map<number, E>
}

/**
 * Reset the per-session tracking after a mid-session save: everything so far is
 * committed to disk and the changelog, so the undo/discard menus must not be
 * able to claw it back, and edit consolidation baselines restart from the saved state.
 */
export function resetFlatListSessionTracking<E extends FlatListEntry>(
  list: FlatListStrategyContext<E>,
): void {
  list.sessionAdds = []
  list.editUndo = []
  list.originals.clear()
  list.state.snapshot = null
}

/**
 * The shared add/edit tail of a flat-list card entry, once the command-specific
 * prompts have resolved the printing details. A fresh add appends a new entry
 * (and reports its price); an edit re-targets the just-added entry by card ID
 * and updates its changelog event in place so the log shows the final state.
 */
export async function applyFlatListCardEntry<E extends FlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  cardName: string,
  printingOptions: FlatListPrintingOptions,
  isEditing: boolean,
  price: PriceDisplay,
): Promise<void> {
  const { session, state } = list
  // When editing, preserve the card's existing ID. Only allocate a new one for a fresh add.
  const cardId: number =
    isEditing && ctx.lastAdded?.cardId !== undefined
      ? ctx.lastAdded.cardId
      : allocateId(session.pool)
  const options: AddRemoveOptions = {
    ...printingOptions,
    cardId,
    section: flatListTargetSection(session),
  }
  // The changelog records the entry's final state as an add in both flows.
  const addEvent = createAddChange(cardName, options)

  if (isEditing && ctx.lastAdded) {
    applyFlatListChange(
      session,
      createSetPrintingChange(cardName, {
        set: options.set,
        collectorNumber: options.collectorNumber,
        finish: options.finish,
        condition: options.condition,
        // Explicit, `en` included: an absent language would leave the previous
        // add's token alone, but an edit replaces the entry's options wholesale.
        language: options.language ?? 'en',
        cardId,
      }),
    )
    ctx.lastChangeIndex = trackEdit(ctx.sessionChanges, ctx.lastChangeIndex, addEvent, true)
    state.snapshot = { options, note: state.snapshot?.note }
    ctx.lastAdded = { name: cardName, hasNote: ctx.lastAdded.hasNote, cardId }
    console.log(
      t('cli.edit.editedLine', { line: list.renderLine(cardName, state.snapshot, cardId) }),
    )
  } else {
    applyFlatListChange(session, addEvent)
    ctx.lastChangeIndex = trackAdd(ctx.sessionChanges, addEvent)
    list.sessionAdds.push(cardId)
    state.snapshot = { options }
    ctx.lastAdded = { name: cardName, hasNote: false, cardId }
    console.log(
      t('cli.edit.addedLine', { line: list.renderLine(cardName, state.snapshot, cardId) }),
    )
    if (price.kind === 'cheapest') {
      const printings = await getCardPrintings(cardName)
      const currency = getDefaultCurrency()
      console.log(
        formatCheapestPrintingDisplay(findCheapestPrinting(printings, currency), currency),
      )
    } else {
      console.log(formatSpecificPrintingPrice(price.printing, options.finish, getDefaultCurrency()))
    }
  }
  ctx.lastAddedCount = 1
}

/**
 * Add another copy of the last added entry: a new entry with a fresh card ID and
 * an otherwise identical line, including the previous entry's note.
 */
export async function addAnotherFlatListCopy<E extends FlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
): Promise<void> {
  const { session, state } = list
  if (!ctx.lastAdded || !state.snapshot) return
  const cardId = allocateId(session.pool)
  applyFlatListChange(
    session,
    createAddChange(ctx.lastAdded.name, { ...state.snapshot.options, cardId }),
  )
  list.sessionAdds.push(cardId)
  const newIdx = trackAnotherCopy(ctx.sessionChanges, ctx.lastChangeIndex, cardId)
  if (newIdx !== null) ctx.lastChangeIndex = newIdx
  // Copies inherit the previous entry's note, mirroring the rest of its line.
  if (state.snapshot.note) {
    const noteChange = createSetNoteChange(ctx.lastAdded.name, {
      note: state.snapshot.note,
      cardId,
    })
    applyFlatListChange(session, noteChange)
    ctx.sessionChanges.push(noteChange)
  }
  ctx.lastAddedCount++
  ctx.lastAdded = { ...ctx.lastAdded, cardId }
  console.log(
    t('cli.edit.addedLineTotal', {
      line: list.renderLine(ctx.lastAdded.name, state.snapshot, cardId),
      count: ctx.lastAddedCount,
    }),
  )
}

// ── Discarding session adds ─────────────────────────────────────────

/** A flat-list entry carries a card name (both collection and wanted entries do). */
type NamedFlatListEntry = FlatListEntry & { name: string }

/**
 * The cards added this session, in add order, rendered for the discard picker.
 * Indices align 1:1 with {@link FlatListStrategyContext.sessionAdds} so the engine
 * can pass a chosen index straight back to {@link discardFlatListAdd}.
 */
export function listFlatListSessionAdds<E extends NamedFlatListEntry>(
  list: FlatListStrategyContext<E>,
): SessionAddItem[] {
  return list.sessionAdds.map((cardId) => {
    const entry = list.session.entries.find((e) => e.cardId === cardId)
    return entry
      ? { label: list.renderEntry(entry), name: entry.name }
      : { label: t('cli.edit.removedPlaceholder', { id: cardId }), name: `&${cardId}` }
  })
}

/**
 * Discard the session add at `index` (into {@link listFlatListSessionAdds}): remove
 * its entry, drop its changelog events, and re-pack the surviving session ids so they
 * stay dense and in add order (the highest session id returns to the pool). Pre-existing
 * (non-session) entries and their ids are never touched.
 */
export function discardFlatListAdd<E extends NamedFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  index: number,
): void {
  const { session } = list
  const targetId = list.sessionAdds[index]
  if (targetId === undefined) return
  const entry = session.entries.find((e) => e.cardId === targetId)
  if (!entry) return

  // Remove the discarded entry and forget its changelog events.
  session.entries = session.apply(
    session.entries,
    createRemoveChange(entry.name, { cardId: targetId }),
  )
  session.dirty = true
  ctx.sessionChanges = ctx.sessionChanges.filter((c) => !('cardId' in c) || c.cardId !== targetId)

  // Re-pack: survivors take the smallest of the session ids in add order; the top frees up.
  const survivorIds = list.sessionAdds.filter((_, i) => i !== index)
  const { remap, releasedId } = repackSessionIds(list.sessionAdds, survivorIds)
  for (const e of session.entries) {
    if (e.cardId !== undefined && remap.has(e.cardId)) e.cardId = remap.get(e.cardId)!
  }
  for (const c of ctx.sessionChanges) {
    if ('cardId' in c && c.cardId !== undefined && remap.has(c.cardId)) {
      c.cardId = remap.get(c.cardId)!
    }
  }
  list.sessionAdds = survivorIds.map((id) => remap.get(id) ?? id)
  releaseId(session.pool, releasedId)
  // Pending custom art is keyed by the same ids, so it follows the re-pack —
  // otherwise art staged for a card added this session would land on whichever
  // card inherited its number.
  noteArtRepack(session.art, remap, targetId)

  // The re-pack may have renumbered ids that pending edit-undo entries reference,
  // so the edit history can no longer be replayed safely. Dropping it is the
  // conservative move; the discarded card's own edit events were filtered above.
  if (list.editUndo.length > 0) {
    list.editUndo = []
    console.log(t('cli.edit.undoHistoryCleared'))
  }

  // The discarded card may have been the "last added"; reset so the copy/edit
  // shortcuts don't point at a stale entry until the next add.
  ctx.lastAdded = null
  ctx.lastChangeIndex = null
  ctx.lastAddedCount = 0
  list.state.snapshot = null
  console.log(t('cli.edit.discardedCard', { name: entry.name }))
}
