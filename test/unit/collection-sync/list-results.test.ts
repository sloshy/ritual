import { describe, expect, test } from 'bun:test'
import {
  createListResults,
  markCancelled,
  type CollectionSyncEvent,
  type ListResults,
} from '../../../src/collection-sync/types'
import { syncText } from '../../../src/sync/message'

/**
 * The per-list result bookkeeping: what each list's `status` and `outcome` end
 * up as, whichever order the run's flows report things in.
 */

function results(): ListResults {
  const events: CollectionSyncEvent[] = []
  return createListResults((event) => events.push(event))
}

describe('createListResults', () => {
  test('a list ends synced only when the run says so, with the outcome it gives', () => {
    const lists = results()
    expect(lists.succeed('binder', 'unchanged')).toMatchObject({
      status: 'synced',
      outcome: 'unchanged',
    })
    expect(lists.succeed('box', 'dry-run', syncText('dry-run: +1 added'))).toMatchObject({
      status: 'synced',
      outcome: 'dry-run',
      reason: 'dry-run: +1 added',
    })
  })

  test('a list the run never reached is skipped as not run, never synced', () => {
    const lists = results()
    lists.track('binder')
    expect(lists.all()).toEqual([
      {
        name: 'binder',
        status: 'skipped',
        outcome: 'not-run',
        reason: 'not synced: the run stopped before this list',
        reasonKey: 'domain.sync.reasonNotRun',
        added: 0,
        removed: 0,
        pending: 0,
      },
    ])
  })

  test('a list that failed stays failed when the run is then cancelled', () => {
    const lists = results()
    lists.fail('binder', syncText('disk is full'))
    markCancelled(['binder'], () => {}, lists, 'pull')
    const [binder] = lists.all()
    expect(binder).toMatchObject({ name: 'binder', status: 'failed', reason: 'disk is full' })
    expect(binder?.outcome).toBeUndefined()
  })

  test('a failure wins over a later success', () => {
    const lists = results()
    lists.fail('binder', syncText('disk is full'))
    const result = lists.succeed('binder', 'changed')
    expect(result.status).toBe('failed')
    expect(result.outcome).toBeUndefined()
  })

  test('a cancelled list carries the cancelled outcome and its English reason', () => {
    const lists = results()
    markCancelled(['binder'], () => {}, lists, 'pull')
    expect(lists.all()[0]).toMatchObject({
      status: 'skipped',
      outcome: 'cancelled',
      reason: 'cancelled before it started',
    })
  })
})
