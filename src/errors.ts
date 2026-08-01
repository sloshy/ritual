import type { ErrorCode } from './types'

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

/**
 * Whether `error` is a Node system error carrying `code` (e.g. `'ENOENT'`).
 * Narrowing on the `code` property is the only way to tell "the file is not
 * there" from "reading it failed", which callers that treat absence as a
 * default — rather than as an error — have to distinguish.
 */
/** A Node errno error whose `code` is known to be `C`. */
type ErrnoWithCode<C extends ErrnoCode> = NodeJS.ErrnoException & { code: C }

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

/** Structured error thrown by one-shot card commands. The action handler should
 * `instanceof`-check this to convert it into an `emitError` call. */
export class CardCommandError extends Error {
  readonly code: ErrorCode
  readonly exitCode: ExitCodeValue
  readonly details?: unknown
  constructor(code: ErrorCode, message: string, exitCode: ExitCodeValue, details?: unknown) {
    super(message)
    this.code = code
    this.exitCode = exitCode
    this.details = details
  }
}
