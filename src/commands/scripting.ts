import * as fs from 'node:fs/promises'
import path from 'node:path'
import { InvalidArgumentError, type Command } from 'commander'
import type { ErrorCode } from '../types'
import { ExitCode, type ExitCodeValue } from '../errors'
import { formatResolveListError, type ResolveListError } from '../resolve-list'
import { getAtPath } from '../utils'

// The exit-code vocabulary lives in src/errors.ts (the dependency-free leaf so
// CardCommandError can carry an ExitCodeValue); command modules keep importing
// it from here.
export { ExitCode }
export type { ExitCodeValue }

export const OUTPUT_FORMATS = ['text', 'json', 'ndjson'] as const

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export interface ScriptingOptions {
  output: OutputFormat
  quiet: boolean
}

/**
 * Commander argParser body for an enum-valued flag: lowercase the value,
 * require membership in `values`, and reject anything else with the shared
 * `Invalid <label> '<value>'. Use one of: ...` message.
 */
export function parseEnumFlag<T extends string>(
  value: string,
  values: readonly T[],
  label: string,
): T {
  const normalized = value.toLowerCase()
  if ((values as readonly string[]).includes(normalized)) {
    return normalized as T
  }
  throw new InvalidArgumentError(`Invalid ${label} '${value}'. Use one of: ${values.join(', ')}.`)
}

export function parseOutputFormat(value: string): OutputFormat {
  return parseEnumFlag(value, OUTPUT_FORMATS, 'output format')
}

export function addScriptingOptions(
  command: Command,
  defaultOutput: OutputFormat = 'text',
): Command {
  return command
    .option(
      '--output <format>',
      'Output format: text, json, or ndjson',
      parseOutputFormat,
      defaultOutput,
    )
    .option('--quiet', 'Suppress non-essential output', false)
}

/** Register the shared `-n, --dry-run` flag with a command-specific description. */
export function addDryRunOption(command: Command, description: string): Command {
  return command.option('-n, --dry-run', description)
}

/** Register the shared `--fields <list>` projection flag for json/ndjson output. */
export function addFieldsOption(command: Command): Command {
  return command.option(
    '--fields <list>',
    'Comma-separated fields for json/ndjson output',
    parseFields,
  )
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
        process.stdout.write(`${JSON.stringify(item)}\n`)
      }
      return
    }
    process.stdout.write(`${JSON.stringify(data)}\n`)
    return
  }

  if (options.output === 'json') {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
    return
  }

  process.stdout.write(`${String(data)}\n`)
}

export function emitError(
  code: ErrorCode,
  message: string,
  options: ScriptingOptions,
  details?: unknown,
): void {
  if (options.output === 'json') {
    process.stderr.write(`${JSON.stringify({ error: { code, message, details } }, null, 2)}\n`)
    return
  }
  if (options.output === 'ndjson') {
    process.stderr.write(`${JSON.stringify({ error: { code, message, details } })}\n`)
    return
  }

  process.stderr.write(`${message}\n`)
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
    emitError('usage_error', '--fields requires --output json or --output ndjson.', options)
    process.exitCode = ExitCode.UsageError
    return true
  }
  return false
}

/** The card fields {@link renderCardSummary} needs for its one-line summary. */
export type CardSummary = { name: string; set: string }

/** The shared one-line text rendering for a fetched card: `Name (SET)`. */
export function renderCardSummary(card: CardSummary): string {
  return `${card.name} (${card.set.toUpperCase()})`
}

/**
 * Emit a list-resolution error through the scripting error channel and set the
 * matching process exit code. Ambiguity is a usage error (the user must pick a
 * type); a missing list or empty directory is a not-found.
 */
export function emitResolveListError(error: ResolveListError, options: ScriptingOptions): void {
  const message = formatResolveListError(error)
  switch (error.kind) {
    case 'ambiguous':
      emitError('usage_error', message, options)
      process.exitCode = ExitCode.UsageError
      return
    case 'no-lists':
    case 'not-found':
      emitError('not_found', message, options)
      process.exitCode = ExitCode.NotFound
      return
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
    process.stdout.write(content)
    if (!quiet && confirm?.stdout !== undefined) {
      process.stderr.write(`${confirm.stdout}\n`)
    }
    return
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, content, 'utf-8')
  if (!quiet && confirm?.file) {
    console.log(confirm.file(outPath))
  }
}

export type FileReadFailure = { errorCode: ErrorCode; exitCode: ExitCodeValue }

/**
 * Classify a failed read of a user-supplied file path: a missing file is a
 * not-found, anything else (permissions, directory, IO) is a runtime error.
 */
export function classifyFileReadError(error: unknown): FileReadFailure {
  const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
  return missing
    ? { errorCode: 'not_found', exitCode: ExitCode.NotFound }
    : { errorCode: 'runtime_error', exitCode: ExitCode.RuntimeError }
}

/** Commander argParser for port options: reject non-numeric and out-of-range values at parse time. */
export function parsePort(value: string): number {
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new InvalidArgumentError('Port must be an integer between 1 and 65535.')
  }
  return port
}

export function parseFields(value: string): string[] {
  const fields = value
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0)

  if (fields.length === 0) {
    throw new InvalidArgumentError('Expected at least one field for --fields.')
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

export function projectFields(data: unknown, fields?: string[]): unknown {
  if (!fields || fields.length === 0) {
    return data
  }

  if (Array.isArray(data)) {
    return data.map((entry) => {
      if (isRecord(entry)) {
        return projectRecordFields(entry, fields)
      }
      return entry
    })
  }

  if (isRecord(data)) {
    return projectRecordFields(data, fields)
  }

  return data
}
