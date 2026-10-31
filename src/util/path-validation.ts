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

/** Whether the platform's usual file system compares names without case. */
export function namesIgnoreCase(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/**
 * Whether `child` is `parent` or lies inside it, by path (both resolved). A
 * name that merely starts with two dots (`..cache`) is inside. On a platform
 * whose file system ignores case, names compare without case — erring
 * towards "inside" on a case-sensitive volume there.
 */
export function isSameOrWithin(
  child: string,
  parent: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const fold = (value: string): string =>
    namesIgnoreCase(platform) ? path.resolve(value).toLowerCase() : path.resolve(value)
  const relative = path.relative(fold(parent), fold(child))
  if (relative === '') return true
  if (path.isAbsolute(relative)) return false
  return relative !== '..' && !relative.startsWith(`..${path.sep}`)
}
