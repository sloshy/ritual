import { describe, expect, test } from 'bun:test'
import zlib from 'node:zlib'
import type { MessageKey } from '../../../src/i18n/messages/en'
import { isMessageParseError } from '../../../src/sync/message'
import { extractBinary } from '../../../src/update/archive'
import type { ArchiveFormat } from '../../../src/update/release-source'
import { tarGz, zip, type ArchiveEntry } from '../../helpers/archives'

const BINARY = 'fake ritual 1.1.0'

/** The refusal's key, or the unpacked bytes as text when there was none. */
function outcome(
  archive: Uint8Array,
  format: ArchiveFormat,
  member: string,
  maxBytes?: number,
): string | undefined {
  const result = extractBinary(archive, format, member, maxBytes)
  return isMessageParseError(result) ? result.error.messageKey : new TextDecoder().decode(result)
}

const FORMATS: readonly [ArchiveFormat, string, (entries: ArchiveEntry[]) => Uint8Array][] = [
  ['tar.gz', 'ritual', tarGz],
  ['zip', 'ritual.exe', zip],
]

describe.each(FORMATS)('extractBinary (%s)', (format, member, pack) => {
  test('returns the one binary the archive holds', () => {
    expect(outcome(pack([{ name: member, data: BINARY }]), format, member)).toBe(BINARY)
  })

  // Every name but the exact member is refused, so nothing the archive names is
  // ever a path Ritual writes to.
  test.each<[string, ArchiveEntry[], MessageKey]>([
    [
      'a parent-directory path',
      [{ name: `../${member}`, data: BINARY }],
      'cli.selfUpdate.archive.unexpectedEntry',
    ],
    [
      'an absolute path',
      [{ name: `/usr/bin/${member}`, data: BINARY }],
      'cli.selfUpdate.archive.unexpectedEntry',
    ],
    [
      'a nested path',
      [{ name: `dir/${member}`, data: BINARY }],
      'cli.selfUpdate.archive.unexpectedEntry',
    ],
    [
      'a second file after the binary',
      [
        { name: member, data: BINARY },
        { name: 'extra', data: 'x' },
      ],
      'cli.selfUpdate.archive.extraEntry',
    ],
    [
      'the binary twice',
      [
        { name: member, data: BINARY },
        { name: member, data: 'other' },
      ],
      'cli.selfUpdate.archive.extraEntry',
    ],
    [
      'a link named like the binary',
      [{ name: member, type: 'symlink' }],
      'cli.selfUpdate.archive.notAFile',
    ],
    [
      'a directory named like the binary',
      [{ name: member, type: 'directory' }],
      'cli.selfUpdate.archive.notAFile',
    ],
    ['no entries at all', [], 'cli.selfUpdate.archive.missingMember'],
  ])('refuses %s', (_label, entries, key) => {
    expect(outcome(pack(entries), format, member)).toBe(key)
  })

  test('refuses an archive that unpacks past the cap', () => {
    const archive = pack([{ name: member, data: 'x'.repeat(4096) }])
    expect(outcome(archive, format, member, 1024)).toBe('cli.selfUpdate.archive.tooLarge')
  })

  test.each<[string, (archive: Uint8Array) => Uint8Array]>([
    ['bytes that are no archive', () => new TextEncoder().encode('not an archive at all')],
    ['an archive cut short', (archive) => archive.subarray(0, archive.byteLength - 30)],
  ])('refuses %s as damaged', (_label, mangle) => {
    const archive = mangle(pack([{ name: member, data: BINARY.repeat(40) }]))
    expect(outcome(archive, format, member)).toBe('cli.selfUpdate.archive.damaged')
  })
})

describe('extractBinary on a tarball', () => {
  /** The tarball inside a .tar.gz, to alter before gzipping it again. */
  const tarOf = (entries: ArchiveEntry[]): Buffer => zlib.gunzipSync(tarGz(entries))

  /** Rewrite the first header's checksum after an edit, so only the edit is wrong. */
  function rechecksum(tar: Buffer): void {
    tar.write('        ', 148)
    const sum = tar.subarray(0, 512).reduce((total, byte) => total + byte, 0)
    tar.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  }

  test('a header whose checksum does not match is damaged', () => {
    const tar = tarOf([{ name: 'ritual', data: BINARY }])
    tar[0] = 'R'.charCodeAt(0)
    expect(outcome(zlib.gzipSync(tar), 'tar.gz', 'ritual')).toBe('cli.selfUpdate.archive.damaged')
  })

  test('a size that is not octal is damaged', () => {
    const tar = tarOf([{ name: 'ritual', data: BINARY }])
    tar.write('notoctal\0\0\0\0', 124)
    rechecksum(tar)
    expect(outcome(zlib.gzipSync(tar), 'tar.gz', 'ritual')).toBe('cli.selfUpdate.archive.damaged')
  })

  test('an entry whose data runs past the end is damaged', () => {
    const tar = tarOf([{ name: 'ritual', data: BINARY.repeat(100) }])
    expect(outcome(zlib.gzipSync(tar.subarray(0, 1024)), 'tar.gz', 'ritual')).toBe(
      'cli.selfUpdate.archive.damaged',
    )
  })

  test('a ustar prefix is part of the name, so `../` + `ritual` is refused', () => {
    const tar = tarOf([{ name: 'ritual', data: BINARY }])
    tar.write('..', 345)
    rechecksum(tar)
    expect(outcome(zlib.gzipSync(tar), 'tar.gz', 'ritual')).toBe(
      'cli.selfUpdate.archive.unexpectedEntry',
    )
  })

  test('quotes the refused entry on one line, and names the binary', () => {
    const result = extractBinary(
      tarGz([{ name: '../evil\tname', data: BINARY }]),
      'tar.gz',
      'ritual',
    )
    expect(isMessageParseError(result) ? result.error.messageParams : result).toEqual({
      entry: '../evil name',
      member: 'ritual',
    })
  })
})

describe('extractBinary on a zip', () => {
  /** The offset of the zip's (one) central-directory record. */
  const centralRecord = (archive: Buffer): number =>
    archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))

  /** A one-entry zip of `data`, with `edit` applied to its bytes. */
  function zipWith(edit: (archive: Buffer, central: number) => void, data = BINARY): Buffer {
    const archive = Buffer.from(zip([{ name: 'ritual.exe', data }]))
    edit(archive, centralRecord(archive))
    return archive
  }

  test.each<[string, (archive: Buffer, central: number) => void, MessageKey]>([
    [
      'an entry that does not match its recorded CRC-32',
      (archive, central) =>
        archive.writeUInt32LE((archive.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16),
      'cli.selfUpdate.archive.damaged',
    ],
    [
      'a central record pointing at no local header',
      (archive, central) => archive.writeUInt32LE(5, central + 42),
      'cli.selfUpdate.archive.damaged',
    ],
    [
      'an encrypted entry',
      (archive, central) => archive.writeUInt16LE(1, central + 8),
      'cli.selfUpdate.archive.unsupportedZip',
    ],
    [
      'a zip64 size marker',
      (archive, central) => archive.writeUInt32LE(0xffffffff, central + 24),
      'cli.selfUpdate.archive.unsupportedZip',
    ],
    [
      'a compression method other than store or deflate',
      (archive, central) => archive.writeUInt16LE(12, central + 10),
      'cli.selfUpdate.archive.unsupportedZip',
    ],
    [
      'a directory marked the DOS way, by a zip not made on Unix',
      (archive, central) => {
        archive.writeUInt8(0, central + 5)
        archive.writeUInt32LE(0x10, central + 38)
      },
      'cli.selfUpdate.archive.notAFile',
    ],
  ])('refuses %s', (_label, edit, key) => {
    expect(outcome(zipWith(edit), 'zip', 'ritual.exe')).toBe(key)
  })

  test('a zip whose recorded size understates what it inflates to stops at the cap', () => {
    // The decompression-bomb case: the size check before inflating passes, so
    // only the inflate cap stands between the archive and memory.
    const archive = zipWith(
      (bytes, central) => bytes.writeUInt32LE(10, central + 24),
      'x'.repeat(4096),
    )
    expect(outcome(archive, 'zip', 'ritual.exe', 1024)).toBe('cli.selfUpdate.archive.tooLarge')
  })
})
