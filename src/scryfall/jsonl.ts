/** Byte-level progress reported while consuming a gzipped JSONL stream. */
export type GzipJsonLinesProgress = {
  /** Compressed bytes consumed from the underlying stream so far. */
  compressedBytes: number
}

/** A malformed line encountered while reading a JSONL stream. */
export class JsonLinesError extends Error {
  constructor(
    readonly line: number,
    cause: unknown,
  ) {
    super(`Invalid JSONL: line ${line} is not valid JSON`, { cause })
    this.name = 'JsonLinesError'
  }
}

function parseLine(text: string, line: number): unknown {
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new JsonLinesError(line, e)
  }
}

/**
 * Stream a gzipped JSONL body (e.g. a Scryfall `.jsonl.gz` bulk file), yielding
 * one parsed JSON value per non-empty line. Decompression and parsing are
 * incremental, so arbitrarily large files never need to fit in memory at once.
 *
 * Throws {@link JsonLinesError} for a line that is not valid JSON; corrupt gzip
 * data throws from the underlying {@link DecompressionStream}.
 */
export async function* readGzipJsonLines(
  body: ReadableStream<Uint8Array>,
  onProgress?: (progress: GzipJsonLinesProgress) => void,
): AsyncGenerator<unknown, void, undefined> {
  let compressedBytes = 0
  const byteCounter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      compressedBytes += chunk.byteLength
      onProgress?.({ compressedBytes })
      controller.enqueue(chunk)
    },
  })

  // DecompressionStream's lib.dom typing accepts BufferSource, which does not
  // structurally match pipeThrough's Uint8Array pair — the runtime shape is fine.
  const gunzip = new DecompressionStream('gzip') as unknown as TransformStream<
    Uint8Array,
    Uint8Array
  >
  const reader = body.pipeThrough(byteCounter).pipeThrough(gunzip).getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let line = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        // trim() also drops the '\r' of CRLF line endings.
        const text = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        line++
        if (text.length === 0) continue
        yield parseLine(text, line)
      }
    }

    buffer += decoder.decode()
    const tail = buffer.trim()
    if (tail.length > 0) {
      yield parseLine(tail, line + 1)
    }
  } finally {
    // Stop pulling (and decompressing) when the consumer exits early.
    await reader.cancel().catch(() => {})
  }
}
