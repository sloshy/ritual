/**
 * Single-line text: what a card line, a heading, and a changelog prose line can
 * hold. List files and changelogs are line-oriented, so a value holding a line
 * break is not one line of text but several — interpolated raw, it writes the
 * rest of itself as real lines (a forged card line with its own `&N`, a
 * `## <timestamp>` changelog page). Two answers live here:
 *
 * - {@link singleLineText} folds, for display names that may be adjusted the way
 *   a file name is sanitized (list titles, section headings).
 * - {@link hasLineBreak} / {@link findLineBreak} detect, for boundaries that
 *   must refuse instead: a card name is identity, so folding it would quietly
 *   write a different card.
 *
 * Browser-safe (no imports).
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
 * A line terminator any reader of a list file, a changelog, or a CSV could split
 * on: LF, CR, VT, FF, NEL, U+2028, U+2029. Narrower than the fold's
 * {@link LINE_BREAK} on purpose: detection refuses, and a tab or other control
 * character cannot forge a line — refusing one would only make an existing
 * changelog event carrying it undecodable.
 */
const LINE_TERMINATOR = /[\n\r\v\f\x85\u2028\u2029]/u

/** Whether `text` spans more than one line for any line-oriented reader. */
export function hasLineBreak(text: string): boolean {
  return LINE_TERMINATOR.test(text)
}

/**
 * The path of the first string inside `value` holding a line terminator, or
 * null when every string is single-line. Walks arrays and plain objects, so an
 * unvalidated request body is checked whole — a field added to a change event
 * later is covered without being listed here.
 *
 * Meant for JSON-parsed input (no cycles). Iterative, so a hostile body nested
 * millions deep is refused like any other rather than overflowing the stack.
 * `path` names `value` itself; nested paths extend it as `changes[2].cardName`.
 */
export function findLineBreak(value: unknown, path: string): string | null {
  const pending: Array<[unknown, string]> = [[value, path]]
  while (pending.length > 0) {
    const [item, itemPath] = pending.pop()!
    if (typeof item === 'string') {
      if (hasLineBreak(item)) return itemPath
    } else if (Array.isArray(item)) {
      // Pushed in reverse so the first offender in document order is reported.
      for (let index = item.length - 1; index >= 0; index--) {
        pending.push([item[index], `${itemPath}[${index}]`])
      }
    } else if (typeof item === 'object' && item !== null) {
      const entries = Object.entries(item)
      for (let index = entries.length - 1; index >= 0; index--) {
        const [key, child] = entries[index]!
        pending.push([child, `${itemPath}.${key}`])
      }
    }
  }
  return null
}
