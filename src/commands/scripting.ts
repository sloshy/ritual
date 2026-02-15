import { InvalidArgumentError, type Command } from 'commander'

export type OutputFormat = 'text' | 'json' | 'ndjson'

export const ExitCode = {
  RuntimeError: 1,
  UsageError: 2,
  NotFound: 3,
} as const

export interface ScriptingOptions {
  output: OutputFormat
  quiet: boolean
}

export function parseOutputFormat(value: string): OutputFormat {
  const normalized = value.toLowerCase()
  if (normalized === 'text' || normalized === 'json' || normalized === 'ndjson') {
    return normalized
  }

  throw new InvalidArgumentError(
    `Invalid output format '${value}'. Use 'text', 'json', or 'ndjson'.`,
  )
}

export function addScriptingOptions(command: Command, defaultOutput: OutputFormat = 'text') {
  return command
    .option(
      '--output <format>',
      'Output format: text, json, or ndjson',
      parseOutputFormat,
      defaultOutput,
    )
    .option('--quiet', 'Suppress non-essential output', false)
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
  code: string,
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

function projectRecordFields(
  record: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {}

  for (const field of fields) {
    const pathParts = field.split('.').filter((part) => part.length > 0)
    if (pathParts.length === 0) continue

    let source: unknown = record
    for (const part of pathParts) {
      if (typeof source !== 'object' || source === null || !(part in source)) {
        source = undefined
        break
      }
      source = (source as Record<string, unknown>)[part]
    }

    if (source === undefined) continue

    let target: Record<string, unknown> = projected
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i]
      if (part === undefined) continue
      if (i === pathParts.length - 1) {
        target[part] = source
      } else {
        const current = target[part]
        if (typeof current !== 'object' || current === null || Array.isArray(current)) {
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
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        return projectRecordFields(entry as Record<string, unknown>, fields)
      }
      return entry
    })
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return projectRecordFields(data as Record<string, unknown>, fields)
  }

  return data
}
