import type { Finish, Condition } from './types'

export const VALID_FINISHES = ['nonfoil', 'foil', 'etched'] as const satisfies readonly Finish[]
export const VALID_CONDITIONS = [
  'NM',
  'LP',
  'MP',
  'HP',
  'DMG',
] as const satisfies readonly Condition[]

export function isFinish(value: string | undefined): value is Finish {
  return value !== undefined && (VALID_FINISHES as readonly string[]).includes(value)
}

export function isCondition(value: string | undefined): value is Condition {
  return value !== undefined && (VALID_CONDITIONS as readonly string[]).includes(value)
}
