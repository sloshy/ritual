/**
 * Terminal display width.
 *
 * `String.prototype.length` counts UTF-16 code units, so it over-counts astral
 * characters, over-counts combining marks and emoji sequences, and *under*-
 * counts East Asian wide characters — which occupy two terminal columns. Every
 * column-aligned table in the CLI is therefore misaligned the moment a card
 * name is Japanese, and `[ja]` card-language support already puts such names
 * into those columns. This is a present bug, not a hypothetical one.
 *
 * Width is computed over grapheme clusters (`Intl.Segmenter`) so an emoji ZWJ
 * sequence or a base letter plus combining marks counts once, using a compact
 * East-Asian-Wide range table rather than a `string-width` dependency.
 *
 * Browser-safe: no `node:` imports.
 */

import { DEFAULT_LOCALE } from './constants'
import { segmenter } from './format'

/** Grapheme segmentation is locale-independent; the tag is pinned so the lint rule is satisfied. */
const GRAPHEME_LOCALE = DEFAULT_LOCALE

/**
 * East Asian Wide (W) and Fullwidth (F) code point ranges, inclusive. Compact
 * on purpose: the CJK, Hangul, Kana and fullwidth-forms blocks plus the emoji
 * blocks that render double-width in every terminal that supports them.
 */
export const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  // Emoji that predate the astral emoji blocks and are still Wide: watch,
  // hourglass, zodiac, weather, sports, marks. Scattered singletons, so they
  // are listed rather than approximated by one broad range.
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols and punctuation
  [0x3041, 0x33ff], // Kana, Bopomofo, Hangul Compatibility Jamo, CJK compatibility
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f004, 0x1f004], // Mahjong tile red dragon
  [0x1f0cf, 0x1f0cf], // Playing card black joker
  [0x1f18e, 0x1f18e], // Negative squared AB
  [0x1f191, 0x1f19a], // Squared CL through VS
  [0x1f200, 0x1f2ff], // Enclosed ideographic supplement
  [0x1f300, 0x1f64f], // Misc symbols and pictographs, emoticons
  [0x1f680, 0x1f6ff], // Transport and map symbols
  [0x1f7e0, 0x1f7eb], // Colored circles and squares
  [0x1f900, 0x1f9ff], // Supplemental symbols and pictographs
  [0x1fa70, 0x1faff], // Symbols and pictographs extended-A
  [0x20000, 0x3fffd], // CJK Unified Ideographs Extensions B and beyond
]

/**
 * Zero-width code point ranges: combining marks, variation selectors, and the
 * format characters used to glue emoji sequences together. A grapheme cluster
 * that *starts* with one of these contributes nothing.
 */
export const ZERO_WIDTH_RANGES: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f], // Combining diacritical marks
  [0x0483, 0x0489], // Combining Cyrillic
  [0x0591, 0x05bd], // Hebrew points
  [0x0610, 0x061a], // Arabic marks
  [0x064b, 0x065f], // Arabic marks
  [0x0e31, 0x0e31], // Thai vowel sign mai han akat
  [0x0e34, 0x0e3a], // Thai above/below vowels
  [0x1ab0, 0x1aff], // Combining diacritical marks extended
  [0x1dc0, 0x1dff], // Combining diacritical marks supplement
  [0x200b, 0x200f], // Zero-width space, ZWNJ, ZWJ, directional marks
  [0x2060, 0x2064], // Word joiner, invisible operators
  [0x20d0, 0x20f0], // Combining marks for symbols
  [0xfe00, 0xfe0f], // Variation selectors
  [0xfe20, 0xfe2f], // Combining half marks
  [0xfeff, 0xfeff], // Zero-width no-break space
]

function inRanges(cp: number, ranges: readonly (readonly [number, number])[]): boolean {
  for (const [start, end] of ranges) {
    if (cp < start) return false
    if (cp <= end) return true
  }
  return false
}

/** Columns one grapheme cluster occupies: 0 for marks, 2 for wide characters, else 1. */
function clusterWidth(cluster: string): number {
  const cp = cluster.codePointAt(0)
  if (cp === undefined) return 0
  // C0/C1 controls occupy no column (a stray \n in a cell is a caller bug, not a width).
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (inRanges(cp, ZERO_WIDTH_RANGES)) return 0
  return inRanges(cp, WIDE_RANGES) ? 2 : 1
}

/** The number of terminal columns a string occupies. */
export function displayWidth(text: string): number {
  let width = 0
  for (const { segment } of segmenter(GRAPHEME_LOCALE, { granularity: 'grapheme' }).segment(text)) {
    width += clusterWidth(segment)
  }
  return width
}

/**
 * Pad on the right to a column count. The display-width analogue of
 * `String.prototype.padEnd`, which counts code units and so under-pads any cell
 * holding a Japanese card name.
 */
export function padEndDisplay(text: string, columns: number, fill: string = ' '): string {
  return text + padding(displayWidth(text), columns, fill)
}

/** Pad on the left to a column count. The display-width analogue of `padStart`. */
export function padStartDisplay(text: string, columns: number, fill: string = ' '): string {
  return padding(displayWidth(text), columns, fill) + text
}

function padding(width: number, columns: number, fill: string): string {
  const fillWidth = displayWidth(fill)
  if (fillWidth <= 0) return ''
  let out = ''
  let current = width
  while (current + fillWidth <= columns) {
    out += fill
    current += fillWidth
  }
  return out
}

/**
 * Truncate to a column budget, appending `ellipsis` when anything was dropped.
 * Cuts on grapheme boundaries, so an emoji sequence is kept or dropped whole.
 */
export function truncateToWidth(text: string, columns: number, ellipsis: string = '…'): string {
  if (displayWidth(text) <= columns) return text
  const budget = columns - displayWidth(ellipsis)
  if (budget <= 0) return ''
  let out = ''
  let width = 0
  for (const { segment } of segmenter(GRAPHEME_LOCALE, { granularity: 'grapheme' }).segment(text)) {
    const next = clusterWidth(segment)
    if (width + next > budget) break
    out += segment
    width += next
  }
  return out + ellipsis
}
