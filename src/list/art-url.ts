import type { CardArtRef } from './card-art'

/**
 * How a custom-art reference becomes a URL a page can point an `<img>` at.
 *
 * Browser-safe on purpose: the bakers (`details/*.ts`), the deploy step
 * (`art-deploy.ts`), and the admin editor all have to agree on the one spelling
 * of a file reference's URL, and the editor's half of that runs in the SPA
 * bundle — which cannot import the node-only modules the other two live in.
 */

/** The built site's art directory, relative to the site root. */
export const SITE_ART_DIR = 'art'

/**
 * The site-relative URL a file reference is baked as. Segments are encoded
 * individually so a space or `#` in a file name survives as one path segment.
 */
export function siteArtUrl(relPath: string): string {
  return `${SITE_ART_DIR}/${relPath.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * The URL that displays a reference: a file resolves under `art/`, served by a
 * built site's static tree, `serve --api`'s `/art/*` route, or the admin
 * server's authed one; a URL is used verbatim.
 */
export function cardArtDisplayUrl(ref: CardArtRef): string {
  return 'file' in ref ? siteArtUrl(ref.file) : ref.url
}
