import type { ErrorCode } from './types'

/** Safely extract an error message from an unknown thrown value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
