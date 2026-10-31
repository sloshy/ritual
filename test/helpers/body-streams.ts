/**
 * Request bodies streamed with no declared size, for the body-budget suites:
 * only a reader that counts what it reads can refuse them in time.
 */

const CHUNK_SIZE = 64 * 1024

/** An endless body of `x` bytes. Only a reader that counts what it reads can ever finish with it. */
export function endlessBody(): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(CHUNK_SIZE).fill(0x78)
  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      controller.enqueue(chunk)
    },
  })
}

/** A finite stream of `bytes` bytes of `x`, so `fetch` sends it chunked. */
export function chunkedBody(bytes: number): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (sent >= bytes) {
        controller.close()
        return
      }
      const size = Math.min(CHUNK_SIZE, bytes - sent)
      controller.enqueue(new Uint8Array(size).fill(0x78))
      sent += size
    },
  })
}
