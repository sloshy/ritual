// Minimal ambient typings for the torrent packages (none ship usable types for
// the versions we depend on). Only the surface ritual uses is declared.

declare module 'webtorrent' {
  import type { EventEmitter } from 'node:events'

  export interface Torrent extends EventEmitter {
    infoHash: string
    magnetURI: string
    name: string
    length: number
    numPeers: number
    uploaded: number
    downloaded: number
    progress: number
    done: boolean
    on(event: 'ready' | 'done' | 'metadata' | 'infoHash', listener: () => void): this
    on(event: 'error', listener: (err: Error | string) => void): this
    addPeer(peer: string): boolean
    destroy(cb?: (err?: Error) => void): void
  }

  export type WebTorrentOptions = {
    dht?: boolean | object
    tracker?: boolean | object
    lsd?: boolean
    utPex?: boolean
    utp?: boolean
    webSeeds?: boolean
    natUpnp?: boolean | string
    natPmp?: boolean
    torrentPort?: number
    maxConns?: number
  }

  export type AddTorrentOptions = {
    path?: string
    announce?: string[]
    skipVerify?: boolean
  }

  export type ClientAddress = { address: string; family: string; port: number }

  export default class WebTorrent extends EventEmitter {
    constructor(opts?: WebTorrentOptions)
    torrents: Torrent[]
    add(
      torrent: Uint8Array | string,
      opts?: AddTorrentOptions,
      cb?: (torrent: Torrent) => void,
    ): Torrent
    seed(input: string | string[], opts?: object, cb?: (torrent: Torrent) => void): Torrent
    remove(torrent: Torrent | string, opts?: object, cb?: (err?: Error) => void): void
    address(): ClientAddress | null
    destroy(cb?: (err?: Error) => void): void
    on(event: 'error', listener: (err: Error | string) => void): this
  }
}

declare module 'create-torrent' {
  export type CreateTorrentOptions = {
    name?: string
    comment?: string
    createdBy?: string
    creationDate?: number
    private?: boolean
    pieceLength?: number
    announceList?: string[][]
    urlList?: string[]
  }

  export default function createTorrent(
    input: string | string[],
    opts: CreateTorrentOptions,
    callback: (err: Error | null, torrent: Buffer) => void,
  ): void
}

declare module 'parse-torrent' {
  export interface ParsedTorrent {
    infoHash: string
    name?: string
    length?: number
    announce?: string[]
    urlList?: string[]
  }

  export function toMagnetURI(parsed: ParsedTorrent): string

  export default function parseTorrent(torrent: Uint8Array | string): Promise<ParsedTorrent>
}
