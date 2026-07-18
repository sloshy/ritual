export interface Logger {
  info(message?: unknown, ...optionalParams: unknown[]): void
  warn(message?: unknown, ...optionalParams: unknown[]): void
  error(message?: unknown, ...optionalParams: unknown[]): void
  progress(message: string): void
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'progress'
  args: unknown[]
}

class ConsoleLogger implements Logger {
  info(message?: unknown, ...optionalParams: unknown[]): void {
    console.log(message, ...optionalParams)
  }

  warn(message?: unknown, ...optionalParams: unknown[]): void {
    console.warn(message, ...optionalParams)
  }

  error(message?: unknown, ...optionalParams: unknown[]): void {
    console.error(message, ...optionalParams)
  }

  progress(message: string): void {
    process.stdout.write(message)
  }
}

export class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = []

  constructor(private readonly mirrorTo?: Logger) {}

  info(message?: unknown, ...optionalParams: unknown[]): void {
    this.entries.push({ level: 'info', args: [message, ...optionalParams] })
    this.mirrorTo?.info(message, ...optionalParams)
  }

  warn(message?: unknown, ...optionalParams: unknown[]): void {
    this.entries.push({ level: 'warn', args: [message, ...optionalParams] })
    this.mirrorTo?.warn(message, ...optionalParams)
  }

  error(message?: unknown, ...optionalParams: unknown[]): void {
    this.entries.push({ level: 'error', args: [message, ...optionalParams] })
    this.mirrorTo?.error(message, ...optionalParams)
  }

  progress(message: string): void {
    this.entries.push({ level: 'progress', args: [message] })
    this.mirrorTo?.progress(message)
  }

  clear(): void {
    this.entries.length = 0
  }
}

export type CacheProgressEvent = {
  stage: 'download' | 'save' | 'done' | 'info'
  percentage?: number
  message: string
}

function stringifyLogMessage(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

export class StreamingLogger implements Logger {
  constructor(
    private readonly onEvent: (event: CacheProgressEvent) => void,
    private readonly mirrorTo?: Logger,
  ) {}

  info(message?: unknown, ...optionalParams: unknown[]): void {
    const msg = stringifyLogMessage(message)
    this.mirrorTo?.info(message, ...optionalParams)

    if (msg.includes('Saving to cache')) {
      this.onEvent({ stage: 'save', message: msg })
    } else if (msg.includes('Done!')) {
      this.onEvent({ stage: 'done', message: msg })
    } else {
      this.onEvent({ stage: 'info', message: msg })
    }
  }

  warn(message?: unknown, ...optionalParams: unknown[]): void {
    this.mirrorTo?.warn(message, ...optionalParams)
    this.onEvent({ stage: 'info', message: `Warning: ${stringifyLogMessage(message)}` })
  }

  error(message?: unknown, ...optionalParams: unknown[]): void {
    this.mirrorTo?.error(message, ...optionalParams)
    this.onEvent({ stage: 'info', message: `Error: ${stringifyLogMessage(message)}` })
  }

  progress(message: string): void {
    this.mirrorTo?.progress(message)
    const match = message.match(/Downloading:\s*(\d+)%\s*\(([^)]+)\)/)
    if (match && match[1] && match[2]) {
      this.onEvent({
        stage: 'download',
        percentage: parseInt(match[1], 10),
        message: `Downloading: ${match[1]}% (${match[2]})`,
      })
    }
  }
}

/**
 * A logger that keeps stdout untouched: info and progress lines go to stderr
 * alongside warnings and errors. Commands that emit structured data on stdout
 * (`--output json`/`ndjson`) install this so data-layer chatter (e.g. Scryfall
 * "Fetching: …" notices during a cold-cache run) stays visible without
 * corrupting the payload.
 */
export const STDERR_LOGGER: Logger = {
  info(message?: unknown, ...optionalParams: unknown[]): void {
    console.error(message, ...optionalParams)
  },
  warn(message?: unknown, ...optionalParams: unknown[]): void {
    console.warn(message, ...optionalParams)
  },
  error(message?: unknown, ...optionalParams: unknown[]): void {
    console.error(message, ...optionalParams)
  },
  progress(message: string): void {
    process.stderr.write(message)
  },
}

const defaultLogger = new ConsoleLogger()
let activeLogger: Logger = defaultLogger

export function getLogger(): Logger {
  return activeLogger
}

export function setLogger(logger: Logger): void {
  activeLogger = logger
}

export function resetLogger(): void {
  activeLogger = defaultLogger
}
