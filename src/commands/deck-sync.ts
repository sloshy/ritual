import { Command } from 'commander'
import { ArchidektAuth } from '../auth/ArchidektAuth'
import { FileTokenStore } from '../auth/FileTokenStore'
import { getLogger, STDERR_LOGGER, type Logger } from '../logger'
import {
  runDeckSync,
  SYNC_DIRECTIONS,
  type DeckSyncEvent,
  type SyncDirection,
  type UnreadableDeck,
} from '../deck-sync/engine'
import { isNoInput } from '../no-input'
import { ask } from './prompts-helpers'
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

/** Commander argParser for the `<direction>` positional: only push/pull are valid. */
export function parseSyncDirection(value: string): SyncDirection {
  return parseEnumFlag(value, SYNC_DIRECTIONS, 'direction')
}

export type DeckSyncCommandOptions = { dryRun?: boolean; yes?: boolean } & Partial<ScriptingOptions>

/** Warnings and errors still print, progress info does not. */
function quietLogger(base: Logger): Logger {
  return {
    info() {},
    progress() {},
    warn: base.warn.bind(base),
    error: base.error.bind(base),
  }
}

/**
 * Pick the logger for a run. Under `--output json`/`ndjson` the report owns
 * stdout, so progress is dropped but warnings and errors go to stderr — a run
 * refused for unreadable lines has to be able to say why, and stderr is where
 * that belongs (see `STDERR_LOGGER`). `--quiet` gets the same treatment on the
 * normal logger.
 */
function loggerFor(scripting: ScriptingOptions): Logger {
  if (scripting.output !== 'text') return quietLogger(STDERR_LOGGER)
  return scripting.quiet ? quietLogger(getLogger()) : getLogger()
}

/**
 * The full picture of what syncing these decks would delete: every deck, every
 * line the parser could not read. Shown before the confirmation so the choice is
 * made against the actual lines, not a count.
 */
function describeUnreadable(decks: UnreadableDeck[]): string {
  const lines = decks.flatMap((deck) => [
    `  ${deck.file} ("${deck.name}"):`,
    ...deck.warnings.map((warning) => `    ${warning}`),
  ])
  const count = decks.length
  const subject = count === 1 ? '1 deck contains' : `${count} decks contain`
  return [
    `${subject} lines Ritual cannot read.`,
    'Syncing rewrites the deck file, so these lines would be removed:',
    ...lines,
  ].join('\n')
}

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
      logger.warn(describeUnreadable(event.decks))
      return
    default: {
      // Every event kind must be rendered somewhere; a new one is a compile error.
      const unhandled: never = event
      throw new Error(`Unhandled deck-sync event: ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * Ask whether decks with unreadable lines may sync anyway (the lines the run
 * just listed would be removed). `--yes` answers it up front. Without a terminal
 * — `--no-input`, a pipe, or json/ndjson output, which owns stdout — there is
 * nobody to ask, so the answer is no and those decks fail.
 */
export async function confirmUnreadableDecks(
  decks: UnreadableDeck[],
  // Taken as a bare flag rather than the whole options object: `ScriptingOptions`
  // is assignable to `DeckSyncCommandOptions`, so an options/scripting mix-up at
  // the call site would type-check and silently disable `--yes`.
  yes: boolean,
  scripting: ScriptingOptions,
  logger: Logger,
): Promise<boolean> {
  if (yes) return true

  const interactive = scripting.output === 'text' && !isNoInput() && process.stdin.isTTY === true
  if (!interactive) {
    logger.error(
      'Confirmation required: pass --yes to sync these decks non-interactively (their unreadable lines will be removed), or fix the lines first.',
    )
    return false
  }

  const count = decks.length
  return (
    (await ask<boolean>({
      type: 'confirm',
      message: `Sync ${count} deck${count === 1 ? '' : 's'} anyway, removing the lines above?`,
      initial: false,
    })) === true
  )
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
        .argument('[decks...]', 'Deck names to sync (defaults to all Archidekt decks)')
        .option(
          '-y, --yes',
          'Sync decks with unreadable lines without asking (those lines are removed)',
          false,
        ),
      'Report what would sync without writing files or pushing changes',
    ),
  ).action(async (direction: SyncDirection, decks: string[], options: DeckSyncCommandOptions) => {
    const scripting = normalizeScriptingOptions(options)
    // JSON/NDJSON output owns stdout, so per-deck progress logging is silenced
    // there; every outcome still lands in the emitted report.
    const logger = loggerFor(scripting)

    const auth = new ArchidektAuth(new FileTokenStore())

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

    const { report } = await runDeckSync({
      direction,
      token,
      deckNames: decks,
      dryRun: options.dryRun ?? false,
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
