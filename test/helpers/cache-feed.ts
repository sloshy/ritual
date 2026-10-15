/**
 * A synthetic cache feed (`src/cache/feed.ts`): the feed document and the bytes
 * of each artifact it lists, consistent with each other — the length, the
 * SHA-256 the client verifies, and the file and torrent URLs under one origin.
 * Suites serve it however they reach the client: a `MockHttpClient`, or a
 * loopback server the binary downloads from.
 */

import { FEED_VERSION, type CacheFeedDocument, type CacheFeedEntry } from '../../src/cache/feed'

/** One artifact the feed publishes. */
export type FeedArtifact = { kind: CacheFeedEntry['kind']; fileName: string; body: Uint8Array }

/** A built feed: its document, and each artifact's bytes by the URL the document gives it. */
export type BuiltCacheFeed = { feed: CacheFeedDocument; files: Map<string, Uint8Array> }

/** Build a feed publishing `artifacts` under `origin`, every timestamp `stamp`. */
export function buildCacheFeed(
  origin: string,
  artifacts: readonly FeedArtifact[],
  stamp: string,
): BuiltCacheFeed {
  const entries: CacheFeedEntry[] = []
  const files = new Map<string, Uint8Array>()
  for (const { kind, fileName, body } of artifacts) {
    const sha256 = new Bun.CryptoHasher('sha256').update(body).digest('hex')
    const infoHash = sha256.slice(0, 40)
    const fileUrl = `${origin}/files/${fileName}`
    entries.push({
      kind,
      fileName,
      infoHash,
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
      length: body.byteLength,
      sha256,
      scryfallUpdatedAt: stamp,
      publishedAt: stamp,
      fileUrl,
      torrentUrl: `${origin}/torrents/${infoHash}.torrent`,
    })
    files.set(fileUrl, body)
  }
  return { feed: { version: FEED_VERSION, generatedAt: stamp, entries }, files }
}
