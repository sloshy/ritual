import { InvalidArgumentError } from 'commander'
import { DAY_REFRESH_MS, MONTHLY_REFRESH_MS, WEEKLY_REFRESH_MS } from './constants'
import { type RefreshCadence } from './types'

export function parsePort(value: string): number {
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new InvalidArgumentError('Port must be an integer between 1 and 65535.')
  }
  return port
}

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
