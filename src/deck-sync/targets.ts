/**
 * @fileoverview Which local decks a run covers: reading each deck's Archidekt
 * link from its front matter, loading and validating the file, and gating
 * decks whose lines the parser could not read.
 */

import path from 'node:path'
import {
  listDeckFiles,
  parseDeckText,
  readDeckName,
  type DeckParseResult,
} from '../importers/text-file'
import { unreadableMessages } from '../list/unreadable-content'
import {
  errorMessage,
  errorParam,
  isSyncMessage,
  nestSync,
  reasonFields,
  syncMessage,
  type SyncMessage,
  type SyncText,
} from '../sync/message'
import { parseDeckFrontMatter, type DeckFrontMatter } from '../list/deck-file'
import { isResolveListError, resolveList, resolveListErrorMessage } from '../list/resolve-list'
import type { ConfirmUnreadable } from '../sync/common'
import { getDecksDir } from '../config/ritual-config'
import type {
  DeckSyncDeckResult,
  DeckSyncLogLevel,
  UnreadableDeck,
  DeckSyncEventHandler,
  SyncableDeck,
  DeckTarget,
} from './types'

// ── Deck resolution ───────────────────────────────────────────────────

/** Front matter proven to carry an Archidekt source URL. */
type ArchidektFrontMatter = DeckFrontMatter & { sourceUrl: string }

function isArchidektDeck(frontMatter: DeckFrontMatter): frontMatter is ArchidektFrontMatter {
  // `parseDeckFrontMatter` already drops a `sourceUrl` that is not a string, so
  // the `typeof` here is belt-and-braces; what this predicate actually decides is
  // the `archidekt.com` part, which no parse checks.
  return (
    typeof frontMatter.sourceUrl === 'string' && frontMatter.sourceUrl.includes('archidekt.com')
  )
}

function extractSourceId(frontMatter: DeckFrontMatter): string | undefined {
  return typeof frontMatter.sourceId === 'string' ? frontMatter.sourceId : undefined
}

/**
 * How a deck file relates to Archidekt. Kept as one union so the listing and the
 * sync agree about what "linked" means and about which decks are missing an id
 * — they report those differently, but they must not disagree about the set.
 */
type DeckLink =
  | { kind: 'linked'; deck: SyncableDeck; frontMatter: ArchidektFrontMatter }
  | { kind: 'not-archidekt' }
  | { kind: 'missing-source-id'; name: string }
  | { kind: 'unreadable'; name: string; error: SyncText }

/** Classify one deck file by reading only its front matter. */
async function readDeckLink(decksDir: string, file: string): Promise<DeckLink> {
  const filePath = path.join(decksDir, file)
  const slug = path.basename(file, '.md')

  let frontMatter: DeckFrontMatter
  let name: string
  try {
    frontMatter = await parseDeckFrontMatter(filePath)
    name = await readDeckName(filePath)
  } catch (error: unknown) {
    return { kind: 'unreadable', name: slug, error: errorParam(error) }
  }

  if (!isArchidektDeck(frontMatter)) return { kind: 'not-archidekt' }

  const sourceId = extractSourceId(frontMatter)
  if (!sourceId) return { kind: 'missing-source-id', name }

  return {
    kind: 'linked',
    frontMatter,
    deck: {
      slug,
      name,
      sourceId,
      sourceUrl: frontMatter.sourceUrl,
      lastSynced: typeof frontMatter.lastSynced === 'string' ? frontMatter.lastSynced : null,
    },
  }
}

/** Targets that could be loaded, plus per-deck results for those that could not. */
export type ResolvedTargets = {
  targets: DeckTarget[]
  problems: DeckSyncDeckResult[]
  /** Decks carrying unreadable lines, whether or not they were let through. */
  unreadable: UnreadableDeck[]
}

/**
 * Every Archidekt-linked deck that can be synced, in file order. Decks with an
 * Archidekt `sourceUrl` but no `sourceId` are omitted — nothing can be fetched
 * for them; a run that covers all decks reports them as skipped. A deck whose
 * front matter cannot be read is skipped too rather than failing the listing,
 * so one broken file does not hide every other deck.
 */
export async function listSyncableDecks(): Promise<SyncableDeck[]> {
  const decksDir = getDecksDir()
  let files: string[]
  try {
    files = await listDeckFiles(decksDir)
  } catch {
    // The decks directory may not exist yet.
    return []
  }

  const decks: SyncableDeck[] = []
  for (const file of files) {
    const link = await readDeckLink(decksDir, file)
    if (link.kind === 'linked') decks.push(link.deck)
  }
  return decks
}

/** A loaded target waiting on the caller's decision about the lines it would drop. */
type HeldTarget = { target: DeckTarget; deck: UnreadableDeck }

/**
 * Which deck a problem's log line names: a file found while syncing every
 * linked deck, or a deck the caller named.
 */
type DeckProblemSubject = { scope: 'all'; file: string } | { scope: 'named'; deck: string }

/**
 * A deck that could not be loaded: one result in the report, and one line on
 * the log — the reason itself, prefixed with the deck it is about when the
 * reason does not name it.
 */
type DeckProblem = {
  name: string
  status: 'failed' | 'skipped'
  reason: SyncMessage
  subject?: DeckProblemSubject
  level: DeckSyncLogLevel
}

/** The log line for a problem: its reason, prefixed with the deck it is about. */
function problemLine(reason: SyncMessage, subject: DeckProblemSubject | undefined): SyncMessage {
  if (subject === undefined) return reason
  return subject.scope === 'all'
    ? syncMessage('domain.sync.skippingDeckFile', { file: subject.file, reason: nestSync(reason) })
    : syncMessage('domain.sync.deckProblem', { deck: subject.deck, reason: nestSync(reason) })
}

/**
 * Load a deck for syncing. Both directions re-serialize the file, so the parser's
 * skipped-line warnings are returned rather than dropped (as `importFromTextFile`
 * would) — a line the parser cannot read is a line the save would delete.
 */
async function loadDeckForSync(filePath: string): Promise<DeckParseResult | SyncMessage> {
  let text: string
  try {
    text = await Bun.file(filePath).text()
  } catch (error: unknown) {
    return errorMessage(error)
  }
  return parseDeckText(text, path.basename(filePath, '.md'))
}

export async function resolveTargetDecks(
  deckNames: string[],
  decksDir: string,
  emit: DeckSyncEventHandler,
  confirmUnreadable: ConfirmUnreadable | undefined,
  dryRun: boolean,
): Promise<ResolvedTargets> {
  const targets: DeckTarget[] = []
  const problems: DeckSyncDeckResult[] = []
  /** Targets held back until the unreadable lines they would drop are accepted. */
  const unreadable: HeldTarget[] = []

  const problem = ({ name, status, reason, subject, level }: DeckProblem): void => {
    emit({ kind: 'log', level, item: null, ...problemLine(reason, subject) })
    const result: DeckSyncDeckResult = { name, status, ...reasonFields(reason) }
    problems.push(result)
    emit({ kind: 'item-result', result })
  }

  /** Load a resolved deck file into a target, reporting a read failure as a problem. */
  const addTarget = async (
    filePath: string,
    frontMatter: DeckFrontMatter,
    sourceId: string,
    name: string,
  ): Promise<void> => {
    const loaded = await loadDeckForSync(filePath)
    if (isSyncMessage(loaded)) {
      problem({
        name,
        status: 'failed',
        reason: syncMessage('domain.sync.deckFileUnreadable', { error: nestSync(loaded) }),
        subject: { scope: 'named', deck: name },
        level: 'error',
      })
      return
    }
    const target: DeckTarget = { filePath, frontMatter, deck: loaded.deck, sourceId }
    // Both directions re-serialize the whole file, so a fenced code block is as
    // much at risk as a line the parser could not read.
    const blockers = unreadableMessages(loaded)
    if (blockers.length > 0) {
      unreadable.push({
        target,
        deck: { name, file: path.basename(filePath), warnings: blockers },
      })
      return
    }
    targets.push(target)
  }

  if (deckNames.length === 0) {
    // All Archidekt decks
    let files: string[]
    try {
      files = await listDeckFiles(decksDir)
    } catch {
      // The decks directory may not exist yet — nothing to sync.
      return { targets, problems, unreadable: [] }
    }

    for (const file of files) {
      const link = await readDeckLink(decksDir, file)
      if (link.kind === 'not-archidekt') continue
      if (link.kind === 'unreadable') {
        problem({
          name: link.name,
          status: 'failed',
          reason: syncMessage('domain.sync.frontMatterUnreadable', { error: link.error }),
          subject: { scope: 'all', file },
          level: 'error',
        })
        continue
      }
      if (link.kind === 'missing-source-id') {
        problem({
          name: link.name,
          status: 'skipped',
          reason: syncMessage('domain.sync.missingSourceId'),
          subject: { scope: 'all', file },
          level: 'warn',
        })
        continue
      }
      await addTarget(
        path.join(decksDir, file),
        link.frontMatter,
        link.deck.sourceId,
        link.deck.name,
      )
    }
  } else {
    for (const name of deckNames) {
      const resolved = await resolveList(name, 'deck')
      if (isResolveListError(resolved)) {
        // The resolver's own message, which names the deck already.
        problem({
          name,
          status: 'failed',
          reason: resolveListErrorMessage(resolved, 'none'),
          level: 'error',
        })
        continue
      }

      const link = await readDeckLink(
        path.dirname(resolved.filePath),
        path.basename(resolved.filePath),
      )
      if (link.kind === 'unreadable') {
        problem({
          name,
          status: 'failed',
          reason: syncMessage('domain.sync.frontMatterUnreadable', { error: link.error }),
          subject: { scope: 'named', deck: name },
          level: 'error',
        })
        continue
      }
      if (link.kind === 'not-archidekt') {
        problem({
          name,
          status: 'failed',
          reason: syncMessage('domain.sync.notArchidekt'),
          subject: { scope: 'named', deck: name },
          level: 'error',
        })
        continue
      }
      if (link.kind === 'missing-source-id') {
        problem({
          name,
          status: 'failed',
          reason: syncMessage('domain.sync.missingSourceId'),
          subject: { scope: 'named', deck: name },
          level: 'error',
        })
        continue
      }

      await addTarget(resolved.filePath, link.frontMatter, link.deck.sourceId, link.deck.name)
    }
  }

  // Decks whose files hold lines the parser cannot read are held back: a sync
  // re-serializes the file, so those lines would be deleted. Every surface is
  // told which lines are at stake, then the caller decides — no decision (no
  // handler, or a declined prompt) fails those decks rather than dropping data.
  //
  // A dry run writes nothing, so there is nothing to protect and nothing to ask:
  // the lines are reported and the deck is previewed like any other. The real
  // run that follows is where the question belongs.
  const unreadableDecks = unreadable.map((entry) => entry.deck)
  if (unreadable.length > 0) {
    emit({ kind: 'unreadable-lines', items: unreadableDecks })
    // A handler that throws is a decision that was never made — refuse, since
    // that is the direction that cannot destroy anything.
    let accepted = dryRun
    if (!accepted && confirmUnreadable) {
      try {
        accepted = await confirmUnreadable(unreadableDecks)
      } catch (error: unknown) {
        emit({
          kind: 'log',
          level: 'error',
          item: null,
          ...syncMessage('domain.sync.confirmUnreadableFailed', { error: errorParam(error) }),
        })
      }
    }
    for (const entry of unreadable) {
      if (accepted) {
        targets.push(entry.target)
        continue
      }
      const reason = syncMessage('domain.sync.unreadableDropped', {
        count: entry.deck.warnings.length,
      })
      const result: DeckSyncDeckResult = {
        name: entry.deck.name,
        status: 'failed',
        ...reasonFields(reason),
      }
      // Logged like every other failure, so a refused deck carries its reason
      // inline rather than only in the list emitted above.
      emit({
        kind: 'log',
        level: 'warn',
        item: null,
        ...syncMessage('domain.sync.itemReason', {
          item: entry.deck.file,
          reason: nestSync(reason),
        }),
      })
      problems.push(result)
      emit({ kind: 'item-result', result })
    }
  }

  return { targets, problems, unreadable: unreadableDecks }
}
