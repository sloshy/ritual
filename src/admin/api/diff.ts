import { loadExportEntries } from '../../export/entries'
import {
  diffLists,
  isDiffBy,
  loadDiffListRef,
  type DiffBy,
  type DiffListRef,
  type DiffMatch,
  type DiffOnly,
} from '../../list-diff'
import {
  formatResolveListError,
  isResolveListError,
  parseListArgument,
  resolveList,
  type ListLocation,
} from '../../resolve-list'
import { apiHandler } from '../utils'

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

export type DiffErrorResponse = { success: false; message: string }

function badRequest(message: string): Response {
  const body: DiffErrorResponse = { success: false, message }
  return Response.json(body, { status: 400 })
}

/** Resolve one side's `[type:]name` query value to a list file, or a 400 response. */
async function resolveSide(raw: string): Promise<ListLocation | Response> {
  const arg = parseListArgument(raw)
  const resolved = await resolveList(arg.name, arg.type)
  if (isResolveListError(resolved)) return badRequest(formatResolveListError(resolved))
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
      return badRequest("Query parameters 'a' and 'b' are required ([type:]name).")
    }

    const rawBy = url.searchParams.get('by') ?? 'name'
    if (!isDiffBy(rawBy)) {
      return badRequest(`Invalid by '${rawBy}'. Use 'name' or 'printing'.`)
    }

    const locationA = await resolveSide(rawA)
    if (locationA instanceof Response) return locationA
    const locationB = await resolveSide(rawB)
    if (locationB instanceof Response) return locationB

    const [refA, refB] = await Promise.all([loadDiffListRef(locationA), loadDiffListRef(locationB)])
    const [sideA, sideB] = await Promise.all([
      loadExportEntries([locationA]),
      loadExportEntries([locationB]),
    ])
    const result = diffLists(sideA.entries, sideB.entries, rawBy)

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
