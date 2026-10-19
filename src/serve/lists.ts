import { getSiteSelectionConfig, type RitualConfig } from '../config/ritual-config'
import { dirForType } from '../list/resolve-list'
import { resolveSelectedBasenames } from '../site-build/list-sources'
import { getErrorMessage } from '../util/errors'
import type { ListType } from '../list/list-type'
import { t, type SelectBranch } from '../i18n/t'

/**
 * `cli.serve.enumerateFailed` has one branch per list kind. Pinned both ways at
 * compile time: a new {@link ListType} without its branch (or a branch for a
 * kind that no longer exists) fails to compile here rather than rendering the
 * bare key.
 */
type EnumerateBranch = SelectBranch<'cli.serve.enumerateFailed'>
type BranchesMatchListTypes = [ListType] extends [EnumerateBranch]
  ? [EnumerateBranch] extends [ListType]
    ? true
    : false
  : false
const ENUMERATE_BRANCHES_MATCH: BranchesMatchListTypes = true
void ENUMERATE_BRANCHES_MATCH

/**
 * The basenames the site's selection config includes for one list kind — the
 * live server's answer to what `build-site` resolves at build time.
 *
 * Never throws: discovery already reports a missing list directory as an empty
 * category, and anything it does let through (permissions, I/O) is logged
 * rather than taking the server down.
 */
export async function enumerateSources(kind: ListType, config: RitualConfig): Promise<string[]> {
  try {
    return await resolveSelectedBasenames(
      kind,
      dirForType(kind, config),
      getSiteSelectionConfig(config.site),
    )
  } catch (e) {
    console.warn(t('cli.serve.enumerateFailed', { type: kind, reason: getErrorMessage(e) }))
    return []
  }
}
