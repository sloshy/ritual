/**
 * The standard action-handler shell for one-shot commands: run the body, and
 * turn every structured refusal ({@link CardCommandError}) into the scripting
 * error channel plus the matching process exit code.
 */

import type { ListArgumentConflict } from '../list/resolve-list'
import type { ListLifecycleError } from '../list/list-lifecycle'
import type { MessageKey } from '../i18n/messages/en'
import { t, type TranslateArgs, paramsOf, type MessageRef } from '../i18n/t'
import {
  CardCommandError,
  ExitCode,
  localizedCommandError,
  type ErrorCode,
  type ExitCodeValue,
} from '../util/errors'
import { emitError, type ScriptingOptions } from './output'

/**
 * Run a one-shot command's action body, mapping a thrown
 * {@link CardCommandError} to the scripting error channel and process exit
 * code — the standard action-handler shell shared by every one-shot command.
 * Anything else propagates untouched.
 */
export async function runCommandAction(
  scripting: ScriptingOptions,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run()
  } catch (err) {
    if (err instanceof CardCommandError) {
      // The catalog key travels beside the rendered prose, so `--output json`
      // carries a locale-invariant discriminator alongside `error.code`.
      emitError(err.code, err.message, scripting, err.details, err.messageRef)
      process.exitCode = err.exitCode
      return
    }
    throw err
  }
}

/** The process exit code each structured error code maps to — exhaustive by construction. */
const EXIT_FOR_ERROR = {
  not_found: ExitCode.NotFound,
  usage_error: ExitCode.UsageError,
  runtime_error: ExitCode.RuntimeError,
} as const satisfies Record<ErrorCode, ExitCodeValue>

/**
 * Report a catalog-keyed failure through the scripting error channel and record
 * its exit code — the inline form of throwing a {@link CardCommandError} for the
 * action bodies that report and return rather than throw. The key and its
 * params ride along in the envelope so a client can re-render the message.
 */
export function fail<K extends MessageKey>(
  scripting: ScriptingOptions,
  code: ErrorCode,
  key: K,
  ...args: TranslateArgs<K>
): void {
  failWith(scripting, code, t(key, ...args), { key, params: paramsOf(args) })
}

/**
 * {@link fail} for a message an engine has already rendered (a parser's
 * `.message`, a git failure description). `messageRef` is the envelope's
 * `messageKey`/`messageParams` when the caller has one; omit it for prose
 * with no key.
 */
export function failWith(
  scripting: ScriptingOptions,
  code: ErrorCode,
  message: string,
  messageRef?: MessageKey | MessageRef,
): void {
  emitError(code, message, scripting, undefined, messageRef)
  process.exitCode = EXIT_FOR_ERROR[code]
}

/**
 * The shared "the user cancelled a prompt" refusal. Every interactive selector
 * in the one-shot commands ends here, so the wording and the exit code cannot
 * drift between them.
 */
export function cancelledError(): CardCommandError {
  return localizedCommandError('usage_error', ExitCode.UsageError, 'cli.cardOps.cancelled')
}

/**
 * The shared refusal for a `deck:`/`collection:`/`wanted:` prefix that
 * contradicts the command's type flag. The prose is rendered by the resolver
 * itself; this only attaches the exit code and the resolver's catalog key.
 */
export function listArgumentConflictError(conflict: ListArgumentConflict): CardCommandError {
  return new CardCommandError('usage_error', conflict.message, ExitCode.UsageError, undefined, {
    key: 'errors.resolveList.typeConflict',
    params: conflict.params,
  })
}

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
