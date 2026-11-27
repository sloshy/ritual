/**
 * The display name of a list: its first `# H1`, falling back to the file slug.
 * The one rule for all three list types, applied to content already in hand —
 * so a reader that has the file's text never reads it again to name it.
 */

import { listSlug, titleNamesFile } from './list-file-name'
import { parseTitleFromContent } from './section-format'

/** A list's display name from its content: the `# Title`, else the slug of `filePath`. */
export function listDisplayNameFromContent(content: string, filePath: string): string {
  return parseTitleFromContent(content) ?? listSlug(filePath)
}

/**
 * The title a write that replaces the list at `filePath` gives it. A list's
 * title and its file name are one name, so the replacement keeps the file's
 * name: `requested` when it names that file (`Burn?` for `Burn.md`), else the
 * title the file already has when that one does, else the file's own name — an
 * import of `trade binder` over `Trade Binder.md` stays `Trade Binder`.
 */
export function replacementTitle(
  requested: string,
  filePath: string,
  existingContent: string | null,
): string {
  const slug = listSlug(filePath)
  if (titleNamesFile(requested, slug)) return requested
  const existing = existingContent === null ? null : parseTitleFromContent(existingContent)
  return existing !== null && titleNamesFile(existing, slug) ? existing : slug
}
