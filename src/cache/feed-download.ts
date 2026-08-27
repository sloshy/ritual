import { rename, unlink } from 'node:fs/promises'

/**
 * Stream `body` to `filePath` via a `.partial` temp file, renaming into place
 * only on success; a failed download never leaves a torn destination file.
 * `onChunk` observes every chunk (for hashing/size accounting).
 */
export async function streamToFile(
  body: ReadableStream<Uint8Array>,
  filePath: string,
  onChunk?: (chunk: Uint8Array) => void,
): Promise<void> {
  const partialPath = `${filePath}.partial`
  const writer = Bun.file(partialPath).writer()
  const reader = body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      onChunk?.(value)
      await writer.write(value)
    }
    await writer.end()
  } catch (e) {
    // Best-effort cleanup; the original error is what must surface.
    try {
      await writer.end()
    } catch {
      // Ignore — the sink may already be closed or errored.
    }
    await unlink(partialPath).catch(() => {})
    throw e
  } finally {
    await reader.cancel().catch(() => {})
  }
  await rename(partialPath, filePath)
}
