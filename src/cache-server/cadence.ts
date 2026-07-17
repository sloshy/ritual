import { InvalidArgumentError } from 'commander'
import { DAY_REFRESH_MS, MONTHLY_REFRESH_MS, WEEKLY_REFRESH_MS } from './constants'
import { parseCacheFeedUrl } from '../ritual-config'
import { type RefreshCadence } from './types'

export function parseRefreshCadence(value: string): RefreshCadence {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'daily' || normalized === 'weekly' || normalized === 'monthly') {
    return normalized
  }
  throw new InvalidArgumentError("Refresh interval must be one of: 'daily', 'weekly', 'monthly'.")
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
      parsed === undefined ? '"--feed-url" requires a value' : parsed.error,
    )
  }
  return parsed
}
