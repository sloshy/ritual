import path from 'node:path'
import type { DeckFormatKey } from '../list/deck-format'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'
import type { ListType } from '../list/list-type'
import { dirForType, normalizeListName } from '../list/resolve-list'
import type { DeckData } from '../list/deck'
import {
  createCardSessionContext,
  listMarkdownNames,
  resetCardSessionTracking,
  saveCardSession,
  type CardSessionContext,
  type CardSessionStrategy,
  type SessionChangeItem,
} from './card-session'
import {
  mirrorMoveTo,
  sameListRef,
  type ListRef,
  type MoveFromChange,
} from '../changes/change-event'
import {
  prepareOutgoingMoves,
  type OutgoingMoveBatch,
  type PreparedOutgoingMoves,
} from '../admin/api/move-save'
import { getErrorMessage } from '../util/errors'
import { createCardArtCache } from '../list/card-art'
import type { MoveTargetsProvider } from './edit-move'
import { createCollectionStrategy } from './collection-strategy'
import { createDeckStrategy } from './deck-strategy'
import { listExistingDecks, loadDeck, type DeckSessionConfig } from './deck-helpers'
import { newDeckFrontMatter } from '../list/deck-file'
import {
  loadCollectionSession,
  loadWantedSession,
  newCollectionSession,
  newWantedSession,
} from './flat-list-session'
import { warnUnreconciledArt } from './session-art'
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

/**
 * The list created *earlier in this session* that a new `name` would fold onto,
 * if any — the in-session twin of `listNameCollision`.
 *
 * A list created in the editor exists in memory until the session is saved, so
 * the on-disk check cannot see it. Without this, two lists created in one
 * session whose names fold together would both be written on save, leaving the
 * pair mutually unaddressable by every name-resolving command — the very trap
 * the creation refusal exists to prevent.
 */
export function pendingListCollision(
  open: Iterable<OpenList>,
  type: ListType,
  name: string,
): OpenList | undefined {
  const normalized = normalizeListName(name)
  for (const list of open) {
    if (!list.isNew() || list.ref.type !== type) continue
    if (normalizeListName(list.ref.name) === normalized) return list
  }
  return undefined
}

/**
 * The create-new menu items, shared by the selection menu and the add-target
 * prompt. Message keys rather than rendered rows — this table is evaluated once
 * at module load. The `➕` marker is layout, not wording, so it stays here.
 */
const NEW_LIST_TITLES = {
  deck: 'domain.newList.deck',
  collection: 'domain.newList.collection',
  wanted: 'domain.newList.wanted',
} as const satisfies Record<ListType, MessageKey>

/** The create-new menu row for a list type, in the active UI locale. */
export function newListTitle(type: ListType): string {
  return `➕ ${t(NEW_LIST_TITLES[type])}`
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
  moveTargets?: MoveTargetsProvider,
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
        moveTargets,
      }),
    }
  }
  if (ref.type === 'collection') {
    const session = await loadCollectionSession(ref.file)
    return {
      ref,
      ctx,
      isNew: () => false,
      strategy: createCollectionStrategy(
        session,
        sessionConfig,
        ref.name,
        excludeDigitalOnly,
        moveTargets,
      ),
    }
  }
  const session = await loadWantedSession(ref.file)
  return {
    ref,
    ctx,
    isNew: () => false,
    strategy: createWantedStrategy(
      session,
      sessionConfig,
      ref.name,
      excludeDigitalOnly,
      moveTargets,
    ),
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
 * never strand changes that no longer have a list to belong to. It is likewise
 * blocked while another open list holds a pending move *into* this one
 * (`inboundMoves`): dropping the list would leave that move with nowhere to
 * deliver, failing the source list's save later.
 */
export function trackListCreation(
  inner: CardSessionStrategy,
  ref: UnifiedListRef,
  onDiscard: () => void,
  inboundMoves: () => number = () => 0,
): TrackedCreation {
  let isNew = true
  let discarded = false
  const creationLabel = t('cli.edit.creationChange', { type: ref.type })

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
      const inbound = inboundMoves()
      const blocked =
        changes.length > 0
          ? t('cli.edit.discardCardChangesFirst', { type: ref.type, count: changes.length })
          : inbound > 0
            ? t('cli.edit.discardInboundMovesFirst', { type: ref.type, count: inbound })
            : undefined
      return [{ label: creationLabel, blocked }, ...changes]
    },
    discardSessionChange: async (ctx: CardSessionContext, index: number): Promise<void> => {
      if (!isNew) return inner.discardSessionChange(ctx, index)
      if (index > 0) return inner.discardSessionChange(ctx, index - 1)
      // The engine blocks this in the picker; enforce it here too, so the list
      // can never be dropped out from under card changes that belong to it —
      // or out from under another list's pending move into it.
      if (inner.listSessionChanges().length > 0 || inboundMoves() > 0) return
      discarded = true
      onDiscard()
      console.log(t('cli.edit.discardedList', { type: ref.type, name: ref.name }))
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
  moveTargets?: MoveTargetsProvider,
  inboundMoves?: () => number,
): OpenList {
  const inner = newListStrategy(ref, format, sessionConfig, excludeDigitalOnly, moveTargets)
  const { strategy, isNew } = trackListCreation(inner, ref, onDiscard, inboundMoves)
  return { ref, ctx: createCardSessionContext(), strategy, isNew }
}

/** The type-specific strategy for a list with no file yet: an empty in-memory model. */
function newListStrategy(
  ref: UnifiedListRef,
  format: DeckFormatKey | null,
  sessionConfig: DeckSessionConfig,
  excludeDigitalOnly: boolean,
  moveTargets?: MoveTargetsProvider,
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
      moveTargets,
    })
  }
  if (ref.type === 'collection') {
    const session = newCollectionSession(ref.file, ref.name)
    return createCollectionStrategy(
      session,
      sessionConfig,
      ref.name,
      excludeDigitalOnly,
      moveTargets,
    )
  }
  const session = newWantedSession(ref.file, ref.name)
  return createWantedStrategy(session, sessionConfig, ref.name, excludeDigitalOnly, moveTargets)
}

/** Whether an open list has anything unsaved (pending events or a dirty model). */
export function hasUnsavedChanges(open: OpenList): boolean {
  return open.ctx.sessionChanges.length > 0 || open.strategy.hasUnsavedChanges()
}

/** One list's pending moves, split by whether their destination is open in the editor. */
type PendingMoveCommit = {
  source: OpenList
  sourceRef: ListRef
  /** Moves whose destination is not open — written straight to disk. */
  offline: MoveFromChange[]
  /** Moves whose destination is an open session, delivered in memory. */
  openDest: OpenDestMove[]
}

/** A pending move headed for a list that is open in the editor. */
type OpenDestMove = { dest: OpenList; move: MoveFromChange }

/** Split a list's pending move-from events by destination. Mutates nothing. */
function planMoveCommit(source: OpenList, everyOpen: OpenList[]): PendingMoveCommit {
  const plan: PendingMoveCommit = {
    source,
    sourceRef: { type: source.ref.type, name: source.ref.name },
    offline: [],
    openDest: [],
  }
  for (const change of source.ctx.sessionChanges) {
    if (change.action !== 'move-from') continue
    const dest = everyOpen.find((other) => other !== source && sameListRef(other.ref, change.to))
    if (dest) plan.openDest.push({ dest, move: change })
    else plan.offline.push(change)
  }
  return plan
}

/**
 * Save one open list, committing the destination side of its pending
 * cross-list moves in the same step — a saved `move-from` must never be
 * missing its `move-to` half:
 *
 * - A destination that is *not* open in the editor is written to disk
 *   through {@link prepareOutgoingMoves}, exactly as an admin-editor save
 *   does — except staged across the whole closure first, so nothing lands
 *   until every batch has validated.
 * - A destination that *is* open receives the card on its in-memory model
 *   (through its own strategy, which allocates it a fresh id) and is saved
 *   in the same pass — including any unrelated pending changes it carried,
 *   since its file must land in one consistent write. A receiving list's
 *   *own* pending moves commit too, so a chain (A→B while B→C) or a swap
 *   resolves fully; the closure is planned up front, before anything mutates,
 *   which is also what lets every delivery be validated first.
 *
 * Returns false — with every session intact and nothing written — when a
 * destination cannot be committed (deleted file, a printing-less card headed
 * into a collection): every delivery, on-disk and in-memory alike, is staged
 * and validated before the first file is written, so a failed save can be
 * retried without re-applying moves that already landed. Only an I/O error
 * during the final writes can still leave a destination written ahead of its
 * source.
 */
export async function saveOpenList(
  open: OpenList,
  allOpen: () => Iterable<OpenList>,
): Promise<boolean> {
  const everyOpen = [...allOpen()]

  // Plan the transitive closure without mutating anything. receiveMove only
  // ever adds move-to events — never new move-froms — so the closure is
  // already complete before any delivery is applied.
  const queue: OpenList[] = [open]
  const plans: PendingMoveCommit[] = []
  for (let i = 0; i < queue.length; i++) {
    const plan = planMoveCommit(queue[i]!, everyOpen)
    plans.push(plan)
    for (const { dest } of plan.openDest) {
      if (!queue.includes(dest)) queue.push(dest)
    }
  }

  const fail = (error: string): false => {
    console.error(t('cli.edit.moveCommitFailed', { name: open.ref.name, error }))
    return false
  }

  // Validate every in-memory delivery up front, so a card that cannot land —
  // the open-session counterpart of applyAddToStaged's collection check —
  // aborts before any file is written.
  for (const plan of plans) {
    for (const { move } of plan.openDest) {
      if (move.to.type === 'collection' && (!move.set || !move.collectorNumber)) {
        return fail(t('cli.move.collectionNeedsPrinting', { name: move.cardName }))
      }
    }
  }

  // The departing cards' custom art, for the deliveries into open sessions
  // below. Read from each source before that source is saved — a save re-files
  // its own sidecar against the ids its removals freed, and by then the
  // departed card's entry is gone. Keyed by file path, so a list whose display
  // name differs from its slug still finds its art.
  const sourceArt = createCardArtCache()

  // Stage every closed-destination batch in memory before anything is
  // written, in one shared staging across the closure: a batch that cannot
  // validate (deleted file, a printing-less card headed into a collection)
  // aborts the save with no file touched — a later retry must never re-apply
  // a batch that already landed — and two sources moving into the same
  // closed list stack on one loaded copy of its file instead of the second
  // write clobbering the first.
  let offline: PreparedOutgoingMoves
  try {
    offline = await prepareOutgoingMoves(
      plans.map(
        (plan): OutgoingMoveBatch => ({
          sourceRef: plan.sourceRef,
          sourceFile: plan.source.ref.file,
          changes: plan.offline,
        }),
      ),
    )
  } catch (error) {
    return fail(getErrorMessage(error))
  }

  // WRITE: everything validated. Closed destinations first, then the open
  // deliveries, then every involved list — destinations before their sources
  // (the queue reversed, since it leads with `open`), so an I/O failure
  // partway can only leave a card present in both lists (self-healing: saving
  // the source removes its copy), never removed from its source without
  // having landed anywhere.
  try {
    // A closed destination whose sidecar could not be re-filed kept its own art
    // and lost the arriving cards' — the lines landed either way, so this is
    // reported here rather than thrown, exactly as a session's own save reports
    // its sidecar — through the same helper, so both print one sentence.
    // Silently discarding the result would make a move look clean while the art
    // it was carrying was quietly dropped.
    const committed = await offline.commit()
    for (const failure of committed.artFailures) warnUnreconciledArt(failure)
    // Deliver to the open destinations (each allocates its own line id; the
    // pushed move-to names the source line as `sourceCardId` and carries no
    // destination id — `receiveMove` does not report the line it landed on).
    for (const plan of plans) {
      for (const { dest, move } of plan.openDest) {
        const moveTo = mirrorMoveTo(move, plan.sourceRef)
        const art = await sourceArt.lookup(plan.source.ref.file, move.cardId)
        dest.strategy.receiveMove(moveTo, art)
        dest.ctx.sessionChanges.push(moveTo)
      }
    }
    for (const list of [...queue].reverse()) {
      if (list !== open) console.log(t('cli.edit.savingMoveDest', { name: list.ref.name }))
      await saveCardSession(list.strategy, list.ctx)
      resetCardSessionTracking(list.strategy, list.ctx)
    }
  } catch (error) {
    // Unlike a staging failure, a failure here may leave some destinations
    // already written — report it (with its own message saying so) rather
    // than letting the throw escape the editor with the session half-saved.
    console.error(
      t('cli.edit.moveWriteFailed', { name: open.ref.name, error: getErrorMessage(error) }),
    )
    return false
  }
  return true
}
