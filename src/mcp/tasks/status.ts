/**
 * The status lines a task shows while it runs.
 *
 * A task's `statusMessage` is what a client puts in front of its *user* (Claude
 * Code's /tasks view), so unlike everything else the MCP server says to the
 * agent it is worded in the server's UI language — the same rule as the
 * `sync_collection` elicitation form.
 *
 * The routes already report progress, but as English notes on a numeric scale
 * (`RouteProgress`), for the `notifications/progress` channel an agent reads.
 * Those notes cannot be re-worded, so each task tool's line is rendered here from
 * the report's position on the scale its route documents.
 */

import { t } from '../../i18n/t'
import type { RouteProgress } from '../../util/progress'
import type { McpToolName } from '../tools/names'

/** The tools that may run as a task. */
export const TASK_TOOL_NAMES = [
  'build_site',
  'sync_decks',
  'sync_collection',
  'refresh_cache',
] as const satisfies readonly McpToolName[]

/** One of {@link TASK_TOOL_NAMES}. */
export type TaskToolName = (typeof TASK_TOOL_NAMES)[number]

/** Which item of a counted run is in flight, 1-based. */
type ItemPosition = { current: number; total: number }

/** Step `progress` (0-based, on its `total`) of a counted run, as a 1-based "n of m". */
function itemOf(report: RouteProgress): ItemPosition | undefined {
  const total = report.total
  if (total === undefined || total <= 0) return undefined
  return { current: Math.min(Math.floor(report.progress) + 1, total), total }
}

/**
 * The status line for a progress report from `tool`, or `undefined` when the
 * report carries nothing a line can say (a sync that has not counted its items
 * yet). The scales are the routes': `build_site` reports steps 0 (starting),
 * 1 (building), 2 (publishing) and 3 (done); the syncs count items finished; the
 * cache refresh runs 0–100.
 */
export function taskProgressStatus(tool: TaskToolName, report: RouteProgress): string | undefined {
  switch (tool) {
    case 'build_site':
      if (report.progress < 1) return t('cli.mcp.task.buildSite.starting')
      if (report.progress < 2) return t('cli.mcp.task.buildSite.building')
      if (report.total === undefined || report.progress < report.total) {
        return t('cli.mcp.task.buildSite.publishing')
      }
      return t('cli.mcp.task.buildSite.published')
    case 'refresh_cache': {
      if (report.total === undefined || report.total <= 0) return undefined
      const percent = Math.min(100, Math.round((report.progress / report.total) * 100))
      return t('cli.mcp.task.refreshCache.progress', { percent })
    }
    case 'sync_decks': {
      const item = itemOf(report)
      return item && t('cli.mcp.task.syncDecks.progress', item)
    }
    case 'sync_collection': {
      const item = itemOf(report)
      return item && t('cli.mcp.task.syncCollection.progress', item)
    }
  }
}
