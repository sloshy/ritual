import { Command, InvalidArgumentError } from 'commander'
import { ensureCardCacheForUpload } from '../cache/freshness'
import { ARCHIDEKT_IMPORT_URL, CSV_UPLOAD_THRESHOLD } from '../collection-sync/csv'
import {
  runCollectionSync,
  type CollectionSyncEvent,
  type CollectionSyncReport,
} from '../collection-sync/engine'
import type { Logger } from '../util/logger'
import { addRefreshOption, addScriptingOptions } from '../cli/options'
import { cliRefreshPolicy } from '../cli/refresh-policy'
import type { RefreshMode } from '../cache/refresh'
import { getCollectionSyncPullTarget } from '../config/ritual-config'
import { unreadableConsequence, type SyncChangeFilter, type SyncDirection } from '../sync/common'
import { decideCsvUpload } from './decide-csv'
import { resolveAmbiguousRemovals } from './resolve-ambiguity'
import {
  canPromptWithOutput,
  emitOutput,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from '../cli/output'
import { fail } from '../cli/action'
import { ExitCode } from '../util/errors'
import {
  addSyncDirectionArgument,
  addSyncOptions,
  confirmUnreadableSync,
  createScopedIndenter,
  describeUnreadable,
  loggerFor,
  requireArchidektSession,
  type ScopedIndenter,
  type UnreadableSubject,
} from './sync-helpers'
import { t } from '../i18n/t'

/** Commander argParser for `--into`: the name of the list a pull adds cards to. */
export function parsePullTarget(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new InvalidArgumentError(t('cli.collectionSync.intoRequiresName'))
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
    throw new InvalidArgumentError(t('cli.collectionSync.removalPriorityRequiresName'))
  }
  return [...previous, trimmed]
}

/** Commander argParser for `--csv-file`: where a push writes its additions. */
export function parseCsvFile(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new InvalidArgumentError(t('cli.collectionSync.csvFileRequiresPath'))
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
const LISTS: UnreadableSubject = 'collectionLists'

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
    ? t('cli.sync.costRemoveLines')
    : t('cli.sync.costRemoveFromArchidekt')
}

/**
 * Render one sync event as a console line. List-scoped messages are indented
 * under the `Syncing "…"` line that opened the list — but only when that line
 * actually printed, and only after it did (see {@link createScopedIndenter}):
 * the per-line cache warnings arrive before any list header exists, and
 * `--quiet` drops the headers entirely. Run-level messages (the remote fetch,
 * ambiguous removals, records for cards that live in no list any more) sit
 * flush left. Results themselves are not printed — they are summarized by the
 * report.
 */
function renderSyncEvent(
  direction: SyncDirection,
  logger: Logger,
  indent: ScopedIndenter,
  event: CollectionSyncEvent,
): void {
  switch (event.kind) {
    case 'list-start':
      indent.start(event.list)
      logger.info(t('cli.sync.syncing', { name: event.list, direction }))
      return
    case 'log': {
      const line = indent.line(event.list, event.message)
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
  const waiting = pending > 0 ? t('cli.collectionSync.awaitingUpload', { count: pending }) : ''
  const change = t('cli.collectionSync.tally', { added, removed, waiting })
  // `into` is null only on a push, which this branch excludes; String() keeps
  // the previous template-literal rendering for the unreachable case.
  const where =
    report.direction === 'pull'
      ? t('cli.collectionSync.intoClause', { list: String(report.into) })
      : ''
  if (report.errors.length > 0) return t('cli.collectionSync.notSynced', { change, where })
  return report.dryRun
    ? t('cli.collectionSync.wouldSync', { change, where })
    : t('cli.collectionSync.synced', { change, where })
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
  const cards = t('domain.count.cards', { count: csv.cards })
  if (csv.status === 'exported') {
    return t('cli.collectionSync.csvExported', {
      count: csv.cards,
      cards,
      path: csv.path,
      url: ARCHIDEKT_IMPORT_URL,
    })
  }
  if (csv.status === 'planned' && csv.destination === 'export') {
    return t('cli.collectionSync.csvPlanned', {
      cards,
      path: csv.path,
      url: ARCHIDEKT_IMPORT_URL,
    })
  }
  return undefined
}

export function registerCollectionSyncCommand(program: Command): void {
  addScriptingOptions(
    addRefreshOption(
      addSyncOptions(
        addSyncDirectionArgument(
          program.command('collection-sync').description(t('help.collectionSync.description')),
        ),
        'collectionLists',
      )
        .argument('[lists...]', t('help.collectionSync.lists'))
        .option('--into <list>', t('help.collectionSync.into'), parsePullTarget)
        .option(
          '--removal-priority <list>',
          t('help.collectionSync.removalPriority'),
          parseRemovalPriority,
          [] as string[],
        )
        .option('--csv', t('help.collectionSync.csv', { threshold: CSV_UPLOAD_THRESHOLD }), false)
        .option('--csv-file <path>', t('help.collectionSync.csvFile'), parseCsvFile),
      t('help.collectionSync.refresh'),
    ),
  ).action(
    async (direction: SyncDirection, lists: string[], options: CollectionSyncCommandOptions) => {
      const scripting = normalizeScriptingOptions(options)
      // JSON/NDJSON output owns stdout, so per-list progress logging is silenced
      // there; every outcome still lands in the emitted report.
      const logger = loggerFor(scripting)
      const indent = createScopedIndenter(scripting)

      // One says "send the additions to Archidekt", the other "do not send them
      // at all" — there is no reading of the two together, so it is a usage
      // error rather than a precedence rule.
      if (options.csv === true && options.csvFile !== undefined) {
        fail(scripting, 'usage_error', 'cli.collectionSync.csvFlagsExclusive')
        return
      }

      const session = await requireArchidektSession(scripting)
      if (!session) return

      if (direction === 'push' && options.into !== undefined) {
        logger.warn(t('cli.collectionSync.ignoringInto'))
      }

      const removalPriority = options.removalPriority ?? []
      if (direction === 'push' && removalPriority.length > 0) {
        logger.warn(t('cli.collectionSync.ignoringRemovalPriority'))
      }

      if (direction === 'pull') {
        if (options.csv === true) logger.warn(t('cli.collectionSync.ignoringCsv'))
        if (options.csvFile !== undefined) {
          logger.warn(t('cli.collectionSync.ignoringCsvFile'))
        }
      }

      // Resolving removals one by one needs a terminal that owns stdout, and a
      // run that will actually write something — the shared sync gate, plus dry
      // runs, which never resolve anything. (The engine owns that dry-run
      // precedence too: belt and braces, so a preview cannot reach a prompt by
      // some route this command has not thought of.)
      const canPrompt = canPromptWithOutput(scripting) && options.dryRun !== true

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
          ensureCardCacheForUpload(cliRefreshPolicy(options.refresh ?? 'ask'), {
            log: (message) => log(message),
          }),
        dryRun: options.dryRun ?? false,
        onEvent: (event) => renderSyncEvent(direction, logger, indent, event),
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
        logger.error(
          t('cli.collectionSync.listsFailed', {
            failed: report.failedCount,
            total: report.lists.length,
          }),
        )
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
