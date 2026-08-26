/**
 * Fenced code block tracking for the list-file line parsers.
 *
 * Deck, collection, and wanted-list markdown is hand-authored: a file may carry
 * a fenced code block showing an example card line, a template, or a snippet of
 * shell output. Every line-scanning parser in Ritual would otherwise read those
 * lines as real data — a fenced `1 Sol Ring (LEA:1)` would count as a card, an
 * add would merge copies onto it, the `&N` backfill would stamp an id into it,
 * and the flat parsers would report the surrounding prose as unreadable lines.
 * Feeding every line through a tracker makes fenced content opaque instead.
 *
 * The grammar is a pragmatic subset of CommonMark's fenced code blocks:
 *
 * - An **opening fence** is three or more backticks or three or more tildes,
 *   indented by at most three spaces, optionally followed by an info string. A
 *   backtick fence's info string may not contain a backtick (CommonMark), which
 *   keeps a line like ``a ``` b`` from opening a block.
 * - A **closing fence** uses the same character as the opening one, is at least
 *   as long, and carries nothing but whitespace after it. A shorter run, the
 *   other fence character, or a run followed by an info string is content.
 * - Fences do not nest: tildes inside a backtick fence (and vice versa) are
 *   ordinary content.
 * - An **unclosed fence runs to the end of the file** — CommonMark's rule, and
 *   the conservative one here: everything after a stray ``` is treated as prose
 *   rather than silently becoming card data again.
 * - The fence lines themselves are opaque too, so a delimiter never reads as a
 *   card line, a heading, or an unrecognized line.
 *
 * Deliberately out of scope: inline code spans, indented (four-space) code
 * blocks, and block quotes. Inline spans and block quotes cannot be confused
 * for a card line or a `## Section` header, which both anchor at the start of a
 * trimmed line. Indented code blocks *can* — the line parsers trim before
 * matching, so an indented `1 Sol Ring` still reads as a card and an indented
 * ``` still reads as an unrecognized line. Supporting them is nonetheless out
 * of scope: a four-space indent is indistinguishable from the continuation of a
 * list item, so honouring it would make ordinary nested markdown opaque. Write
 * a fenced block instead — that is the documented way to hold prose card lines.
 */

/** What role a line plays relative to fenced code blocks. */
export type FenceRole = 'outside' | 'open' | 'content' | 'close'

/**
 * A single line's fence classification, as reported by {@link FenceTracker.feed}.
 *
 * Readonly because {@link createFenceTracker} returns a shared singleton for the
 * common `outside` case — mutating a returned state would poison every later
 * result in the process.
 */
export type FenceState = {
  /**
   * True when the line is not list data: fenced content, or a fence delimiter.
   * Equivalent to `role !== 'outside'`, named separately because that is the
   * only question most callers actually ask.
   */
  readonly opaque: boolean
  /**
   * Which part of a fenced block the line is. Diagnostic detail: the mutation
   * paths key off {@link FenceState.opaque}, and `role` distinguishes the
   * delimiters from their content for callers that need to insert around a
   * block rather than inside it.
   */
  readonly role: FenceRole
}

/** A line-at-a-time fence scanner. Lines must be fed in file order, all of them. */
export type FenceTracker = {
  /** Classify the next line, advancing the tracker's state. */
  feed(line: string): FenceState
  /**
   * True when the tracker is currently inside an open fence. After the last
   * line of a file this means the file ends inside an unclosed fence, so text
   * appended at the end would land in the opaque region — see
   * {@link endsInsideOpenFence}.
   */
  readonly isOpen: boolean
}

/** A run of three or more backticks or tildes, indented at most three spaces. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/

const OUTSIDE: FenceState = Object.freeze({ opaque: false, role: 'outside' })

type OpenFence = { char: string; length: number }

/**
 * Create a fence tracker. Every line of the scanned text must be fed in order —
 * skipping lines (blank ones included) would let a fence delimiter go unseen.
 */
export function createFenceTracker(): FenceTracker {
  let open: OpenFence | null = null

  return {
    get isOpen(): boolean {
      return open !== null
    },
    feed(line: string): FenceState {
      const match = FENCE_RE.exec(line)
      const marker = match?.[1]
      const info = match?.[2] ?? ''

      if (open === null) {
        if (marker === undefined) return OUTSIDE
        const char = marker[0]!
        // CommonMark: a backtick fence's info string may not contain a backtick.
        if (char === '`' && info.includes('`')) return OUTSIDE
        open = { char, length: marker.length }
        return { opaque: true, role: 'open' }
      }

      if (
        marker !== undefined &&
        marker[0] === open.char &&
        marker.length >= open.length &&
        info.trim() === ''
      ) {
        open = null
        return { opaque: true, role: 'close' }
      }
      return { opaque: true, role: 'content' }
    },
  }
}

/**
 * The index of the first body line: past a deck's YAML front matter when the
 * content opens with one, 0 otherwise. An unterminated `---` block is not front
 * matter — gray-matter treats the whole file as body, and so does this.
 *
 * Fence scans start here so a ``` inside a front-matter string (a deck
 * `description:` block scalar, say) cannot open a fence over the whole body.
 */
export function frontMatterBodyStart(lines: readonly string[]): number {
  if (lines[0]?.trim() !== '---') return 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') return i + 1
  }
  return 0
}

/**
 * True when `content` ends inside an unclosed fence, i.e. text appended to the
 * end of the file would land in the opaque region and be invisible to every
 * parser. The append paths (`add-card`, `move` destinations) refuse rather than
 * write a card line nobody can read back.
 */
export function endsInsideOpenFence(content: string): boolean {
  const lines = content.split('\n')
  const tracker = createFenceTracker()
  for (let i = frontMatterBodyStart(lines); i < lines.length; i++) {
    tracker.feed(lines[i]!)
  }
  return tracker.isOpen
}

/**
 * Classify each line of `lines` in one pass: `true` where the line is fenced
 * content or a fence delimiter. Lines before `startIndex` (a deck's YAML front
 * matter, say) are never fenced and do not feed the tracker.
 *
 * This is the random-access form the line-preserving mutation paths need: they
 * scan the same array repeatedly by index and rebuild it between scans.
 */
export function markFencedLines(lines: readonly string[], startIndex = 0): boolean[] {
  const tracker = createFenceTracker()
  const flags: boolean[] = new Array(lines.length).fill(false)
  for (let i = Math.max(0, startIndex); i < lines.length; i++) {
    flags[i] = tracker.feed(lines[i]!).opaque
  }
  return flags
}

/**
 * The shape every list parse result exposes for the "would a whole-file
 * re-serialize lose something?" question.
 */
export type ParsedListContent = {
  /** Lines the parser could not read at all. */
  warnings: readonly string[]
  /** Lines belonging to fenced code blocks (delimiters included). */
  fencedLines: number
}

/**
 * Everything a whole-file re-serialize would delete from a parsed list file:
 * the parser's skipped lines, plus a single line accounting for fenced code
 * blocks.
 *
 * Fenced content is prose to the parsers — it produces no per-line warnings, is
 * never a mutation target, and survives every line-preserving edit untouched.
 * The canonical serializers, however, emit only sections and card lines, so a
 * route that rewrites a whole file from parsed entries would drop the block.
 * The gates that refuse such a rewrite (admin saves, `cleanup`, the sync
 * engines) key off this list rather than `warnings` alone.
 */
export function unreadableLines(parsed: ParsedListContent): string[] {
  const lines = [...parsed.warnings]
  if (parsed.fencedLines > 0) {
    lines.push(
      `Fenced code block content (${parsed.fencedLines} line(s)) — read as prose, but a whole-file rewrite would delete it`,
    )
  }
  return lines
}

/**
 * The refusal text every whole-file-rewrite gate shares.
 *
 * Deliberately not a line count: {@link unreadableLines} collapses a whole
 * fenced block into one entry, so `lines.length` is a count of *problems*, not
 * of lines — each entry states its own extent.
 *
 * @param filePath The list file, named so the fix is obvious.
 * @param lines The result of {@link unreadableLines}; must be non-empty.
 * @param gerund What the caller was about to do, e.g. `saving`, `moving`.
 */
export function unreadableContentMessage(
  filePath: string,
  lines: readonly string[],
  gerund: string,
): string {
  return (
    `${filePath} holds content the parser cannot re-emit, and ${gerund} would delete it ` +
    `(releasing any &N ids it carries). Fix the file first — ${lines.join('; ')}`
  )
}
