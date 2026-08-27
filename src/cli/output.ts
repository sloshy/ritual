/**
 * The scripting output channel: `--output` formats, the stdout latch, and the
 * structured error / warning envelopes every command speaks through.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import { InvalidArgumentError } from 'commander'
import { getBaseDir } from '../config/base-dir'
import {
  type ErrorCode,
  CardCommandError,
  ExitCode,
  getErrorMessage,
  hasErrorCode,
  isBrokenPipeError,
  type ErrorMessageRef,
} from '../util/errors'
import type { MessageKey } from '../i18n/messages/en'
import { t, type RenderParams, type ParameterlessKey } from '../i18n/t'
import {
  formatResolveListError,
  type ResolveHint,
  type ResolveListError,
} from '../list/resolve-list'
import { getAtPath } from '../util/object'
import { promptsUnavailable } from '../util/no-input'
import { QUIET_STDERR_LOGGER, setLogger, STDERR_LOGGER } from '../util/logger'

export const OUTPUT_FORMATS = ['text', 'json', 'ndjson'] as const

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

/**
 * The shared vocabulary plus `csv`, for the commands whose `--output` also
 * offers a CSV payload (`scry`, `sell`). A fourth `--output` value rather than
 * a separate `--csv` boolean, so exactly one flag owns the format.
 */
export const CSV_OUTPUT_FORMATS = [...OUTPUT_FORMATS, 'csv'] as const

export type CsvOutputFormat = (typeof CSV_OUTPUT_FORMATS)[number]

/**
 * The scripting envelope for a csv-widened command: `csv` has no error dialect
 * of its own, so it borrows `text`'s — plain messages on stderr.
 */
export function csvScriptingOptions(
  format: CsvOutputFormat | undefined,
  quiet: boolean,
): ScriptingOptions {
  const output: OutputFormat = format === undefined || format === 'csv' ? 'text' : format
  return { output, quiet }
}

/**
 * Whether the downstream reader has closed stdout. Once that happens every
 * further write would throw EPIPE, so all shared writers go quiet and the
 * process is allowed to finish normally (exit 0), like `head`-terminated Unix
 * tools do.
 */
let stdoutClosed = false

/** True once a broken pipe has been observed on stdout. */
export function isStdoutClosed(): boolean {
  return stdoutClosed
}

/**
 * Record that stdout is closed. Called by the global stdout `error` handler so
 * an asynchronously-reported broken pipe silences the shared writers too.
 */
export function markStdoutClosed(): void {
  stdoutClosed = true
}

/** Test seam: forget a recorded broken pipe between cases. */
export function resetStdoutClosed(): void {
  stdoutClosed = false
}

/**
 * The one stdout write in the scripting surface. A closed pipe (`… | head`) is
 * not a failure: record it, stop writing, and let the process exit 0 rather
 * than dumping an EPIPE stack trace. Any other write failure propagates.
 */
export function writeStdout(text: string): void {
  if (stdoutClosed) return
  try {
    process.stdout.write(text)
  } catch (error) {
    if (isBrokenPipeError(error)) {
      stdoutClosed = true
      return
    }
    throw error
  }
}

/** {@link writeStdout} for the stderr side: a closed stderr is equally benign. */
export function writeStderr(text: string): void {
  try {
    process.stderr.write(text)
  } catch (error) {
    if (!isBrokenPipeError(error)) throw error
  }
}

export interface ScriptingOptions {
  output: OutputFormat
  quiet: boolean
}

/**
 * The envelope for a command that only ever speaks plain text — no `--output`
 * or `--quiet` of its own — so its prompts, errors and confirmations go through
 * the same channels as everyone else's.
 */
export const TEXT_ONLY: Readonly<ScriptingOptions> = Object.freeze({ output: 'text', quiet: false })

/**
 * Whether a command may open a prompt while producing this output: prompting
 * has to be possible at all ({@link promptsUnavailable}) *and* the command must
 * own stdout — JSON/NDJSON output cannot share it with prompt UI. Every command
 * whose prompt competes with a machine-readable stream asks this one question,
 * so no copy can drop half the condition. Callers add their own extra
 * conditions (a dry run resolves nothing, `--yes` answers up front).
 */
export function canPromptWithOutput(scripting: ScriptingOptions): boolean {
  return scripting.output === 'text' && !promptsUnavailable()
}

export function normalizeScriptingOptions(
  options: Partial<ScriptingOptions>,
  defaultOutput: OutputFormat = 'text',
): ScriptingOptions {
  return {
    output: options.output ?? defaultOutput,
    quiet: options.quiet ?? false,
  }
}

export function emitOutput(data: unknown, options: ScriptingOptions): void {
  if (options.output === 'ndjson') {
    if (Array.isArray(data)) {
      for (const item of data) {
        if (isStdoutClosed()) return
        writeStdout(`${JSON.stringify(item)}\n`)
      }
      return
    }
    writeStdout(`${JSON.stringify(data)}\n`)
    return
  }

  if (options.output === 'json') {
    writeStdout(`${JSON.stringify(data, null, 2)}\n`)
    return
  }

  writeStdout(`${String(data)}\n`)
}

/**
 * The one channel for warnings that must survive structured output: a note the
 * user needs (a skipped card line, a truncated result set) goes to stderr so
 * stdout stays a parseable payload, and `--quiet` silences it only when it is
 * genuinely non-essential — data-loss warnings pass `essential: true`.
 */
export type WarningEmission = {
  /** Print even under `--quiet`. Use for anything the user would lose silently. */
  essential?: boolean
}

export function emitWarnings(
  warnings: readonly string[],
  options: ScriptingOptions,
  emission: WarningEmission = {},
): void {
  if (warnings.length === 0) return
  if (options.quiet && emission.essential !== true) return
  for (const warning of warnings) {
    writeStderr(`${warning}\n`)
  }
}

/**
 * Install the data-layer logger that matches this run's scripting options:
 * `--quiet` drops info/progress outright, and anything but `text` output keeps
 * info off stdout so the payload stays parseable. A plain text run keeps the
 * default console logger. Commands whose own messages go through
 * `getLogger().info` (rather than `console.log`) must call this before doing
 * work, so engine chatter can never corrupt or outshout the payload.
 */
export function installScriptingLogger(options: ScriptingOptions): void {
  if (options.quiet) {
    setLogger(QUIET_STDERR_LOGGER)
    return
  }
  if (options.output !== 'text') {
    setLogger(STDERR_LOGGER)
  }
}

/**
 * The `error` object of the structured envelope. `code` and `messageKey` are the
 * locale-invariant halves — the pair a script or an agent matches on — while
 * `message` is prose that follows the user's UI locale. `messageKey` is dropped
 * by `JSON.stringify` when the failure has no catalog key behind it, so an
 * envelope that has always been English stays byte-identical.
 */
export type ErrorEnvelope = {
  code: ErrorCode
  messageKey: MessageKey | undefined
  /**
   * What `messageKey` interpolates. Carrying the key without them would make the
   * key un-renderable — a client re-rendering `errors.enum.invalid` alone gets
   * literal `{field}` / `{value}` / `{choices}` tokens. Dropped by
   * `JSON.stringify` when absent, so a params-free failure is unchanged.
   */
  messageParams: RenderParams | undefined
  message: string
  details: unknown
}

export function emitError(
  code: ErrorCode,
  message: string,
  options: ScriptingOptions,
  details?: unknown,
  // A bare key for the common params-free failure, or the whole ref when the
  // message interpolates — carrying a parameterised key without its parameters
  // would hand a client a key it cannot render, so the bare form is typed to
  // refuse one.
  messageRef?: ParameterlessKey | ErrorMessageRef,
): void {
  if (options.output === 'text') {
    writeStderr(`${message}\n`)
    return
  }
  const ref: ErrorMessageRef | undefined =
    typeof messageRef === 'string' ? { key: messageRef } : messageRef
  const envelope: ErrorEnvelope = {
    code,
    messageKey: ref?.key,
    messageParams: ref?.params,
    message,
    details,
  }
  const indent = options.output === 'json' ? 2 : undefined
  writeStderr(`${JSON.stringify({ error: envelope }, null, indent)}\n`)
}

/**
 * Report an error caught by a command action. A broken pipe (`… | head` closed
 * the reader) is a normal end of output rather than a failure: latch it so the
 * shared writers go quiet and leave the exit code untouched — anything the
 * command already recorded stands, and an otherwise clean run still exits 0.
 * Every other error is a runtime failure with the shared envelope.
 */
export function emitActionError(error: unknown, options: ScriptingOptions): void {
  if (isBrokenPipeError(error)) {
    markStdoutClosed()
    return
  }
  const messageRef =
    error instanceof CardCommandError && error.messageKey !== undefined
      ? { key: error.messageKey, params: error.messageParams }
      : undefined
  emitError('runtime_error', getErrorMessage(error), options, error, messageRef)
  process.exitCode = ExitCode.RuntimeError
}

/**
 * The `--fields` projection only applies to structured output. When `--fields`
 * was given alongside `--output text`, emit the shared usage error, set the
 * usage exit code, and return true so the caller can bail out.
 */
export function rejectFieldsWithTextOutput(
  fields: string[] | undefined,
  options: ScriptingOptions,
): boolean {
  if (fields !== undefined && fields.length > 0 && options.output === 'text') {
    emitError(
      'usage_error',
      t('errors.scripting.fieldsNeedStructuredOutput'),
      options,
      undefined,
      'errors.scripting.fieldsNeedStructuredOutput',
    )
    process.exitCode = ExitCode.UsageError
    return true
  }
  return false
}

/**
 * Emit a list-resolution error through the scripting error channel and set the
 * matching process exit code. Ambiguity is a usage error (the user must narrow
 * the name); a missing list or empty directory is a not-found. `hint` names the
 * disambiguation mechanism this command actually offers — see {@link ResolveHint}.
 */
export function emitResolveListError(
  error: ResolveListError,
  options: ScriptingOptions,
  hint: ResolveHint,
): void {
  const message = formatResolveListError(error, hint)
  const ref = resolveListMessageRef(error)
  switch (error.kind) {
    case 'ambiguous':
      emitError('usage_error', message, options, undefined, ref)
      process.exitCode = ExitCode.UsageError
      return
    case 'no-lists':
    case 'not-found':
      emitError('not_found', message, options, undefined, ref)
      process.exitCode = ExitCode.NotFound
      return
  }
}

/**
 * The catalog key `formatResolveListError` rendered from, **with its
 * parameters** — the discriminator a script gets in the structured envelope. It
 * distinguishes the type-scoped refusals from the cross-type ones, which
 * `error.code` alone cannot: both a missing deck and a missing list of any kind
 * are `not_found`.
 *
 * The params ride along because these keys interpolate: a client that re-renders
 * from the key alone would otherwise print literal `{type}` / `{query}` tokens.
 * `matches`/`advice` are deliberately not reproduced — they are already inside
 * the rendered `message`, and rebuilding them would duplicate
 * `formatResolveListError`'s body.
 */
function resolveListMessageRef(error: ResolveListError): ErrorMessageRef {
  switch (error.kind) {
    case 'no-lists':
      return error.type
        ? { key: 'errors.resolveList.noListsOfType', params: { type: error.type } }
        : { key: 'errors.resolveList.noLists' }
    case 'not-found':
      return error.type
        ? {
            key: 'errors.resolveList.notFoundOfType',
            params: { type: error.type, query: error.query },
          }
        : { key: 'errors.resolveList.notFound', params: { query: error.query } }
    case 'ambiguous':
      return { key: 'errors.resolveList.ambiguous', params: { query: error.query } }
  }
}

/**
 * How {@link emitToFileOrStdout} confirms a completed write, if at all. Each
 * destination has its own channel: a file-write confirmation goes to stdout
 * (stdout carried no data), while a stdout-write confirmation goes to stderr
 * so the payload stays parseable. Omit either line to stay silent for that
 * destination.
 */
export type OutputConfirmation = {
  /** Confirmation printed to stdout after writing the file at `target`. */
  file?: (target: string) => string
  /** Confirmation printed to stderr after writing the payload to stdout. */
  stdout?: string
}

/** Destination and chattiness for {@link emitToFileOrStdout}. */
export type EmitToFileOrStdoutOptions = {
  /** Pre-resolved absolute destination path; undefined writes to stdout. */
  outPath?: string
  /** Suppress the confirmation lines. */
  quiet: boolean
  confirm?: OutputConfirmation
}

/**
 * The shared `--out <file>` writer: write the fully rendered content (trailing
 * newline included) to the resolved path — creating parent directories — or
 * raw to stdout when no path was given. Write failures propagate to the caller,
 * which owns their classification.
 */
export async function emitToFileOrStdout(
  content: string,
  options: EmitToFileOrStdoutOptions,
): Promise<void> {
  const { outPath, quiet, confirm } = options
  if (outPath === undefined) {
    writeStdout(content)
    if (!quiet && confirm?.stdout !== undefined) {
      writeStderr(`${confirm.stdout}\n`)
    }
    return
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, content, 'utf-8')
  if (!quiet && confirm?.file) {
    console.log(confirm.file(outPath))
  }
}

/**
 * Resolve a shared `--out <file>` value to an absolute destination for
 * {@link emitToFileOrStdout}: absent or `-` means stdout, and a relative path
 * resolves against the base directory (not the process cwd), like every other
 * workspace-relative path.
 */
export function resolveOutPath(out: string | undefined): string | undefined {
  if (out === undefined || out === '-') return undefined
  return path.isAbsolute(out) ? out : path.join(getBaseDir(), out)
}

export type FileReadFailure = { errorCode: ErrorCode }

/**
 * Classify a failed read of a user-supplied file path: a missing file is a
 * not-found, anything else (permissions, directory, IO) is a runtime error.
 * The exit code follows from the error code (`exitCodeFor` in `./action`).
 */
export function classifyFileReadError(error: unknown): FileReadFailure {
  const missing = hasErrorCode(error, 'ENOENT')
  return { errorCode: missing ? 'not_found' : 'runtime_error' }
}

export function parseFields(value: string): string[] {
  const fields = value
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0)

  if (fields.length === 0) {
    throw new InvalidArgumentError(t('errors.scripting.fieldsEmpty'))
  }

  return fields
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function projectRecordFields(
  record: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {}

  for (const field of fields) {
    const pathParts = field.split('.').filter((part) => part.length > 0)
    if (pathParts.length === 0) continue

    const source = getAtPath(record, pathParts)
    if (source === undefined) continue

    let target: Record<string, unknown> = projected
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i]
      if (part === undefined) continue
      if (i === pathParts.length - 1) {
        target[part] = source
      } else {
        const current = target[part]
        if (!isRecord(current)) {
          target[part] = {}
        }
        target = target[part] as Record<string, unknown>
      }
    }
  }

  return projected
}

/**
 * {@link projectFields} for a list of items: an array in, an array out. Kept as
 * its own export rather than an overload so a caller holding a card list — the
 * common case — never has to assert the result back into one.
 */
export function projectFieldsArray(items: readonly unknown[], fields?: string[]): unknown[] {
  if (!fields || fields.length === 0) return [...items]
  return items.map((entry) => (isRecord(entry) ? projectRecordFields(entry, fields) : entry))
}

export function projectFields(data: unknown, fields?: string[]): unknown {
  if (!fields || fields.length === 0) {
    return data
  }

  if (Array.isArray(data)) {
    return projectFieldsArray(data, fields)
  }

  if (isRecord(data)) {
    return projectRecordFields(data, fields)
  }

  return data
}
