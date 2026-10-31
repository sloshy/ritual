/**
 * Hand-built release archives for the `self-update` suites: a gzipped ustar
 * tarball and a zip, each from a list of entries the test chooses — including
 * ones a real release never holds (`../ritual`, a link, a second file), which
 * the reader must refuse.
 */

import zlib from 'node:zlib'

/** One entry of a hand-built archive. */
export type ArchiveEntry = {
  name: string
  data?: string | Uint8Array
  /** What the entry is; a regular file by default. */
  type?: 'file' | 'directory' | 'symlink'
}

const encoder = new TextEncoder()

function bytesOf(data: string | Uint8Array | undefined): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : (data ?? new Uint8Array())
}

/** Write `text` into `block` at `offset`, NUL-padded to `length`. */
function put(block: Uint8Array, offset: number, length: number, text: string): void {
  block.set(encoder.encode(text).subarray(0, length), offset)
}

/** A ustar tarball of `entries`, gzipped. */
export function tarGz(entries: readonly ArchiveEntry[]): Uint8Array {
  const parts: Uint8Array[] = []
  for (const entry of entries) {
    const data = entry.type === 'file' || entry.type === undefined ? bytesOf(entry.data) : null
    const header = new Uint8Array(512)
    put(header, 0, 100, entry.name)
    put(header, 100, 8, '0000755\0')
    put(header, 108, 8, '0000000\0')
    put(header, 116, 8, '0000000\0')
    put(header, 124, 12, `${(data?.byteLength ?? 0).toString(8).padStart(11, '0')}\0`)
    put(header, 136, 12, '00000000000\0')
    const typeflag = { file: '0', directory: '5', symlink: '2' }[entry.type ?? 'file']
    put(header, 156, 1, typeflag)
    if (entry.type === 'symlink') put(header, 157, 100, '/usr/bin/evil')
    put(header, 257, 6, 'ustar\0')
    put(header, 263, 2, '00')
    put(header, 148, 8, '        ')
    const sum = header.reduce((total, byte) => total + byte, 0)
    put(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `)
    parts.push(header)
    if (data !== null) {
      parts.push(data, new Uint8Array((512 - (data.byteLength % 512)) % 512))
    }
  }
  parts.push(new Uint8Array(1024))
  return zlib.gzipSync(Buffer.concat(parts))
}

/** A zip of `entries`, deflated, made "on Unix" so each entry's file type is recorded. */
export function zip(entries: readonly ArchiveEntry[]): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = bytesOf(entry.type === 'symlink' ? '/usr/bin/evil' : entry.data)
    const deflated = zlib.deflateRawSync(data)
    const crc = zlib.crc32(data)
    const mode = { file: 0o100755, directory: 0o040755, symlink: 0o120777 }[entry.type ?? 'file']

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.byteLength, 18)
    local.writeUInt32LE(data.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    locals.push(local, name, deflated)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(deflated.byteLength, 20)
    central.writeUInt32LE(data.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt32LE((mode << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.byteLength + name.byteLength + deflated.byteLength
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
