import type { MessageKey } from '../i18n/messages/en'
import { paramsOf, t, type MessageRef, type RenderParams, type TranslateArgs } from '../i18n/t'

export type ErrorCode = 'not_found' | 'usage_error' | 'runtime_error'

/** Safely extract an error message from an unknown thrown value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The errno codes Ritual actually branches on. A closed union rather than
 * `string` so a typo'd code (`'ENONET'`) is a compile error instead of a
 * permanently-dead branch.
 */
export type ErrnoCode = 'ENOENT' | 'ENOTDIR' | 'EEXIST' | 'EPERM' | 'EPIPE'

/**
 * Whether a failure is "the reader closed the pipe" — the `… | head` case.
 * Standard Unix tools stop quietly and exit 0 there, so every stdout write path
 * treats this as a normal end of output rather than a runtime error.
 */
export function isBrokenPipeError(error: unknown): boolean {
  return hasErrorCode(error, 'EPIPE')
}

/** A Node errno error whose `code` is known to be `C`. */
type ErrnoWithCode<C extends ErrnoCode> = NodeJS.ErrnoException & { code: C }

/**
 * Whether `error` is a Node system error carrying `code` (e.g. `'ENOENT'`).
 * Narrowing on the `code` property is the only way to tell "the file is not
 * there" from "reading it failed", which callers that treat absence as a
 * default — rather than as an error — have to distinguish.
 */
export function hasErrorCode<C extends ErrnoCode>(
  error: unknown,
  code: C,
): error is ErrnoWithCode<C> {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

/** Throw a descriptive error when an HTTP response is not OK. */
export function throwHttpError(response: Response, action: string): never {
  throw new Error(`${action}: ${response.status} ${response.statusText}`)
}

/**
 * Process exit codes for CLI failures. Commands set `process.exitCode` to one
 * of these (never a bare numeric literal, never a hard exit call) and return.
 */
export const ExitCode = {
  /**
   * A clean run. Rarely set explicitly — an untouched `process.exitCode` is
   * already 0 — but named so the mapping in index.ts never spells a bare `0`.
   */
  Success: 0,
  RuntimeError: 1,
  UsageError: 2,
  NotFound: 3,
} as const

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode]

/**
 * The locale-invariant identity of a failure's prose: the catalog key that
 * produced it, plus the parameters it was rendered with. Carried *beside* the
 * rendered `message` rather than instead of it, so nothing downstream has to
 * learn to render — `--output json` gains a stable discriminator scripts can
 * match on, and every text path keeps printing what it printed before.
 */
export type ErrorMessageRef = MessageRef

/** Structured error thrown by one-shot card commands. The action handler should
 * `instanceof`-check this to convert it into an `emitError` call. */
export class CardCommandError extends Error {
  readonly code: ErrorCode
  readonly exitCode: ExitCodeValue
  readonly details?: unknown
  /**
   * The catalog key `message` was rendered from, when it was rendered from one.
   * Optional because a failure may still quote an external error verbatim
   * (a Scryfall response, a filesystem errno) that has no key at all.
   */
  readonly messageKey?: MessageKey
  readonly messageParams?: RenderParams
  /** The pair above, as one value — what `emitError` wants. */
  readonly messageRef?: ErrorMessageRef
  constructor(
    code: ErrorCode,
    message: string,
    exitCode: ExitCodeValue,
    details?: unknown,
    messageRef?: ErrorMessageRef,
  ) {
    super(message)
    this.code = code
    this.exitCode = exitCode
    this.details = details
    this.messageKey = messageRef?.key
    this.messageParams = messageRef?.params
    this.messageRef = messageRef
  }
}

/**
 * Build a {@link CardCommandError} from a catalog key: the message is rendered
 * in the active UI locale and the key travels with it. The one way to raise a
 * localized command failure, so `message` and `messageKey` can never disagree —
 * constructing the error by hand and passing a key that does not match the
 * prose would put a lie into the `--output json` envelope.
 */
export function localizedCommandError<K extends MessageKey>(
  code: ErrorCode,
  exitCode: ExitCodeValue,
  key: K,
  ...args: TranslateArgs<K>
): CardCommandError {
  const params = paramsOf(args)
  return new CardCommandError(code, t(key, ...args), exitCode, undefined, { key, params })
}

/**
 * Whether a caught error is a `fetch` cancelled through `AbortController.abort()`.
 * Abort rejections are `DOMException`s, which extend `Error`, so one check
 * covers every runtime. (`AbortSignal.timeout()` rejects with `TimeoutError`,
 * which is deliberately not treated as a cancellation.)
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
