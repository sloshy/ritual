import { type JSX, createMemo, For, Show } from 'solid-js'
import {
  describeCsvFailure,
  describeCsvFailureReasons,
  describeCsvSize,
  type CollectionCsvFailure,
} from '../../../collection-sync/describe'
import type { CollectionSyncCsv } from '../../../collection-sync/engine'

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

type ThresholdCountProps = { value: number }

/**
 * The threshold as a sentence reads it. The server owns the number, so until the
 * status has landed there is no number to name — and "more than 0 of them" is a
 * claim the page must not make.
 */
function ThresholdCount(props: ThresholdCountProps): JSX.Element {
  return (
    <Show when={props.value > 0} fallback={<>a few</>}>
      {props.value}
    </Show>
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
  return (
    <div class="sync-csv">
      <h3 class="section-subheading">New cards</h3>
      <p class="sync-choice-desc">
        A printing your Archidekt collection does not have yet costs a search plus a create, paced
        half a second apart, so a first push of a real collection would take hundreds of requests.
        Uploaded as one CSV import it takes one, with every row built from your local Scryfall
        cache. Quantity changes and removals never ride it.
      </p>
      <label class="sync-csv-toggle">
        <input
          type="checkbox"
          checked={props.value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        Upload new cards as one CSV import
      </label>
      <Show when={!props.value}>
        <p class="sync-csv-warning">
          {/* Swapped rather than corrected after the fact: over the threshold a
              preview reports the upload it would make and never fails, so the
              sentence has to be true in whichever mode it is read. */}
          <Show
            when={props.dryRun}
            fallback={
              <>
                Off: new cards are added one at a time, and a push with more than{' '}
                <ThresholdCount value={props.threshold} /> of them{' '}
                <strong>fails without pushing anything at all</strong> — a browser cannot be asked
                half way through a run, so this toggle is that answer.
              </>
            }
          >
            Off: new cards would be added one at a time — though a preview still reports the upload
            it would make. A <em>real</em> push with more than{' '}
            <ThresholdCount value={props.threshold} /> of them{' '}
            <strong>fails without pushing anything at all</strong>.
          </Show>
        </p>
      </Show>
    </div>
  )
}

export type CsvOutcomePanelProps = {
  csv: CollectionSyncCsv
}

/** Read in a list-rendering position, so its identity is stable per report. */
const NO_FAILURES: readonly CollectionCsvFailure[] = []

/**
 * What the CSV did, in one sentence. An exhaustive switch rather than a `Switch`
 * with four narrowing `Match`es: a new outcome status is then a compile error
 * here, the way a new event kind is one in the page's own event handler.
 */
function outcomeLead(csv: CollectionSyncCsv): JSX.Element {
  const size = describeCsvSize(csv.cards, csv.rows)
  switch (csv.status) {
    case 'uploaded':
      return (
        <>
          Uploaded {size} to Archidekt as a CSV import in {csv.chunks} request
          {csv.chunks === 1 ? '' : 's'}.
          <Show when={csv.unconfirmedChunks > 0}>
            {' '}
            Archidekt's answer to {csv.unconfirmedChunks} of them could not be read, so those rows
            are counted as imported without confirmation — the run log has what it said.
          </Show>
        </>
      )
    case 'exported':
      return (
        <>
          Wrote {size} to <code>{csv.path}</code> instead of pushing them — those cards reach
          Archidekt only once that file is imported by hand.
        </>
      )
    case 'planned':
      return csv.destination === 'upload' ? (
        <>Would upload {size} to Archidekt as one CSV import — nothing was searched or sent.</>
      ) : (
        <>
          Would write {size} to <code>{csv.path}</code> instead of pushing them.
        </>
      )
    case 'failed':
      return (
        <>
          The CSV import failed: {csv.message} Those cards were not added; the rest of the run
          applied.
        </>
      )
    case 'empty':
      // The count is the whole content of this outcome, so the lead carries it and
      // the uncached note below is suppressed rather than repeating it.
      return (
        <>
          No CSV was built: not one of the {csv.uncached} new cards has a printing in your Scryfall
          cache, so no row could be keyed by a Scryfall ID. Refresh the cache (
          <code>ritual cache preload-all</code>) and run again.
        </>
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
    const cards = `${count} new card${count === 1 ? '' : 's'}`
    const them = count === 1 ? 'it' : 'they'
    const added = props.csv.status === 'planned' ? 'would be added' : 'were added'
    return `${cards} could not ride the CSV (the printing is not in your Scryfall cache), so ${them} ${added} one at a time instead.`
  }

  /** How many rows Archidekt refused, and why — the run log's own wording. */
  const failuresNote = (): string => {
    const reasons = describeCsvFailureReasons(failures())
    const dropped = `${failures().length} of ${props.csv.rows} rows`
    return `Archidekt did not import ${dropped}${reasons === '' ? '' : ` (${reasons})`}. The lists holding those cards are reported as failed.`
  }

  /** One refused row: the card, and Archidekt's reason for it. */
  const failureNote = (failure: CollectionCsvFailure): string =>
    `${failure.card} — ${describeCsvFailure(failure)}`

  return (
    <div class="sync-csv-outcome" data-status={props.csv.status}>
      <p class="sync-csv-outcome-lead">{outcomeLead(props.csv)}</p>

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
