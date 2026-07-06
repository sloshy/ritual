import type { FileSystemClient } from '../interfaces'

/**
 * Write `data` to `filePath` via a temp file + rename so concurrent readers
 * never see a torn file. The temp name embeds the pid so concurrent writers in
 * different processes cannot clobber each other's in-flight temp file. The
 * containing directory must already exist.
 */
export async function writeFileAtomic(
  fs: FileSystemClient,
  filePath: string,
  data: string | Uint8Array,
): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(tmpPath, data)
  await fs.rename(tmpPath, filePath)
}
