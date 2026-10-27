import { describe, expect, test } from 'bun:test'
import { t } from '../../../src/i18n/t'
import { taskProgressStatus } from '../../../src/mcp/tasks/status'

/**
 * Each task tool's status line is read off its route's progress scale, so what
 * is pinned is the mapping: which position on each scale yields which catalog
 * line, with which numbers.
 */
describe('taskProgressStatus', () => {
  test('build_site names the step its route reports', () => {
    const at = (progress: number): string | undefined =>
      taskProgressStatus('build_site', { progress, total: 3 })
    expect(at(0)).toBe(t('cli.mcp.task.buildSite.starting'))
    expect(at(0.5)).toBe(t('cli.mcp.task.buildSite.starting'))
    expect(at(1)).toBe(t('cli.mcp.task.buildSite.building'))
    expect(at(1.5)).toBe(t('cli.mcp.task.buildSite.building'))
    expect(at(2)).toBe(t('cli.mcp.task.buildSite.publishing'))
    // The final frame: published, until the task reports it finished.
    expect(at(2.5)).toBe(t('cli.mcp.task.buildSite.publishing'))
    expect(at(3)).toBe(t('cli.mcp.task.buildSite.published'))
  })

  test('refresh_cache rounds to a whole percentage, capped at 100', () => {
    const at = (progress: number, total?: number): string | undefined =>
      taskProgressStatus('refresh_cache', { progress, total })
    expect(at(2, 3)).toBe(t('cli.mcp.task.refreshCache.progress', { percent: 67 }))
    expect(at(120, 100)).toBe(t('cli.mcp.task.refreshCache.progress', { percent: 100 }))
    expect(at(1)).toBeUndefined()
    expect(at(1, 0)).toBeUndefined()
  })

  test('the syncs count the item in flight, 1-based, never past the total', () => {
    expect(taskProgressStatus('sync_decks', { progress: 0, total: 3 })).toBe(
      t('cli.mcp.task.syncDecks.progress', { current: 1, total: 3 }),
    )
    expect(taskProgressStatus('sync_collection', { progress: 1.5, total: 3 })).toBe(
      t('cli.mcp.task.syncCollection.progress', { current: 2, total: 3 }),
    )
    // The terminal frame reports every item finished.
    expect(taskProgressStatus('sync_decks', { progress: 3, total: 3 })).toBe(
      t('cli.mcp.task.syncDecks.progress', { current: 3, total: 3 }),
    )
    // A run that has not counted its items yet has nothing to say.
    expect(taskProgressStatus('sync_collection', { progress: 0, total: 0 })).toBeUndefined()
    expect(taskProgressStatus('sync_decks', { progress: 0 })).toBeUndefined()
  })
})
