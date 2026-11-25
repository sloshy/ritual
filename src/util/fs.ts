import { access, readdir } from 'node:fs/promises'
import path from 'node:path'

/** Returns true if the path exists and is accessible. */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Whether the file's directory lists its name spelled exactly as given. A path
 * lookup ({@link fileExists}) matches any casing on a case-insensitive file
 * system (macOS, Windows), where `atraxa binder.md` "exists" once
 * `Atraxa Binder.md` does; a byte-exact name match must ask the listing.
 */
export async function fileExistsExactly(filePath: string): Promise<boolean> {
  try {
    return (await readdir(path.dirname(filePath))).includes(path.basename(filePath))
  } catch {
    return false
  }
}
