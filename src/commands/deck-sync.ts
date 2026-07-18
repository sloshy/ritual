import path from 'node:path'
import { Command } from 'commander'
import { ArchidektClient } from '../clients/ArchidektClient'
import { FileTokenStore } from '../auth/FileTokenStore'
import { ArchidektAuth } from '../auth/ArchidektAuth'
import { importFromTextFile, listDeckFiles } from '../importers/text-file'
import { parseDeckFrontMatter, serializeDeckToMarkdown, type DeckFrontMatter } from '../deck-file'
import { getDeckFormatLabel } from '../deck-format'
import { formatResolveListError, isResolveListError, resolveList } from '../resolve-list'
import { appendChangelog } from '../changelog-writer'
import { getLogger, type Logger } from '../logger'
import type { Card, DeckData, DeckSection } from '../types'
import type {
  ArchidektRawDeckResponse,
  ArchidektRawCardEntry,
  ModifyCardEntry,
  ModifyCardModifications,
} from '../importers/archidekt-types'
import {
  addDryRunOption,
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  parseEnumFlag,
  type ScriptingOptions,
} from './scripting'
import {
  diffByCardName,
  diffToChangeEvents,
  buildCardIdResolver,
  isDiffEmpty,
  applyDownloadDiff,
  syncDeckFormat,
  type NameDiff,
} from './deck-sync-helpers'
import { assignMissingDeckCardIds } from '../card-id'
import { writeFileWithHash } from '../content-hash'
import { getDecksDir } from '../ritual-config'

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

// ── Upload sync ───────────────────────────────────────────────────────

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

// ── Deck resolution helpers ───────────────────────────────────────────

function isArchidektDeck(frontMatter: Record<string, unknown>): boolean {
  const sourceUrl = frontMatter.sourceUrl as string | undefined
  return typeof sourceUrl === 'string' && sourceUrl.includes('archidekt.com')
}

function extractSourceId(frontMatter: Record<string, unknown>): string | undefined {
  return typeof frontMatter.sourceId === 'string' ? frontMatter.sourceId : undefined
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
}

async function resolveTargetDecks(
  deckNames: string[],
  decksDir: string,
  logger: Logger,
): Promise<ResolvedTargets> {
  const targets: DeckTarget[] = []
  const problems: DeckSyncDeckResult[] = []

  if (deckNames.length === 0) {
    // All Archidekt decks
    const files = await listDeckFiles(decksDir)
    for (const file of files) {
      const filePath = path.join(decksDir, file)
      const frontMatter = await parseDeckFrontMatter(filePath)
      if (!isArchidektDeck(frontMatter)) continue

      const sourceId = extractSourceId(frontMatter)
      if (!sourceId) {
        logger.warn(`Skipping ${file}: has Archidekt sourceUrl but no sourceId`)
        problems.push({
          name: typeof frontMatter.name === 'string' ? frontMatter.name : file,
          status: 'skipped',
          reason: 'has Archidekt sourceUrl but no sourceId',
        })
        continue
      }

      const deck = await importFromTextFile(filePath)
      targets.push({ filePath, frontMatter, deck, sourceId })
    }
  } else {
    for (const name of deckNames) {
      const resolved = await resolveList(name, 'deck')
      if (isResolveListError(resolved)) {
        const message = formatResolveListError(resolved)
        logger.error(message)
        problems.push({ name, status: 'failed', reason: message })
        continue
      }
      const filePath = resolved.filePath

      const frontMatter = await parseDeckFrontMatter(filePath)
      if (!isArchidektDeck(frontMatter)) {
        logger.error(`Deck "${name}" is not sourced from Archidekt`)
        problems.push({ name, status: 'failed', reason: 'not sourced from Archidekt' })
        continue
      }

      const sourceId = extractSourceId(frontMatter)
      if (!sourceId) {
        logger.error(`Deck "${name}" has Archidekt sourceUrl but no sourceId`)
        problems.push({ name, status: 'failed', reason: 'has Archidekt sourceUrl but no sourceId' })
        continue
      }

      const deck = await importFromTextFile(filePath)
      targets.push({ filePath, frontMatter, deck, sourceId })
    }
  }

  return { targets, problems }
}

// ── Persistence helpers ───────────────────────────────────────────────

async function saveDeckWithSyncTimestamp(target: DeckTarget, deck: DeckData): Promise<void> {
  const updatedFrontMatter = { ...target.frontMatter, lastSynced: new Date().toISOString() }
  const markdown = serializeDeckToMarkdown(deck, updatedFrontMatter)
  await writeFileWithHash(target.filePath, markdown)
}

// ── Command registration ──────────────────────────────────────────────

const SYNC_DIRECTIONS = ['push', 'pull'] as const

/** The sync direction: `push` (local → Archidekt) or `pull` (Archidekt → local). */
export type SyncDirection = (typeof SYNC_DIRECTIONS)[number]

/** Commander argParser for the `<direction>` positional: only push/pull are valid. */
export function parseSyncDirection(value: string): SyncDirection {
  return parseEnumFlag(value, SYNC_DIRECTIONS, 'direction')
}

type DeckSyncOptions = { dryRun?: boolean } & Partial<ScriptingOptions>

/** What happened to one deck during a sync run. */
export type DeckSyncStatus = 'synced' | 'failed' | 'skipped'
export type DeckSyncDeckResult = { name: string; status: DeckSyncStatus; reason?: string }

/** The `--output json` payload: per-deck results plus the failure count. */
export type DeckSyncReport = {
  direction: SyncDirection
  decks: DeckSyncDeckResult[]
  failedCount: number
}

/** A logger that swallows everything — used when `--output json`/`ndjson` owns stdout. */
const SILENT_LOGGER: Logger = {
  info() {},
  warn() {},
  error() {},
  progress() {},
}

/** The text-mode `--quiet` view: warnings and errors still print, progress info does not. */
function quietLogger(base: Logger): Logger {
  return {
    info() {},
    progress() {},
    warn: base.warn.bind(base),
    error: base.error.bind(base),
  }
}

/** Pick the logger for a run: silent under JSON output, warn/error-only under `--quiet`. */
function loggerFor(scripting: ScriptingOptions): Logger {
  if (scripting.output !== 'text') return SILENT_LOGGER
  return scripting.quiet ? quietLogger(getLogger()) : getLogger()
}

export function registerDeckSyncCommand(program: Command): void {
  addScriptingOptions(
    addDryRunOption(
      program
        .command('deck-sync')
        .description('Sync deck changes with Archidekt')
        .argument(
          '<direction>',
          "Sync direction: 'push' (local → Archidekt) or 'pull' (Archidekt → local)",
          parseSyncDirection,
        )
        .argument('[decks...]', 'Deck names to sync (defaults to all Archidekt decks)'),
      'Report what would sync without writing files or pushing changes',
    ),
  ).action(async (direction: SyncDirection, decks: string[], options: DeckSyncOptions) => {
    const scripting = normalizeScriptingOptions(options)
    const dryRun = options.dryRun ?? false
    // JSON/NDJSON output owns stdout, so per-deck progress logging is silenced
    // there; every outcome still lands in the emitted report.
    const logger = loggerFor(scripting)

    const tokenStore = new FileTokenStore()
    const auth = new ArchidektAuth(tokenStore)
    const client = new ArchidektClient()

    // Check authentication
    const token = await auth.getToken()
    if (!token) {
      emitError(
        'runtime_error',
        'Not signed into Archidekt. Run "ritual login archidekt" first.',
        scripting,
      )
      process.exitCode = ExitCode.RuntimeError
      return
    }

    const decksDir = getDecksDir()
    const { targets, problems } = await resolveTargetDecks(decks, decksDir, logger)

    if (targets.length === 0 && problems.length === 0) {
      logger.info('No Archidekt decks found to sync.')
    }

    const outcome: SyncOutcome =
      targets.length === 0
        ? { decks: [] }
        : direction === 'pull'
          ? await downloadChanges(targets, client, token, logger, dryRun)
          : await uploadChanges(targets, client, token, logger, dryRun)

    const deckResults = [...problems, ...outcome.decks]
    const failedCount = deckResults.filter((deck) => deck.status === 'failed').length
    const report: DeckSyncReport = { direction, decks: deckResults, failedCount }
    if (scripting.output !== 'text') {
      emitOutput(report, scripting)
    }

    if (failedCount > 0) {
      logger.error(`${failedCount} of ${deckResults.length} decks failed`)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}

// ── Sync outcome ──────────────────────────────────────────────────────

type SyncOutcome = { decks: DeckSyncDeckResult[] }

// ── Download flow ─────────────────────────────────────────────────────

async function downloadChanges(
  targets: DeckTarget[],
  client: ArchidektClient,
  token: string,
  logger: Logger,
  dryRun: boolean,
): Promise<SyncOutcome> {
  const results: DeckSyncDeckResult[] = []
  for (const target of targets) {
    logger.info(`Syncing "${target.deck.name}" (pull)...`)

    let remoteDeck: DeckData
    try {
      remoteDeck = await client.fetchDeck(target.sourceId, token)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to fetch Archidekt deck ${target.sourceId}: ${message}`)
      results.push({
        name: target.deck.name,
        status: 'failed',
        reason: `Failed to fetch Archidekt deck ${target.sourceId}: ${message}`,
      })
      continue
    }

    const diff = diffByCardName(target.deck.sections, remoteDeck.sections)
    const formatSync = syncDeckFormat(target.deck, target.frontMatter.format, remoteDeck)

    if (isDiffEmpty(diff) && !formatSync.changed) {
      logger.info(`  No changes detected.`)
      results.push({ name: target.deck.name, status: 'synced', reason: 'no changes' })
      continue
    }

    const changeSummary = `+${diff.added.length} added, -${diff.removed.length} removed, ~${diff.quantityChanged.length} quantity changed`
    if (!isDiffEmpty(diff)) {
      logger.info(`  Changes: ${changeSummary}`)
    }
    if (formatSync.changed && formatSync.format) {
      const was = formatSync.localFormat ? getDeckFormatLabel(formatSync.localFormat) : 'not set'
      logger.info(`  Format: ${was} → ${getDeckFormatLabel(formatSync.format)}`)
    }

    if (dryRun) {
      logger.info(`  [dry-run] Not saved.`)
      results.push({
        name: target.deck.name,
        status: 'synced',
        reason: `dry-run: ${changeSummary}`,
      })
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
      await appendChangelog(target.filePath, target.deck.name, changes)
    }

    // Write updated deck with lastSynced
    await saveDeckWithSyncTimestamp(target, updatedDeck)
    logger.info(`  Saved.`)
    results.push({ name: target.deck.name, status: 'synced' })
  }
  return { decks: results }
}

// ── Upload flow ───────────────────────────────────────────────────────

async function uploadChanges(
  targets: DeckTarget[],
  client: ArchidektClient,
  token: string,
  logger: Logger,
  dryRun: boolean,
): Promise<SyncOutcome> {
  const results: DeckSyncDeckResult[] = []

  // Fetch owned deck IDs for ownership check
  let ownedDeckIds: Set<string>
  try {
    const ownDecks = await client.fetchOwnDecks(token)
    ownedDeckIds = new Set(ownDecks.map((d) => d.id.toString()))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to fetch owned decks: ${message}`)
    // No deck could be synced without the ownership list — all failed.
    return {
      decks: targets.map(
        (target): DeckSyncDeckResult => ({
          name: target.deck.name,
          status: 'failed',
          reason: `Failed to fetch owned decks: ${message}`,
        }),
      ),
    }
  }

  for (const target of targets) {
    logger.info(`Syncing "${target.deck.name}" (push)...`)

    if (!ownedDeckIds.has(target.sourceId)) {
      logger.warn(`  Skipping: you do not own Archidekt deck ${target.sourceId}`)
      results.push({
        name: target.deck.name,
        status: 'skipped',
        reason: `you do not own Archidekt deck ${target.sourceId}`,
      })
      continue
    }

    let rawDeck: ArchidektRawDeckResponse
    try {
      rawDeck = await client.fetchDeckRaw(target.sourceId, token)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`  Failed to fetch Archidekt deck ${target.sourceId}: ${message}`)
      results.push({
        name: target.deck.name,
        status: 'failed',
        reason: `Failed to fetch Archidekt deck ${target.sourceId}: ${message}`,
      })
      continue
    }

    // Parse raw response into DeckData for diffing (reuse existing parser).
    // Uploads diff by name only: the modifyCards API path cannot yet target a
    // specific remote board/category, so board placement must be ignored here to
    // avoid spuriously moving cards on Archidekt.
    const remoteDeck = await client.fetchDeck(target.sourceId, token)
    const diff = diffByCardName(remoteDeck.sections, target.deck.sections, { byBoard: false })

    if (isDiffEmpty(diff)) {
      logger.info(`  No changes to upload.`)
      results.push({ name: target.deck.name, status: 'synced', reason: 'no changes' })
      continue
    }

    logger.info(
      `  Changes: +${diff.added.length} to add, -${diff.removed.length} to remove, ~${diff.quantityChanged.length} quantity changes`,
    )

    const rawIndex = buildRawCardIndex(rawDeck)
    const plan = await buildUploadPlan(diff, target.deck.sections, rawIndex, client, token)

    // Plan errors are partial failures: some cards could not be turned into
    // upload entries, so the deck did not fully sync even if the rest pushes.
    const deckFailed = plan.errors.length > 0
    if (plan.errors.length > 0) {
      for (const err of plan.errors) {
        logger.warn(`  ${err}`)
      }
    }

    if (dryRun) {
      logger.info(`  [dry-run] Would push ${plan.entries.length} card changes to Archidekt.`)
      results.push(
        deckFailed
          ? { name: target.deck.name, status: 'failed', reason: plan.errors.join('; ') }
          : {
              name: target.deck.name,
              status: 'synced',
              reason: `dry-run: would push ${plan.entries.length} card changes`,
            },
      )
      continue
    }

    if (plan.entries.length > 0) {
      try {
        await client.modifyCards(target.sourceId, plan.entries, token)
        logger.info(`  Pushed ${plan.entries.length} card changes to Archidekt.`)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`  Failed to push changes: ${message}`)
        results.push({
          name: target.deck.name,
          status: 'failed',
          reason: `Failed to push changes: ${message}`,
        })
        continue
      }
    }

    results.push(
      deckFailed
        ? { name: target.deck.name, status: 'failed', reason: plan.errors.join('; ') }
        : { name: target.deck.name, status: 'synced' },
    )

    // Update lastSynced in front matter
    await saveDeckWithSyncTimestamp(target, target.deck)
    logger.info(`  Updated lastSynced.`)
  }
  return { decks: results }
}
