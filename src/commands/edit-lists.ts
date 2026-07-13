import path from 'node:path'
import type { DeckFormatKey } from '../deck-format'
import { LIST_TYPE_DISPLAY, listTypeLabel, type ListType } from '../list-type'
import { dirForType } from '../resolve-list'
import type { DeckData } from '../types'
import {
  createCardSessionContext,
  listMarkdownNames,
  type CardSessionContext,
  type CardSessionStrategy,
  type SessionChangeItem,
} from './card-session'
import { createCollectionStrategy } from './collection-strategy'
import { createDeckStrategy } from './deck-strategy'
import { deckFilePath, listExistingDecks, loadDeck, type DeckSessionConfig } from './deck-helpers'
import { newDeckFrontMatter } from '../deck-file'
import {
  loadCollectionSession,
  loadWantedSession,
  newCollectionSession,
  newWantedSession,
} from './flat-list-session'
import { createWantedStrategy } from './wanted-strategy'

/**
 * The list inventory shared by the unified `edit` command and its multi-list
 * modes: enumerating every list on disk, and opening one into a live editing
 * session. Sessions are kept open (with their unsaved changes) for as long as
 * the editor runs, so edits can span several lists before a single save.
 */

/** One list offered in the unified selection menu. `name` is its display name. */
export type UnifiedListRef = { type: ListType; name: string; file: string }

/** An opened list's live editing state, kept while the user is in other lists. */
export type OpenList = {
  ref: UnifiedListRef
  strategy: CardSessionStrategy
  ctx: CardSessionContext
  /**
   * Whether the list was created this session and its file does not exist yet.
   * Turns false on the first save that writes it. Such a list starts out
   * unsaved, so exiting without saving discards the creation along with
   * everything else.
   */
  isNew: () => boolean
}

/** The path a new list of `type` named `name` would be created at. */
export function newListFilePath(type: ListType, name: string): string {
  return type === 'deck' ? deckFilePath(name) : path.join(dirForType(type), `${name}.md`)
}

/** A list's icon and name, as shown wherever lists are mixed together. */
export function listRefLabel(ref: UnifiedListRef): string {
  return `${LIST_TYPE_DISPLAY[ref.type].icon} ${ref.name}`
}

/** The create-new menu items, shared by the selection menu and the add-target prompt. */
export const NEW_LIST_TITLES: Record<ListType, string> = {
  deck: '➕ New Deck',
  collection: '➕ New Collection',
  wanted: '➕ New Wanted List',
}

/** Enumerate every list on disk for the selection menu (decks by display name). */
export async function collectListRefs(): Promise<UnifiedListRef[]> {
  const decks = await listExistingDecks()
  const collections = await listMarkdownNames(dirForType('collection'))
  const wanted = await listMarkdownNames(dirForType('wanted'))
  return [
    ...decks.map((d): UnifiedListRef => ({ type: 'deck', name: d.name, file: d.file })),
    ...collections.map(
      (name): UnifiedListRef => ({
        type: 'collection',
        name,
        file: path.join(dirForType('collection'), `${name}.md`),
      }),
    ),
    ...wanted.map(
      (name): UnifiedListRef => ({
        type: 'wanted',
        name,
        file: path.join(dirForType('wanted'), `${name}.md`),
      }),
    ),
  ]
}

/** Load a list into a fresh session and build its type-specific strategy. */
export async function openListSession(
  ref: UnifiedListRef,
  sessionConfig: DeckSessionConfig,
  excludeDigitalOnly: boolean,
): Promise<OpenList> {
  const ctx = createCardSessionContext()
  if (ref.type === 'deck') {
    const loaded = await loadDeck(ref.file)
    return {
      ref,
      ctx,
      isNew: () => false,
      strategy: createDeckStrategy({
        deckFile: ref.file,
        deckName: ref.name,
        initialDeck: loaded.deck,
        frontMatter: loaded.frontMatter,
        sessionConfig,
        excludeDigitalOnly,
      }),
    }
  }
  if (ref.type === 'collection') {
    const session = await loadCollectionSession(ref.file)
    return {
      ref,
      ctx,
      isNew: () => false,
      strategy: createCollectionStrategy(session, sessionConfig, ref.name, excludeDigitalOnly),
    }
  }
  const session = await loadWantedSession(ref.file)
  return {
    ref,
    ctx,
    isNew: () => false,
    strategy: createWantedStrategy(session, sessionConfig, ref.name, excludeDigitalOnly),
  }
}

/** A wrapped strategy plus the flag telling whether its list is still uncreated. */
export type TrackedCreation = { strategy: CardSessionStrategy; isNew: () => boolean }

/**
 * Wrap a not-yet-created list's strategy so the creation itself shows up as a
 * session change, ahead of any card change made to the list. Discarding it takes
 * the whole list back out of the session (`onDiscard`); saving commits it, and
 * the entry disappears. The creation cannot be discarded while the list still
 * has card changes of its own — those must be discarded first, so the entry can
 * never strand changes that no longer have a list to belong to.
 */
export function trackListCreation(
  inner: CardSessionStrategy,
  ref: UnifiedListRef,
  onDiscard: () => void,
): TrackedCreation {
  let isNew = true
  let discarded = false
  const creationLabel = `Created this ${listTypeLabel(ref.type)}`

  const strategy: CardSessionStrategy = {
    ...inner,
    discarded: () => discarded,
    sessionSaved: () => {
      inner.sessionSaved()
      // The list is on disk now, so its creation is no longer pending.
      isNew = false
    },
    listSessionChanges: (): SessionChangeItem[] => {
      if (discarded) return []
      const changes = inner.listSessionChanges()
      if (!isNew) return changes
      const blocked =
        changes.length > 0
          ? `discard this ${listTypeLabel(ref.type)}'s ${changes.length} card change(s) first`
          : undefined
      return [{ label: creationLabel, blocked }, ...changes]
    },
    discardSessionChange: async (ctx: CardSessionContext, index: number): Promise<void> => {
      if (!isNew) return inner.discardSessionChange(ctx, index)
      if (index > 0) return inner.discardSessionChange(ctx, index - 1)
      // The engine blocks this in the picker; enforce it here too, so the list
      // can never be dropped out from under card changes that belong to it.
      if (inner.listSessionChanges().length > 0) return
      discarded = true
      onDiscard()
      console.log(`Discarded ${listTypeLabel(ref.type)} "${ref.name}".`)
    },
  }
  return { strategy, isNew: () => isNew }
}

/**
 * Build a session for a list that does not exist on disk. Nothing is written:
 * the session starts unsaved, so the list's file (and its changelog) appear only
 * when the editor is saved, and never if the session is discarded. `onDiscard`
 * removes the list from the editor when its creation is taken back.
 */
export function newListSession(
  ref: UnifiedListRef,
  format: DeckFormatKey | null,
  sessionConfig: DeckSessionConfig,
  excludeDigitalOnly: boolean,
  onDiscard: () => void,
): OpenList {
  const inner = newListStrategy(ref, format, sessionConfig, excludeDigitalOnly)
  const { strategy, isNew } = trackListCreation(inner, ref, onDiscard)
  return { ref, ctx: createCardSessionContext(), strategy, isNew }
}

/** The type-specific strategy for a list with no file yet: an empty in-memory model. */
function newListStrategy(
  ref: UnifiedListRef,
  format: DeckFormatKey | null,
  sessionConfig: DeckSessionConfig,
  excludeDigitalOnly: boolean,
): CardSessionStrategy {
  if (ref.type === 'deck') {
    // `format` is always given for a deck (the caller prompts for it), but fall
    // back rather than write a deck with no format at all.
    const deckFormat: DeckFormatKey = format ?? 'commander'
    const initialDeck: DeckData = {
      name: ref.name,
      format: deckFormat,
      sections: [{ name: 'Main', cards: [] }],
    }
    return createDeckStrategy({
      deckFile: ref.file,
      deckName: ref.name,
      initialDeck,
      frontMatter: newDeckFrontMatter(ref.name, deckFormat),
      sessionConfig,
      excludeDigitalOnly,
      initiallyDirty: true,
    })
  }
  if (ref.type === 'collection') {
    const session = newCollectionSession(ref.file, ref.name)
    return createCollectionStrategy(session, sessionConfig, ref.name, excludeDigitalOnly)
  }
  const session = newWantedSession(ref.file, ref.name)
  return createWantedStrategy(session, sessionConfig, ref.name, excludeDigitalOnly)
}

/** Whether an open list has anything unsaved (pending events or a dirty model). */
export function hasUnsavedChanges(open: OpenList): boolean {
  return open.ctx.sessionChanges.length > 0 || open.strategy.hasUnsavedChanges()
}
