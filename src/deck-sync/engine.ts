/**
 * The Archidekt deck-sync engine, shared by every surface that syncs decks: the
 * `deck-sync` CLI command, the admin site's Sync Decks page (and its SSE stream),
 * and the `sync_decks` MCP tool.
 *
 * Progress is reported as structured {@link DeckSyncEvent}s rather than log lines
 * so each surface can present it in its own idiom — the CLI renders them to the
 * logger, the admin stream forwards them to the browser as they happen.
 */

import path from 'node:path'
import { ArchidektClient, createPacedArchidektClient } from '../clients/ArchidektClient'
import { listDeckFiles, parseDeckText, type DeckParseResult } from '../importers/text-file'
import { getErrorMessage } from '../errors'
import { parseDeckFrontMatter, serializeDeckToMarkdown, type DeckFrontMatter } from '../deck-file'
import { getDeckFormatLabel } from '../deck-format'
import { formatResolveListError, isResolveListError, resolveList } from '../resolve-list'
import { appendChangelog } from '../changelog-writer'
import type { Card, DeckData, DeckSection } from '../types'
import type {
  ArchidektRawDeckResponse,
  ArchidektRawCardEntry,
  ModifyCardEntry,
  ModifyCardModifications,
} from '../importers/archidekt-types'
import {
  diffByCardName,
  diffToChangeEvents,
  buildCardIdResolver,
  filterNameDiff,
  isDiffEmpty,
  applyDownloadDiff,
  syncDeckFormat,
  type NameDiff,
} from './diff'
import {
  describeSkippedChanges,
  type ConfirmUnreadable,
  type SyncChangeFilter,
  type SyncDirection,
  type SyncItemStatus,
  type SyncLogLevel,
  type UnreadableSource,
} from '../sync-common'
import { assignMissingDeckCardIds } from '../card-id'
import { hashPath, writeFileWithHash } from '../content-hash'
import { getDecksDir } from '../ritual-config'

// ── Public surface ────────────────────────────────────────────────────

/** What happened to one deck during a sync run. */
export type DeckSyncStatus = SyncItemStatus
export type DeckSyncDeckResult = { name: string; status: DeckSyncStatus; reason?: string }

/** The report a run produces: per-deck results plus the failure count. */
export type DeckSyncReport = {
  direction: SyncDirection
  decks: DeckSyncDeckResult[]
  failedCount: number
  /**
   * Decks whose files hold lines the parser cannot read, with those lines.
   * Reported whether the run went ahead or refused them, so every consumer —
   * including `--output json` and the non-streaming endpoint, which never see
   * the `unreadable-lines` event — can show what accepting would delete.
   */
  unreadable: UnreadableDeck[]
}

export type DeckSyncLogLevel = SyncLogLevel

/**
 * A deck file the parser could not fully read. Syncing re-serializes the file,
 * so every line listed in `warnings` would be deleted by the save.
 */
export type UnreadableDeck = UnreadableSource

/**
 * Decide whether decks carrying unreadable lines may sync anyway (declared on
 * {@link ConfirmUnreadable} in `sync-common`): called once, before any deck
 * syncs, with every affected deck.
 */
export type { ConfirmUnreadable }

/**
 * One step of a sync run, emitted as it happens.
 *
 * A `log` event with a `deck` belongs to the deck currently being synced (the
 * CLI indents those under its `deck-start` line); one with `deck: null` is about
 * the run as a whole, including decks that could not be loaded at all.
 */
export type DeckSyncEvent =
  | { kind: 'deck-start'; deck: string; index: number; total: number }
  | { kind: 'log'; level: DeckSyncLogLevel; deck: string | null; message: string }
  | { kind: 'deck-result'; result: DeckSyncDeckResult }
  /** Emitted before any deck syncs, when some deck file has lines the parser cannot read. */
  | { kind: 'unreadable-lines'; decks: UnreadableDeck[] }

export type DeckSyncEventHandler = (event: DeckSyncEvent) => void

export type DeckSyncOptions = {
  direction: SyncDirection
  /** An Archidekt access token; callers obtain one from `ArchidektAuth.getToken()`. */
  token: string
  /** Deck names to sync; empty (the default) syncs every Archidekt-linked deck. */
  deckNames?: string[]
  /** Report what would sync without writing files or pushing changes. */
  dryRun?: boolean
  /**
   * Apply only one side of each deck's diff — additions or removals, relative to
   * the sync destination (local files on a pull, Archidekt on a push). Omitted,
   * every change applies. Skipped changes are still counted and logged.
   */
  only?: SyncChangeFilter
  onEvent?: DeckSyncEventHandler
  /**
   * Confirm syncing decks whose files carry unreadable lines. Omitted, such
   * decks fail — a sync must never silently delete a line it could not parse.
   * Never consulted under `dryRun`, which writes nothing and so has nothing to
   * confirm.
   */
  confirmUnreadable?: ConfirmUnreadable
  /** Injectable for tests; a fresh {@link ArchidektClient} by default. */
  client?: ArchidektClient
}

export type DeckSyncRun = {
  report: DeckSyncReport
  /**
   * Every file the run wrote — each synced deck, its `.sha256` sidecar, and any
   * changelog it appended to. Always empty on a dry run. Callers that commit a
   * run (the admin endpoints) stage exactly this set.
   */
  writtenFiles: string[]
}

/** A deck `deck-sync` can operate on: linked to Archidekt and carrying a source id. */
export type SyncableDeck = {
  /** File basename without `.md` — the identifier the API and UI address decks by. */
  slug: string
  name: string
  sourceId: string
  sourceUrl: string
  /** When this deck last synced, or null if it never has. */
  lastSynced: string | null
}

// ── Archidekt raw response helpers ────────────────────────────────────

export type RawCardIndexEntry = { entry: ArchidektRawCardEntry; totalQty: number }
export type RawCardIndex = Map<string, RawCardIndexEntry>

/**
 * Build an index from an Archidekt raw deck response, keyed by card name (lowercase).
 * When multiple entries share a name, the first entry is kept and quantities are summed.
 */
export function buildRawCardIndex(rawDeck: ArchidektRawDeckResponse): RawCardIndex {
  const index: RawCardIndex = new Map()
  for (const entry of rawDeck.cards) {
    const name = entry.card.oracleCard.name.toLowerCase()
    const existing = index.get(name)
    if (existing) {
      existing.totalQty += entry.quantity
    } else {
      index.set(name, { entry, totalQty: entry.quantity })
    }
  }
  return index
}

// ── Upload plan ───────────────────────────────────────────────────────

type UploadPlan = {
  entries: ModifyCardEntry[]
  errors: string[]
}

const DEFAULT_LABEL = ',#656565'

function createPatchIdGenerator(): () => string {
  let counter = 0
  return () => `ritual-${++counter}`
}

function modificationsFromRaw(
  entry: ArchidektRawCardEntry,
  quantity: number,
): ModifyCardModifications {
  return {
    quantity,
    modifier: entry.modifier,
    customCmc: entry.customCmc,
    companion: entry.companion,
    flippedDefault: entry.flippedDefault,
    label: entry.label,
  }
}

/**
 * Build modifyCards/v2/ entries from a name diff (local = new, archidekt = old).
 * For new adds, resolves Archidekt card IDs via search.
 * For removals and quantity changes, uses IDs from the raw deck index.
 */
async function buildUploadPlan(
  diff: NameDiff,
  localSections: DeckSection[],
  rawIndex: RawCardIndex,
  client: ArchidektClient,
  token: string,
): Promise<UploadPlan> {
  const entries: ModifyCardEntry[] = []
  const errors: string[] = []
  const nextPatchId = createPatchIdGenerator()

  // Remove cards: set quantity to 0
  for (const card of diff.removed) {
    const indexed = rawIndex.get(card.name.toLowerCase())
    if (!indexed) {
      errors.push(`Cannot remove card not found in Archidekt deck: ${card.name}`)
      continue
    }
    entries.push({
      action: 'remove',
      cardid: indexed.entry.card.id,
      customCardId: null,
      categories: indexed.entry.categories,
      patchId: nextPatchId(),
      modifications: modificationsFromRaw(indexed.entry, 0),
      deckRelationId: indexed.entry.id,
    })
  }

  // Quantity changes: set new absolute quantity
  for (const entry of diff.quantityChanged) {
    const indexed = rawIndex.get(entry.name.toLowerCase())
    if (!indexed) {
      errors.push(`Cannot update quantity for card not found in Archidekt deck: ${entry.name}`)
      continue
    }
    entries.push({
      action: 'modify',
      cardid: indexed.entry.card.id,
      customCardId: null,
      categories: indexed.entry.categories,
      patchId: nextPatchId(),
      modifications: modificationsFromRaw(indexed.entry, entry.newQty),
      deckRelationId: indexed.entry.id,
    })
  }

  // Add new cards: resolve Archidekt card edition ID via search
  for (const card of diff.added) {
    // Find the local card to get set info if available
    const localCard = findLocalCard(localSections, card.name)
    const result = await client.searchCards(card.name, localCard?.set, token)
    if (typeof result === 'string') {
      errors.push(result)
      continue
    }
    entries.push({
      action: 'add',
      cardid: result.id,
      customCardId: null,
      categories: [result.oracleCard.defaultCategory],
      patchId: nextPatchId(),
      modifications: {
        quantity: card.totalQuantity,
        modifier: result.options[0] ?? 'Normal',
        customCmc: null,
        companion: false,
        flippedDefault: false,
        label: DEFAULT_LABEL,
      },
    })
  }

  return { entries, errors }
}

function findLocalCard(sections: DeckSection[], cardName: string): Card | undefined {
  const nameLower = cardName.toLowerCase()
  for (const section of sections) {
    const card = section.cards.find((c) => c.name.toLowerCase() === nameLower)
    if (card) return card
  }
  return undefined
}

// ── Deck resolution ───────────────────────────────────────────────────

/** Front matter proven to carry an Archidekt source URL. */
type ArchidektFrontMatter = DeckFrontMatter & { sourceUrl: string }

function isArchidektDeck(frontMatter: DeckFrontMatter): frontMatter is ArchidektFrontMatter {
  // `parseDeckFrontMatter` only validates `format`, so the declared string type
  // is optimistic — the runtime check is what makes it a fact.
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
  | { kind: 'unreadable'; name: string; message: string }

/** Classify one deck file by reading only its front matter. */
async function readDeckLink(decksDir: string, file: string): Promise<DeckLink> {
  const filePath = path.join(decksDir, file)
  const slug = path.basename(file, '.md')

  let frontMatter: DeckFrontMatter
  try {
    frontMatter = await parseDeckFrontMatter(filePath)
  } catch (error: unknown) {
    return { kind: 'unreadable', name: slug, message: getErrorMessage(error) }
  }

  if (!isArchidektDeck(frontMatter)) return { kind: 'not-archidekt' }

  const name = typeof frontMatter.name === 'string' ? frontMatter.name : slug
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

type DeckTarget = {
  filePath: string
  frontMatter: DeckFrontMatter
  deck: DeckData
  sourceId: string
}

/** Targets that could be loaded, plus per-deck results for those that could not. */
type ResolvedTargets = {
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

/** A deck that could not be loaded: one message on the log, one result in the report. */
type DeckProblem = {
  name: string
  status: DeckSyncStatus
  reason: string
  message: string
  level: DeckSyncLogLevel
}

/**
 * Load a deck for syncing. Both directions re-serialize the file, so the parser's
 * skipped-line warnings are returned rather than dropped (as `importFromTextFile`
 * would) — a line the parser cannot read is a line the save would delete.
 */
async function loadDeckForSync(filePath: string): Promise<DeckParseResult | string> {
  let text: string
  try {
    text = await Bun.file(filePath).text()
  } catch (error: unknown) {
    return getErrorMessage(error)
  }
  return parseDeckText(text, path.basename(filePath, '.md'))
}

async function resolveTargetDecks(
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

  const problem = ({ name, status, reason, message, level }: DeckProblem): void => {
    emit({ kind: 'log', level, deck: null, message })
    const result: DeckSyncDeckResult = { name, status, reason }
    problems.push(result)
    emit({ kind: 'deck-result', result })
  }

  /** Load a resolved deck file into a target, reporting a read failure as a problem. */
  const addTarget = async (
    filePath: string,
    frontMatter: DeckFrontMatter,
    sourceId: string,
    name: string,
  ): Promise<void> => {
    const loaded = await loadDeckForSync(filePath)
    if (typeof loaded === 'string') {
      problem({
        name,
        status: 'failed',
        reason: `Could not read deck file: ${loaded}`,
        message: `Could not read deck file for "${name}": ${loaded}`,
        level: 'error',
      })
      return
    }
    const target: DeckTarget = { filePath, frontMatter, deck: loaded.deck, sourceId }
    if (loaded.warnings.length > 0) {
      unreadable.push({
        target,
        deck: { name, file: path.basename(filePath), warnings: loaded.warnings },
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
          reason: `unreadable front matter: ${link.message}`,
          message: `Skipping ${file}: unreadable front matter (${link.message})`,
          level: 'error',
        })
        continue
      }
      if (link.kind === 'missing-source-id') {
        problem({
          name: link.name,
          status: 'skipped',
          reason: 'has Archidekt sourceUrl but no sourceId',
          message: `Skipping ${file}: has Archidekt sourceUrl but no sourceId`,
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
        const message = formatResolveListError(resolved)
        problem({ name, status: 'failed', reason: message, message, level: 'error' })
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
          reason: `unreadable front matter: ${link.message}`,
          message: `Deck "${name}" has unreadable front matter: ${link.message}`,
          level: 'error',
        })
        continue
      }
      if (link.kind === 'not-archidekt') {
        problem({
          name,
          status: 'failed',
          reason: 'not sourced from Archidekt',
          message: `Deck "${name}" is not sourced from Archidekt`,
          level: 'error',
        })
        continue
      }
      if (link.kind === 'missing-source-id') {
        problem({
          name,
          status: 'failed',
          reason: 'has Archidekt sourceUrl but no sourceId',
          message: `Deck "${name}" has Archidekt sourceUrl but no sourceId`,
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
    emit({ kind: 'unreadable-lines', decks: unreadableDecks })
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
          deck: null,
          message: `Could not confirm the unreadable lines: ${getErrorMessage(error)}`,
        })
      }
    }
    for (const entry of unreadable) {
      if (accepted) {
        targets.push(entry.target)
        continue
      }
      const lines = entry.deck.warnings.length
      const reason = `${lines} unreadable line${lines === 1 ? '' : 's'} would be dropped by a sync`
      const result: DeckSyncDeckResult = { name: entry.deck.name, status: 'failed', reason }
      // Logged like every other failure, so a refused deck carries its reason
      // inline rather than only in the list emitted above.
      emit({ kind: 'log', level: 'warn', deck: null, message: `${entry.deck.file}: ${reason}` })
      problems.push(result)
      emit({ kind: 'deck-result', result })
    }
  }

  return { targets, problems, unreadable: unreadableDecks }
}

// ── Persistence helpers ───────────────────────────────────────────────

/**
 * Write the deck back with a fresh `lastSynced`, returning every file the write
 * touched — the deck and its content-hash sidecar — so callers that commit a
 * run (the admin endpoints) stage the same set the editors do.
 */
async function saveDeckWithSyncTimestamp(target: DeckTarget, deck: DeckData): Promise<string[]> {
  const updatedFrontMatter: DeckFrontMatter = {
    ...target.frontMatter,
    lastSynced: new Date().toISOString(),
  }
  const markdown = serializeDeckToMarkdown(deck, updatedFrontMatter)
  await writeFileWithHash(target.filePath, markdown)
  return [target.filePath, hashPath(target.filePath)]
}

// ── Run ───────────────────────────────────────────────────────────────

/** The per-deck half of a run: results plus the files it wrote. */
type SyncOutcome = { decks: DeckSyncDeckResult[]; writtenFiles: string[] }

/** Everything a direction's flow needs beyond the decks it was handed. */
type SyncFlow = {
  client: ArchidektClient
  token: string
  dryRun: boolean
  only: SyncChangeFilter | undefined
  emit: DeckSyncEventHandler
}

/**
 * Sync decks with Archidekt in one direction, emitting progress as it goes.
 *
 * Per-deck failures never abort the run: each deck's outcome lands in the report
 * and the next deck is attempted, so `failedCount` is what callers branch on.
 */
export async function runDeckSync(options: DeckSyncOptions): Promise<DeckSyncRun> {
  const { direction, token } = options
  const emit = options.onEvent ?? ((): void => {})
  const dryRun = options.dryRun ?? false
  const client =
    options.client ??
    createPacedArchidektClient((message) =>
      emit({ kind: 'log', level: 'warn', deck: null, message }),
    )

  const { targets, problems, unreadable } = await resolveTargetDecks(
    options.deckNames ?? [],
    getDecksDir(),
    emit,
    options.confirmUnreadable,
    dryRun,
  )

  if (targets.length === 0 && problems.length === 0) {
    emit({ kind: 'log', level: 'info', deck: null, message: 'No Archidekt decks found to sync.' })
  }

  const flow: SyncFlow = { client, token, dryRun, only: options.only, emit }
  const outcome: SyncOutcome =
    targets.length === 0
      ? { decks: [], writtenFiles: [] }
      : direction === 'pull'
        ? await downloadChanges(targets, flow)
        : await uploadChanges(targets, flow)

  const decks = [...problems, ...outcome.decks]
  const failedCount = decks.filter((deck) => deck.status === 'failed').length
  return {
    report: { direction, decks, failedCount, unreadable },
    writtenFiles: outcome.writtenFiles,
  }
}

/** Emit a deck's final result and record it. */
function finish(
  results: DeckSyncDeckResult[],
  emit: DeckSyncEventHandler,
  result: DeckSyncDeckResult,
): void {
  results.push(result)
  emit({ kind: 'deck-result', result })
}

/** Report a deck as failed: the reason on the log, then the result. */
function failDeck(
  results: DeckSyncDeckResult[],
  emit: DeckSyncEventHandler,
  name: string,
  reason: string,
): void {
  emit({ kind: 'log', level: 'error', deck: name, message: reason })
  finish(results, emit, { name, status: 'failed', reason })
}

// ── Download flow ─────────────────────────────────────────────────────

async function downloadChanges(targets: DeckTarget[], flow: SyncFlow): Promise<SyncOutcome> {
  const { client, token, dryRun, only, emit } = flow
  const results: DeckSyncDeckResult[] = []
  const writtenFiles: string[] = []

  for (const [index, target] of targets.entries()) {
    const name = target.deck.name
    emit({ kind: 'deck-start', deck: name, index, total: targets.length })

    let remoteDeck: DeckData
    try {
      remoteDeck = await client.fetchDeck(target.sourceId, token)
    } catch (error: unknown) {
      failDeck(
        results,
        emit,
        name,
        `Failed to fetch Archidekt deck ${target.sourceId}: ${getErrorMessage(error)}`,
      )
      continue
    }

    // The filter narrows the diff before anything acts on it, so "no changes"
    // means "nothing left to apply" — with the skipped side reported either way.
    const { diff, skipped } = filterNameDiff(
      diffByCardName(target.deck.sections, remoteDeck.sections),
      only,
    )
    const skippedMessage = describeSkippedChanges(only, skipped)
    if (skippedMessage) {
      emit({ kind: 'log', level: 'info', deck: name, message: skippedMessage })
    }
    const formatSync = syncDeckFormat(target.deck, target.frontMatter.format, remoteDeck)

    if (isDiffEmpty(diff) && !formatSync.changed) {
      emit({ kind: 'log', level: 'info', deck: name, message: 'No changes detected.' })
      finish(results, emit, { name, status: 'synced', reason: 'no changes' })
      continue
    }

    const changeSummary = `+${diff.added.length} added, -${diff.removed.length} removed, ~${diff.quantityChanged.length} quantity changed`
    if (!isDiffEmpty(diff)) {
      emit({ kind: 'log', level: 'info', deck: name, message: `Changes: ${changeSummary}` })
    }
    if (formatSync.changed && formatSync.format) {
      const was = formatSync.localFormat ? getDeckFormatLabel(formatSync.localFormat) : 'not set'
      emit({
        kind: 'log',
        level: 'info',
        deck: name,
        message: `Format: ${was} → ${getDeckFormatLabel(formatSync.format)}`,
      })
    }

    if (dryRun) {
      emit({ kind: 'log', level: 'info', deck: name, message: '[dry-run] Not saved.' })
      finish(results, emit, { name, status: 'synced', reason: `dry-run: ${changeSummary}` })
      continue
    }

    // Apply changes to local sections, assigning IDs to any newly added cards so
    // they are persisted with a stable `&N` rather than being backfilled later.
    const updatedSections = applyDownloadDiff(target.deck.sections, diff)
    const updatedDeck: DeckData = assignMissingDeckCardIds({
      ...target.deck,
      format: formatSync.format ?? undefined,
      sections: updatedSections,
    })

    // Record changes in changelog, stamping each with its card ID. Added and
    // quantity-changed cards resolve against the post-sync deck; removed cards
    // (no longer present) resolve against the pre-sync deck.
    const resolveCardId = buildCardIdResolver(updatedDeck.sections, target.deck.sections)
    const changes = diffToChangeEvents(diff, resolveCardId)
    if (changes.length > 0) {
      writtenFiles.push(await appendChangelog(target.filePath, target.deck.name, changes))
    }

    // Write updated deck with lastSynced
    writtenFiles.push(...(await saveDeckWithSyncTimestamp(target, updatedDeck)))
    emit({ kind: 'log', level: 'info', deck: name, message: 'Saved.' })
    finish(results, emit, { name, status: 'synced' })
  }

  return { decks: results, writtenFiles }
}

// ── Upload flow ───────────────────────────────────────────────────────

async function uploadChanges(targets: DeckTarget[], flow: SyncFlow): Promise<SyncOutcome> {
  const { client, token, dryRun, only, emit } = flow
  const results: DeckSyncDeckResult[] = []
  const writtenFiles: string[] = []

  // Fetch owned deck IDs for ownership check
  let ownedDeckIds: Set<string>
  try {
    const ownDecks = await client.fetchOwnDecks(token)
    ownedDeckIds = new Set(ownDecks.map((d) => d.id.toString()))
  } catch (error: unknown) {
    const reason = `Failed to fetch owned decks: ${getErrorMessage(error)}`
    emit({ kind: 'log', level: 'error', deck: null, message: reason })
    // No deck could be synced without the ownership list — all failed.
    for (const target of targets) {
      finish(results, emit, { name: target.deck.name, status: 'failed', reason })
    }
    return { decks: results, writtenFiles }
  }

  for (const [index, target] of targets.entries()) {
    const name = target.deck.name
    emit({ kind: 'deck-start', deck: name, index, total: targets.length })

    if (!ownedDeckIds.has(target.sourceId)) {
      const reason = `you do not own Archidekt deck ${target.sourceId}`
      emit({ kind: 'log', level: 'warn', deck: name, message: `Skipping: ${reason}` })
      finish(results, emit, { name, status: 'skipped', reason })
      continue
    }

    // Both fetches are guarded together: a failure in either leaves this deck
    // unsynced, and the run must move on to the next one rather than abort.
    let rawDeck: ArchidektRawDeckResponse
    let remoteDeck: DeckData
    try {
      rawDeck = await client.fetchDeckRaw(target.sourceId, token)
      // Parse raw response into DeckData for diffing (reuse existing parser).
      remoteDeck = await client.fetchDeck(target.sourceId, token)
    } catch (error: unknown) {
      failDeck(
        results,
        emit,
        name,
        `Failed to fetch Archidekt deck ${target.sourceId}: ${getErrorMessage(error)}`,
      )
      continue
    }

    // Uploads diff by name only: the modifyCards API path cannot yet target a
    // specific remote board/category, so board placement must be ignored here to
    // avoid spuriously moving cards on Archidekt.
    const { diff, skipped } = filterNameDiff(
      diffByCardName(remoteDeck.sections, target.deck.sections, { byBoard: false }),
      only,
    )
    const skippedMessage = describeSkippedChanges(only, skipped)
    if (skippedMessage) {
      emit({ kind: 'log', level: 'info', deck: name, message: skippedMessage })
    }

    if (isDiffEmpty(diff)) {
      emit({ kind: 'log', level: 'info', deck: name, message: 'No changes to upload.' })
      finish(results, emit, { name, status: 'synced', reason: 'no changes' })
      continue
    }

    emit({
      kind: 'log',
      level: 'info',
      deck: name,
      message: `Changes: +${diff.added.length} to add, -${diff.removed.length} to remove, ~${diff.quantityChanged.length} quantity changes`,
    })

    const rawIndex = buildRawCardIndex(rawDeck)
    const plan = await buildUploadPlan(diff, target.deck.sections, rawIndex, client, token)

    // Plan errors are partial failures: some cards could not be turned into
    // upload entries, so the deck did not fully sync even if the rest pushes.
    const deckFailed = plan.errors.length > 0
    for (const err of plan.errors) {
      emit({ kind: 'log', level: 'warn', deck: name, message: err })
    }

    if (dryRun) {
      emit({
        kind: 'log',
        level: 'info',
        deck: name,
        message: `[dry-run] Would push ${plan.entries.length} card changes to Archidekt.`,
      })
      finish(
        results,
        emit,
        deckFailed
          ? { name, status: 'failed', reason: plan.errors.join('; ') }
          : {
              name,
              status: 'synced',
              reason: `dry-run: would push ${plan.entries.length} card changes`,
            },
      )
      continue
    }

    if (plan.entries.length > 0) {
      try {
        await client.modifyCards(target.sourceId, plan.entries, token)
        emit({
          kind: 'log',
          level: 'info',
          deck: name,
          message: `Pushed ${plan.entries.length} card changes to Archidekt.`,
        })
      } catch (error: unknown) {
        failDeck(results, emit, name, `Failed to push changes: ${getErrorMessage(error)}`)
        continue
      }
    }

    // Update lastSynced in front matter
    writtenFiles.push(...(await saveDeckWithSyncTimestamp(target, target.deck)))
    emit({ kind: 'log', level: 'info', deck: name, message: 'Updated lastSynced.' })

    finish(
      results,
      emit,
      deckFailed
        ? { name, status: 'failed', reason: plan.errors.join('; ') }
        : { name, status: 'synced' },
    )
  }

  return { decks: results, writtenFiles }
}
