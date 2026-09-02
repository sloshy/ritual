import { describe, expect, test } from 'bun:test'
import {
  CSV_FILE_UNSUPPORTED_MESSAGE,
  describeRun,
  parseCollectionSyncBody,
  parseCollectionSyncQuery,
  type CollectionSyncRequest,
  REMOVAL_STRATEGY_CONFLICT_MESSAGE,
} from '../../src/admin/api/collection-sync'
import type { AmbiguousRemoval } from '../../src/collection-sync/describe'
import type {
  CollectionSyncCsv,
  CollectionSyncListResult,
  CollectionSyncReport,
  CollectionSyncTotals,
} from '../../src/collection-sync/engine'

/**
 * Validation and summary text for the admin collection-sync endpoints. The sync
 * itself is the engine's business; these pin what the handlers accept — from a
 * JSON body and from the query string an `EventSource` opens the stream with —
 * and what they say about a finished run.
 */

type RejectedCase = { label: string; body: unknown; expected: string }

/** A request with nothing set beyond the required direction. */
function defaults(direction: 'pull' | 'push' = 'pull'): CollectionSyncRequest {
  return { direction, lists: [], dryRun: false, ignoreUnreadableLines: false }
}

describe('parseCollectionSyncBody', () => {
  test('defaults to the whole collection, a live run, and refusing unreadable lines', () => {
    expect(parseCollectionSyncBody({ direction: 'pull' })).toEqual(defaults())
  })

  test('keeps the requested lists, trimmed, and both flags', () => {
    expect(
      parseCollectionSyncBody({
        direction: 'push',
        lists: ['  Blue Binder ', '', '  '],
        dryRun: true,
        ignoreUnreadableLines: true,
      }),
    ).toEqual({
      direction: 'push',
      lists: ['Blue Binder'],
      dryRun: true,
      ignoreUnreadableLines: true,
    } satisfies CollectionSyncRequest)
  })

  test('accepts a direction in any casing, as the CLI argument parser does', () => {
    expect(parseCollectionSyncBody({ direction: 'Push' })).toEqual(defaults('push'))
  })

  test('keeps a change filter, in any casing', () => {
    expect(parseCollectionSyncBody({ direction: 'pull', only: 'Removals' })).toEqual({
      ...defaults(),
      only: 'removals',
    } satisfies CollectionSyncRequest)
  })

  test('treats an absent or empty change filter as "apply everything"', () => {
    // A query string with no `only` param, and a form control left unset, both
    // arrive here as nothing to filter by rather than as a bad value.
    for (const only of [undefined, null, '']) {
      const parsed = parseCollectionSyncBody({ direction: 'pull', only })
      expect(typeof parsed).not.toBe('string')
      expect((parsed as CollectionSyncRequest).only).toBeUndefined()
    }
  })

  test('keeps the pull target, trimmed', () => {
    expect(parseCollectionSyncBody({ direction: 'pull', into: '  Inbox  ' })).toEqual({
      ...defaults(),
      into: 'Inbox',
    } satisfies CollectionSyncRequest)
  })

  test('keeps the removal priority in the order it was given, trimmed', () => {
    // The order *is* the priority: the first list named is the first asked for
    // copies, so it must survive parsing exactly as sent.
    expect(
      parseCollectionSyncBody({
        direction: 'pull',
        removalPriority: ['  Long Box ', 'Blue Binder'],
      }),
    ).toEqual({
      ...defaults(),
      removalPriority: ['Long Box', 'Blue Binder'],
    } satisfies CollectionSyncRequest)
  })

  test('treats an absent or empty removal priority as "no strategy"', () => {
    // Which, on a server surface, is what makes an ambiguous removal fail the
    // run — there is no prompt to fall back to.
    for (const removalPriority of [undefined, null, []]) {
      const parsed = parseCollectionSyncBody({ direction: 'pull', removalPriority })
      expect(typeof parsed).not.toBe('string')
      expect((parsed as CollectionSyncRequest).removalPriority).toBeUndefined()
    }
  })

  test('keeps explicit removal assignments, trimming the list names', () => {
    expect(
      parseCollectionSyncBody({
        direction: 'pull',
        removalAssignments: [
          { key: 'c21|240|nonfoil|NM|en', choices: [{ list: ' Long Box ', copies: 1 }] },
        ],
      }),
    ).toEqual({
      ...defaults(),
      removalAssignments: [
        { key: 'c21|240|nonfoil|NM|en', choices: [{ list: 'Long Box', copies: 1 }] },
      ],
    } satisfies CollectionSyncRequest)
  })

  test('treats an absent or empty removal assignment list as "no strategy"', () => {
    for (const removalAssignments of [undefined, null, []]) {
      const parsed = parseCollectionSyncBody({ direction: 'pull', removalAssignments })
      expect(typeof parsed).not.toBe('string')
      expect((parsed as CollectionSyncRequest).removalAssignments).toBeUndefined()
    }
  })

  test('keeps a request for the CSV upload path', () => {
    expect(parseCollectionSyncBody({ direction: 'push', csv: true })).toEqual({
      ...defaults('push'),
      csv: true,
    } satisfies CollectionSyncRequest)
  })

  test('treats an absent or false csv flag as "add them one at a time"', () => {
    // Which, on a server surface, is what makes a push with more additions than
    // the threshold fail — there is no prompt to fall back to. `false` is left
    // off rather than echoed, so the two spellings produce the same request.
    for (const csv of [undefined, false]) {
      const parsed = parseCollectionSyncBody({ direction: 'push', csv })
      expect(typeof parsed).not.toBe('string')
      expect((parsed as CollectionSyncRequest).csv).toBeUndefined()
    }
  })

  test('treats an absent or blank pull target as "use the configured one"', () => {
    // The engine is handed a resolved list name, so a blank `into` must read as
    // unset rather than as a list called "".
    for (const into of [undefined, null, '', '   ']) {
      const parsed = parseCollectionSyncBody({ direction: 'pull', into })
      expect(typeof parsed).not.toBe('string')
      expect((parsed as CollectionSyncRequest).into).toBeUndefined()
    }
  })

  // The rules `parseSyncRequestCore` owns (direction, `only`, and the two
  // booleans) are pinned in test/unit/admin/sync-request.test.ts; one row here
  // proves this endpoint reaches it. The rest are this endpoint's own fields.
  const rejected: RejectedCase[] = [
    { label: 'a non-object body', body: 'pull', expected: 'Invalid request body' },
    { label: 'a null body', body: null, expected: 'Invalid request body' },
    { label: 'an array body', body: [], expected: 'Invalid request body' },
    {
      label: 'an unknown direction, which is the shared core rejecting it',
      body: { direction: 'sideways' },
      expected: "Invalid direction 'sideways'. Use one of: push, pull.",
    },
    {
      label: 'lists that are not strings',
      body: { direction: 'pull', lists: [7] },
      expected: 'lists must be an array of collection list names',
    },
    {
      label: 'a non-array lists field',
      body: { direction: 'pull', lists: 'Blue Binder' },
      expected: 'lists must be an array of collection list names',
    },
    {
      label: 'a pull target that is not a string',
      body: { direction: 'pull', into: 7 },
      expected: 'into must be a collection list name',
    },
    {
      label: 'a removal priority that is not an array of names',
      body: { direction: 'pull', removalPriority: 'Long Box' },
      expected: 'removalPriority must be an array of collection list names',
    },
    {
      label: 'a removal priority holding a blank name',
      // Dropping it would quietly promote every list after it — unlike `lists`,
      // where a blank entry is simply dropped.
      body: { direction: 'pull', removalPriority: ['Long Box', '  '] },
      expected: 'removalPriority must not contain blank names',
    },
    {
      label: 'removal assignments that are not an array',
      body: { direction: 'pull', removalAssignments: { key: 'k', choices: [] } },
      expected: 'removalAssignments must be an array of { key, choices }',
    },
    {
      label: 'a removal assignment without a key',
      body: {
        direction: 'pull',
        removalAssignments: [{ choices: [{ list: 'Binder', copies: 1 }] }],
      },
      expected: "removalAssignments[0].key must be the ambiguous removal's key",
    },
    {
      label: 'a removal assignment choosing no list',
      body: { direction: 'pull', removalAssignments: [{ key: 'k', choices: [] }] },
      expected: 'removalAssignments[0].choices must be a non-empty array of { list, copies }',
    },
    {
      label: 'a removal assignment giving up zero copies',
      // Zero is spelled by leaving the list out; refused so a client cannot
      // send a choice that means nothing and read it as a decision.
      body: {
        direction: 'pull',
        removalAssignments: [{ key: 'k', choices: [{ list: 'Binder', copies: 0 }] }],
      },
      expected: 'removalAssignments[0].choices[0].copies must be a whole number of at least 1',
    },
    {
      label: 'both ambiguity strategies at once',
      // The engine consults a priority instead of a resolver, so the
      // assignments would be dropped without a word.
      body: {
        direction: 'pull',
        removalPriority: ['Long Box'],
        removalAssignments: [{ key: 'k', choices: [{ list: 'Binder', copies: 1 }] }],
      },
      expected: REMOVAL_STRATEGY_CONFLICT_MESSAGE,
    },
    {
      label: 'a csv flag that is not a boolean',
      // Validated like the other flags: it decides whether a large batch of
      // additions is uploaded, so a truthy string must not read as "yes".
      body: { direction: 'push', csv: 'true' },
      expected: 'csv must be a boolean',
    },
    {
      label: 'a request naming a CSV file, which only the CLI can write',
      body: { direction: 'push', csvFile: 'archidekt-import.csv' },
      expected: CSV_FILE_UNSUPPORTED_MESSAGE,
    },
  ]

  for (const { label, body, expected } of rejected) {
    test(`rejects ${label}`, () => {
      expect(parseCollectionSyncBody(body)).toBe(expected)
    })
  }
})

describe('parseCollectionSyncQuery', () => {
  test('reads repeated list params, both flags, and the pull target', () => {
    const params = new URLSearchParams(
      'direction=pull&list=binder&list=longbox&into=Inbox&dryRun=true&ignoreUnreadableLines=true',
    )
    expect(parseCollectionSyncQuery(params)).toEqual({
      direction: 'pull',
      lists: ['binder', 'longbox'],
      into: 'Inbox',
      dryRun: true,
      ignoreUnreadableLines: true,
    } satisfies CollectionSyncRequest)
  })

  test('reads a repeated removalPriority param in the order it appears', () => {
    // `EventSource` can only issue a bodyless GET, so the page spells the
    // priority as one param per list — and the order carries its meaning.
    expect(
      parseCollectionSyncQuery(
        new URLSearchParams(
          'direction=pull&removalPriority=long-box&removalPriority=binder&removalPriority=inbox',
        ),
      ),
    ).toEqual({
      ...defaults(),
      removalPriority: ['long-box', 'binder', 'inbox'],
    } satisfies CollectionSyncRequest)
  })

  test('reads removalAssignments from one JSON-encoded param', () => {
    const assignments = [{ key: 'c21|240|nonfoil|NM|en', choices: [{ list: 'binder', copies: 1 }] }]
    const params = new URLSearchParams({ direction: 'pull' })
    params.set('removalAssignments', JSON.stringify(assignments))
    expect(parseCollectionSyncQuery(params)).toEqual({
      ...defaults(),
      removalAssignments: assignments,
    } satisfies CollectionSyncRequest)
  })

  test('refuses a removalAssignments param that is not JSON', () => {
    expect(
      parseCollectionSyncQuery(new URLSearchParams('direction=pull&removalAssignments=binder')),
    ).toBe('removalAssignments must be a JSON-encoded array of { key, choices }')
  })

  test('rejects a blank removalPriority param rather than dropping it', () => {
    expect(
      parseCollectionSyncQuery(
        new URLSearchParams('direction=pull&removalPriority=long-box&removalPriority='),
      ),
    ).toBe('removalPriority must not contain blank names')
  })

  test('reads the change filter, which is a string enum rather than a flag', () => {
    expect(parseCollectionSyncQuery(new URLSearchParams('direction=push&only=additions'))).toEqual({
      ...defaults('push'),
      only: 'additions',
    } satisfies CollectionSyncRequest)
  })

  test('rejects an unknown change filter rather than syncing everything', () => {
    expect(parseCollectionSyncQuery(new URLSearchParams('direction=pull&only=everything'))).toBe(
      "Invalid only 'everything'. Use one of: additions, removals.",
    )
  })

  test('reads the csv flag, which the stream carries like any other flag', () => {
    expect(parseCollectionSyncQuery(new URLSearchParams('direction=push&csv=true'))).toEqual({
      ...defaults('push'),
      csv: true,
    } satisfies CollectionSyncRequest)
  })

  test('rejects a csv param that is neither true nor false', () => {
    // The shared reader owns the spelling rule; what this proves is that `csv` is
    // one of the flags handed to it — a missing entry there would silently read
    // an unspelled flag as "no".
    expect(parseCollectionSyncQuery(new URLSearchParams('direction=push&csv=1'))).toBe(
      "csv must be 'true' or 'false'",
    )
  })

  test('rejects a csvFile param instead of quietly uploading the additions', () => {
    expect(parseCollectionSyncQuery(new URLSearchParams('direction=push&csvFile=import.csv'))).toBe(
      CSV_FILE_UNSUPPORTED_MESSAGE,
    )
  })

  test('treats an empty into param as the configured pull target', () => {
    expect(parseCollectionSyncQuery(new URLSearchParams('direction=pull&into='))).toEqual(
      defaults(),
    )
  })

  test('treats missing params as a live run over the whole collection', () => {
    expect(parseCollectionSyncQuery(new URLSearchParams('direction=pull'))).toEqual(defaults())
  })

  test('rejects a query with no direction', () => {
    expect(parseCollectionSyncQuery(new URLSearchParams('list=binder'))).toBe(
      'direction is required (push or pull)',
    )
  })

  test('threads the boolean flags through the shared reader', () => {
    // `readBooleanFlags` owns the spelling rules (pinned in
    // test/unit/admin/sync-request.test.ts); what this endpoint can get wrong is
    // handing it the wrong flag names, which one unreadable value proves.
    expect(parseCollectionSyncQuery(new URLSearchParams('direction=pull&dryRun=1'))).toBe(
      "dryRun must be 'true' or 'false'",
    )
  })
})

describe('describeRun', () => {
  type ReportOptions = {
    direction?: 'pull' | 'push'
    into?: string | null
    dryRun?: boolean
    lists?: CollectionSyncListResult[]
    errors?: string[]
    ambiguous?: AmbiguousRemoval[]
    totals?: Partial<CollectionSyncTotals>
    csv?: CollectionSyncCsv | null
  }

  function synced(name: string): CollectionSyncListResult {
    return { name, status: 'synced', added: 0, removed: 0, pending: 0 }
  }

  function report(options: ReportOptions = {}): CollectionSyncReport {
    const lists = options.lists ?? [synced('binder')]
    const direction = options.direction ?? 'pull'
    return {
      direction,
      into: options.into ?? (direction === 'pull' ? 'Inbox' : null),
      dryRun: options.dryRun ?? false,
      lists,
      failedCount: lists.filter((list) => list.status === 'failed').length,
      errors: options.errors ?? [],
      unreadable: [],
      cancelled: false,
      unresolvedAmbiguity: false,
      ambiguous: options.ambiguous ?? [],
      localIncomplete: false,
      csv: options.csv ?? null,
      totals: { added: 0, removed: 0, skipped: 0, pending: 0, ...options.totals },
    }
  }

  function ambiguousRemoval(lists: string[]): AmbiguousRemoval {
    return {
      key: 'c21|240|nonfoil|NM',
      parts: { set: 'c21', collectorNumber: '240', finish: 'nonfoil', condition: 'NM' },
      name: 'Sol Ring',
      quantity: 1,
      lists: lists.map((list) => ({ list, copies: 1 })),
    }
  }

  test('reports that nothing was found when there is no list to sync', () => {
    expect(describeRun(report({ lists: [] }))).toBe('No collection lists found to sync.')
  })

  test('names the list a pull added into', () => {
    const summary = describeRun(report({ totals: { added: 2, removed: 1 } }))
    expect(summary).toBe('Pulled +2 added, -1 removed into "Inbox".')
  })

  test('leaves the target out when a pull added nothing', () => {
    // Nothing landed in it, so naming it would only be noise.
    expect(describeRun(report({ totals: { removed: 3 } }))).toBe('Pulled +0 added, -3 removed.')
  })

  test('a push names no target, because it writes nothing locally', () => {
    expect(describeRun(report({ direction: 'push', totals: { added: 4 } }))).toBe(
      'Pushed +4 added, -0 removed.',
    )
  })

  test('says "previewed" for a dry run', () => {
    expect(describeRun(report({ dryRun: true, totals: { added: 1 } }))).toBe(
      'Previewed +1 added, -0 removed into "Inbox".',
    )
  })

  test('counts an ambiguous removal without claiming it was stepped over', () => {
    // A priority may well have placed it, and one nothing could place failed the
    // whole run — so the count is reported and `errors` says which it was.
    expect(
      describeRun(report({ totals: { removed: 2 }, ambiguous: [ambiguousRemoval(['binder'])] })),
    ).toBe('Pulled +0 added, -2 removed, 1 ambiguous removal.')
  })

  test('counts copies written to a CSV file apart from the ones that were pushed', () => {
    // A `--csv-file` push leaves those cards in a file, not in the account, so the
    // summary must not read as if they had been added.
    expect(
      describeRun(
        report({
          direction: 'push',
          totals: { removed: 1, pending: 3 },
          csv: { status: 'exported', cards: 3, rows: 2, uncached: 0, path: 'import.csv' },
        }),
      ),
    ).toBe('Pushed +0 added, -1 removed, 3 awaiting a manual CSV upload.')
  })

  test('counts filtered, ambiguous, failed, and run-level problems alongside the copies', () => {
    const summary = describeRun(
      report({
        lists: [
          synced('binder'),
          { name: 'longbox', status: 'failed', added: 0, removed: 0, pending: 0 },
        ],
        totals: { added: 1, removed: 1, skipped: 2 },
        ambiguous: [ambiguousRemoval(['binder', 'longbox'])],
        errors: ['Failed to fetch the Archidekt collection (page 1): boom'],
      }),
    )
    expect(summary).toBe(
      'Pulled +1 added, -1 removed into "Inbox", 2 filtered out, 1 ambiguous removal, 1 list failed, 1 error.',
    )
  })

  test('reports a run-level failure even when it touched no list', () => {
    // A push refused for having nothing readable locally has no list results —
    // the reason lives in `errors`, and must not read as "nothing to sync".
    const summary = describeRun(
      report({ direction: 'push', lists: [], errors: ['No readable collection lists to push.'] }),
    )
    expect(summary).toBe('Pushed +0 added, -0 removed, 1 error.')
  })
})
