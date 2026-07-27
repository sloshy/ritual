import { describe, expect, test } from 'bun:test'
import { resolveAmbiguousRemovals, type AskPrompt } from '../../../src/commands/resolve-ambiguity'
import type { AmbiguousRemoval, AmbiguousList } from '../../../src/collection-sync/describe'
import { MemoryLogger } from '../../../src/logger'

/**
 * The CLI's interactive answer to "which binder lost this card?". The prompt
 * itself is injected, so what is pinned here is the flow: what is asked, in what
 * order, with which choices, and every path that ends without a full assignment —
 * because each of those has to leave the run writing nothing, quoting the reason
 * this module gives back.
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

function removal(quantity: number, lists: AmbiguousList[]): AmbiguousRemoval {
  return {
    key: 'lea|161|nonfoil|NM',
    parts: { set: 'lea', collectorNumber: '161', finish: 'nonfoil', condition: 'NM' },
    name: 'Lightning Bolt',
    quantity,
    lists,
  }
}

const SPLIT = removal(2, [
  { list: 'blue-binder', copies: 1 },
  { list: 'long-box', copies: 2 },
])

/** The choice titles of a select question, as the terminal would show them. */
function titles(question: Question): string[] {
  const choices = question.choices
  return Array.isArray(choices) ? choices.map((choice) => String(choice.title)) : []
}

describe('resolveAmbiguousRemovals', () => {
  test('refuses without a terminal, naming the flag that settles it up front', async () => {
    const logger = new MemoryLogger()
    const { ask, asked } = scriptedAsk([])

    const outcome = await resolveAmbiguousRemovals({
      ambiguous: [SPLIT],
      interactive: false,
      logger,
      ask,
    })

    expect(asked).toEqual([])
    // Returned rather than logged: the engine puts it in the run's report, so a
    // scripted run carries the reason and the terminal prints it once.
    expect(outcome).toEqual({
      ok: false,
      message:
        '1 ambiguous removal needs a decision. Pass --removal-priority <list> (repeatable, in priority order) to say which lists may lose copies, or run in a terminal to resolve them one by one.',
    })
    expect(logger.entries).toEqual([])
  })

  test('asks first, and declining resolves nothing', async () => {
    const logger = new MemoryLogger()
    const { ask, asked } = scriptedAsk([false])

    const outcome = await resolveAmbiguousRemovals({
      ambiguous: [SPLIT],
      interactive: true,
      logger,
      ask,
    })

    expect(asked).toHaveLength(1)
    expect(asked[0]?.type).toBe('confirm')
    expect(asked[0]?.message).toBe('1 removal is ambiguous. Resolve them one by one now?')
    // Default No: a destructive choice is never the one the Enter key makes.
    expect(asked[0]?.initial).toBe(false)
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.message).toBe(
      '1 ambiguous removal left unresolved. Pass --removal-priority <list> (repeatable, in priority order) to say which lists may lose copies, or run in a terminal to resolve them one by one.',
    )
  })

  test('walks every copy, offering the lists that still hold one', async () => {
    const logger = new MemoryLogger()
    const { ask, asked } = scriptedAsk([true, 'blue-binder', 'long-box'])

    const outcome = await resolveAmbiguousRemovals({
      ambiguous: [SPLIT],
      interactive: true,
      logger,
      ask,
    })

    expect(outcome).toEqual({
      ok: true,
      assignments: [
        {
          key: 'lea|161|nonfoil|NM',
          choices: [
            { list: 'blue-binder', copies: 1 },
            { list: 'long-box', copies: 1 },
          ],
        },
      ],
    })
    // The per-removal context line: the prompts show what is left in each list,
    // so only this line says how the copies were split to begin with.
    expect(logger.entries.map((entry) => String(entry.args[0]))).toContain(
      'Lightning Bolt (LEA:161): 2 to remove — copies live in "blue-binder" (1) and "long-box" (2).',
    )
    expect(asked.slice(1).map((question) => question.message)).toEqual([
      'Which list lost Lightning Bolt (LEA:161)? (copy 1 of 2)',
      'Which list lost Lightning Bolt (LEA:161)? (copy 2 of 2)',
    ])
    expect(titles(asked[1]!)).toEqual(['blue-binder (1 left)', 'long-box (2 left)'])
    // blue-binder gave up its only copy, so it is gone from the second prompt.
    expect(titles(asked[2]!)).toEqual(['long-box (2 left)'])
  })

  test('sums repeated picks of one list into a single choice', async () => {
    const logger = new MemoryLogger()
    const { ask } = scriptedAsk([true, 'long-box', 'long-box'])

    const outcome = await resolveAmbiguousRemovals({
      ambiguous: [SPLIT],
      interactive: true,
      logger,
      ask,
    })

    expect(outcome).toEqual({
      ok: true,
      assignments: [{ key: 'lea|161|nonfoil|NM', choices: [{ list: 'long-box', copies: 2 }] }],
    })
  })

  test('cancelling part way through abandons the whole session', async () => {
    const logger = new MemoryLogger()
    // The script runs out after the first copy, which is what Esc looks like.
    const { ask, asked } = scriptedAsk([true, 'long-box'])

    const outcome = await resolveAmbiguousRemovals({
      ambiguous: [SPLIT],
      interactive: true,
      logger,
      ask,
    })

    expect(asked).toHaveLength(3)
    // The reason says how far the session got; the engine appends "Nothing was
    // written." to it.
    expect(outcome).toEqual({
      ok: false,
      message: 'Cancelled after 1 of 2 copies of Lightning Bolt (LEA:161).',
    })
  })

  test('resolves several removals in one session', async () => {
    const logger = new MemoryLogger()
    const second: AmbiguousRemoval = {
      ...removal(1, [
        { list: 'blue-binder', copies: 1 },
        { list: 'long-box', copies: 1 },
      ]),
      key: 'ltc|284|nonfoil|NM',
      parts: { set: 'ltc', collectorNumber: '284', finish: 'nonfoil', condition: 'NM' },
      name: 'Sol Ring',
    }
    const { ask } = scriptedAsk([true, 'long-box', 'long-box', 'blue-binder'])

    const outcome = await resolveAmbiguousRemovals({
      ambiguous: [SPLIT, second],
      interactive: true,
      logger,
      ask,
    })

    expect(outcome).toEqual({
      ok: true,
      assignments: [
        { key: 'lea|161|nonfoil|NM', choices: [{ list: 'long-box', copies: 2 }] },
        { key: 'ltc|284|nonfoil|NM', choices: [{ list: 'blue-binder', copies: 1 }] },
      ],
    })
  })
})
