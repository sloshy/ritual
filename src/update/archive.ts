/**
 * Reading the one binary out of a release archive for `ritual self-update`:
 * a gzipped ustar tarball (Linux, macOS) or a zip (Windows), as
 * `scripts/archive-binary.sh` packs them.
 *
 * Nothing here writes a file or trusts a name the archive gives: the archive
 * must hold exactly one entry, a regular file named exactly the expected
 * member, and only its bytes are returned — the caller decides where they go.
 * So an entry such as `../ritual`, `/usr/bin/ritual`, a directory, a link or a
 * second file is refused rather than skipped, and a path-traversal write is
 * impossible by construction. The archive's `.sha256` is verified before it
 * gets here; the tar header checksums and the zip CRC-32 catch damage after.
 */

import zlib from 'node:zlib'
import { quotedReply } from '../util/reply-text'
import { syncMessage, syncSize, type MessageParseError } from '../sync/message'
import type { ArchiveFormat } from './release-source'

/**
 * The most an archive may unpack to (bytes). A release binary is well under
 * this, so anything more is a damaged or hostile archive, refused before it is
 * held in memory.
 */
export const MAX_UNPACKED_BYTES = 512 * 1024 * 1024

/** The most of an entry's name a refusal quotes (characters). */
const MAX_QUOTED_NAME_CHARS = 200

const TAR_BLOCK = 512

/** The member's bytes, or why the archive was refused. */
export type Unpacked = Uint8Array | MessageParseError

const decoder = new TextDecoder()

/** The member's bytes from an archive of `format`, or why the archive was refused. */
export function extractBinary(
  archive: Uint8Array,
  format: ArchiveFormat,
  member: string,
  maxBytes = MAX_UNPACKED_BYTES,
): Unpacked {
  return format === 'zip'
    ? extractFromZip(archive, member, maxBytes)
    : extractFromTarGz(archive, member, maxBytes)
}

function unexpectedEntry(entry: string, member: string): MessageParseError {
  return {
    error: syncMessage('cli.selfUpdate.archive.unexpectedEntry', {
      entry: quotedReply(entry, MAX_QUOTED_NAME_CHARS),
      member,
    }),
  }
}

function extraEntry(entry: string): MessageParseError {
  return {
    error: syncMessage('cli.selfUpdate.archive.extraEntry', {
      entry: quotedReply(entry, MAX_QUOTED_NAME_CHARS),
    }),
  }
}

/** The refusal for an entry, or `undefined` when it is the first entry named exactly `member`. */
function refuseEntry(
  entry: string,
  member: string,
  alreadyFound: boolean,
): MessageParseError | undefined {
  if (alreadyFound) return extraEntry(entry)
  return entry === member ? undefined : unexpectedEntry(entry, member)
}

function notAFile(member: string): MessageParseError {
  return { error: syncMessage('cli.selfUpdate.archive.notAFile', { member }) }
}

function missingMember(member: string): MessageParseError {
  return { error: syncMessage('cli.selfUpdate.archive.missingMember', { member }) }
}

function damaged(): MessageParseError {
  return { error: syncMessage('cli.selfUpdate.archive.damaged') }
}

function tooLarge(maxBytes: number): MessageParseError {
  return { error: syncMessage('cli.selfUpdate.archive.tooLarge', { size: syncSize(maxBytes) }) }
}

/** Inflate with `inflate`, capped at `maxBytes`; a cap overrun and a corrupt stream are told apart. */
function inflateCapped(
  inflate: (input: Uint8Array, options: zlib.ZlibOptions) => Uint8Array,
  input: Uint8Array,
  maxBytes: number,
): Unpacked {
  try {
    return inflate(input, { maxOutputLength: maxBytes })
  } catch (error) {
    const overrun =
      error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE'
    return overrun ? tooLarge(maxBytes) : damaged()
  }
}

// ── tar.gz ───────────────────────────────────────────────────────────────

/** A NUL-terminated header field as text. */
function tarText(header: Uint8Array, offset: number, length: number): string {
  const field = header.subarray(offset, offset + length)
  const end = field.indexOf(0)
  return decoder.decode(end === -1 ? field : field.subarray(0, end))
}

/** An octal header field (space or NUL padded), or `undefined` when it is not one. */
function tarOctal(header: Uint8Array, offset: number, length: number): number | undefined {
  const text = tarText(header, offset, length).trim()
  return /^[0-7]+$/.test(text) ? Number.parseInt(text, 8) : undefined
}

/** Whether the header's checksum field matches its bytes (the field itself counted as spaces). */
function tarChecksumMatches(header: Uint8Array): boolean {
  const recorded = tarOctal(header, 148, 8)
  if (recorded === undefined) return false
  let sum = 0
  for (let i = 0; i < TAR_BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!
  return sum === recorded
}

/**
 * The entry's path: the POSIX ustar `prefix` field, when set, joined to its
 * `name`. Old GNU headers (`ustar  `) keep other fields where `prefix` would be.
 */
function tarPath(header: Uint8Array): string {
  const name = tarText(header, 0, 100)
  const isUstar = tarText(header, 257, 6) === 'ustar' && tarText(header, 263, 2) === '00'
  const prefix = isUstar ? tarText(header, 345, 155) : ''
  return prefix === '' ? name : `${prefix}/${name}`
}

function extractFromTarGz(archive: Uint8Array, member: string, maxBytes: number): Unpacked {
  const tar = inflateCapped(zlib.gunzipSync, archive, maxBytes)
  if (!(tar instanceof Uint8Array)) return tar
  let found: Uint8Array | undefined
  let offset = 0
  while (offset + TAR_BLOCK <= tar.byteLength) {
    const header = tar.subarray(offset, offset + TAR_BLOCK)
    // Two zero blocks end the archive; one is enough to stop reading.
    if (header.every((byte) => byte === 0)) break
    if (!tarChecksumMatches(header)) return damaged()
    const entry = tarPath(header)
    const size = tarOctal(header, 124, 12)
    if (size === undefined) return damaged()
    const refused = refuseEntry(entry, member, found !== undefined)
    if (refused !== undefined) return refused
    // '0' and the pre-POSIX NUL are regular files; anything else (a directory,
    // a link, a pax header) is not the binary.
    const type = header[156]
    if (type !== 0x30 && type !== 0) return notAFile(member)
    const start = offset + TAR_BLOCK
    if (start + size > tar.byteLength) return damaged()
    found = tar.subarray(start, start + size)
    offset = start + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
  }
  return found ?? missingMember(member)
}

// ── zip ──────────────────────────────────────────────────────────────────

const ZIP_END_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_SIGNATURE = 0x02014b50
const ZIP_LOCAL_SIGNATURE = 0x04034b50
/** The end-of-central-directory record before its comment (bytes). */
const ZIP_END_SIZE = 22
/** A zip64 placeholder: the real value is in an extra field Ritual's archives never need. */
const ZIP64_MARKER = 0xffffffff
/** The `st_mode` file-type bits a Unix zip keeps in the high half of the external attributes. */
const UNIX_TYPE_MASK = 0o170000
const UNIX_REGULAR = 0o100000
/** The MS-DOS directory attribute, in the low byte of the external attributes. */
const DOS_DIRECTORY = 0x10

function unsupported(): MessageParseError {
  return { error: syncMessage('cli.selfUpdate.archive.unsupportedZip') }
}

/** The offset of the end-of-central-directory record, searched back over a comment of up to 64 KiB. */
function findZipEnd(view: DataView): number | undefined {
  const last = view.byteLength - ZIP_END_SIZE
  const first = Math.max(0, last - 0xffff)
  for (let at = last; at >= first; at--) {
    if (view.getUint32(at, true) === ZIP_END_SIGNATURE) return at
  }
  return undefined
}

/** The member's central-directory record: where its data is and how it is stored. */
type ZipEntry = {
  method: number
  crc: number
  compressedSize: number
  size: number
  localOffset: number
}

function extractFromZip(archive: Uint8Array, member: string, maxBytes: number): Unpacked {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const end = findZipEnd(view)
  if (end === undefined) return damaged()
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  let found: ZipEntry | undefined
  for (let i = 0; i < count; i++) {
    if (at + 46 > archive.byteLength || view.getUint32(at, true) !== ZIP_CENTRAL_SIGNATURE) {
      return damaged()
    }
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    if (at + 46 + nameLength > archive.byteLength) return damaged()
    const entry = decoder.decode(archive.subarray(at + 46, at + 46 + nameLength))
    const refused = refuseEntry(entry, member, found !== undefined)
    if (refused !== undefined) return refused
    // A Unix-made zip records the file type, so a link or anything else is
    // refused; any zip may mark a directory with the DOS attribute.
    const attributes = view.getUint32(at + 38, true)
    const madeOnUnix = view.getUint8(at + 5) === 3
    const unixType = (attributes >>> 16) & UNIX_TYPE_MASK
    const notRegular = madeOnUnix && unixType !== 0 && unixType !== UNIX_REGULAR
    if (notRegular || (attributes & DOS_DIRECTORY) !== 0) return notAFile(member)
    const flags = view.getUint16(at + 8, true)
    found = {
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      localOffset: view.getUint32(at + 42, true),
    }
    const encrypted = (flags & 1) !== 0
    const zip64 = [found.compressedSize, found.size, found.localOffset].includes(ZIP64_MARKER)
    if (encrypted || zip64 || (found.method !== 0 && found.method !== 8)) return unsupported()
    at += 46 + nameLength + extraLength + commentLength
  }
  if (found === undefined) return missingMember(member)
  if (found.size > maxBytes) return tooLarge(maxBytes)
  return readZipEntry(archive, view, found, maxBytes)
}

/** The entry's data, from behind its local header, inflated and checked against its CRC-32. */
function readZipEntry(
  archive: Uint8Array,
  view: DataView,
  entry: ZipEntry,
  maxBytes: number,
): Unpacked {
  const local = entry.localOffset
  if (local + 30 > archive.byteLength || view.getUint32(local, true) !== ZIP_LOCAL_SIGNATURE) {
    return damaged()
  }
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
  if (start + entry.compressedSize > archive.byteLength) return damaged()
  const stored = archive.subarray(start, start + entry.compressedSize)
  const data = entry.method === 0 ? stored : inflateCapped(zlib.inflateRawSync, stored, maxBytes)
  if (!(data instanceof Uint8Array)) return data
  if (data.byteLength !== entry.size || zlib.crc32(data) !== entry.crc) return damaged()
  return data
}
