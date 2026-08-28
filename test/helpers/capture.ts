/**
 * Std-stream capture for in-process CLI runs — where `emitError` writes usage
 * errors (stderr) and `emitOutput` writes payloads (stdout).
 *
 * One shared helper because the hand-rolled copies had already diverged on
 * decoding: `process.std*.write` accepts `string | Uint8Array`, and a copy
 * that stringifies a `Uint8Array` records comma-joined byte numbers instead of
 * text. Chunks are decoded as streamed UTF-8 here so both shapes round-trip.
 */
export async function captureStream(
  stream: 'stdout' | 'stderr',
  action: () => Promise<unknown>,
): Promise<string> {
  const target = process[stream]
  const write = target.write.bind(target)
  const decoder = new TextDecoder()
  const chunks: string[] = []
  target.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }))
    return true
  }
  try {
    await action()
  } finally {
    target.write = write
  }
  return chunks.join('')
}

/** The `console` methods {@link captureConsole} can intercept. */
export type ConsoleLevel = 'log' | 'warn' | 'error'

/** What one {@link captureConsole} run recorded, and what its action returned. */
export type ConsoleCapture<T> = {
  /** One entry per call, arguments stringified and joined by a space, per level. */
  lines: Record<ConsoleLevel, string[]>
  /** Every captured call across levels, in emission order. */
  all: string[]
  /** Whatever `action` resolved to. */
  result: T
}

/**
 * Run `action` with the named `console` levels recorded rather than printed.
 *
 * Separate from {@link captureStream} because Bun's `console.log` does **not**
 * route through `process.stdout.write`: a stream capture sees nothing a console
 * call wrote, and vice versa. Commands that report through `console.*` directly
 * — `src/commands` makes ~323 such calls — can only be observed this way.
 *
 * Arguments are joined with `String(...)` per argument, so an object logged
 * beside a string records as `[object Object]` rather than throwing; the
 * hand-rolled copies had already split over `args.join(' ')` vs
 * `args.map(String).join(' ')`, which differ for exactly that case.
 */
export async function captureConsole<T>(
  levels: readonly ConsoleLevel[],
  action: () => T | Promise<T>,
): Promise<ConsoleCapture<T>> {
  const lines: Record<ConsoleLevel, string[]> = { log: [], warn: [], error: [] }
  const all: string[] = []
  const originals = levels.map((level) => [level, console[level]] as const)
  for (const level of levels) {
    console[level] = (...args: unknown[]): void => {
      const line = args.map(String).join(' ')
      lines[level].push(line)
      all.push(line)
    }
  }
  try {
    return { lines, all, result: await action() }
  } finally {
    for (const [level, original] of originals) console[level] = original
  }
}
