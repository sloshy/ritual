/**
 * The disk side of a list's cover image: reading the `image:` key straight out
 * of a list file, and rewriting it in place.
 *
 * Split from `list-image.ts` because gray-matter and `node:fs` live here and
 * that module is bundled into both SPAs. Every rule about what an `image:` value
 * may be stays there; this module only moves the value between the grammar and
 * the file.
 */

import fs from 'node:fs/promises'
import { parseCardIdsFromContent } from '../card/card-id'
import { getErrorMessage } from '../util/errors'
import { readFrontMatterMapping, writeListFrontMatter } from './front-matter-write'
import {
  isListImageCardRef,
  readListImage,
  reconcileListImageRef,
  serializeListImageRef,
  type ListImageRead,
  type ListImageReconcileInput,
  type ListImageRef,
} from './list-image'

/**
 * Read a list file's cover override by path — for callers holding nothing but
 * the path and wanting nothing but the cover (the art deployer, the reconcile
 * wrapper). A file that cannot be read, or whose front matter is not a mapping,
 * reads as no cover with an advisory: this is a display detail, and refusing to
 * load a list over it would be out of proportion.
 */
export async function readListImageFile(listFilePath: string): Promise<ListImageRead> {
  let content: string
  try {
    content = await fs.readFile(listFilePath, 'utf-8')
  } catch (error) {
    return {
      advisory: `The list file could not be read, so any list image it names was ignored: ${getErrorMessage(error)}`,
    }
  }
  const mapping = readFrontMatterMapping(content)
  if (!mapping.ok) {
    return {
      advisory:
        mapping.reason === 'not-a-mapping'
          ? 'Front matter is not a key/value mapping, so any list image it names was ignored.'
          : `Front matter could not be read as YAML, so any list image it names was ignored: ${mapping.detail}`,
    }
  }
  return readListImage(mapping.data)
}

/** The paths {@link writeListImage} touched, for a caller staging its own writes. */
export type ListImageWrite = {
  /** The list file, plus its `.sha256` sidecar when the write refreshed it. */
  writtenFiles: string[]
  /**
   * The file's hash after the write. A caller holding a concurrency token for
   * this file (the admin save routes) has to hand this one out instead, or the
   * client's next save 409s against the rewrite this reconcile just performed.
   */
  contentHash: string
}

/**
 * Rewrite a list file's `image:` key, leaving every other key and the whole body
 * alone. `null` removes the key.
 *
 * Returns an error string — and writes nothing — when the existing front matter
 * cannot be read as a YAML mapping, exactly as the metadata writers do: a merge
 * over keys we cannot see would clobber them. On success, the written paths
 * include the `.sha256` sidecar only when {@link writeListFrontMatter} refreshed
 * it, so a caller staging the result never commits a deliberately stale sidecar.
 *
 * `blankLineAfterBlock` is on for every list type, decks included: a canonically
 * written deck already has that blank line (its serializer emits one), so the
 * option only normalizes a hand-authored file that lacked it — cheaper than
 * teaching this writer which type of list it was handed.
 */
export async function writeListImage(
  listFilePath: string,
  image: ListImageRef | null,
): Promise<ListImageWrite | string> {
  const original = await fs.readFile(listFilePath, 'utf-8')
  const mapping = readFrontMatterMapping(original)
  if (!mapping.ok) {
    const problem =
      mapping.reason === 'not-a-mapping'
        ? 'is not a key/value mapping'
        : 'could not be read as YAML'
    return `The file's front matter ${problem}, so a list image write would overwrite it. Fix the block by hand first.`
  }
  const data = { ...mapping.data }
  if (image === null) delete data.image
  else data.image = serializeListImageRef(image)

  const { writtenFiles, contentHash } = await writeListFrontMatter(listFilePath, data, {
    blankLineAfterBlock: true,
  })
  return { writtenFiles, contentHash }
}

/** What {@link reconcileListImageFile} did: nothing, a write, or a refusal. */
export type ListImageReconcileFileResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; writtenFiles: string[]; contentHash: string }
  | { ok: false; message: string }

/**
 * Re-point (or clear) a list file's `card`-mode cover after the save that
 * rewrote its card lines, writing the front matter only when the reference
 * actually moved.
 *
 * Runs *after* the card lines are written, exactly like `reconcileCardArt`:
 * both answer the same question — what happened to the `&N` this thing is filed
 * under — and both would otherwise be reasoning about a file that no longer
 * says what they think it does. A front matter this cannot read is reported
 * rather than thrown: the cover is a display detail, and refusing a save that
 * already landed would be out of proportion.
 */
export async function reconcileListImageFile(
  listFilePath: string,
  input: ListImageReconcileInput,
): Promise<ListImageReconcileFileResult> {
  // Drained up front: `removed` is an iterable, and reading it twice (once to
  // decide there is work, once to do it) would exhaust a generator.
  const removed = new Set(input.removed ?? [])
  const nothingToDo =
    removed.size === 0 && (input.renumbered === undefined || input.renumbered.size === 0)
  // Short-circuited before the read: most saves change no ids at all, and a
  // list with no cover at all is the common case besides.
  if (nothingToDo) return { ok: true, changed: false }

  const current = await readListImageFile(listFilePath)
  if (current.image === undefined || !isListImageCardRef(current.image)) {
    return { ok: true, changed: false }
  }
  const reconciled = reconcileListImageRef(current.image, { ...input, removed })
  if (!reconciled.changed) return { ok: true, changed: false }

  const written = await writeListImage(listFilePath, reconciled.image)
  if (typeof written === 'string') return { ok: false, message: written }
  return { ok: true, changed: true, ...written }
}

/**
 * Verify a `card`-mode cover against the file it is about to be written to,
 * returning the message refusing it or `null` when there is nothing to check.
 *
 * A cover naming an `&N` is only meaningful alongside the line carrying that id,
 * and both live in the same file — so its validity is transactionally knowable
 * here and a stale id is always a mistake, worth a refusal rather than a cover
 * that silently reads as the default forever. A `file` reference deliberately
 * gets no such check: it names an asset the user may add later, exactly as the
 * custom-art surfaces already accept, and a missing one is a build-time warning.
 *
 * The ids are read from the file's own lines ({@link parseCardIdsFromContent}),
 * which is the one reader that works for a deck and a flat list alike. Lives
 * here rather than at the admin route so the CLI shares the rule without
 * depending on the HTTP layer.
 */
export async function checkListImageCardId(
  listFilePath: string,
  image: ListImageRef | null | undefined,
): Promise<string | null> {
  if (image === null || image === undefined || !isListImageCardRef(image)) return null
  const ids = parseCardIdsFromContent(await fs.readFile(listFilePath, 'utf-8'))
  if (ids.includes(image.card)) return null
  return `image references card &${image.card}, which is not a card in this list.`
}
