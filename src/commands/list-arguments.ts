import type { ListType } from '../list/list-type'
import {
  isListArgumentConflict,
  isResolveListError,
  resolveList,
  resolveListArgument,
  type ListLocation,
  type ResolveListError,
} from '../list/resolve-list'

/** Why a list-argument batch failed to resolve. */
export type ListArgumentsFailure =
  | { kind: 'conflict'; message: string }
  | { kind: 'resolve'; error: ResolveListError }

export type ListArgumentsResult = ListLocation[] | ListArgumentsFailure

export function isListArgumentsFailure(
  result: ListArgumentsResult,
): result is ListArgumentsFailure {
  return !Array.isArray(result)
}

/**
 * Resolve a variadic `[list...]` argument batch, the protocol shared by every
 * command that takes several list names (`export`, `sell`): each raw value
 * goes through the `type:`-prefix grammar, is checked against the command's
 * type flag, and resolves through the shared resolver. The first failure stops
 * the batch; callers own how it is reported (all of them pass the
 * `'type-prefix'` hint) and whether duplicates are collapsed.
 */
export async function resolveListArguments(
  raw: string[],
  flagType: ListType | undefined,
): Promise<ListArgumentsResult> {
  const locations: ListLocation[] = []
  for (const value of raw) {
    const arg = resolveListArgument(value, flagType)
    if (isListArgumentConflict(arg)) return { kind: 'conflict', message: arg.message }
    const resolved = await resolveList(arg.name, arg.type)
    if (isResolveListError(resolved)) return { kind: 'resolve', error: resolved }
    locations.push(resolved)
  }
  return locations
}
