import createTorrent from 'create-torrent'
import parseTorrent, { toMagnetURI } from 'parse-torrent'

/** The torrent artifacts derived from one feed file. */
export type CreatedTorrent = {
  buffer: Uint8Array
  infoHash: string
  magnet: string
  length: number
}

/**
 * Build a single-file torrent for `filePath` with `webSeedUrl` as its BEP 19
 * web seed, so downloads complete over plain HTTPS even with zero peers.
 * `creationDate` must be supplied (rather than defaulting to "now") so the
 * info hash is a pure function of file content + name — re-running the host
 * over unchanged data reproduces the same torrent.
 */
export async function createFileTorrent(
  filePath: string,
  webSeedUrl: string,
  creationDate: Date,
): Promise<CreatedTorrent> {
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    createTorrent(
      filePath,
      {
        urlList: [webSeedUrl],
        announceList: [],
        createdBy: 'ritual',
        creationDate: creationDate.getTime(),
      },
      (err, torrent) => {
        if (err) reject(err)
        else resolve(torrent)
      },
    )
  })
  const parsed = await parseTorrent(buffer)
  return {
    buffer,
    infoHash: parsed.infoHash,
    magnet: toMagnetURI(parsed),
    length: parsed.length ?? 0,
  }
}
