import type { ListLifecycleError } from '../list-lifecycle'
import { CardCommandError } from '../errors'
import { ExitCode } from './scripting'

/**
 * Convert a structured list-lifecycle engine error into the shared
 * {@link CardCommandError} the one-shot command action handlers catch. A missing
 * list is a not-found (exit 3); everything else — unusable name, unknown deck
 * format, slug collision — is a usage error (exit 2).
 */
export function lifecycleErrorToCommandError(error: ListLifecycleError): CardCommandError {
  if (error.kind === 'not-found') {
    return new CardCommandError('not_found', error.message, ExitCode.NotFound)
  }
  return new CardCommandError('usage_error', error.message, ExitCode.UsageError)
}
