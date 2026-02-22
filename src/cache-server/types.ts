import { type PriceData } from '../types'

export type RefreshCadence = 'daily' | 'weekly' | 'monthly'
export type PriceRefreshReason = 'scheduled' | 'manual-override'
export type PriceRefreshAction = 'read-through-fill' | 'scheduled-refresh' | 'manual-refresh'

export interface PriceRefreshSchedule {
  /** Absolute UNIX ms timestamp when the key should refresh next. */
  refreshAt: number
  bucketId: string
}

export interface PriceRefreshBucket {
  keys: Set<string>
  /** Active timer that triggers processing for this bucket. */
  timeout: ReturnType<typeof setTimeout> | null
}

export interface PriceReadThroughResult {
  value: PriceData | null
  updated: boolean
}

export interface CacheServerCommandOptions {
  port: number
  host: string
  cardsRefresh?: RefreshCadence
  pricesRefresh?: RefreshCadence
  verbose?: boolean
}
