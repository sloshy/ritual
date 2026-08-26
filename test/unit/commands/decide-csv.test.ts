import { describe, expect, test } from 'bun:test'
import { CSV_UPLOAD_THRESHOLD } from '../../../src/collection-sync/csv'
import type { CsvUploadQuestion } from '../../../src/collection-sync/engine'
import { decideCsvUpload, defaultCsvFileName } from '../../../src/commands/decide-csv'
import type { AskPrompt } from '../../../src/cli/prompts'

/**
 * The CLI's interactive answer to "how should these new cards reach Archidekt?".
 * The prompt is injected, so what is pinned here is the flow: what is asked, with
 * which choices, and every path that ends without an answer — because each of
 * those has to leave the run pushing nothing, quoting the reason this module
 * gives back.
 */

type Question = Parameters<AskPrompt>[0]

type Scripted = {
  ask: AskPrompt
  /** Every question asked, in order. */
  asked: Question[]
}

/** An `ask` that answers from a script; running past its end cancels the prompt. */
function scriptedAsk(answers: unknown[]): Scripted {
  const queue = [...answers]
  const asked: Question[] = []
  const ask = ((question: Question) => {
    asked.push(question)
    return Promise.resolve(queue.shift())
  }) as AskPrompt
  return { ask, asked }
}

const QUESTION: CsvUploadQuestion = {
  additions: 26,
  threshold: CSV_UPLOAD_THRESHOLD,
}

/** A fixed clock, so the suggested file name is assertable. */
const NOW = (): Date => new Date('2026-07-27T18:30:00Z')

/** The choice values of a select question, in the order offered. */
function values(question: Question): unknown[] {
  const choices = question.choices
  return Array.isArray(choices) ? choices.map((choice) => choice.value) : []
}

describe('decideCsvUpload', () => {
  test('refuses without a terminal, naming both flags that settle it up front', async () => {
    const { ask, asked } = scriptedAsk([])

    const decision = await decideCsvUpload({ question: QUESTION, interactive: false, ask })

    expect(asked).toEqual([])
    // Returned rather than logged: the engine puts it in the run's report, so a
    // scripted run carries the reason and the terminal prints it once.
    expect(decision).toEqual({
      kind: 'abort',
      message:
        '26 cards would be added — more than 25, so adding them one at a time would cost 26 printing searches. Pass --csv to upload them as one CSV import, or --csv-file <path> to write the CSV for a manual upload.',
    })
  })

  test('offers the four routes, recommending the upload', async () => {
    const { ask, asked } = scriptedAsk(['upload'])

    const decision = await decideCsvUpload({ question: QUESTION, interactive: true, ask })

    expect(asked).toHaveLength(1)
    expect(asked[0]?.type).toBe('select')
    expect(asked[0]?.message).toBe(
      '26 cards would be added — more than 25. How should they reach Archidekt?',
    )
    expect(values(asked[0]!)).toEqual(['upload', 'export', 'individual', 'cancel'])
    expect(decision).toEqual({ kind: 'upload' })
  })

  test('asks where to write the CSV, suggesting a dated file name', async () => {
    const { ask, asked } = scriptedAsk(['export', 'binder-import.csv'])

    const decision = await decideCsvUpload({
      question: QUESTION,
      interactive: true,
      ask,
      now: NOW,
    })

    expect(asked).toHaveLength(2)
    expect(asked[1]?.type).toBe('text')
    // Dated, so two runs on different days cannot silently overwrite each
    // other's pending import.
    expect(asked[1]?.initial).toBe('archidekt-import-2026-07-27.csv')
    expect(asked[1]?.message).toContain('https://archidekt.com/collections/import')
    expect(decision).toEqual({ kind: 'export', path: 'binder-import.csv' })
  })

  test('an empty path answer takes the suggestion it was prefilled with', async () => {
    const { ask } = scriptedAsk(['export', '  '])

    const decision = await decideCsvUpload({
      question: QUESTION,
      interactive: true,
      ask,
      now: NOW,
    })

    expect(decision).toEqual({ kind: 'export', path: 'archidekt-import-2026-07-27.csv' })
  })

  test('choosing the slow path says so plainly', async () => {
    const { ask } = scriptedAsk(['individual'])

    expect(await decideCsvUpload({ question: QUESTION, interactive: true, ask })).toEqual({
      kind: 'individual',
    })
  })

  test('cancelling the run refuses with the same advice', async () => {
    const { ask } = scriptedAsk(['cancel'])

    expect(await decideCsvUpload({ question: QUESTION, interactive: true, ask })).toEqual({
      kind: 'abort',
      message:
        'Cancelled before adding 26 cards. Pass --csv to upload them as one CSV import, or --csv-file <path> to write the CSV for a manual upload.',
    })
  })

  test('escaping either prompt abandons the run rather than guessing', async () => {
    // The script runs out, which is what Esc looks like.
    const escapedChoice = await decideCsvUpload({
      question: QUESTION,
      interactive: true,
      ask: scriptedAsk([]).ask,
    })
    const escapedPath = await decideCsvUpload({
      question: QUESTION,
      interactive: true,
      ask: scriptedAsk(['export']).ask,
    })

    expect(escapedChoice.kind).toBe('abort')
    expect(escapedPath.kind).toBe('abort')
  })

  test('one addition past the threshold reads as one card', async () => {
    const { ask, asked } = scriptedAsk(['upload'])

    await decideCsvUpload({
      question: { additions: 1, threshold: 0 },
      interactive: true,
      ask,
    })

    expect(asked[0]?.message).toBe(
      '1 card would be added — more than 0. How should it reach Archidekt?',
    )
  })
})

describe('defaultCsvFileName', () => {
  test('is dated by day, in the working directory', () => {
    expect(defaultCsvFileName(new Date('2026-01-05T23:59:59Z'))).toBe(
      'archidekt-import-2026-01-05.csv',
    )
  })
})
