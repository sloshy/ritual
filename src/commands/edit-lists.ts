import path from 'node:path'
import type { ListType } from '../list-type'
import { LIST_TYPE_DISPLAY } from '../list-type'
import { dirForType } from '../resolve-list'
import {
  createCardSessionContext,
  listMarkdownNames,
  type CardSessionContext,
  type CardSessionStrategy,
} from './card-session'
import { createCollectionStrategy } from './collection-strategy'
import { createDeckStrategy } from './deck-strategy'
import { listExistingDecks, loadDeck, type DeckSessionConfig } from './deck-helpers'
import { loadCollectionSession, loadWantedSession } from './flat-list-session'
import { createWantedStrategy } from './wanted-strategy'

/**
 * The list inventory shared by the unified `edit` command and its All Lists
 * mode: enumerating every list on disk, and opening one into a live editing
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
}

/** A list's icon and name, as shown wherever lists are mixed together. */
export function listRefLabel(ref: UnifiedListRef): string {
  return `${LIST_TYPE_DISPLAY[ref.type].icon} ${ref.name}`
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
      strategy: createCollectionStrategy(session, sessionConfig, ref.name, excludeDigitalOnly),
    }
  }
  const session = await loadWantedSession(ref.file)
  return {
    ref,
    ctx,
    strategy: createWantedStrategy(session, sessionConfig, ref.name, excludeDigitalOnly),
  }
}

/** Whether an open list has anything unsaved (pending events or a dirty model). */
export function hasUnsavedChanges(open: OpenList): boolean {
  return open.ctx.sessionChanges.length > 0 || open.strategy.hasUnsavedChanges()
}
