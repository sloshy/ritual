/**
 * Extract the H1 title from a markdown document.
 * Returns `undefined` if no H1 heading is found.
 */
export function extractMarkdownTitle(content: string): string | undefined {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim()
}
