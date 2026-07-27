/**
 * The CLI's answer to "how should these 200 new cards reach Archidekt?".
 *
 * A push creates new printings one at a time, each costing a paced printing
 * search, so a first push of a real collection is hundreds of requests. Past the
 * engine's threshold (`CSV_UPLOAD_THRESHOLD` new printings) the run stops and
 * asks — `--csv` and `--csv-file` answer up front, and with a terminal to ask on
 * this module offers the choice.
 *
 * Every path that does not answer the question refuses with the reason (no
 * terminal, cancelled, no path given), which the engine quotes in the run's
 * report before failing without pushing anything. The prompt itself is
 * injectable ({@link AskPrompt}) so the whole flow is testable without a TTY.
 */

import { ARCHIDEKT_IMPORT_URL } from '../collection-sync/csv'
import type { CsvUploadDecision, CsvUploadQuestion } from '../collection-sync/engine'
import { ask } from './prompts-helpers'

/** The prompt seam: the shared {@link ask} helper in production, a stub in tests. */
export type AskPrompt = typeof ask

export type CsvUploadRequest = {
  /** What the engine is asking about: how many additions, and the threshold they passed. */
  question: CsvUploadQuestion
  /**
   * Whether a prompt can run at all: text output, prompts enabled, a terminal,
   * and not a dry run. Decided by the command, since every one of those is a
   * property of the invocation rather than of the additions.
   */
  interactive: boolean
  /** Injectable for tests; the shared `ask` helper by default. */
  ask?: AskPrompt
  /** Injectable for tests; today's date, used for the default file name. */
  now?: () => Date
}

/** How to settle the question without a terminal — the two flags that do it. */
const FLAG_ADVICE =
  'Pass --csv to upload them as one CSV import, or --csv-file <path> to write the CSV for a manual upload.'

/** What each answer means, in the order the prompt offers them. */
type CsvChoice = 'upload' | 'export' | 'individual' | 'cancel'

/**
 * The file a `--csv-file` prompt suggests: `archidekt-import-2026-07-27.csv` in
 * the working directory. Dated rather than fixed, so two runs on different days
 * cannot silently overwrite each other's pending import.
 */
export function defaultCsvFileName(date: Date): string {
  const day = date.toISOString().slice(0, 10)
  return `archidekt-import-${day}.csv`
}

/**
 * Decide how a large batch of additions reaches Archidekt, or refuse with the
 * reason the decision could not be made. The engine treats every refusal the
 * same way: the run fails and pushes nothing, quoting the reason given here.
 */
export async function decideCsvUpload(request: CsvUploadRequest): Promise<CsvUploadDecision> {
  const { question, interactive } = request
  const prompt = request.ask ?? ask
  const cards = `${question.additions} card${question.additions === 1 ? '' : 's'}`

  if (!interactive) {
    return {
      kind: 'abort',
      message: `${cards} would be added — more than ${question.threshold}, so adding them one at a time would cost ${question.additions} printing searches. ${FLAG_ADVICE}`,
    }
  }

  const choice = await prompt<CsvChoice>({
    type: 'select',
    message: `${cards} would be added — more than ${question.threshold}. How should they reach Archidekt?`,
    choices: [
      { title: 'Upload them automatically as one CSV import (recommended)', value: 'upload' },
      { title: 'Save the CSV to a file for a manual upload', value: 'export' },
      { title: 'Add them individually (slow; may be rate limited)', value: 'individual' },
      { title: 'Cancel the run', value: 'cancel' },
    ],
  })

  if (choice === undefined || choice === 'cancel') {
    return { kind: 'abort', message: `Cancelled before adding ${cards}. ${FLAG_ADVICE}` }
  }
  if (choice === 'upload') return { kind: 'upload' }
  if (choice === 'individual') return { kind: 'individual' }

  const suggestion = defaultCsvFileName(request.now?.() ?? new Date())
  const path = await prompt<string>({
    type: 'text',
    message: `Write the CSV where? (import it at ${ARCHIDEKT_IMPORT_URL})`,
    initial: suggestion,
  })
  if (path === undefined) {
    return { kind: 'abort', message: `Cancelled before adding ${cards}. ${FLAG_ADVICE}` }
  }
  // An empty answer means the suggestion (the prompt shows it prefilled, and
  // clearing it is not a way of naming a file).
  const trimmed = path.trim() === '' ? suggestion : path.trim()
  return { kind: 'export', path: trimmed }
}
