/**
 * Everything a list file files under a card line's `&N`, reconciled in one step
 * after a save rewrote those lines: the `<list>.art.json` custom-art sidecar and
 * the list's own `image:` cover.
 *
 * The two are separate features with separate storage, but they answer the same
 * question — what happened to the id this thing is filed under — from the same
 * inputs, and every path that frees or renumbers an id has to ask both. Asking
 * once, here, is what keeps a caller from remembering only the sidecar: `&N`
 * ids are *reused*, so a cover left behind does not go stale, it silently
 * reappears showing whichever card took the number next.
 */

import { reconcileCardArt, reconciledArtPath, type CardArtReconcileInput } from './card-art'
import type { CardArtReconcileResult } from './card-art'
import { reconcileListImageFile, type ListImageReconcileFileResult } from './list-image-file'

/**
 * What {@link reconcileListRefs} did to both stores.
 *
 * The two results are kept whole rather than merged: each has its own refusal
 * (an unreadable sidecar, an unreadable front matter) that only its own caller
 * knows how to word, and `writtenFiles` is the union both callers stage.
 */
export type ListRefsReconcile = {
  art: CardArtReconcileResult
  image: ListImageReconcileFileResult
  /** Every path either reconcile wrote, deduplicated, for a caller staging them. */
  writtenFiles: string[]
  /**
   * The list file's hash after a cover rewrite, absent when the cover did not
   * move. A caller that just handed a client a hash for this file must hand out
   * this one instead.
   */
  contentHash?: string
}

/**
 * Re-file a list's custom art and re-point its cover after its card ids changed.
 *
 * Runs *after* the card lines are written — both halves read the file back — and
 * writes nothing when the ids did not move. The `added` half of the input means
 * nothing to a single cover and is simply ignored by that half.
 */
export async function reconcileListRefs(
  listFilePath: string,
  input: CardArtReconcileInput,
): Promise<ListRefsReconcile> {
  // Drained once here rather than in each half: `removed` is an iterable, and
  // two consumers reading the same generator would leave the second empty.
  const drained: CardArtReconcileInput = { ...input, removed: new Set(input.removed ?? []) }
  const art = await reconcileCardArt(listFilePath, drained)
  const image = await reconcileListImageFile(listFilePath, drained)

  const writtenFiles = new Set<string>()
  const artPath = reconciledArtPath(art)
  if (artPath !== undefined) writtenFiles.add(artPath)
  if (image.ok && image.changed) for (const file of image.writtenFiles) writtenFiles.add(file)

  return {
    art,
    image,
    writtenFiles: [...writtenFiles],
    ...(image.ok && image.changed ? { contentHash: image.contentHash } : {}),
  }
}
