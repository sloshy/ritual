import { Command } from 'commander'
import type { Logger } from '../logger'
import { runDeckSync, type DeckSyncEvent } from '../deck-sync/engine'
import { unreadableConsequence, type SyncChangeFilter, type SyncDirection } from '../sync-common'
import {
  addSyncOptions,
  confirmUnreadableSync,
  describeUnreadable,
  loggerFor,
  requireArchidektToken,
  type UnreadableSource,
  type UnreadableSubject,
} from './sync-helpers'
import {
  addScriptingOptions,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

export type DeckSyncCommandOptions = {
  dryRun?: boolean
  yes?: boolean
  only?: SyncChangeFilter
} & Partial<ScriptingOptions>

/** What this command calls the things it syncs, in prompts and warnings. */
const DECKS: UnreadableSubject = { one: 'deck', many: 'decks' }

/** What accepting the unreadable lines costs — a sync re-serializes the file. */
const UNREADABLE_COST = 'removing the lines above'

/**
 * Render one sync event as a console line. Deck-scoped messages are indented
 * under the `Syncing "…"` line that opened the deck; run-level ones (including
 * decks that could not be loaded at all) sit flush left. Results themselves are
 * not printed — they are summarized by the report.
 */
function renderSyncEvent(direction: SyncDirection, logger: Logger, event: DeckSyncEvent): void {
  switch (event.kind) {
    case 'deck-start':
      logger.info(`Syncing "${event.deck}" (${direction})...`)
      return
    case 'log': {
      const line = event.deck === null ? event.message : `  ${event.message}`
      if (event.level === 'warn') logger.warn(line)
      else if (event.level === 'error') logger.error(line)
      else logger.info(line)
      return
    }
    case 'deck-result':
      // Results are summarized by the report rather than printed per deck.
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

export function registerDeckSyncCommand(program: Command): void {
  addScriptingOptions(
    addSyncOptions(
      program.command('deck-sync').description('Sync deck changes with Archidekt'),
      'decks',
    ).argument('[decks...]', 'Deck names to sync (defaults to all Archidekt decks)'),
  ).action(async (direction: SyncDirection, decks: string[], options: DeckSyncCommandOptions) => {
    const scripting = normalizeScriptingOptions(options)
    // JSON/NDJSON output owns stdout, so per-deck progress logging is silenced
    // there; every outcome still lands in the emitted report.
    const logger = loggerFor(scripting)

    const token = await requireArchidektToken(scripting)
    if (!token) return

    const { report } = await runDeckSync({
      direction,
      token,
      deckNames: decks,
      dryRun: options.dryRun ?? false,
      only: options.only,
      onEvent: (event) => renderSyncEvent(direction, logger, event),
      confirmUnreadable: (unreadable) =>
        confirmUnreadableDecks(unreadable, options.yes === true, scripting, logger),
    })

    if (scripting.output !== 'text') {
      emitOutput(report, scripting)
    }

    if (report.failedCount > 0) {
      logger.error(`${report.failedCount} of ${report.decks.length} decks failed`)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
