import { describe, expect, test } from 'bun:test'
import { JsonLinesError, readGzipJsonLines } from '../../src/scryfall/jsonl'
import { gzipJsonLines } from '../test-utils'

/** Stream `bytes` in chunks of `chunkSize` (whole buffer at once by default). */
function byteStream(bytes: Uint8Array, chunkSize = bytes.byteLength): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        controller.enqueue(bytes.subarray(offset, offset + chunkSize))
      }
      controller.close()
    },
  })
}

function gzipText(text: string): Uint8Array {
  return Bun.gzipSync(new TextEncoder().encode(text))
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const values: unknown[] = []
  for await (const value of readGzipJsonLines(stream)) values.push(value)
  return values
}

describe('readGzipJsonLines', () => {
  const cards = [
    { name: 'Sol Ring', set: 'cmr' },
    { name: 'Lightning Bolt', set: 'lea' },
    { name: 'Delver of Secrets', set: 'isd' },
  ]

  test('yields one parsed value per line', async () => {
    expect(await collect(byteStream(gzipJsonLines(cards)))).toEqual(cards)
  })

  test('handles values split across tiny stream chunks', async () => {
    expect(await collect(byteStream(gzipJsonLines(cards), 3))).toEqual(cards)
  })

  test('handles CRLF line endings and skips blank lines', async () => {
    const text = '{"a":1}\r\n\r\n{"b":2}\r\n'
    expect(await collect(byteStream(gzipText(text)))).toEqual([{ a: 1 }, { b: 2 }])
  })

  test('parses a final line without a trailing newline', async () => {
    const text = '{"a":1}\n{"b":2}'
    expect(await collect(byteStream(gzipText(text)))).toEqual([{ a: 1 }, { b: 2 }])
  })

  test('throws JsonLinesError with the offending line number', async () => {
    const text = '{"a":1}\nnot json\n{"b":2}\n'
    const error = await collect(byteStream(gzipText(text))).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(JsonLinesError)
    expect((error as JsonLinesError).line).toBe(2)
  })

  test('throws when the body is not valid gzip data', async () => {
    const notGzip = new TextEncoder().encode('{"a":1}\n')
    const error = await collect(byteStream(notGzip)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(JsonLinesError)
  })

  test('stops cleanly when the consumer exits the loop early', async () => {
    const values: unknown[] = []
    for await (const value of readGzipJsonLines(byteStream(gzipJsonLines(cards), 4))) {
      values.push(value)
      break
    }
    expect(values).toEqual([cards[0]])
  })

  test('reports monotonically increasing compressed-byte progress up to the total', async () => {
    const bytes = gzipJsonLines(cards)
    const reported: number[] = []
    const generator = readGzipJsonLines(byteStream(bytes, 4), ({ compressedBytes }) => {
      reported.push(compressedBytes)
    })
    for await (const _ of generator) {
      // Drain the stream; progress is observed via the callback.
    }
    expect(reported.length).toBeGreaterThan(1)
    expect(reported).toEqual([...reported].sort((a, b) => a - b))
    expect(reported.at(-1)).toBe(bytes.byteLength)
  })
})
