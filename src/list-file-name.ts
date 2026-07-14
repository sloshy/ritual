/**
 * The one place a list's display name becomes a file name.
 *
 * A list file is named as the user entered it — case, spaces, and punctuation are
 * kept, so "Winota Stax" is `Winota Stax.md`, not `winota-stax.md`. Only the
 * characters common file systems reject are removed. Every surface that creates a
 * deck, collection, or wanted list (the CLI, the editors, imports, the admin site)
 * names the file through this, so the same name always lands in the same place.
 *
 * This module is browser-safe (no node imports) so the admin site can preview the
 * exact file name the server will write.
 */

/**
 * Strip the characters that are illegal in a file name on Windows, macOS, or
 * Linux, leaving the rest of the name as entered.
 *
 * Returns **null** when nothing usable is left (a name of only illegal characters,
 * e.g. `"???"`), rather than an empty string: under `strictNullChecks` that forces
 * every caller to decide what to do about it instead of quietly naming a file
 * `.md`.
 */
export function sanitizeListFileName(name: string): string | null {
  const safeName = name
    .trim()
    // Reserved on Windows (`\ / : * ? " < > |`), plus the path separator and the
    // null byte, which no file system accepts.
    // eslint-disable-next-line no-control-regex -- null byte is intentional: strips filename-illegal chars.
    .replace(/[/\\:*?"<>|\x00]/g, '')
    // `..` would be a path traversal; leading/trailing dots are hidden files or
    // are silently trimmed by Windows.
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .trim()
  return safeName === '' ? null : safeName
}

/** True when `name` still has usable characters once sanitized. */
export function isUsableFileName(name: string): boolean {
  return sanitizeListFileName(name) !== null
}

/** A list's file name, including the `.md` extension. Null when `name` is unusable. */
export function listFileName(name: string): string | null {
  const safeName = sanitizeListFileName(name)
  return safeName === null ? null : `${safeName}.md`
}

/**
 * The message every surface uses when it refuses a name it cannot make a file
 * name out of, so the CLI, the editors, and the admin API say the same thing.
 */
export function unusableFileNameMessage(name: string): string {
  return `'${name}' contains no characters usable in a file name.`
}
