export { capitalize } from '../utils'

/** Pick a numeric value from an object based on the active currency. */
export function getCurrencyValue(
  usd: number | undefined,
  eur: number | undefined,
  tix: number | undefined,
  currency: 'usd' | 'eur' | 'tix',
): number {
  if (currency === 'eur') return eur ?? 0
  if (currency === 'tix') return tix ?? 0
  return usd ?? 0
}
