import { Command, InvalidArgumentError } from 'commander'
import { ensureCardCacheForUpload } from '../cache/freshness'
import { ARCHIDEKT_IMPORT_URL, CSV_UPLOAD_THRESHOLD } from '../collection-sync/csv'
import {
  runCollectionSync,
  type CollectionSyncEvent,
  type CollectionSyncReport,
} from '../collection-sync/engine'
import type { Logger } from '../logger'
import { addRefreshOption, type RefreshMode } from '../refresh'
import { getCollectionSyncPullTarget } from '../ritual-config'
import { unreadableConsequence, type SyncChangeFilter, type SyncDirection } from '../sync-common'
import { decideCsvUpload } from './decide-csv'
import { resolveAmbiguousRemovals } from './resolve-ambiguity'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'
import {
  addSyncOptions,
  canPromptDuringSync,
  confirmUnreadableSync,
  describeUnreadable,
  loggerFor,
  requireArchidektSession,
  type UnreadableSubject,
} from './sync-helpers'

/** Commander argParser for `--into`: the name of the list a pull adds cards to. */
export function parsePullTarget(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new InvalidArgumentError('--into requires a collection list name.')
  }
  return trimmed
}

/**
 * Commander argParser for `--removal-priority`: repeatable, and the order the
 * names are given in *is* the priority, so each value is appended.
 */
export function parseRemovalPriority(value: string, previous: string[]): string[] {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new InvalidArgumentError('--removal-priority requires a collection list name.')
  }
  return [...previous, trimmed]
}

/** Commander argParser for `--csv-file`: where a push writes its additions. */
export function parseCsvFile(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new InvalidArgumentError('--csv-file requires a file path.')
  }
  return trimmed
}

export type CollectionSyncCommandOptions = {
  dryRun?: boolean
  yes?: boolean
  only?: SyncChangeFilter
  into?: string
  removalPriority?: string[]
  csv?: boolean
  csvFile?: string
  refresh?: RefreshMode
} & Partial<ScriptingOptions>

/** What this command calls the things it syncs, in prompts and warnings. */
const LISTS: UnreadableSubject = { one: 'collection list', many: 'collection lists' }

/**
 * The pull target: `--into`, else the `collectionSync.pullTarget` config key,
 * else its built-in default. The list is created on first use, so it does not
 * have to exist yet.
 */
function resolvePullTarget(into: string | undefined): string {
  return into ?? getCollectionSyncPullTarget()
}

function unreadableCost(direction: SyncDirection): string {
  return direction === 'pull'
    ? 'removing the lines above'
    : 'removing those cards from your Archidekt collection'
}

/**
 * Render one sync event as a console line. List-scoped messages are indented
 * under the `Syncing "…"` line that opened the list; run-level ones (the remote
 * fetch, ambiguous removals, records for cards that live in no list any more)
 * sit flush left. Results themselves are not printed — they are summarized by
 * the report.
 */
function renderSyncEvent(
  direction: SyncDirection,
  logger: Logger,
  event: CollectionSyncEvent,
): void {
  switch (event.kind) {
    case 'list-start':
      logger.info(`Syncing "${event.list}" (${direction})...`)
      return
    case 'log': {
      const line = event.list === null ? event.message : `  ${event.message}`
      if (event.level === 'warn') logger.warn(line)
      else if (event.level === 'error') logger.error(line)
      else logger.info(line)
      return
    }
    case 'list-result':
      // Results are summarized by the report rather than printed per list.
      return
    case 'unreadable-lines':
      logger.warn(
        describeUnreadable(event.lists, LISTS, unreadableConsequence('collection', direction)),
      )
      return
    default: {
      // Every event kind must be rendered somewhere; a new one is a compile error.
      const unhandled: never = event
      throw new Error(`Unhandled collection-sync event: ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * The run's closing tally — copies moved, not lists touched, since one card can
 * span several lists. A pull names the list it added to, which is the one thing
 * about a pull the per-list lines do not make obvious up front. A run that
 * failed at the run level (an ambiguity nothing could place, an unusable removal
 * priority) says so instead of announcing a sync: it is the last line on the
 * terminal, and "Synced: +0 added, -0 removed" directly under "Nothing was
 * written." reads as a contradiction.
 */
function summarize(report: CollectionSyncReport): string {
  const { added, removed, pending } = report.totals
  // Copies written to a CSV file are not on Archidekt yet, so they are counted
  // apart from the ones that were pushed — see `csvNote` for where they went.
  const waiting = pending > 0 ? `, ${pending} awaiting upload` : ''
  const change = `+${added} added, -${removed} removed${waiting}`
  const where = report.direction === 'pull' ? ` (additions into "${report.into}")` : ''
  if (report.errors.length > 0) return `Not synced: ${change}${where}.`
  return report.dryRun ? `[dry-run] Would sync: ${change}${where}.` : `Synced: ${change}${where}.`
}

/**
 * The extra closing line a run that wrote its additions to a CSV file needs: the
 * cards are in a file rather than on Archidekt, and only a manual import will
 * change that. Every other CSV outcome is already covered by the run's log —
 * an upload said what it imported, a failure said why.
 */
function csvNote(report: CollectionSyncReport): string | undefined {
  const csv = report.csv
  if (!csv) return undefined
  const cards = `${csv.cards} card${csv.cards === 1 ? '' : 's'}`
  if (csv.status === 'exported') {
    return `${cards} were not pushed: upload ${csv.path} at ${ARCHIDEKT_IMPORT_URL} to add them.`
  }
  if (csv.status === 'planned' && csv.destination === 'export') {
    return `[dry-run] ${cards} would await a manual upload of ${csv.path} at ${ARCHIDEKT_IMPORT_URL}.`
  }
  return undefined
}

export function registerCollectionSyncCommand(program: Command): void {
  addScriptingOptions(
    addRefreshOption(
      addSyncOptions(
        program.command('collection-sync').description('Sync collection changes with Archidekt'),
        'collection lists',
      )
        .argument(
          '[lists...]',
          'Collection lists to sync (defaults to every collection list); the remote side is always the whole Archidekt collection',
        )
        .option(
          '--into <list>',
          'Collection list a pull adds new cards to, created if needed (default: the collectionSync.pullTarget config key)',
          parsePullTarget,
        )
        .option(
          '--removal-priority <list>',
          'Collection list an ambiguous removal may take copies from, in the order given (repeatable)',
          parseRemovalPriority,
          [] as string[],
        )
        .option(
          '--csv',
          `Upload a push's new cards as one CSV import instead of adding them one at a time (automatic above ${CSV_UPLOAD_THRESHOLD})`,
          false,
        )
        .option(
          '--csv-file <path>',
          "Write a push's new cards to this CSV file for a manual upload instead of pushing them",
          parseCsvFile,
        ),
    ),
  ).action(
    async (direction: SyncDirection, lists: string[], options: CollectionSyncCommandOptions) => {
      const scripting = normalizeScriptingOptions(options)
      // JSON/NDJSON output owns stdout, so per-list progress logging is silenced
      // there; every outcome still lands in the emitted report.
      const logger = loggerFor(scripting)

      // One says "send the additions to Archidekt", the other "do not send them
      // at all" — there is no reading of the two together, so it is a usage
      // error rather than a precedence rule.
      if (options.csv === true && options.csvFile !== undefined) {
        emitError(
          'usage_error',
          '--csv and --csv-file cannot be combined: --csv uploads the new cards, --csv-file writes them to a file instead of pushing them.',
          scripting,
        )
        process.exitCode = ExitCode.UsageError
        return
      }

      const session = await requireArchidektSession(scripting)
      if (!session) return

      if (direction === 'push' && options.into !== undefined) {
        logger.warn('Ignoring --into: it only applies to a pull.')
      }

      const removalPriority = options.removalPriority ?? []
      if (direction === 'push' && removalPriority.length > 0) {
        logger.warn('Ignoring --removal-priority: it only applies to a pull.')
      }

      if (direction === 'pull') {
        if (options.csv === true) logger.warn('Ignoring --csv: it only applies to a push.')
        if (options.csvFile !== undefined) {
          logger.warn('Ignoring --csv-file: it only applies to a push.')
        }
      }

      // Resolving removals one by one needs a terminal that owns stdout, and a
      // run that will actually write something — the shared sync gate, plus dry
      // runs, which never resolve anything. (The engine owns that dry-run
      // precedence too: belt and braces, so a preview cannot reach a prompt by
      // some route this command has not thought of.)
      const canPrompt = canPromptDuringSync(scripting) && options.dryRun !== true

      const { report } = await runCollectionSync({
        direction,
        token: session.token,
        userId: session.account.id,
        lists,
        only: options.only,
        into: resolvePullTarget(options.into),
        removalPriority,
        // Never consulted when a priority was given; the engine owns that
        // precedence so every surface applies it the same way.
        resolveAmbiguous: (ambiguous) =>
          resolveAmbiguousRemovals({ ambiguous, interactive: canPrompt, logger }),
        csv: options.csv === true,
        csvFile: options.csvFile,
        // Only consulted when neither flag was given and the additions pass the
        // threshold; like the ambiguity resolver, it answers for a
        // non-interactive run too — by refusing with the reason.
        decideCsv: (question) => decideCsvUpload({ question, interactive: canPrompt }),
        // Every uploaded row is keyed by a Scryfall id from the local cache, so a
        // run taking the CSV path needs that cache fresh — refreshed, prompted
        // for, or refused, according to `--refresh`. The refresh line goes through
        // the run's log so it reads in order with the rest of the run.
        ensureCsvCache: ({ log }) =>
          ensureCardCacheForUpload(options.refresh ?? 'ask', { log: (message) => log(message) }),
        dryRun: options.dryRun ?? false,
        onEvent: (event) => renderSyncEvent(direction, logger, event),
        confirmUnreadable: (unreadable) =>
          confirmUnreadableSync({
            sources: unreadable,
            subject: LISTS,
            cost: unreadableCost(direction),
            yes: options.yes === true,
            scripting,
            logger,
          }),
      })

      if (scripting.output !== 'text') {
        emitOutput(report, scripting)
      } else {
        logger.info(summarize(report))
        const note = csvNote(report)
        if (note) logger.info(note)
      }

      if (report.failedCount > 0) {
        logger.error(`${report.failedCount} of ${report.lists.length} collection lists failed`)
      }
      // Run-level errors (a failed collection fetch, records that could not be
      // deleted) belong to no list, so they are counted separately — but they
      // fail the run just the same.
      if (report.failedCount > 0 || report.errors.length > 0) {
        process.exitCode = ExitCode.RuntimeError
      }
    },
  )
}
