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
