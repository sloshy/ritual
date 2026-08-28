/**
 * The standard action-handler shell for one-shot commands: run the body, and
 * turn every failure — a broken pipe, a structured refusal
 * ({@link CardCommandError}), or an unexpected throw, in that dispatch order —
 * into the scripting error channel plus the matching process exit code.
 */

import type { ListArgumentConflict } from '../list/resolve-list'
import type { ListLifecycleError } from '../list/list-lifecycle'
import type { MessageKey } from '../i18n/messages/en'
import { t, type TranslateArgs, paramsOf, type MessageRef, type ParameterlessKey } from '../i18n/t'
import {
  CardCommandError,
  ExitCode,
  getErrorMessage,
  isBrokenPipeError,
  localizedCommandError,
  type ErrorCode,
  type ExitCodeValue,
} from '../util/errors'
import { emitError, markStdoutClosed, type ScriptingOptions } from './output'

/**
 * Run a one-shot command's action body — the standard action-handler shell
 * shared by every one-shot command, and the CLI's one catch-all. A broken pipe
 * (`… | head` closed the reader) is a normal end of output; a thrown
 * {@link CardCommandError} is a structured refusal carrying its own code and
 * exit code; anything else is an unexpected failure reported through the same
 * envelope so `--output json` stays parseable either way.
 */
export async function runCommandAction(
  scripting: ScriptingOptions,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run()
  } catch (err) {
    if (isBrokenPipeError(err)) {
      // Latch the shared writers quiet and leave the exit code untouched:
      // anything the command already recorded stands, and an otherwise clean
      // run still exits 0.
      markStdoutClosed()
      return
    }
    if (err instanceof CardCommandError) {
      // The catalog key travels beside the rendered prose, so `--output json`
      // carries a locale-invariant discriminator alongside `error.code`.
      emitError(err.code, err.message, scripting, err.details, err.messageRef)
      process.exitCode = err.exitCode
      return
    }
    // A bug rather than a refusal: there is no catalog key behind it, and the
    // raw Error is not `details` (it stringifies to `{}` and a subclass could
    // leak a path).
    emitError('runtime_error', getErrorMessage(err), scripting)
    // Deliberately overrides any code an earlier emit set: the run ended in a
    // bug, and that is what the caller should see.
    process.exitCode = ExitCode.RuntimeError
  }
}

/** The process exit code each structured error code maps to — exhaustive by construction. */
const EXIT_FOR_ERROR = {
  not_found: ExitCode.NotFound,
  usage_error: ExitCode.UsageError,
  runtime_error: ExitCode.RuntimeError,
} as const satisfies Record<ErrorCode, ExitCodeValue>

/** The process exit code a structured error code maps to. */
export function exitCodeFor(code: ErrorCode): ExitCodeValue {
  return EXIT_FOR_ERROR[code]
}

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
 * with no key. A bare key is accepted only for a params-free message — a
 * parameterised key must travel with its params, as a {@link MessageRef}.
 */
export function failWith(
  scripting: ScriptingOptions,
  code: ErrorCode,
  message: string,
  messageRef?: ParameterlessKey | MessageRef,
): void {
  emitError(code, message, scripting, undefined, messageRef)
  process.exitCode = exitCodeFor(code)
}

/**
 * {@link failWith} for a {@link CardCommandError} the caller holds rather than
 * throws: report it through the scripting error channel and record its exit
 * code — exactly what {@link runCommandAction} does for a thrown one.
 */
export function failWithError(scripting: ScriptingOptions, error: CardCommandError): void {
  emitError(error.code, error.message, scripting, error.details, error.messageRef)
  process.exitCode = error.exitCode
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
