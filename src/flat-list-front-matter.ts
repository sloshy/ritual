/**
 * YAML front matter for the flat list files (collections and wanted lists).
 *
 * Flat lists historically carried no front matter at all — only decks did. A
 * collection's default card labels (`labels: [sale, trade]`) live there now, so
 * the flat parsers skip and capture the block instead of warning on its lines.
 *
 * The design principle is **verbatim round-tripping**: the block's exact text
 * (both `---` fences included) is carried as {@link FlatListFrontMatter.raw}
 * and re-emitted by the whole-file serializers via plain string concatenation.
 * That keeps two promises at once — a hand-authored block (comments, quoting
 * style, unknown keys) survives every save byte for byte, and the browser-side
 * serializers (`collectionToMarkdown` runs in the public editor) never need a
 * YAML dumper. Only the *parse* side touches gray-matter, so this module stays
 * server-only; browser code imports the type alone.
 *
 * Because `raw` round-trips verbatim, nothing about the block can make a file
 * unreadable: a block whose YAML does not parse, or whose `labels:` value is
 * invalid, degrades to an **advisory** (the keys are ignored, the text is
 * preserved), never a whole-file-rewrite-blocking warning.
 */

import { frontMatterBodyStart } from './markdown-fence'
import { readFrontMatterMapping } from './front-matter-write'
import { parseCardLabelsValue, type CardLabel } from './card-labels'

/** A flat list's front-matter block, as parsed from the top of the file. */
export type FlatListFrontMatter = {
  /**
   * The block's verbatim text — both `---` fence lines and a trailing newline
   * included. Serializers re-emit exactly this string.
   */
  raw: string
  /**
   * The parsed YAML mapping, unknown keys included. A copy, never gray-matter's
   * own object (it memoizes by content and hands the same `data` back on a
   * repeat parse). Empty when the YAML could not be read.
   */
  data: Record<string, unknown>
}

/** What {@link parseFlatListFrontMatter} found at the top of a flat list file. */
export type FlatListFrontMatterParse = {
  /** The block, when the file opens with one. */
  frontMatter?: FlatListFrontMatter
  /**
   * The list's default card labels, when `validateLabels` was requested and the
   * block carries a legal non-empty `labels:` value. `labels: []` reads as "no
   * default" (the key still round-trips).
   */
  labels?: CardLabel[]
  /** Index of the first body line: past the block, or 0 when there is none. */
  bodyStart: number
  /**
   * Non-fatal notes about the block — unreadable YAML, an invalid `labels:`
   * value. Advisories rather than warnings on purpose: the raw block
   * round-trips verbatim, so a rewrite loses nothing.
   */
  advisories: string[]
}

export type ParseFlatListFrontMatterOptions = {
  /** Interpret a `labels:` key (collections); off, the block is carried uninterpreted. */
  validateLabels: boolean
}

/**
 * Parse an optional YAML front-matter block from the top of a flat list file's
 * lines. Detection uses {@link frontMatterBodyStart} — the same rule the fence
 * scanners and the `&N` backfill use — so every reader agrees on where the body
 * starts. An unterminated `---` is not front matter (the whole file is body,
 * and the stray lines warn as malformed exactly as before).
 */
export function parseFlatListFrontMatter(
  lines: readonly string[],
  opts: ParseFlatListFrontMatterOptions,
): FlatListFrontMatterParse {
  const bodyStart = frontMatterBodyStart(lines)
  if (bodyStart === 0) return { bodyStart: 0, advisories: [] }

  const raw = lines.slice(0, bodyStart).join('\n') + '\n'
  const advisories: string[] = []
  let data: Record<string, unknown> = {}
  const mapping = readFrontMatterMapping(raw)
  if (mapping.ok) {
    data = mapping.data
  } else if (mapping.reason === 'not-a-mapping') {
    advisories.push(
      'Front matter is not a key/value mapping, so its content was ignored (the block itself is preserved on save).',
    )
  } else {
    advisories.push(
      `Front matter could not be read as YAML, so its keys were ignored (the block itself is preserved on save): ${mapping.detail}`,
    )
  }

  const result: FlatListFrontMatterParse = { frontMatter: { raw, data }, bodyStart, advisories }

  if (opts.validateLabels && 'labels' in data) {
    const labels = parseCardLabelsValue(data.labels, 'labels')
    if (!labels.ok) {
      advisories.push(`Front matter 'labels' ignored: ${labels.message}`)
    } else if (labels.labels.length > 0) {
      result.labels = labels.labels
    }
  }

  return result
}
