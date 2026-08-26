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
import { ask, type AskPrompt } from '../cli/prompts'
import { t } from '../i18n/t'

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
function flagAdvice(): string {
  return t('cli.csvUpload.flagAdvice')
}

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
  const cards = t('domain.count.cards', { count: question.additions })

  if (!interactive) {
    return {
      kind: 'abort',
      message: t('cli.csvUpload.tooMany', {
        cards,
        threshold: question.threshold,
        searches: question.additions,
        advice: flagAdvice(),
      }),
    }
  }

  const choice = await prompt<CsvChoice>({
    type: 'select',
    message: t('cli.csvUpload.prompt', {
      count: question.additions,
      cards,
      threshold: question.threshold,
    }),
    choices: [
      { title: t('cli.csvUpload.optionUpload'), value: 'upload' },
      { title: t('cli.csvUpload.optionExport'), value: 'export' },
      { title: t('cli.csvUpload.optionIndividual'), value: 'individual' },
      { title: t('cli.csvUpload.optionCancel'), value: 'cancel' },
    ],
  })

  if (choice === undefined || choice === 'cancel') {
    return {
      kind: 'abort',
      message: t('cli.csvUpload.cancelled', { cards, advice: flagAdvice() }),
    }
  }
  if (choice === 'upload') return { kind: 'upload' }
  if (choice === 'individual') return { kind: 'individual' }

  const suggestion = defaultCsvFileName(request.now?.() ?? new Date())
  const path = await prompt<string>({
    type: 'text',
    message: t('cli.csvUpload.promptPath', { url: ARCHIDEKT_IMPORT_URL }),
    initial: suggestion,
  })
  if (path === undefined) {
    return {
      kind: 'abort',
      message: t('cli.csvUpload.cancelled', { cards, advice: flagAdvice() }),
    }
  }
  // An empty answer means the suggestion (the prompt shows it prefilled, and
  // clearing it is not a way of naming a file).
  const trimmed = path.trim() === '' ? suggestion : path.trim()
  return { kind: 'export', path: trimmed }
}
