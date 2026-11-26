import { t } from '../../i18n/t'
import type { OAuthFileProblem, OAuthStoreProblem } from './store'

/** Why a state file was refused, in the operator's language. */
function stateProblemReason(problem: OAuthFileProblem): string {
  switch (problem.problem) {
    case 'json':
      return t('cli.mcp.oauth.state.notJson')
    case 'version':
      return t('cli.mcp.oauth.state.version', { version: problem.version })
    case 'shape':
      return t('cli.mcp.oauth.state.shape', { path: problem.path })
    case 'io':
      return t('cli.mcp.oauth.state.io', { code: problem.code })
    default:
      return problem satisfies never
  }
}

/** The refusal for a state file that could not be used. */
export function describeOAuthStoreProblem(problem: OAuthStoreProblem): string {
  return t('cli.mcp.oauth.state.invalid', {
    file: problem.file,
    reason: stateProblemReason(problem),
  })
}
