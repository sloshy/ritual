/**
 * What the CLI says about a failure nothing anticipated — one that reached the
 * catch-all without a catalog key behind it (not a {@link CardCommandError},
 * not a `SyncMessageError`).
 *
 * Two kinds land there. A failure of the machine around Ritual — a system call
 * refused (`EACCES`, `ENOSPC`), a connection that could not be made, a request
 * that timed out — is the user's to fix, and its own message says what went
 * wrong. Anything else is a bug: its message alone rarely helps, so the CLI
 * adds one line saying so, how to get the details (`RITUAL_DEBUG=1`), and where
 * to report it — the running build's own issue tracker, so a fork's users reach
 * the fork.
 *
 * `RITUAL_DEBUG` (read with the same on/off spellings as `RITUAL_NO_INPUT`)
 * swaps the bare message for the full stack trace, `cause` chain included. A
 * compiled binary embeds its source map, so the frames name `src/` files.
 */

import { ISSUES_URL } from '../config/version'
import { t } from '../i18n/t'
import { ENV_VAR } from '../util/cli-tokens'
import { getErrorMessage } from '../util/errors'
import { envFlagSet } from '../util/no-input'

/** Whether `RITUAL_DEBUG` asks for full stack traces. */
export function isDebugEnabled(envValue: string | undefined = process.env[ENV_VAR.debug]): boolean {
  return envFlagSet(envValue)
}

/** How deep a `cause` chain the classifier and the trace follow. */
const MAX_CAUSE_DEPTH = 5

/** The chain of `cause`s under a failure, itself first, at most {@link MAX_CAUSE_DEPTH} deep. */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [error]
  let current: unknown = error
  while (current instanceof Error && current.cause != null && chain.length <= MAX_CAUSE_DEPTH) {
    current = current.cause
    chain.push(current)
  }
  return chain
}

/**
 * A system or network error code: an errno (`ENOENT`, `ECONNRESET`), a TLS
 * failure (`ERR_TLS_CERT_ALTNAME_INVALID`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`)
 * or one of Bun's network codes (`ConnectionRefused`, `FailedToOpenSocket`).
 * Node's other `ERR_*` codes are argument and state checks — Ritual calling an
 * API wrongly — and a lowercase code is an application's own discriminator,
 * so neither counts.
 */
function isSystemCode(code: string): boolean {
  if (/^ERR_(TLS|SSL)_/.test(code)) return true
  if (code.startsWith('ERR_')) return false
  // Upper-case errno-style codes (`ENOENT`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`)
  // or Bun's PascalCase network codes (`ConnectionRefused`).
  return /^[A-Z][A-Z0-9_]+$/.test(code) || /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(code)
}

function isMachineFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
  const code: unknown = 'code' in error ? error.code : undefined
  return typeof code === 'string' && isSystemCode(code)
}

/**
 * Whether an unanticipated failure came from the machine around Ritual rather
 * than from Ritual itself: it, or a failure it wraps as its `cause`, is a
 * system or network error ({@link isSystemCode}) or a cancelled or timed-out
 * request.
 */
export function isEnvironmentFailure(error: unknown): boolean {
  return causeChain(error).some(isMachineFailure)
}

/**
 * The full trace of a failure: its stack (or its message, for a thrown
 * non-Error), then each `cause` beneath it. What `RITUAL_DEBUG` prints, and
 * what `--output json` carries as `details.stack`.
 */
export function debugTrace(error: unknown): string {
  const chain = causeChain(error)
  const parts = chain.map((link, depth) => {
    const text =
      link instanceof Error ? link.stack || `${link.name}: ${link.message}` : getErrorMessage(link)
    return depth === 0 ? text : t('cli.unexpected.causedBy', { trace: text })
  })
  const last = chain.at(-1)
  if (last instanceof Error && last.cause != null) parts.push(t('cli.unexpected.causeTruncated'))
  return parts.join('\n')
}

/** What {@link unexpectedErrorText} reads besides the error. */
export type UnexpectedErrorContext = {
  /** `RITUAL_DEBUG` is on: print the trace rather than the bare message. */
  debug: boolean
  /** Where bugs are reported. */
  issuesUrl: string
}

/** The running process's {@link UnexpectedErrorContext}. */
export function unexpectedErrorContext(): UnexpectedErrorContext {
  return { debug: isDebugEnabled(), issuesUrl: ISSUES_URL }
}

/**
 * The plain-text report of an unanticipated failure, without a trailing
 * newline: the message (or, under `RITUAL_DEBUG`, the trace), and for a bug one
 * more line pointing at the details and the issue tracker.
 */
export function unexpectedErrorText(error: unknown, context: UnexpectedErrorContext): string {
  const head = context.debug ? debugTrace(error) : getErrorMessage(error)
  if (isEnvironmentFailure(error)) return head
  const report = context.debug
    ? t('cli.unexpected.reportBug', { url: context.issuesUrl })
    : t('cli.unexpected.reportBugWithDebug', {
        envVar: ENV_VAR.debug,
        url: context.issuesUrl,
      })
  return `${head}\n${report}`
}
