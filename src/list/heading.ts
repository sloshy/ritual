/**
 * The one way a list file's `# Title` and `## Section` headings are written.
 *
 * A heading is a single line, but the text it carries comes from places that do
 * not promise that: a deck name or section posted to the admin API, a remote
 * deck's name or category from an importer, a `--section` flag. Interpolated
 * raw, a name holding a line break writes the rest of itself as real lines —
 * a card line with a forged `&N`, or a section header the parser then files
 * cards under. Folding every line break and control character to a space here
 * makes that impossible by construction, whichever surface the text came from.
 *
 * Browser-safe (no imports) so the site-side serializers share it.
 */

/** A character that ends a line: any control character (C0, DEL and C1 — so `\n`, `\r`, NEL) or U+2028/U+2029. */
const LINE_BREAK = /[\p{Cc}\u2028\u2029]/u

/**
 * A maximal run of whitespace and control characters. Folding whole runs, and
 * only those holding a break, keeps `"Foo \r\n Bar"` to one space while leaving
 * ordinary spacing byte-for-byte alone — and matches in linear time, where a
 * `\s*` on either side of the break would backtrack quadratically over a long
 * run of spaces in a hostile name.
 */
const SPACE_RUN = /[\s\p{Cc}]+/gu

/** `text` with every line break and control character folded to a single space. */
export function singleLineText(text: string): string {
  return text.replace(SPACE_RUN, (run) => (LINE_BREAK.test(run) ? ' ' : run))
}

/**
 * The name a heading carries, exactly as `parseHeading` reads it back: folded
 * to one line and trimmed. Compare a requested section against headings read
 * off disk in this form, or a name with a stray break never matches the very
 * heading it wrote.
 */
export function headingName(text: string): string {
  return singleLineText(text).trim()
}

/** A list's `# Title` line. */
export function titleHeading(title: string): string {
  return `# ${headingName(title)}`
}

/** A list's `## Section` line. */
export function sectionHeading(section: string): string {
  return `## ${headingName(section)}`
}
