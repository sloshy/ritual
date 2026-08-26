/**
 * The one body-preserving front-matter writer, shared by every list type.
 *
 * Extracted from the deck path (`writeDeckFrontMatter`) when collections
 * gained front matter (`labels:` defaults), so the two gray-matter hazards and
 * the `.sha256` sidecar rule live exactly once:
 *
 * - **File-object form**, not `matter.stringify(string, …)`: given a string,
 *   gray-matter re-parses it, so a body whose first line is `---` (a
 *   horizontal rule) would be swallowed as a second front-matter block and the
 *   card list silently dropped. `data: {}` is required because stringify does
 *   `Object.assign({}, file.data, data)` — carrying the old data forward would
 *   resurrect exactly the keys a write means to delete.
 * - **Sidecar rule**: the `.sha256` sidecar is only refreshed when it matched
 *   the file *before* this write. A front-matter edit says nothing about card
 *   lines, so stamping the sidecar over an unrecorded hand edit would make
 *   `detect-changes` treat that edit as already recorded and drop its
 *   changelog entries. The returned hash always describes the new content
 *   either way.
 */

import fs from 'node:fs/promises'
import matter from 'gray-matter'
import { computeHash, hashPath, isRitualClean, writeFileWithHash } from '../changes/content-hash'
import { isRecord } from '../util/json'

/** The outcome of reading a front-matter block's YAML as a key/value mapping. */
export type FrontMatterMappingResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: 'not-a-mapping' }
  | { ok: false; reason: 'invalid-yaml'; detail: string }

/**
 * Parse `content`'s YAML front matter as a key/value mapping — the shared
 * parse behind the flat-list reader and the metadata writer, so the two
 * gray-matter read hazards are handled exactly once. `content` may be a whole
 * file or just the block; a file without a block reads as an empty mapping.
 */
export function readFrontMatterMapping(content: string): FrontMatterMappingResult {
  try {
    // Options are load-bearing: gray-matter's option-less path memoizes by
    // content string and caches partial entries even for input it threw on.
    const parsed: unknown = matter(content, { language: 'yaml' }).data
    if (!isRecord(parsed)) return { ok: false, reason: 'not-a-mapping' }
    // Copied, not used in place: gray-matter memoizes by content string and
    // hands the same `data` object back on a repeat parse.
    return { ok: true, data: { ...parsed } }
  } catch (error) {
    const detail = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)
    return { ok: false, reason: 'invalid-yaml', detail }
  }
}

/** What a front-matter write produced: the new content hash and the files it touched. */
export type ListFrontMatterWrite = {
  contentHash: string
  /**
   * The list file, plus its `.sha256` sidecar when that sidecar was refreshed.
   * Callers stage exactly this set, so a sidecar deliberately left stale is not
   * committed as if it had been rewritten.
   */
  writtenFiles: string[]
}

export type WriteListFrontMatterOptions = {
  /**
   * Keep the canonical single blank line between the closing `---` and the
   * body, inserting or trimming one as the block is written or removed. The
   * flat-list paths use this (their canonical serializers emit the blank
   * line, so `cleanup --check` stays clean after a metadata write); the deck
   * path leaves it off to keep its strict body-byte-for-byte contract.
   */
  blankLineAfterBlock?: boolean
}

/**
 * Dump a front-matter mapping to its block text — both `---` fences, trailing
 * newline included — or `undefined` for an empty mapping (no block at all).
 * The in-memory counterpart of {@link writeListFrontMatter}, for callers that
 * hold a file's content themselves (the CLI edit session's deferred save).
 * Same caveat as every metadata write: js-yaml re-dumps the YAML, so comments
 * and quoting style are not preserved.
 */
export function dumpFrontMatterBlock(data: Record<string, unknown>): string | undefined {
  if (Object.keys(data).length === 0) return undefined
  const source: FrontMatterFile = { content: '', data: {} }
  // stringify appends the (empty) content after a separating newline; the raw
  // block ends at the closing fence, exactly as the parse side captures it.
  return matter.stringify(source, data).replace(/\n+$/, '\n')
}

/**
 * Rewrite only a list file's YAML front matter, leaving the markdown body byte
 * for byte as it was (modulo {@link WriteListFrontMatterOptions.blankLineAfterBlock}
 * and a trailing newline gained by a body that lacked one). An empty
 * `frontMatter` removes the block entirely. The YAML is re-dumped by js-yaml —
 * comments and the original quoting style are not preserved, though every key
 * and value the caller passes is.
 */
export async function writeListFrontMatter(
  filePath: string,
  frontMatter: Record<string, unknown>,
  options?: WriteListFrontMatterOptions,
): Promise<ListFrontMatterWrite> {
  const original = await fs.readFile(filePath, 'utf-8')
  const wasRitualClean = await isRitualClean(filePath, original)
  const parsed = matter(original)
  let body = parsed.content
  if (options?.blankLineAfterBlock) {
    const hasBlock = Object.keys(frontMatter).length > 0
    // With a block, the body leads with exactly one blank line; without one,
    // it must not (the file would open with a dangling blank).
    body = hasBlock ? '\n' + body.replace(/^\n+/, '') : body.replace(/^\n+/, '')
  }
  const source: FrontMatterFile = { ...parsed, content: body, data: {} }
  const content = matter.stringify(source, frontMatter)
  if (wasRitualClean) {
    return {
      contentHash: await writeFileWithHash(filePath, content),
      writtenFiles: [filePath, hashPath(filePath)],
    }
  }
  await fs.writeFile(filePath, content)
  return { contentHash: computeHash(content), writtenFiles: [filePath] }
}

/**
 * The parsed-file shape `matter.stringify` reads: the body it re-emits verbatim,
 * the front-matter data it merges the new keys over, and the excerpt it re-emits
 * when one was parsed (always `''` here, since no excerpt option is used).
 */
type FrontMatterFile = { content: string; data: Record<string, unknown>; excerpt?: string }
