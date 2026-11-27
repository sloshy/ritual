import { describe, expect, test } from 'bun:test'
import { summarizeListsQuery } from '../../../src/mcp/tools/read-tools'
import { parseListsSummaryParams } from '../../../src/admin/api/lists'

type SummarizeListsInput = Parameters<typeof summarizeListsQuery>[0]

describe('summarize_lists → GET /api/lists/summary', () => {
  test('every input reaches the route as the option it was', () => {
    // Required<…>: a new tool input this pin does not set is a compile error.
    const input: Required<SummarizeListsInput> = {
      listType: 'deck',
      nameContains: 'stax',
      lists: [
        { listType: 'deck', slug: 'Winota, Stax' },
        { listType: 'deck', slug: 'burn' },
      ],
      label: 'proxy',
      includeEmpty: false,
      format: 'commander',
      sections: ['Commander', 'Main'],
      source: 'cardkingdom',
      sort: 'quantity',
      descending: false,
      limit: 5,
    }
    const query = summarizeListsQuery(input)
    expect(query.startsWith('?')).toBe(true)
    expect(parseListsSummaryParams(new URLSearchParams(query.slice(1)))).toEqual(input)
  })

  test('no input is no query string', () => {
    expect(summarizeListsQuery({})).toBe('')
  })
})
