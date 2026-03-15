import path from 'node:path'

/**
 * Check whether a resolved file path stays strictly within the given base directory.
 * Prevents path traversal attacks (e.g., `../../etc/passwd`).
 */
export function isPathWithinDir(filePath: string, baseDir: string): boolean {
  const resolved = path.resolve(filePath)
  const resolvedBase = path.resolve(baseDir)
  return resolved.startsWith(resolvedBase + path.sep)
}
