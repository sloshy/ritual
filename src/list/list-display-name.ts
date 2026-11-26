/**
 * The display name of a list: its first `# H1`, falling back to the file slug.
 * The one rule for all three list types, applied to content already in hand —
 * so a reader that has the file's text never reads it again to name it.
 */

import { listSlug } from './list-file-name'
import { parseTitleFromContent } from './section-format'

/** A list's display name from its content: the `# Title`, else the slug of `filePath`. */
export function listDisplayNameFromContent(content: string, filePath: string): string {
  return parseTitleFromContent(content) ?? listSlug(filePath)
}
