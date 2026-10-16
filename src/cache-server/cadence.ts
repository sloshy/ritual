import { InvalidArgumentError, type Command } from 'commander'
import { DAY_REFRESH_MS, MONTHLY_REFRESH_MS, WEEKLY_REFRESH_MS } from './constants'
import { parseCacheFeedUrl, parseCacheSource, type CacheSource } from '../config/ritual-config'
import { renderSyncMessage } from '../sync/message'
import { t } from '../i18n/t'
import { fail } from '../cli/action'
import { TEXT_ONLY } from '../cli/output'
import type { RefreshCadence } from './types'
import { parsePort } from '../cli/options'

export function parseRefreshCadence(value: string): RefreshCadence {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'daily' || normalized === 'weekly' || normalized === 'monthly') {
    return normalized
  }
  throw new InvalidArgumentError(t('cli.cache.refreshIntervalInvalid'))
}

export function cadenceToMs(cadence: RefreshCadence): number {
  if (cadence === 'daily') return DAY_REFRESH_MS
  if (cadence === 'weekly') return WEEKLY_REFRESH_MS
  return MONTHLY_REFRESH_MS
}

export function resolveRefreshCadence(
  refreshOption: RefreshCadence | undefined,
  envVarName: string,
): RefreshCadence | undefined {
  if (refreshOption) return refreshOption

  const fromEnv = process.env[envVarName]?.trim()
  if (!fromEnv) return undefined
  return parseRefreshCadence(fromEnv)
}

export function resolveRefreshMs(
  refreshOption: RefreshCadence | undefined,
  envVarName: string,
): number | undefined {
  const cadence = resolveRefreshCadence(refreshOption, envVarName)
  if (!cadence) return undefined
  return cadenceToMs(cadence)
}

/**
 * Run `task` every `intervalMs`, fire-and-forget: a rejection is routed to
 * `onError` and never kills the timer, so the next tick still fires.
 */
export function scheduleRecurringTask(
  intervalMs: number,
  task: () => Promise<void>,
  onError: (error: unknown) => void,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void task().catch(onError)
  }, intervalMs)
}

/** Commander argParser for feed-URL flags: fail at parse time, not first fetch. */
export function parseFeedUrlFlag(value: string): string {
  const parsed = parseCacheFeedUrl(value)
  if (typeof parsed !== 'string') {
    throw new InvalidArgumentError(
      parsed === undefined ? t('cli.cache.feedUrlEmpty') : renderSyncMessage(parsed.error),
    )
  }
  return parsed
}

/** Commander argParser for cache-source flags (`scryfall` or `feed`). */
export function parseCacheSourceFlag(value: string): CacheSource {
  const parsed = parseCacheSource(value)
  if (typeof parsed !== 'string') {
    throw new InvalidArgumentError(renderSyncMessage(parsed.error))
  }
  return parsed
}

/** Register the shared `--url <feedUrl>` feed-URL flag with a command-specific description. */
export function addFeedUrlOption(command: Command, description: string): Command {
  return command.option('--url <feedUrl>', description, parseFeedUrlFlag)
}

/** Register the shared `--torrent-port <number>` flag with a command-specific description. */
export function addTorrentPortOption(command: Command, description: string): Command {
  return command.option('--torrent-port <number>', description, parsePort)
}

/**
 * Refuse combining an explicit non-feed cache source with `--url` — only
 * feed-sourced refreshes ever read the URL, so the combination would silently
 * ignore it. Reports the usage error (exit 2) and returns `true` when the flags
 * conflict; the caller then stops.
 */
export function rejectFeedUrlSourceConflict(
  source: CacheSource | undefined,
  url: string | undefined,
): boolean {
  if (source === undefined || source === 'feed' || url === undefined) return false
  // Neither command takes `--output`: the refusal is text on stderr.
  fail(TEXT_ONLY, 'usage_error', 'cli.cache.feedUrlNeedsFeedSource')
  return true
}
