/**
 * What a deck an import replaces keeps of its front matter. An overwrite
 * replaces a list's cards, not the list: like a collection or wanted list,
 * whose front-matter block survives an overwrite verbatim, a deck keeps every
 * key — its cover, labels default, description, tags, sync link and stamps,
 * and any key the user wrote by hand — except `format`, which every deck
 * import restates. A source states its own `sourceId` / `sourceUrl` over the
 * kept ones (`saveDeck`); the kept `description` wins over a source's.
 */

import { deckFrontMatterFromText, type DeckFrontMatter } from '../list/deck-file'
import { errorParam, syncMessage, type SyncMessage } from '../sync/message'

/**
 * The front matter an import keeps from the deck it replaces (`content`, null
 * when there is no file): everything but `format`. A file whose front matter
 * does not parse is refused rather than replaced as if it had none — what the
 * user set on it would be lost without a word.
 */
export function keptDeckFrontMatter(content: string | null): KeptDeckFrontMatter {
  if (content === null) return { ok: true, frontMatter: {} }
  try {
    const { format: _format, ...frontMatter } = deckFrontMatterFromText(content)
    return { ok: true, frontMatter }
  } catch (error) {
    return {
      ok: false,
      message: syncMessage('domain.import.replacedDeckUnreadable', { reason: errorParam(error) }),
    }
  }
}

/** {@link keptDeckFrontMatter}'s answer: the kept front matter, or why the file is refused. */
export type KeptDeckFrontMatter =
  { ok: true; frontMatter: DeckFrontMatter } | { ok: false; message: SyncMessage }
