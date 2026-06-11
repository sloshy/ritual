import * as fs from 'node:fs/promises'
import path from 'node:path'
import {
  createAddChange,
  createRemoveChange,
  createSetNoteChange,
  createSetPrintingChange,
  type AddRemoveOptions,
  type ChangeEvent,
} from '../change-event'
import type { CollectionCardEntry, WantedListCardEntry } from '../site/data-types'
import { DEFAULT_SECTION, type ScryfallCard } from '../types'
import { parseTitleFromContent } from '../section-format'
import { writeFileWithHash } from '../content-hash'
import {
  allocateId,
  collectExistingIds,
  createIdPool,
  releaseId,
  repackSessionIds,
  type CardIdPool,
} from '../card-id'
import { applyChangeToCollection } from '../editor/collection-changes'
import { applyChangeToWantedList } from '../editor/wanted-changes'
import { collectionToMarkdown, wantedToMarkdown } from '../editor/list-export'
import { getCardPrintings } from '../scryfall'
import {
  findCheapestPrinting,
  formatCheapestPrintingDisplay,
  formatSpecificPrintingPrice,
} from '../price-currency'
import { trackAdd, trackAnotherCopy, trackEdit } from '../session-changelog'
import { parseCollectionFile } from './price-collection'
import { parseWantedListFile } from './wanted-helpers'
import type { CardSessionContext, SessionAddItem } from './card-session'

/** The minimal entry shape the flat-list session machinery relies on. */
export type FlatListEntry = { section: string; cardId?: number }

/**
 * In-memory session model for the flat list types (collections and wanted
 * lists), mirroring how the admin save handlers work: parse the file into
 * entries once, apply each edit as a {@link ChangeEvent}, and re-serialize the
 * whole file in canonical form. Card IDs come from a {@link CardIdPool} seeded
 * at load, so removals' IDs are reused and the file is never re-read mid-session.
 */
export type FlatListSession<E extends FlatListEntry> = {
  filePath: string
  /** The `# Title` H1, preserved on every save. */
  title: string
  entries: E[]
  /** Section names in file order, including empty sections. */
  sectionOrder: string[]
  pool: CardIdPool
  apply: (entries: E[], change: ChangeEvent) => E[]
  serialize: (title: string, entries: E[], sectionOrder: string[]) => string
}

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

/** Load a collection file into a session model, surfacing any parse warnings. */
export async function loadCollectionSession(filePath: string): Promise<CollectionSession> {
  const content = await fs.readFile(filePath, 'utf-8')
  const parsed = parseCollectionFile(content)
  for (const warning of parsed.warnings) console.warn(warning)
  const entries: CollectionCardEntry[] = parsed.entries.map((e, i) => ({
    name: e.name,
    set: e.set,
    collectorNumber: e.collectorNumber,
    finish: e.finish ?? 'nonfoil',
    condition: e.condition ?? 'NM',
    price: 0,
    fileOrder: i,
    section: e.section,
    note: e.note,
    cardId: e.cardId,
  }))
  return {
    filePath,
    title: parseTitleFromContent(content) ?? path.basename(filePath, '.md'),
    entries,
    sectionOrder: parsed.sectionOrder,
    pool: assignMissingIds(entries),
    apply: applyChangeToCollection,
    serialize: collectionToMarkdown,
  }
}

/** Load a wanted-list file into a session model, surfacing any parse warnings. */
export async function loadWantedSession(filePath: string): Promise<WantedSession> {
  const content = await fs.readFile(filePath, 'utf-8')
  const parsed = parseWantedListFile(content)
  for (const warning of parsed.warnings) console.warn(warning)
  const entries: WantedListCardEntry[] = parsed.entries.map((e, i) => ({
    name: e.name,
    set: e.set,
    collectorNumber: e.collectorNumber,
    finish: e.finish,
    price: 0,
    fileOrder: i,
    section: e.section,
    note: e.note,
    state: !e.set || !e.collectorNumber ? 'name-only' : e.finish ? 'fully-specified' : 'printing',
    cardId: e.cardId,
  }))
  return {
    filePath,
    title: parseTitleFromContent(content) ?? path.basename(filePath, '.md'),
    entries,
    sectionOrder: parsed.sectionOrder,
    pool: assignMissingIds(entries),
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
 * Apply a change to the session's entries and write the file back in canonical form.
 *
 * Note: `remove` changes shrink the entry array but do not release the entry's ID
 * back to {@link FlatListSession.pool} — none of the interactive sessions emit
 * removals today. If one ever does, the removed ID must be released here so the
 * pool's gap-reuse guarantee holds within a session.
 */
export async function applyFlatListChange<E extends FlatListEntry>(
  session: FlatListSession<E>,
  change: ChangeEvent,
): Promise<void> {
  session.entries = session.apply(session.entries, change)
  await writeFileWithHash(
    session.filePath,
    session.serialize(session.title, session.entries, session.sectionOrder),
  )
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
    await applyFlatListChange(
      session,
      createSetPrintingChange(cardName, {
        set: options.set,
        collectorNumber: options.collectorNumber,
        finish: options.finish,
        condition: options.condition,
        cardId,
      }),
    )
    ctx.lastChangeIndex = trackEdit(ctx.sessionChanges, ctx.lastChangeIndex, addEvent, true)
    state.snapshot = { options, note: state.snapshot?.note }
    ctx.lastAdded = { name: cardName, hasNote: ctx.lastAdded.hasNote, cardId }
    console.log(`Edited: ${list.renderLine(cardName, state.snapshot, cardId)}`)
  } else {
    await applyFlatListChange(session, addEvent)
    ctx.lastChangeIndex = trackAdd(ctx.sessionChanges, addEvent)
    list.sessionAdds.push(cardId)
    state.snapshot = { options }
    ctx.lastAdded = { name: cardName, hasNote: false, cardId }
    console.log(`Added: ${list.renderLine(cardName, state.snapshot, cardId)}`)
    if (price.kind === 'cheapest') {
      const printings = await getCardPrintings(cardName)
      console.log(formatCheapestPrintingDisplay(findCheapestPrinting(printings)))
    } else {
      console.log(formatSpecificPrintingPrice(price.printing, options.finish))
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
  await applyFlatListChange(
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
    await applyFlatListChange(session, noteChange)
    ctx.sessionChanges.push(noteChange)
  }
  ctx.lastAddedCount++
  ctx.lastAdded = { ...ctx.lastAdded, cardId }
  console.log(
    `Added: ${list.renderLine(ctx.lastAdded.name, state.snapshot, cardId)} (${ctx.lastAddedCount}x total)`,
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
      : { label: `(removed) &${cardId}`, name: `&${cardId}` }
  })
}

/**
 * Discard the session add at `index` (into {@link listFlatListSessionAdds}): remove
 * its entry, drop its changelog events, and re-pack the surviving session ids so they
 * stay dense and in add order (the highest session id returns to the pool). Pre-existing
 * (non-session) entries and their ids are never touched.
 */
export async function discardFlatListAdd<E extends NamedFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  index: number,
): Promise<void> {
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

  await writeFileWithHash(
    session.filePath,
    session.serialize(session.title, session.entries, session.sectionOrder),
  )

  // The discarded card may have been the "last added"; reset so the copy/edit
  // shortcuts don't point at a stale entry until the next add.
  ctx.lastAdded = null
  ctx.lastChangeIndex = null
  ctx.lastAddedCount = 0
  list.state.snapshot = null
  console.log(`Discarded: ${entry.name}`)
}
