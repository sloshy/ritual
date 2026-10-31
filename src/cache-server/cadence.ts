import { InvalidArgumentError, type Command } from 'commander'
import { DAY_REFRESH_MS, MONTHLY_REFRESH_MS, WEEKLY_REFRESH_MS } from './constants'
import { parseCacheFeedUrl, parseCacheSource, type CacheSource } from '../config/ritual-config'
import { renderSyncMessage } from '../sync/message'
import { t } from '../i18n/t'
import { fail } from '../cli/action'
import { TEXT_ONLY } from '../cli/output'
import type { RefreshCadence } from './types'
import { parsePort } from '../cli/options'
import { COMMAND, CONFIG_KEY, FLAG, commandLine } from '../util/cli-tokens'
import { resolveFeedUrl } from '../cache/refresh-source'

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
  if (typeof parsed !== 'string') throw new InvalidArgumentError(renderSyncMessage(parsed.error))
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
  fail(TEXT_ONLY, 'usage_error', 'cli.cache.feedUrlNeedsFeedSource', { flag: FLAG.url })
  return true
}

/**
 * The feed URL — `--url`, else the `cacheFeedUrl` config key — for a command
 * that was asked, by flag, to use the cache feed. With neither, there is no
 * public feed to fall back to: reports the usage error (exit 2) and returns
 * `undefined`, and the caller stops.
 */
export function feedUrlOrFail(url: string | undefined): string | undefined {
  const resolved = resolveFeedUrl(url)
  if (resolved !== undefined) return resolved
  // Neither command takes `--output`: the refusal is text on stderr.
  fail(TEXT_ONLY, 'usage_error', 'cli.cache.feedUrlRequired', {
    flag: FLAG.url,
    configKey: CONFIG_KEY.cacheFeedUrl,
    command: commandLine(COMMAND.cacheFeedHost),
  })
  return undefined
}

/**
 * Refuse a feed source asked for by flag (`--source feed`, `--cache-source
 * feed`) when no feed URL is set, per {@link feedUrlOrFail}; returns `true`
 * when it did, and the caller stops. A feed source that comes from the config
 * alone is not refused here: that refresh warns and uses Scryfall.
 */
export function rejectFeedSourceWithoutUrl(
  source: CacheSource | undefined,
  url: string | undefined,
): boolean {
  return source === 'feed' && feedUrlOrFail(url) === undefined
}

/**
 * The feed-flag checks a command with a cache-source flag runs, in order: a
 * `--url` beside a non-feed source ({@link rejectFeedUrlSourceConflict}), then
 * a feed source with no URL ({@link rejectFeedSourceWithoutUrl}). Returns `true`
 * when one refused, and the caller stops.
 */
export function rejectFeedSourceFlags(
  source: CacheSource | undefined,
  url: string | undefined,
): boolean {
  return rejectFeedUrlSourceConflict(source, url) || rejectFeedSourceWithoutUrl(source, url)
}
