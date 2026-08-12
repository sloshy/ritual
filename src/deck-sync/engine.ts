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
import { unreadableLines } from '../markdown-fence'
import { getErrorMessage } from '../errors'
import { t } from '../i18n/t'
import {
  parseDeckFrontMatter,
  serializeDeckToMarkdown,
  writeDeckFrontMatter,
  type DeckFrontMatter,
} from '../deck-file'
import { getDeckFormatLabel } from '../deck-format'
import { formatResolveListError, isResolveListError, resolveList } from '../resolve-list'
import { appendChangelog } from '../changelog-writer'
import type { Card, DeckData, DeckSection, Finish } from '../types'
import type {
  ArchidektCardModifier,
  ArchidektRawDeckResponse,
  ArchidektRawCardEntry,
  ModifyCardEntry,
  ModifyCardModifications,
} from '../importers/archidekt-types'
import {
  diffByCardName,
  diffPrintings,
  diffToChangeEvents,
  buildCardIdResolver,
  buildCardIdsResolver,
  filterNameDiff,
  isDiffEmpty,
  applyDownloadDiff,
  applyPrintingUpdates,
  printingRefOf,
  printingUpdatesToChangeEvents,
  syncDeckFormat,
  type DeckPrintingRef,
  type NameDiff,
  type PrintingDiff,
  type PrintingSkip,
  type PrintingUpdate,
} from './diff'
import { printingSuffix } from '../card-line'
import { hasSpecificPrinting } from '../card-printing'
import { archidektModifier } from '../importers/archidekt-collection'
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
import { checkDeckDivergence, describeDivergence } from './divergence'
import { hashPath, writeFileWithHash } from '../content-hash'
import { getDecksDir } from '../ritual-config'

// ── Public surface ────────────────────────────────────────────────────

/** What happened to one deck during a sync run. */
export type DeckSyncStatus = SyncItemStatus
export type DeckSyncDeckResult = {
  name: string
  status: DeckSyncStatus
  reason?: string
  /**
   * Printing differences the run found for this deck (applied on a real run,
   * previewed on a dry run). Present only when the run synced printings, so
   * structured consumers — `--output json`, the MCP report, the admin page's
   * non-streaming fallback — see them without reading the log.
   */
  printingsChanged?: number
  /**
   * Cards whose printings could not be reconciled — several distinct printings
   * of one name on one side. Present only when the run synced printings; the
   * log's warning carries which side was ambiguous.
   */
  printingsSkipped?: string[]
}

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
  /**
   * Push a deck whose remote copy changed since its recorded `sourceUpdatedAt`,
   * overwriting those remote changes. Without it such a deck fails; see
   * {@link checkDeckDivergence}. Meaningless on a pull, which never writes to
   * Archidekt.
   */
  force?: boolean
  /**
   * Also sync each card's exact printing — set, collector number, and finish
   * (the CLI's `--sync-printings`). Off by default, matching the historical
   * name-and-quantity-only diff: a pull rewrites local printings to the
   * remote's, and a push moves remote entries to the local file's printings,
   * so it is opt-in per run. Cards whose lines disagree on a printing (several
   * distinct printings of one name on either side) are skipped with a warning
   * rather than guessed at, and the `only` filter does not apply — a printing
   * update neither adds nor removes cards.
   */
  syncPrintings?: boolean
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

export type RawCardIndexEntry = {
  totalQty: number
  /**
   * Every deck-card relation sharing the name, in response order. Typed
   * non-empty because an index entry exists only for a name the response
   * held: `entries[0]` is the primary relation quantity changes are written
   * to, and the type spares every reader the impossible-miss check.
   */
  entries: [ArchidektRawCardEntry, ...ArchidektRawCardEntry[]]
}
export type RawCardIndex = Map<string, RawCardIndexEntry>

/**
 * Build an index from an Archidekt raw deck response, keyed by card name (lowercase).
 * When multiple entries share a name, quantities are summed and every relation
 * is retained in `entries`, first-seen first.
 */
export function buildRawCardIndex(rawDeck: ArchidektRawDeckResponse): RawCardIndex {
  const index: RawCardIndex = new Map()
  for (const entry of rawDeck.cards) {
    const name = entry.card.oracleCard.name.toLowerCase()
    const existing = index.get(name)
    if (existing) {
      existing.totalQty += entry.quantity
      existing.entries.push(entry)
    } else {
      index.set(name, { totalQty: entry.quantity, entries: [entry] })
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

/** The modifier a printing sync sends, or the reason it cannot. */
type ResolvedModifier = { ok: true; modifier: ArchidektCardModifier } | { ok: false; error: string }

/**
 * The modifier for a local finish against the printing's valid options. A
 * finish the line *states* must be offered by the printing — pushing a foil
 * that does not exist would silently mean something else — while an unstated
 * finish falls back to the printing's first option, the same default
 * Archidekt's own editor applies (and the one that keeps a bare local line on
 * a foil-only printing from failing every push).
 */
function resolveModifier(
  finish: Finish | undefined,
  options: ArchidektCardModifier[],
  cardLabel: string,
): ResolvedModifier {
  const desired = archidektModifier(finish ?? 'nonfoil')
  if (options.includes(desired)) return { ok: true, modifier: desired }
  if (finish !== undefined) {
    return {
      ok: false,
      error: `Finish "${finish}" is not offered for ${cardLabel} on Archidekt (valid: ${options.join(', ')})`,
    }
  }
  return { ok: true, modifier: options[0] ?? 'Normal' }
}

/** `Sol Ring (MKM:123)` when the printing names a set, for upload-plan messages. */
function printingLabel(name: string, ref: DeckPrintingRef): string {
  return `${name}${printingSuffix(ref.set, ref.collectorNumber)}`
}

/** The edition/modifier a printing update pushes onto a card's deck relations. */
type ResolvedPrintingTarget = { cardid: number; modifier: ArchidektCardModifier }

/** What resolving printing updates produced: the sendable targets, and why the rest are not. */
type ResolvedPrintingTargets = {
  /** Keyed by card name (lowercase). */
  targets: Map<string, ResolvedPrintingTarget>
  errors: string[]
}

/**
 * Resolve printing updates into the edition id and modifier each card's
 * relations should carry, keyed by card name (lowercase). An update whose
 * target edition differs from the remote's is resolved through the printing
 * search; one that only changes the finish reuses the remote edition. Updates
 * that resolve to exactly what the remote already records are dropped — a
 * bare local line on a foil-only printing "wants" nonfoil but falls back to
 * the printing's own finish, which is not a change worth sending.
 */
async function resolvePrintingTargets(
  updates: readonly PrintingUpdate[],
  rawIndex: RawCardIndex,
  client: ArchidektClient,
  token: string,
): Promise<ResolvedPrintingTargets> {
  const targets = new Map<string, ResolvedPrintingTarget>()
  const errors: string[] = []
  for (const update of updates) {
    const indexed = rawIndex.get(update.name.toLowerCase())
    // The diff only emits updates for cards present on both sides, so a miss
    // here means the raw payload and the parsed deck disagree — report it.
    if (!indexed) {
      errors.push(`Cannot update printing for card not found in Archidekt deck: ${update.name}`)
      continue
    }

    const remoteCard = indexed.entries[0].card
    let cardid = remoteCard.id
    let options = remoteCard.options
    if (hasSpecificPrinting(update.to)) {
      const sameEdition =
        remoteCard.edition.editioncode.toLowerCase() === update.to.set.toLowerCase() &&
        remoteCard.collectorNumber.toLowerCase() === update.to.collectorNumber.toLowerCase()
      if (!sameEdition) {
        const result = await client.searchCards(
          update.name,
          update.to.set,
          token,
          update.to.collectorNumber,
        )
        if (typeof result === 'string') {
          errors.push(result)
          continue
        }
        cardid = result.id
        options = result.options
      }
    }

    const resolved = resolveModifier(
      update.to.finish,
      options,
      printingLabel(update.name, update.to),
    )
    if (!resolved.ok) {
      errors.push(resolved.error)
      continue
    }

    // Nothing left to change once the finish fallback is applied.
    if (cardid === remoteCard.id && resolved.modifier === indexed.entries[0].modifier) continue

    targets.set(update.name.toLowerCase(), { cardid, modifier: resolved.modifier })
  }
  return { targets, errors }
}

/** What a push needs to know beyond the name diff. */
type UploadPlanOptions = {
  /** Printing updates to fold into the plan; empty when the flag is off. */
  printingUpdates: readonly PrintingUpdate[]
  /** Pin new cards to their exact printing and finish (`--sync-printings`). */
  syncPrintings: boolean
}

/**
 * Build modifyCards/v2/ entries from a name diff (local = new, archidekt = old).
 * For new adds, resolves Archidekt card IDs via search.
 * For removals and quantity changes, uses IDs from the raw deck index.
 *
 * Printing updates are folded in rather than appended: a card whose quantity
 * and printing both changed gets **one** modify entry per deck relation, since
 * two entries naming the same `deckRelationId` would race each other.
 */
async function buildUploadPlan(
  diff: NameDiff,
  localSections: DeckSection[],
  rawIndex: RawCardIndex,
  client: ArchidektClient,
  token: string,
  options: UploadPlanOptions,
): Promise<UploadPlan> {
  const entries: ModifyCardEntry[] = []
  const errors: string[] = []
  const nextPatchId = createPatchIdGenerator()

  const resolvedTargets = await resolvePrintingTargets(
    options.printingUpdates,
    rawIndex,
    client,
    token,
  )
  errors.push(...resolvedTargets.errors)
  const printingTargets = resolvedTargets.targets

  /** One modify entry for a relation, carrying its printing target when one is set. */
  const modifyEntry = (
    raw: ArchidektRawCardEntry,
    quantity: number,
    target: ResolvedPrintingTarget | undefined,
  ): ModifyCardEntry => ({
    action: 'modify',
    cardid: target?.cardid ?? raw.card.id,
    customCardId: null,
    categories: raw.categories,
    patchId: nextPatchId(),
    modifications: {
      ...modificationsFromRaw(raw, quantity),
      modifier: target?.modifier ?? raw.modifier,
    },
    deckRelationId: raw.id,
  })

  // Remove cards: set quantity to 0
  for (const card of diff.removed) {
    const indexed = rawIndex.get(card.name.toLowerCase())
    if (!indexed) {
      errors.push(`Cannot remove card not found in Archidekt deck: ${card.name}`)
      continue
    }
    const primary = indexed.entries[0]
    entries.push({
      action: 'remove',
      cardid: primary.card.id,
      customCardId: null,
      categories: primary.categories,
      patchId: nextPatchId(),
      modifications: modificationsFromRaw(primary, 0),
      deckRelationId: primary.id,
    })
  }

  // Quantity changes: set new absolute quantity (on the primary relation; any
  // other relations of the name keep their own quantities but still take a
  // pending printing change).
  for (const entry of diff.quantityChanged) {
    const nameKey = entry.name.toLowerCase()
    const indexed = rawIndex.get(nameKey)
    if (!indexed) {
      errors.push(`Cannot update quantity for card not found in Archidekt deck: ${entry.name}`)
      continue
    }
    const target = printingTargets.get(nameKey)
    printingTargets.delete(nameKey)
    entries.push(modifyEntry(indexed.entries[0], entry.newQty, target))
    if (target) {
      for (const raw of indexed.entries.slice(1)) {
        entries.push(modifyEntry(raw, raw.quantity, target))
      }
    }
  }

  // Printing-only changes: every relation of the name moves to the new
  // edition/finish, each keeping its own quantity.
  for (const [nameKey, target] of printingTargets) {
    const indexed = rawIndex.get(nameKey)
    if (!indexed) continue // already reported by resolvePrintingTargets
    for (const raw of indexed.entries) {
      entries.push(modifyEntry(raw, raw.quantity, target))
    }
  }

  // Add new cards: resolve Archidekt card edition ID via search. Under
  // syncPrintings the pin comes from the diff's own printing summary — set
  // only when the card's local lines agree on one printing — so an ambiguous
  // card is added unpinned (Archidekt picks its default edition) rather than
  // pinned to whichever line happened to come first. Without the flag, the
  // historical behavior: the first matching line's set as a search hint.
  for (const card of diff.added) {
    const printing = options.syncPrintings ? card.printing : undefined
    const searchSet = options.syncPrintings
      ? printing?.set
      : findLocalCard(localSections, card.name)?.set
    const result = await client.searchCards(card.name, searchSet, token, printing?.collectorNumber)
    if (typeof result === 'string') {
      errors.push(result)
      continue
    }
    let modifier = result.options[0] ?? 'Normal'
    if (options.syncPrintings) {
      const resolved = resolveModifier(
        printing?.finish,
        result.options,
        printingLabel(card.name, printing ?? printingRefOf(undefined)),
      )
      if (!resolved.ok) {
        errors.push(resolved.error)
        continue
      }
      modifier = resolved.modifier
    }
    entries.push({
      action: 'add',
      cardid: result.id,
      customCardId: null,
      categories: [result.oracleCard.defaultCategory],
      patchId: nextPatchId(),
      modifications: {
        quantity: card.totalQuantity,
        modifier,
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
    // Both directions re-serialize the whole file, so a fenced code block is as
    // much at risk as a line the parser could not read.
    const blockers = unreadableLines(loaded)
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
        const message = formatResolveListError(resolved, 'none')
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
      const reason = `${t('domain.count.unreadableLines', { count: lines })} would be dropped by a sync`
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
 * The front matter a completed sync stamps: `lastSynced` from the local clock
 * (what the user is shown), and `sourceUpdatedAt` copied verbatim from the
 * remote deck (the divergence guard's single-clock baseline — see
 * {@link checkDeckDivergence}).
 *
 * A remote timestamp Archidekt did not report clears the key rather than leaving
 * a stale one: a baseline older than the sync that just happened would refuse
 * the *next* push over changes this run already reconciled, and "no baseline"
 * fails open the way a never-synced deck does.
 */
function syncedFrontMatter(
  frontMatter: DeckFrontMatter,
  remoteUpdatedAt: string | undefined,
): DeckFrontMatter {
  const next: DeckFrontMatter = { ...frontMatter, lastSynced: new Date().toISOString() }
  if (typeof remoteUpdatedAt === 'string' && remoteUpdatedAt.trim() !== '') {
    next.sourceUpdatedAt = remoteUpdatedAt
  } else {
    delete next.sourceUpdatedAt
  }
  return next
}

/**
 * Write the deck back with a fresh sync stamp, returning every file the write
 * touched — the deck and its content-hash sidecar — so callers that commit a
 * run (the admin endpoints) stage the same set the editors do.
 */
async function saveDeckWithSyncTimestamp(
  target: DeckTarget,
  deck: DeckData,
  remoteUpdatedAt: string | undefined,
): Promise<string[]> {
  const markdown = serializeDeckToMarkdown(
    deck,
    syncedFrontMatter(target.frontMatter, remoteUpdatedAt),
  )
  await writeFileWithHash(target.filePath, markdown)
  return [target.filePath, hashPath(target.filePath)]
}

/**
 * Record a sync that changed no cards: the front matter's stamp moves, the body
 * does not. Written through {@link writeDeckFrontMatter} rather than the full
 * serializer so a pull that found nothing to apply does not also canonicalize
 * every card line — and so an unrecorded hand edit keeps its stale `.sha256`
 * sidecar, leaving `detect-changes` able to record it.
 */
async function stampSyncedFrontMatter(
  target: DeckTarget,
  remoteUpdatedAt: string | undefined,
): Promise<string[]> {
  const write = await writeDeckFrontMatter(
    target.filePath,
    syncedFrontMatter(target.frontMatter, remoteUpdatedAt),
  )
  return write.writtenFiles
}

// ── Run ───────────────────────────────────────────────────────────────

/** The per-deck half of a run: results plus the files it wrote. */
type SyncOutcome = { decks: DeckSyncDeckResult[]; writtenFiles: string[] }

/** Everything a direction's flow needs beyond the decks it was handed. */
type SyncFlow = {
  client: ArchidektClient
  token: string
  direction: SyncDirection
  dryRun: boolean
  only: SyncChangeFilter | undefined
  /** Overwrite a remote deck that changed since the last sync (push only). */
  force: boolean
  /** Also sync each card's exact printing and finish. */
  syncPrintings: boolean
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

  const flow: SyncFlow = {
    client,
    token,
    direction,
    dryRun,
    only: options.only,
    force: options.force ?? false,
    syncPrintings: options.syncPrintings ?? false,
    emit,
  }
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

/**
 * The remote deck's `updatedAt` after a push, for the divergence baseline.
 *
 * A push that sent nothing kept `before`; one that sent cards moved the remote
 * on, so its new value has to be read back. `undefined` on any failure — the
 * baseline is then cleared and the next push fails open rather than refusing
 * over a timestamp Ritual made up.
 */
async function readRemoteUpdatedAt(
  client: ArchidektClient,
  sourceId: string,
  token: string,
  pushed: boolean,
  before: string | undefined,
): Promise<string | undefined> {
  if (!pushed) return before
  try {
    return (await client.fetchDeckRaw(sourceId, token)).updatedAt
  } catch {
    return undefined
  }
}

/** A no-change printing diff, for runs without `syncPrintings`. */
const EMPTY_PRINTING_DIFF: PrintingDiff = { updates: [], skipped: [] }

/**
 * The warning for a card whose printings could not be reconciled. The diff's
 * old side is always the sync destination, so which side is the local file
 * depends on the direction: a pull diffs local → remote, a push remote → local.
 */
function describePrintingSkip(skip: PrintingSkip, direction: SyncDirection): string {
  const skippedLocal = (skip.side === 'old') === (direction === 'pull')
  const where = skippedLocal ? 'in the local file' : 'on Archidekt'
  return `Printing not synced for "${skip.name}": the card has several distinct printings ${where}.`
}

/** The report fields a printing pass adds to a deck's results. */
type PrintingResultFields = Pick<DeckSyncDeckResult, 'printingsChanged' | 'printingsSkipped'>

/**
 * What this deck's results say about the printing pass — empty when the run
 * is not syncing printings, so the fields stay absent rather than reading as
 * "zero printings were considered".
 */
function printingResultFields(flow: SyncFlow, printingDiff: PrintingDiff): PrintingResultFields {
  if (!flow.syncPrintings) return {}
  return {
    printingsChanged: printingDiff.updates.length,
    printingsSkipped: printingDiff.skipped.map((skip) => skip.name),
  }
}

/** Emit one warning per card the printing diff had to skip. */
function emitPrintingSkips(flow: SyncFlow, deck: string, skipped: readonly PrintingSkip[]): void {
  for (const skip of skipped) {
    flow.emit({
      kind: 'log',
      level: 'warn',
      deck,
      message: describePrintingSkip(skip, flow.direction),
    })
  }
}

// ── Download flow ─────────────────────────────────────────────────────

async function downloadChanges(targets: DeckTarget[], flow: SyncFlow): Promise<SyncOutcome> {
  const { client, token, dryRun, only, emit } = flow
  const results: DeckSyncDeckResult[] = []
  const writtenFiles: string[] = []

  for (const [index, target] of targets.entries()) {
    const name = target.deck.name
    emit({ kind: 'deck-start', deck: name, index, total: targets.length })

    // Fetched with its raw payload: the pull records the remote's `updatedAt` as
    // the divergence baseline a later push compares against.
    let remoteDeck: DeckData
    let remoteUpdatedAt: string | undefined
    try {
      const fetched = await client.fetchDeckWithRaw(target.sourceId, token)
      remoteDeck = fetched.deck
      remoteUpdatedAt = fetched.raw.updatedAt
    } catch (error: unknown) {
      failDeck(results, emit, name, getErrorMessage(error))
      continue
    }

    // The filter narrows the diff before anything acts on it, so "no changes"
    // means "nothing left to apply" — with the skipped side reported either way.
    const { diff, skipped } = filterNameDiff(
      diffByCardName(target.deck.sections, remoteDeck.sections, {
        withPrintings: flow.syncPrintings,
      }),
      only,
    )
    const skippedMessage = describeSkippedChanges(only, skipped)
    if (skippedMessage) {
      emit({ kind: 'log', level: 'info', deck: name, message: skippedMessage })
    }
    // Printing updates sit outside the `only` filter: they neither add nor
    // remove cards, so neither side of that vocabulary covers them.
    const printingDiff = flow.syncPrintings
      ? diffPrintings(target.deck.sections, remoteDeck.sections)
      : EMPTY_PRINTING_DIFF
    emitPrintingSkips(flow, name, printingDiff.skipped)
    // Spread into every result this deck produces, so structured consumers see
    // what the printing pass did without reading the log. Empty off the flag.
    const printingReport = printingResultFields(flow, printingDiff)
    const formatSync = syncDeckFormat(target.deck, target.frontMatter.format, remoteDeck)

    if (isDiffEmpty(diff) && !formatSync.changed && printingDiff.updates.length === 0) {
      emit({ kind: 'log', level: 'info', deck: name, message: 'No changes detected.' })
      // The sync still happened, so its stamp is still recorded. Skipping this
      // is what used to lock a deck out of `push`: a remote edit that touches no
      // card list (a rename, a category shuffle, another machine's push) moves
      // Archidekt's `updatedAt` without giving a pull anything to apply, and the
      // divergence guard's documented remedy — pull first — could never clear it.
      if (!dryRun && target.frontMatter.sourceUpdatedAt !== remoteUpdatedAt) {
        writtenFiles.push(...(await stampSyncedFrontMatter(target, remoteUpdatedAt)))
      }
      finish(results, emit, { name, status: 'synced', reason: 'no changes', ...printingReport })
      continue
    }

    const printingClause =
      printingDiff.updates.length > 0
        ? `, ${t('domain.count.printings', { count: printingDiff.updates.length })} changed`
        : ''
    const changeSummary = `+${diff.added.length} added, -${diff.removed.length} removed, ~${diff.quantityChanged.length} quantity changed${printingClause}`
    if (!isDiffEmpty(diff) || printingDiff.updates.length > 0) {
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
      finish(results, emit, {
        name,
        status: 'synced',
        reason: `dry-run: ${changeSummary}`,
        ...printingReport,
      })
      continue
    }

    // Apply changes to local sections, assigning IDs to any newly added cards so
    // they are persisted with a stable `&N` rather than being backfilled later.
    const updatedSections = applyPrintingUpdates(
      applyDownloadDiff(target.deck.sections, diff),
      printingDiff.updates,
    )
    const updatedDeck: DeckData = assignMissingDeckCardIds({
      ...target.deck,
      format: formatSync.format ?? undefined,
      sections: updatedSections,
    })

    // Write updated deck with lastSynced, THEN record the changelog — the same
    // ordering `finishListSave` converged the three save routes on, for the same
    // reason: neither order is atomic, and a crash between the two leaves either
    // a phantom history entry for an edit the file never received or a correct
    // file with a gap in its audit trail. `ritual history`, the change-bundle
    // export, and the editors' undo all *act on* changelog entries, so a phantom
    // propagates while a gap does not.
    writtenFiles.push(...(await saveDeckWithSyncTimestamp(target, updatedDeck, remoteUpdatedAt)))

    // Changes are stamped with their card ID. Added and quantity-changed cards
    // resolve against the post-sync deck; removed cards (no longer present)
    // resolve against the pre-sync deck. Printing updates rewrite every line
    // of a card, so they resolve to one event per rewritten line.
    const resolveCardId = buildCardIdResolver(updatedDeck.sections, target.deck.sections)
    const changes = [
      ...diffToChangeEvents(diff, resolveCardId),
      ...printingUpdatesToChangeEvents(
        printingDiff.updates,
        buildCardIdsResolver(updatedDeck.sections),
      ),
    ]
    if (changes.length > 0) {
      writtenFiles.push(await appendChangelog(target.filePath, target.deck.name, changes))
    }
    emit({ kind: 'log', level: 'info', deck: name, message: 'Saved.' })
    finish(results, emit, { name, status: 'synced', ...printingReport })
  }

  return { decks: results, writtenFiles }
}

// ── Upload flow ───────────────────────────────────────────────────────

async function uploadChanges(targets: DeckTarget[], flow: SyncFlow): Promise<SyncOutcome> {
  const { client, token, dryRun, only, force, emit } = flow
  const results: DeckSyncDeckResult[] = []
  const writtenFiles: string[] = []

  // Fetch owned deck IDs for ownership check
  let ownedDeckIds: Set<string>
  try {
    const ownDecks = await client.fetchOwnDecks(token)
    ownedDeckIds = new Set(ownDecks.map((d) => d.id.toString()))
  } catch (error: unknown) {
    // No outer prefix: the client's error already names the operation that
    // failed ("Failed to fetch own decks: 502 …").
    const reason = getErrorMessage(error)
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

    // One fetch, read both ways: the raw payload for the upload plan's card ids
    // and `updatedAt`, the parsed deck for the diff. A failure leaves this deck
    // unsynced, and the run moves on to the next one rather than aborting.
    let rawDeck: ArchidektRawDeckResponse
    let remoteDeck: DeckData
    try {
      const fetched = await client.fetchDeckWithRaw(target.sourceId, token)
      rawDeck = fetched.raw
      remoteDeck = fetched.deck
    } catch (error: unknown) {
      failDeck(results, emit, name, getErrorMessage(error))
      continue
    }

    // A push overwrites the remote deck with the local file, so a remote that
    // moved on since the recorded sync is quiet data loss unless it was asked
    // for. A dry run reports the same refusal — that is what a real run would
    // do — rather than requiring --force to preview it.
    if (!force) {
      const check = checkDeckDivergence({
        remoteUpdatedAt: rawDeck.updatedAt,
        syncedUpdatedAt:
          typeof target.frontMatter.sourceUpdatedAt === 'string'
            ? target.frontMatter.sourceUpdatedAt
            : null,
      })
      if (check.kind === 'diverged') {
        failDeck(results, emit, name, describeDivergence(check.divergence))
        continue
      }
      // Failing open is deliberate, but silently is not: the push goes ahead
      // and the run log says the guard could not run. (`unsynced` is the
      // documented first-push case and needs no line.)
      if (check.kind === 'unknown') {
        emit({
          kind: 'log',
          level: 'warn',
          deck: name,
          message: `${check.reason} — pushing without the divergence check.`,
        })
      }
    }

    // Uploads diff by name only: the modifyCards API path cannot yet target a
    // specific remote board/category, so board placement must be ignored here to
    // avoid spuriously moving cards on Archidekt. `withPrintings` rides the
    // flag so a new card's printing pin comes from the summary — set only when
    // the card's local lines agree on one printing.
    const { diff, skipped } = filterNameDiff(
      diffByCardName(remoteDeck.sections, target.deck.sections, {
        byBoard: false,
        withPrintings: flow.syncPrintings,
      }),
      only,
    )
    const skippedMessage = describeSkippedChanges(only, skipped)
    if (skippedMessage) {
      emit({ kind: 'log', level: 'info', deck: name, message: skippedMessage })
    }
    // Printing updates sit outside the `only` filter: they neither add nor
    // remove cards, so neither side of that vocabulary covers them.
    const printingDiff = flow.syncPrintings
      ? diffPrintings(remoteDeck.sections, target.deck.sections, { byBoard: false })
      : EMPTY_PRINTING_DIFF
    emitPrintingSkips(flow, name, printingDiff.skipped)
    const printingReport = printingResultFields(flow, printingDiff)

    if (isDiffEmpty(diff) && printingDiff.updates.length === 0) {
      emit({ kind: 'log', level: 'info', deck: name, message: 'No changes to upload.' })
      finish(results, emit, { name, status: 'synced', reason: 'no changes', ...printingReport })
      continue
    }

    const printingClause =
      printingDiff.updates.length > 0
        ? `, ${t('domain.count.printings', { count: printingDiff.updates.length })} to change`
        : ''
    emit({
      kind: 'log',
      level: 'info',
      deck: name,
      message: `Changes: +${diff.added.length} to add, -${diff.removed.length} to remove, ~${diff.quantityChanged.length} quantity changes${printingClause}`,
    })

    const rawIndex = buildRawCardIndex(rawDeck)
    const plan = await buildUploadPlan(diff, target.deck.sections, rawIndex, client, token, {
      printingUpdates: printingDiff.updates,
      syncPrintings: flow.syncPrintings,
    })

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
          ? { name, status: 'failed', reason: plan.errors.join('; '), ...printingReport }
          : {
              name,
              status: 'synced',
              reason: `dry-run: would push ${plan.entries.length} card changes`,
              ...printingReport,
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

    // `lastSynced` records a sync that happened, so a deck whose plan could not
    // be fully built does not get one: it is reported as failed, and stamping it
    // would have the front matter (and every status surface reading it) claim a
    // sync the deck never completed.
    if (deckFailed) {
      finish(results, emit, {
        name,
        status: 'failed',
        reason: plan.errors.join('; '),
        ...printingReport,
      })
      continue
    }

    // The push itself moved the remote's `updatedAt`, so the pre-push value is
    // already stale as a divergence baseline — re-read it, or the very next push
    // would diverge against this run's own changes. A re-read that fails records
    // no baseline at all (the next push fails open and re-establishes one)
    // rather than a value known to be wrong.
    const pushedUpdatedAt = await readRemoteUpdatedAt(
      client,
      target.sourceId,
      token,
      plan.entries.length > 0,
      rawDeck.updatedAt,
    )
    writtenFiles.push(...(await saveDeckWithSyncTimestamp(target, target.deck, pushedUpdatedAt)))
    emit({ kind: 'log', level: 'info', deck: name, message: 'Updated lastSynced.' })

    finish(results, emit, { name, status: 'synced', ...printingReport })
  }

  return { decks: results, writtenFiles }
}
