/**
 * Linking a local deck to a deck that already exists on Archidekt.
 *
 * `deck-sync push` only operates on decks whose front matter carries
 * `sourceUrl` + `sourceId`, which until now only `import`/`import-account`
 * produced. Linking writes exactly those two keys — through the shared
 * front-matter writer every metadata surface uses ({@link applyDeckMetadata}),
 * so the deck's body, prose, and `&N` card ids are preserved byte for byte.
 *
 * Creating a *new* deck on Archidekt is deliberately not here: Archidekt exposes
 * no deck-creation endpoint Ritual can call, so the remote deck has to exist
 * first.
 */

import { applyDeckMetadata } from '../list/deck-metadata'
import { matchDeckUrl, resolveImportSourceUrl } from '../importers/url-dispatch'
import { parseDeckFrontMatter } from '../list/deck-file'

/** An Archidekt deck reference, as deck front matter records one. */
export type ArchidektDeckLink = {
  sourceId: string
  /** Canonical deck URL — the spelling `import` writes, whatever the user pasted. */
  sourceUrl: string
}

/**
 * Parse a user-supplied Archidekt deck URL into the front-matter fields that
 * link a deck, or return the message explaining why it is not one.
 *
 * A scheme-less `archidekt.com/decks/123` is accepted (the same normalization
 * `import` applies), and any trailing deck slug is dropped: the id is what the
 * sync addresses, so the stored URL is canonicalized rather than kept verbatim.
 */
export function parseArchidektDeckUrl(value: string): ArchidektDeckLink | string {
  const trimmed = value.trim()
  if (trimmed === '') return 'An Archidekt deck URL is required.'

  const url = resolveImportSourceUrl(trimmed) ?? trimmed
  const match = matchDeckUrl(url)
  if (!match || match.service !== 'archidekt') {
    return `"${trimmed}" is not an Archidekt deck URL. Expected something like https://archidekt.com/decks/123456.`
  }
  return { sourceId: match.deckId, sourceUrl: `https://archidekt.com/decks/${match.deckId}` }
}

/** The two front-matter fields a source link is made of, as stored YAML spells them. */
export type DeckSourceFields = {
  sourceId?: unknown
  sourceUrl?: unknown
}

/**
 * Whether a deck's front matter names a coherent Archidekt link, or the message
 * saying why it does not.
 *
 * `deck-sync` addresses the remote deck by `sourceId` but every surface *shows*
 * the user `sourceUrl`, so a pair naming two different decks pushes one deck's
 * cards to another deck while reporting the wrong one. {@link
 * parseArchidektDeckUrl} cannot produce such a pair — it derives both fields
 * from one id — but the metadata API accepts the two fields independently, so
 * the rule is enforced on the merged front matter every writer goes through.
 *
 * Only Archidekt URLs are constrained: a deck imported from another service
 * carries whatever `sourceId` that service uses, which no URL here can predict.
 */
export function checkArchidektLink(frontMatter: DeckSourceFields): string | null {
  const { sourceId, sourceUrl } = frontMatter
  if (typeof sourceUrl !== 'string' || typeof sourceId !== 'string') return null
  const match = matchDeckUrl(resolveImportSourceUrl(sourceUrl) ?? sourceUrl)
  if (!match || match.service !== 'archidekt') return null
  if (match.deckId === sourceId) return null
  return (
    `sourceUrl names Archidekt deck ${match.deckId} but sourceId is ${sourceId}. ` +
    'A sync addresses the deck by sourceId, so the two must name the same deck.'
  )
}

/** What a deck was linked to before, when it was linked to anything. */
export type PreviousDeckLink = {
  sourceId?: string
  sourceUrl?: string
}

/** The outcome of linking one deck. */
export type DeckLinkResult = {
  /** File basename without `.md`. */
  slug: string
  /** The deck's display name, as its front matter records it. */
  name: string
  sourceId: string
  sourceUrl: string
  /** The link the deck already carried, or null when it carried none. */
  previous: PreviousDeckLink | null
  /** True when nothing was written. */
  dryRun: boolean
  /** Files the write touched — the deck and its `.sha256` sidecar; empty on a dry run. */
  writtenFiles: string[]
}

export type LinkDeckOptions = {
  filePath: string
  slug: string
  link: ArchidektDeckLink
  dryRun: boolean
}

/**
 * Write the Archidekt link into a deck's front matter, reporting what it
 * replaced. A dry run reads the existing front matter and reports the same
 * result without writing anything.
 */
export async function linkDeckToArchidekt(options: LinkDeckOptions): Promise<DeckLinkResult> {
  const { filePath, slug, link, dryRun } = options
  const existing = await parseDeckFrontMatter(filePath)
  const name = typeof existing.name === 'string' ? existing.name : slug
  const previousId = typeof existing.sourceId === 'string' ? existing.sourceId : undefined
  const previousUrl = typeof existing.sourceUrl === 'string' ? existing.sourceUrl : undefined
  const previous: PreviousDeckLink | null =
    previousId === undefined && previousUrl === undefined
      ? null
      : {
          ...(previousId !== undefined && { sourceId: previousId }),
          ...(previousUrl !== undefined && { sourceUrl: previousUrl }),
        }

  const result: DeckLinkResult = {
    slug,
    name,
    sourceId: link.sourceId,
    sourceUrl: link.sourceUrl,
    previous,
    dryRun,
    writtenFiles: [],
  }
  if (dryRun) return result

  // The pair is derived from one deck id, so `checkArchidektLink` cannot refuse
  // it — passing it anyway keeps the one write path validating for every caller
  // rather than trusting each to have built a coherent pair.
  const write = await applyDeckMetadata(
    filePath,
    { sourceId: link.sourceId, sourceUrl: link.sourceUrl },
    checkArchidektLink,
  )
  if (typeof write === 'string') throw new Error(write)
  return { ...result, writtenFiles: write.writtenFiles }
}
