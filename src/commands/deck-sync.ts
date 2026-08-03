import { Command } from 'commander'
import type { Logger } from '../logger'
import {
  listSyncableDecks,
  runDeckSync,
  type DeckSyncEvent,
  type DeckSyncReport,
  type SyncableDeck,
} from '../deck-sync/engine'
import { linkDeckToArchidekt, parseArchidektDeckUrl, type DeckLinkResult } from '../deck-sync/link'
import { readCollectionSyncStateFile, type CollectionSyncState } from '../collection-sync/state'
import {
  SYNC_DIRECTIONS,
  unreadableConsequence,
  type SyncChangeFilter,
  type SyncDirection,
} from '../sync-common'
import { formatResolveListError, isResolveListError, resolveList } from '../resolve-list'
import {
  addSyncOptions,
  confirmUnreadableSync,
  createScopedIndenter,
  describeUnreadable,
  loggerFor,
  requireArchidektToken,
  type UnreadableSource,
  type UnreadableSubject,
} from './sync-helpers'
import { runCommandAction } from './card-target'
import {
  addDryRunOption,
  addOutputOption,
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

export type DeckSyncCommandOptions = {
  dryRun?: boolean
  yes?: boolean
  only?: SyncChangeFilter
  force?: boolean
} & Partial<ScriptingOptions>

/** `deck-sync link` options: a dry run plus the scripting flags. */
export type DeckLinkCommandOptions = {
  dryRun?: boolean
} & Partial<ScriptingOptions>

/** JSON payload for `deck-sync status`: what a sync can cover, and when it last ran. */
export type DeckSyncStatusOutput = {
  /** Every Archidekt-linked deck, in file order. */
  decks: SyncableDeck[]
  /** The account-level collection sync, or null when none has been recorded. */
  collection: CollectionSyncState | null
  /**
   * Why the collection's recorded state could not be read, when a state file
   * exists but is unusable. Null covers both "read fine" and "no file yet" —
   * `collection` already tells those apart, and only this field distinguishes a
   * genuinely never-synced account from a corrupt record of one.
   */
  collectionStateError: string | null
}

/** One NDJSON row of `deck-sync status`, tagged by which half it belongs to. */
export type DeckSyncStatusRow =
  | ({ kind: 'deck' } & SyncableDeck)
  | ({ kind: 'collection' } & CollectionSyncState)
  | { kind: 'collection-state-error'; reason: string }

/** What this command calls the things it syncs, in prompts and warnings. */
const DECKS: UnreadableSubject = { one: 'deck', many: 'decks' }

/** What accepting the unreadable lines costs — a sync re-serializes the file. */
const UNREADABLE_COST = 'removing the lines above'

/**
 * Render one sync event as a console line. Deck-scoped messages are indented
 * under the `Syncing "…"` line that opened the deck — but only when that line
 * actually printed (see {@link createScopedIndenter}); run-level ones (including
 * decks that could not be loaded at all) sit flush left. Results themselves are
 * not printed — they are summarized by the closing tally and the report.
 */
function renderSyncEvent(
  direction: SyncDirection,
  logger: Logger,
  indent: ReturnType<typeof createScopedIndenter>,
  event: DeckSyncEvent,
): void {
  switch (event.kind) {
    case 'deck-start':
      indent.start(event.deck)
      logger.info(`Syncing "${event.deck}" (${direction})...`)
      return
    case 'log': {
      const line = indent.line(event.deck, event.message)
      if (event.level === 'warn') logger.warn(line)
      else if (event.level === 'error') logger.error(line)
      else logger.info(line)
      return
    }
    case 'deck-result':
      // Results are summarized by the closing tally rather than printed per deck.
      return
    case 'unreadable-lines':
      logger.warn(describeUnreadable(event.decks, DECKS, unreadableConsequence('deck', direction)))
      return
    default: {
      // Every event kind must be rendered somewhere; a new one is a compile error.
      const unhandled: never = event
      throw new Error(`Unhandled deck-sync event: ${JSON.stringify(unhandled)}`)
    }
  }
}

/** `1 deck` / `3 decks`. */
function deckCount(count: number): string {
  return `${count} deck${count === 1 ? '' : 's'}`
}

/**
 * The run's closing tally, the counterpart of collection-sync's — a text-mode
 * run otherwise ends with nothing to say how many decks synced, and the report
 * that carries those counts is only emitted under `--output json`/`ndjson`.
 *
 * "with changes" is the distinction the per-deck lines make and the counts
 * otherwise lose: a deck that was already in sync is reported as synced too.
 * Returns undefined when the run covered no decks at all — the engine already
 * said so, and "Synced 0 decks." underneath it reads as a contradiction.
 */
export function summarizeDeckRun(report: DeckSyncReport, dryRun: boolean): string | undefined {
  if (report.decks.length === 0) return undefined

  const synced = report.decks.filter((deck) => deck.status === 'synced')
  const unchanged = synced.filter((deck) => deck.reason === 'no changes').length
  const skipped = report.decks.filter((deck) => deck.status === 'skipped').length

  const changed = synced.length - unchanged
  const parts = [
    `${dryRun ? '[dry-run] Would sync' : 'Synced'} ${deckCount(synced.length)} (${changed} with changes)`,
  ]
  if (skipped > 0) parts.push(`${skipped} skipped`)
  if (report.failedCount > 0) parts.push(`${report.failedCount} failed`)
  return `${parts.join(', ')}.`
}

/** Ask whether decks with unreadable lines may sync anyway; see {@link confirmUnreadableSync}. */
export function confirmUnreadableDecks(
  decks: readonly UnreadableSource[],
  yes: boolean,
  scripting: ScriptingOptions,
  logger: Logger,
): Promise<boolean> {
  return confirmUnreadableSync({
    sources: decks,
    subject: DECKS,
    cost: UNREADABLE_COST,
    yes,
    scripting,
    logger,
  })
}

/** The text lines `deck-sync link` prints for a completed (or previewed) link. */
export function describeLink(result: DeckLinkResult): string[] {
  const prefix = result.dryRun ? '[dry-run] Would link' : 'Linked'
  const lines = [`${prefix} "${result.name}" to ${result.sourceUrl} (deck ${result.sourceId}).`]
  // Keyed off the whole previous link, not just its URL: the metadata API can
  // leave a deck carrying a `sourceId` with no `sourceUrl`, and replacing that
  // id silently would be the one case the user most needs told about.
  const previous = result.previous
  if (
    previous &&
    (previous.sourceUrl !== result.sourceUrl || previous.sourceId !== result.sourceId)
  ) {
    lines.push(`It was linked to ${previous.sourceUrl ?? `deck ${previous.sourceId}`}.`)
  }
  return lines
}

async function runDeckLink(
  deckName: string,
  url: string,
  options: DeckLinkCommandOptions,
  scripting: ScriptingOptions,
): Promise<void> {
  const link = parseArchidektDeckUrl(url)
  if (typeof link === 'string') {
    emitError('usage_error', link, scripting)
    process.exitCode = ExitCode.UsageError
    return
  }

  const resolved = await resolveList(deckName, 'deck')
  if (isResolveListError(resolved)) {
    const message = formatResolveListError(resolved, 'none')
    emitError(resolved.kind === 'ambiguous' ? 'usage_error' : 'not_found', message, scripting)
    process.exitCode = resolved.kind === 'ambiguous' ? ExitCode.UsageError : ExitCode.NotFound
    return
  }

  const result = await linkDeckToArchidekt({
    filePath: resolved.filePath,
    slug: resolved.name,
    link,
    dryRun: options.dryRun === true,
  })

  if (scripting.output === 'text') {
    if (scripting.quiet) return
    for (const line of describeLink(result)) emitOutput(line, scripting)
    return
  }
  emitOutput(result, scripting)
}

/** The text rendering of `deck-sync status`. */
export function describeSyncStatus(status: DeckSyncStatusOutput): string[] {
  const lines: string[] = []
  if (status.decks.length === 0) {
    lines.push('No Archidekt-linked decks. Link one with "ritual deck-sync link <deck> <url>".')
  } else {
    lines.push(`${deckCount(status.decks.length)} linked to Archidekt:`)
    for (const deck of status.decks) {
      lines.push(`  ${deck.name} — ${deck.sourceUrl}`)
      lines.push(`    last synced: ${deck.lastSynced ?? 'never'}`)
    }
  }
  if (status.collection !== null) {
    lines.push(
      `Collection: last synced ${status.collection.lastSynced} (Archidekt user ${status.collection.username}).`,
    )
  } else if (status.collectionStateError !== null) {
    // Not "never synced": that would be a positive claim about an account whose
    // record is merely unreadable.
    lines.push(`Collection: sync state unreadable (${status.collectionStateError}).`)
  } else {
    lines.push('Collection: never synced.')
  }
  return lines
}

async function runDeckSyncStatus(scripting: ScriptingOptions): Promise<void> {
  // Read-only and offline: front matter plus the recorded collection sync state.
  const [decks, collectionState] = await Promise.all([
    listSyncableDecks(),
    readCollectionSyncStateFile(),
  ])
  const collection = collectionState.kind === 'state' ? collectionState.state : null
  const status: DeckSyncStatusOutput = {
    decks,
    collection,
    collectionStateError: collectionState.kind === 'unreadable' ? collectionState.reason : null,
  }

  if (scripting.output === 'text') {
    for (const line of describeSyncStatus(status)) emitOutput(line, scripting)
    return
  }
  if (scripting.output === 'ndjson') {
    // One row per thing, tagged: a stream of records is what NDJSON consumers
    // expect, and the two halves are genuinely different shapes.
    const rows: DeckSyncStatusRow[] = decks.map((deck) => ({ kind: 'deck', ...deck }))
    if (collection) rows.push({ kind: 'collection', ...collection })
    else if (status.collectionStateError !== null) {
      rows.push({ kind: 'collection-state-error', reason: status.collectionStateError })
    }
    emitOutput(rows, scripting)
    return
  }
  emitOutput(status, scripting)
}

/** One `deck-sync pull` / `deck-sync push` run, from flags to exit code. */
async function runSync(
  direction: SyncDirection,
  decks: string[],
  options: DeckSyncCommandOptions,
): Promise<void> {
  const scripting = normalizeScriptingOptions(options)
  // JSON/NDJSON output owns stdout, so per-deck progress logging is silenced
  // there; every outcome still lands in the emitted report.
  const logger = loggerFor(scripting)
  const indent = createScopedIndenter(scripting)

  const token = await requireArchidektToken(scripting)
  if (!token) return

  const dryRun = options.dryRun ?? false
  const { report } = await runDeckSync({
    direction,
    token,
    deckNames: decks,
    dryRun,
    only: options.only,
    force: options.force === true,
    onEvent: (event) => renderSyncEvent(direction, logger, indent, event),
    confirmUnreadable: (unreadable) =>
      confirmUnreadableDecks(unreadable, options.yes === true, scripting, logger),
  })

  if (scripting.output !== 'text') {
    emitOutput(report, scripting)
  } else {
    const summary = summarizeDeckRun(report, dryRun)
    if (summary) logger.info(summary)
  }

  if (report.failedCount > 0) {
    logger.error(`${report.failedCount} of ${report.decks.length} decks failed`)
    process.exitCode = ExitCode.RuntimeError
  }
}

/** What each direction's subcommand says it does. */
const DIRECTION_DESCRIPTIONS: Record<SyncDirection, string> = {
  pull: 'Apply Archidekt deck changes to the local deck files',
  push: 'Send local deck changes to the decks you own on Archidekt',
}

export function registerDeckSyncCommand(program: Command): void {
  // Every direction is a subcommand rather than a `<direction>` positional, so
  // `link` and `status` can sit beside them: commander resolves a flag declared
  // on both a command and its parent to the *parent*, so a command carrying
  // `--dry-run`/`--output` cannot also host subcommands that take their own.
  const deckSync = program.command('deck-sync').description('Sync deck changes with Archidekt')

  for (const direction of SYNC_DIRECTIONS) {
    const command = addScriptingOptions(
      addSyncOptions(
        deckSync.command(direction).description(DIRECTION_DESCRIPTIONS[direction]),
        'decks',
      ).argument('[decks...]', 'Deck names to sync (defaults to all Archidekt decks)'),
    )
    // Only a push writes to Archidekt, so only a push has remote changes to
    // overwrite; a pull would have nothing to force.
    if (direction === 'push') {
      command.option(
        '--force',
        'Overwrite a remote deck that changed since its last sync (see deck-sync status)',
        false,
      )
    }
    command.action(async (decks: string[], options: DeckSyncCommandOptions) => {
      await runSync(direction, decks, options)
    })
  }

  // `link` and `status` are subcommands of `deck-sync` rather than commands of
  // their own: they are about the same linkage `push`/`pull` operate on.
  addScriptingOptions(
    addDryRunOption(
      deckSync
        .command('link')
        .description('Link a local deck to a deck that already exists on Archidekt')
        .argument('<deck>', 'Deck name to link')
        .argument('<url>', 'Archidekt deck URL, e.g. https://archidekt.com/decks/123456'),
      'Report what would be linked without writing the deck file',
    ),
  ).action(async (deckName: string, url: string, options: DeckLinkCommandOptions) => {
    const scripting = normalizeScriptingOptions(options)
    await runCommandAction(scripting, () => runDeckLink(deckName, url, options, scripting))
  })

  // `--output` only: the listing *is* the payload, so there is no chatter for
  // `--quiet` to suppress. Read-only and offline — it never triggers the card-ID
  // backfill either, because neither `status` nor `deck-sync status` is in
  // `COMMANDS_WITH_ID_BACKFILL` (the hook matches both spellings).
  addOutputOption(
    deckSync
      .command('status')
      .description('Show which decks are linked to Archidekt, and when each last synced'),
  ).action(async (options: Partial<ScriptingOptions>) => {
    const scripting = normalizeScriptingOptions(options)
    await runCommandAction(scripting, () => runDeckSyncStatus(scripting))
  })
}
