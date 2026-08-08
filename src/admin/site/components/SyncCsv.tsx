import { type JSX, createMemo, For, Show } from 'solid-js'
import {
  describeCsvFailure,
  describeCsvFailureReasons,
  describeCsvSize,
  type CollectionCsvFailure,
} from '../../../collection-sync/describe'
import type { CollectionSyncCsv } from '../../../collection-sync/engine'
import type { MessageSegment } from '../../../i18n/types'
import type { TranslateFn } from '../../../i18n/t'
import { useT, useTSegments } from '../../../ui/i18n'

/**
 * The Sync Collection page's two surfaces for how a push's **new cards** reach
 * Archidekt: the decision, taken before the run, and what came of it afterwards.
 *
 * Creating a record for a printing costs a search plus a create, both paced, so a
 * first push of a real collection is hundreds of requests. Archidekt's own
 * collection importer takes one CSV instead, built entirely from the local
 * Scryfall cache. The CLI can stop and ask which route to take; a browser cannot
 * be asked mid-run, so {@link CsvUploadToggle} is that answer given up front —
 * and {@link CsvOutcomePanel} reports what the import actually did, including the
 * rows Archidekt refused.
 */

export type CsvUploadToggleProps = {
  value: boolean
  onChange: (next: boolean) => void
  /** Set while a run is in flight, when changing the answer would be a lie. */
  disabled: boolean
  /**
   * How many new printings a push adds one at a time before refusing to — the
   * engine's threshold, reported by the status endpoint so the page never
   * restates a number the server owns.
   */
  threshold: number
  /** Whether the run is a preview, which reports the upload instead of making it. */
  dryRun: boolean
}

/**
 * The threshold as a sentence reads it. The server owns the number, so until the
 * status has landed there is no number to name — and "more than 0 of them" is a
 * claim the page must not make.
 */
function thresholdText(t: TranslateFn, value: number): string {
  return value > 0 ? String(value) : t('admin.csvToggle.thresholdFew')
}

/** Render a message's segments, bolding the one named `emphasis`. */
function emphasized(segments: MessageSegment[]): JSX.Element {
  return (
    <For each={segments}>
      {(segment) =>
        segment.kind === 'param' && segment.name === 'emphasis' ? (
          <strong>{segment.value}</strong>
        ) : segment.kind === 'param' && segment.name === 'real' ? (
          <em>{segment.value}</em>
        ) : (
          segment.value
        )
      }
    </For>
  )
}

/**
 * The page's form of the CLI's `--csv`, and it means the same thing: send the
 * push's additions as one CSV import, however few there are. On by default,
 * because the alternative cannot be offered safely here — over the threshold an
 * un-flagged run fails rather than spending a search per card, and there is no
 * prompt to fall back to.
 */
export function CsvUploadToggle(props: CsvUploadToggleProps): JSX.Element {
  const t = useT()
  const tSegments = useTSegments()

  /**
   * Swapped rather than corrected after the fact: over the threshold a preview
   * reports the upload it would make and never fails, so the sentence has to be
   * true in whichever mode it is read.
   */
  const warning = (): MessageSegment[] =>
    props.dryRun
      ? tSegments('admin.csvToggle.offPreview', {
          threshold: thresholdText(t, props.threshold),
          real: t('admin.csvToggle.offPreviewReal'),
          emphasis: t('admin.csvToggle.failsWithoutPushing'),
        })
      : tSegments('admin.csvToggle.offRun', {
          threshold: thresholdText(t, props.threshold),
          emphasis: t('admin.csvToggle.failsWithoutPushing'),
        })

  return (
    <div class="sync-csv">
      <h3 class="section-subheading">{t('admin.csvToggle.heading')}</h3>
      <p class="sync-choice-desc">{t('admin.csvToggle.desc')}</p>
      <label class="sync-csv-toggle">
        <input
          type="checkbox"
          checked={props.value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        {t('admin.csvToggle.label')}
      </label>
      <Show when={!props.value}>
        <p class="sync-csv-warning">{emphasized(warning())}</p>
      </Show>
    </div>
  )
}

export type CsvOutcomePanelProps = {
  csv: CollectionSyncCsv
}

/** Read in a list-rendering position, so its identity is stable per report. */
const NO_FAILURES: readonly CollectionCsvFailure[] = []

/** Render a message's segments, wrapping every parameter named `code` in `<code>`. */
function withCode(segments: MessageSegment[]): JSX.Element {
  return (
    <For each={segments}>
      {(segment) => (segment.kind === 'param' ? <code>{segment.value}</code> : segment.value)}
    </For>
  )
}

type OutcomeLeadProps = { csv: CollectionSyncCsv }

/**
 * What the CSV did, in one sentence. An exhaustive switch rather than a `Switch`
 * with four narrowing `Match`es: a new outcome status is then a compile error
 * here, the way a new event kind is one in the page's own event handler.
 */
function OutcomeLead(props: OutcomeLeadProps): JSX.Element {
  const t = useT()
  const tSegments = useTSegments()
  const csv = props.csv
  const size = describeCsvSize(csv.cards, csv.rows)
  switch (csv.status) {
    case 'uploaded':
      return (
        <>
          {t('admin.syncCsv.uploaded', { size, count: csv.chunks })}
          <Show when={csv.unconfirmedChunks > 0}>
            {' '}
            {t('admin.csvOutcome.unconfirmed', { count: csv.unconfirmedChunks })}
          </Show>
        </>
      )
    case 'exported':
      return withCode(tSegments('admin.csvOutcome.exported', { size, path: csv.path }))
    case 'planned':
      return csv.destination === 'upload' ? (
        <>{t('admin.csvOutcome.plannedUpload', { size })}</>
      ) : (
        withCode(tSegments('admin.csvOutcome.plannedExport', { size, path: csv.path }))
      )
    case 'failed':
      return <>{t('admin.csvOutcome.failed', { message: csv.message })}</>
    case 'empty':
      // The count is the whole content of this outcome, so the lead carries it and
      // the uncached note below is suppressed rather than repeating it.
      return withCode(
        tSegments('admin.csvOutcome.empty', {
          count: csv.uncached,
          command: t('admin.csvOutcome.emptyCommand'),
        }),
      )
    default: {
      // Every outcome must be worded; a new status is a compile error.
      const unhandled: never = csv
      throw new Error(`Unhandled CSV outcome: ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * What the CSV path did with a finished push's new cards, worded the way the run
 * log words it (the same `describeCsv*` helpers the engine uses).
 *
 * `exported` is the CLI's `--csv-file` outcome — this API refuses to write files a
 * request names, so the page cannot produce one — but the report's type covers it
 * and rendering it costs a line.
 */
export function CsvOutcomePanel(props: CsvOutcomePanelProps): JSX.Element {
  const t = useT()
  /** Rows Archidekt did not import; only an upload can have any. */
  const failures = createMemo((): readonly CollectionCsvFailure[] =>
    props.csv.status === 'uploaded' ? props.csv.failures : NO_FAILURES,
  )

  /**
   * The additions no row could carry, and what became of them instead. Composed
   * as one string rather than interleaved JSX: every branch changes a word in the
   * middle of a sentence, which is where stray spacing shows.
   */
  const uncachedNote = (): string => {
    const count = props.csv.uncached
    // Two keys rather than one with a tense parameter: the catalog does not
    // nest a select inside a plural, and the pronoun agrees with both.
    return props.csv.status === 'planned'
      ? t('admin.syncCsv.uncachedPlanned', { count })
      : t('admin.syncCsv.uncachedApplied', { count })
  }

  /** How many rows Archidekt refused, and why — the run log's own wording. */
  const failuresNote = (): string => {
    const reasons = describeCsvFailureReasons(failures())
    return t('admin.csvOutcome.failuresLead', {
      dropped: failures().length,
      total: props.csv.rows,
      reasons: reasons === '' ? '' : ` (${reasons})`,
    })
  }

  /** One refused row: the card, and Archidekt's reason for it. */
  const failureNote = (failure: CollectionCsvFailure): string =>
    t('admin.csvOutcome.failure', { card: failure.card, reason: describeCsvFailure(failure) })

  return (
    <div class="sync-csv-outcome" data-status={props.csv.status}>
      <p class="sync-csv-outcome-lead">
        <OutcomeLead csv={props.csv} />
      </p>

      {/* A printing the cache does not hold has no Scryfall id, so it cannot be
          a row — the run added it the slow way instead. When *every* addition was
          in that position the lead has already said so. */}
      <Show when={props.csv.uncached > 0 && props.csv.status !== 'empty'}>
        <p class="sync-csv-uncached">{uncachedNote()}</p>
      </Show>

      <Show when={failures().length > 0}>
        <p class="sync-csv-failures-lead">{failuresNote()}</p>
        <ul class="sync-csv-failures">
          <For each={failures()}>
            {(failure) => <li class="sync-csv-failure">{failureNote(failure)}</li>}
          </For>
        </ul>
      </Show>
    </div>
  )
}
