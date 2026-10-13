import { loadExportEntries } from '../../export/entries'
import {
  diffLists,
  DIFF_BY_MODES,
  loadDiffListRef,
  type DiffBy,
  type DiffListRef,
  type DiffMatch,
  type DiffOnly,
} from '../../changes/list-diff'
import {
  resolveListErrorMessage,
  isResolveListError,
  parseListArgument,
  resolveList,
  type ListLocation,
} from '../../list/resolve-list'
import { apiHandler } from '../utils'
import { badRequest, nestedRefusal, type ApiErrorResponse } from '../../api/http'
import { apiMessage, isApiMessage, parseEnumParam } from '../../api/result'

/** `GET /api/diff` success body — the CLI `diff --output json` shape plus `success`. */
export type DiffResponseBody = {
  success: true
  a: DiffListRef
  b: DiffListRef
  by: DiffBy
  matches: DiffMatch[]
  onlyInA: DiffOnly[]
  onlyInB: DiffOnly[]
  warnings: string[]
}

/**
 * Every body `GET /api/diff` can return: the comparison, the shared refusal,
 * or — for a side that names no single list — the list resolver's refusal,
 * whose params may nest (see {@link ApiErrorResponse}).
 */
export type DiffResponse = DiffResponseBody | ApiErrorResponse

/**
 * Resolve one side's `[type:]name` query value to a list file, or a 400 response.
 * Like the CLI `diff`, each side carries its own `type:` prefix — that prefix is
 * the disambiguation mechanism this grammar offers, so an ambiguity error names it.
 */
async function resolveSide(raw: string): Promise<ListLocation | Response> {
  const arg = parseListArgument(raw)
  const resolved = await resolveList(arg.name, arg.type)
  if (isResolveListError(resolved))
    return nestedRefusal(resolveListErrorMessage(resolved, 'type-prefix'))
  return resolved
}

/**
 * `GET /api/diff?a=<[type:]name>&b=<[type:]name>&by=name|printing` — compare
 * two lists with the shared list-diff engine (the same result the CLI `diff`
 * command emits as JSON). List names resolve like CLI list arguments; an
 * optional `deck:`/`collection:`/`wanted:` prefix pins the type of an
 * ambiguous name. `by` defaults to `name`.
 */
export function handleDiff(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const url = new URL(req.url)
    const rawA = url.searchParams.get('a')
    const rawB = url.searchParams.get('b')
    if (!rawA || !rawB) {
      return badRequest(apiMessage('admin.api.diff.sidesRequired'))
    }

    // Through the shared enum parser so `?by=Printing` is accepted here exactly
    // as `--by Printing` is on the CLI, and the refusal reads the same.
    const by = parseEnumParam(url.searchParams.get('by') ?? 'name', DIFF_BY_MODES, 'by')
    if (isApiMessage(by)) return badRequest(by)

    const locationA = await resolveSide(rawA)
    if (locationA instanceof Response) return locationA
    const locationB = await resolveSide(rawB)
    if (locationB instanceof Response) return locationB

    const [refA, refB] = await Promise.all([loadDiffListRef(locationA), loadDiffListRef(locationB)])
    const [sideA, sideB] = await Promise.all([
      loadExportEntries([locationA]),
      loadExportEntries([locationB]),
    ])
    const result = diffLists(sideA.entries, sideB.entries, by)

    const body: DiffResponseBody = {
      success: true,
      a: refA,
      b: refB,
      by: result.by,
      matches: result.matches,
      onlyInA: result.onlyInA,
      onlyInB: result.onlyInB,
      warnings: [...sideA.warnings, ...sideB.warnings],
    }
    return Response.json(body)
  })
}
