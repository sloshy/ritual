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
  action: () => Promise<void>,
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
