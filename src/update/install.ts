/**
 * Installing a release over the running binary for `ritual self-update`:
 * mapping the platform to its release archive, downloading it while verifying
 * it (listed size, `.sha256`), unpacking the binary from it, writing that into
 * a temporary file beside the binary, a `--version` smoke test, and swapping it
 * into place.
 *
 * A release publishes each binary compressed (`ritual-linux-x86_64.tar.gz`,
 * `ritual-windows-x86_64.zip`), with a `.sha256` of the archive as published:
 * what is hashed is exactly what was downloaded, checked before anything is
 * unpacked. A release without the archive (one from before 0.1.0-rc4, which
 * published bare binaries) is refused.
 *
 * The rules throughout: nothing outside the temporary file is touched until
 * the new binary is fully written, flushed, verified, and has answered
 * `--version` correctly; every failure before the swap deletes the temporary
 * file; and no failure ever leaves the user without a working binary under a
 * name they are told about.
 */

import { createHash, randomBytes } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  errorParam,
  isMessageParseError,
  nestSync,
  syncMessage,
  SyncMessageError,
  syncRef,
  type MessageParseError,
  type SyncText,
} from '../sync/message'
import {
  CardCommandError,
  ExitCode,
  localizedCommandError,
  messageCommandError,
} from '../util/errors'
import { quotedReply, readBoundedText } from '../util/reply-text'
import type { BinaryRunResult, SelfUpdateEnv } from './env'
import { httpError, networkError, request, type Release, type ReleaseAsset } from './release'
import { extractBinary } from './archive'
import { archiveFor, assetNameFor, type ReleaseArchive } from './release-source'
import { renameWithRetry } from '../util/atomic-write'

/** How long the `.sha256` file may take to arrive. */
const CHECKSUM_TIMEOUT_MS = 30_000

/**
 * The most of a `.sha256` file read (bytes). The file is one `sha256sum` line —
 * 64 hex digits and a file name — so anything past this is not one, and is
 * never fetched.
 */
const CHECKSUM_MAX_BYTES = 4096

/** The most of a file name or of the new binary's output a refusal quotes (characters). */
const MAX_QUOTED_OUTPUT_CHARS = 200

/** How long the whole binary download may take. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000

/** A temporary file older than this is a leftover of an interrupted run, not a live one. */
const STALE_TEMPORARY_MS = 60 * 60_000

/** {@link assetNameFor} for this platform, refusing one Ritual publishes no binary for. */
export function requireAssetName(env: SelfUpdateEnv): string {
  const name = assetNameFor(env.platform, env.arch)
  if (name === undefined) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.selfUpdate.error.unsupportedPlatform',
      { platform: env.platform, arch: env.arch },
    )
  }
  return name
}

/**
 * Parse a `sha256sum` line (`<64 hex>  <file>`, or `<64 hex> *<file>` in binary
 * mode) for `assetName`, returning the lowercase digest. A bare digest is
 * accepted too; a line naming a different file is not.
 */
export function parseChecksumFile(text: string, assetName: string): string | MessageParseError {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? ''
  const match = line.match(/^([0-9a-fA-F]{64})(?:\s+\*?(.+))?$/)
  if (match === null) return { error: syncMessage('cli.selfUpdate.checksum.malformed') }
  const file = match[2]?.trim()
  if (file !== undefined && path.basename(file) !== assetName) {
    const named = quotedReply(file, MAX_QUOTED_OUTPUT_CHARS)
    return {
      error: syncMessage('cli.selfUpdate.checksum.otherFile', { file: named, asset: assetName }),
    }
  }
  return match[1]!.toLowerCase()
}

function findAsset(release: Release, name: string): ReleaseAsset | undefined {
  return release.assets.find((asset) => asset.name === name)
}

/**
 * The assets an install needs: the archive downloaded, its `.sha256` file
 * (which hashes the archive as published), and how to unpack it.
 */
type InstallAssets = {
  download: ReleaseAsset
  checksum: ReleaseAsset
  archive: ReleaseArchive
}

/** This platform's archive and its `.sha256`; a release missing either is refused. */
function requireAssets(env: SelfUpdateEnv, release: Release): InstallAssets {
  const archive = archiveFor(requireAssetName(env))
  const download = findAsset(release, archive.name)
  if (download === undefined) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.selfUpdate.error.missingAsset',
      { tag: release.tag, asset: archive.name },
    )
  }
  const checksum = findAsset(release, `${download.name}.sha256`)
  if (checksum === undefined) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.selfUpdate.error.missingChecksum',
      { tag: release.tag, asset: download.name },
    )
  }
  return { download, checksum, archive }
}

/** Download and parse the release's `.sha256` file for the binary. */
async function fetchExpectedDigest(env: SelfUpdateEnv, assets: InstallAssets): Promise<string> {
  const url = assets.checksum.url
  const response = await request(
    env,
    url,
    'application/octet-stream',
    AbortSignal.timeout(CHECKSUM_TIMEOUT_MS),
  )
  if (!response.ok) throw httpError(response, url)
  const text = await readBody(url, () => readBoundedText(response, CHECKSUM_MAX_BYTES))
  const expected = parseChecksumFile(text, assets.download.name)
  if (isMessageParseError(expected)) {
    throw messageCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      syncMessage('cli.selfUpdate.error.badChecksumFile', {
        asset: assets.download.name,
        error: nestSync(expected.error),
      }),
    )
  }
  return expected
}

/** Read a response body; a timeout or dropped connection mid-body is a network error. */
async function readBody<T>(url: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    throw networkError(url, error)
  }
}

function sizeMismatch(asset: string, actual: number, expected: number): CardCommandError {
  return localizedCommandError(
    'runtime_error',
    ExitCode.RuntimeError,
    'cli.selfUpdate.error.sizeMismatch',
    { asset, actual, expected },
  )
}

/** Writing or moving the new binary failed; a keyed reason (a full disk) stays nested. */
function installFailed(target: string, error: unknown): CardCommandError {
  return messageCommandError(
    'runtime_error',
    ExitCode.RuntimeError,
    syncMessage('cli.selfUpdate.error.installFailed', { path: target, error: errorParam(error) }),
  )
}

/**
 * The file the update replaces: the running executable with symlinks resolved,
 * so a `~/.local/bin/ritual` link keeps pointing at the (updated) real binary
 * instead of being replaced by a copy.
 */
export async function resolveTargetBinary(execPath: string): Promise<string> {
  return fs.realpath(execPath)
}

/**
 * Refuse when the binary's directory cannot take the new file and the rename.
 * On Windows `W_OK` only reflects the read-only attribute, so a protected
 * directory (`Program Files`) passes here and fails at write time instead —
 * still before anything is replaced.
 */
export async function assertWritableTarget(target: string): Promise<void> {
  const dir = path.dirname(target)
  try {
    await fs.access(dir, fsConstants.W_OK)
  } catch {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.selfUpdate.refuse.notWritable',
      { dir },
    )
  }
}

/** The leading part of every temporary name beside `target`. */
function temporaryPrefix(target: string): string {
  return `.${path.basename(target)}.`
}

/**
 * A fresh temporary name beside `target`. Same directory, so the final rename
 * never crosses a filesystem; `.exe` on Windows, which only runs files so named.
 */
function temporaryPath(target: string, platform: NodeJS.Platform): string {
  const suffix = randomBytes(4).toString('hex')
  const extension = platform === 'win32' ? '.exe' : ''
  return path.join(path.dirname(target), `${temporaryPrefix(target)}${suffix}.new${extension}`)
}

/**
 * Best-effort removal of temporary files an interrupted run (Ctrl+C mid
 * download) left beside `target`. Only names this module mints, and only old
 * ones, so a concurrent update is never disturbed.
 */
async function sweepStaleTemporaries(target: string): Promise<void> {
  const dir = path.dirname(target)
  const prefix = temporaryPrefix(target)
  const pattern = /^[0-9a-f]{8}\.new(?:\.exe)?$/
  try {
    for (const name of await fs.readdir(dir)) {
      if (!name.startsWith(prefix) || !pattern.test(name.slice(prefix.length))) continue
      const file = path.join(dir, name)
      const stat = await fs.stat(file)
      if (Date.now() - stat.mtimeMs > STALE_TEMPORARY_MS) await fs.rm(file, { force: true })
    }
  } catch {
    // Housekeeping only; the install proceeds either way.
  }
}

/** The file Windows leaves behind: the replaced binary, renamed so the new one can take its name. */
export function leftoverPath(target: string): string {
  return `${target}.old`
}

/** The new binary's mode: the current binary's, always executable by its owner. */
async function installMode(target: string): Promise<number> {
  return ((await fs.stat(target)).mode & 0o777) | 0o100
}

/**
 * Request the download and check what the response announces, before any file
 * is created: a failed request or a size other than the listed one is refused.
 */
async function openDownload(
  env: SelfUpdateEnv,
  assets: InstallAssets,
): Promise<ReadableStreamDefaultReader<Uint8Array> | undefined> {
  const { download } = assets
  const { name } = download
  const response = await request(
    env,
    download.url,
    'application/octet-stream',
    AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  )
  if (!response.ok) throw httpError(response, download.url)
  // A compressed body's Content-Length counts encoded bytes; the streamed count
  // in receiveVerified enforces the size either way.
  const announced = response.headers.get('content-length')
  if (
    announced !== null &&
    response.headers.get('content-encoding') === null &&
    Number(announced) !== download.size
  ) {
    throw sizeMismatch(name, Number(announced), download.size)
  }
  return response.body?.getReader()
}

/**
 * Read the download as it arrives, hashing and counting it: a body larger than
 * the listed size is cut off rather than buffered, and a body whose size or
 * SHA-256 is not the published one is refused once it has all arrived.
 */
async function receiveVerified(
  assets: InstallAssets,
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  expectedDigest: string,
): Promise<Buffer> {
  const { download } = assets
  const { name } = download
  const hash = createHash('sha256')
  const chunks: Uint8Array[] = []
  let received = 0
  while (reader !== undefined) {
    const chunk = await readBody(download.url, () => reader.read())
    if (chunk.done) break
    received += chunk.value.byteLength
    if (received > download.size) {
      await reader.cancel()
      throw sizeMismatch(name, received, download.size)
    }
    hash.update(chunk.value)
    chunks.push(chunk.value)
  }
  if (received !== download.size) throw sizeMismatch(name, received, download.size)
  const actual = hash.digest('hex')
  if (actual !== expectedDigest) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.selfUpdate.error.checksumMismatch',
      { asset: name, expected: expectedDigest, actual },
    )
  }
  return Buffer.concat(chunks)
}

/**
 * Download and verify the archive in memory, then unpack the binary from it.
 * Nothing is written to disk until both the archive's `.sha256` and the
 * unpacking succeed.
 */
async function downloadBinary(
  env: SelfUpdateEnv,
  assets: InstallAssets,
  expectedDigest: string,
): Promise<Uint8Array> {
  const { archive } = assets
  const reader = await openDownload(env, assets)
  const binary = extractBinary(
    await receiveVerified(assets, reader, expectedDigest),
    archive.format,
    archive.member,
  )
  if (isMessageParseError(binary)) {
    throw messageCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      syncMessage('cli.selfUpdate.error.badArchive', {
        asset: archive.name,
        error: nestSync(binary.error),
      }),
    )
  }
  return binary
}

/**
 * Create `temporary` exclusively and write the new binary into it; then flush
 * it to disk, prove every byte reached it, and give it `mode`. `file` names
 * what is written in a refusal.
 */
async function writeNewBinary(
  file: string,
  binary: Uint8Array,
  temporary: string,
  mode: number,
  onCreated: () => void,
): Promise<void> {
  let handle: fs.FileHandle
  try {
    // `wx`: never follow or clobber something that already sits at the name.
    handle = await fs.open(temporary, 'wx', mode)
  } catch (error) {
    throw installFailed(temporary, error)
  }
  onCreated()
  let failure: unknown
  try {
    await writeFully(handle, binary)
    // Without this, a crash after the rename could leave an empty binary.
    await handle.sync()
    const written = (await handle.stat()).size
    if (written !== binary.byteLength) throw sizeMismatch(file, written, binary.byteLength)
  } catch (error) {
    failure = error instanceof CardCommandError ? error : installFailed(temporary, error)
  }
  try {
    await handle.close()
  } catch (error) {
    // A close failure must not mask the error that got us here.
    failure ??= installFailed(temporary, error)
  }
  if (failure !== undefined) throw failure
  try {
    // The mode given to `open` is filtered through the umask.
    await fs.chmod(temporary, mode)
  } catch (error) {
    throw installFailed(temporary, error)
  }
}

/** Write all of `bytes`: `FileHandle.write` may write fewer than it was given. */
async function writeFully(handle: fs.FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset)
    if (bytesWritten <= 0) {
      throw new SyncMessageError(syncMessage('cli.selfUpdate.install.diskFull'))
    }
    offset += bytesWritten
  }
}

/**
 * Why the new binary's `--version` check got no matching version, as the
 * refusal's `detail`. What the binary printed is its own text, quoted: on one
 * line (every line break and control character a space, runs collapsed) and
 * capped at {@link MAX_QUOTED_OUTPUT_CHARS} characters. A failed run quotes its
 * stderr, or its stdout when stderr is empty; only why there is nothing to
 * quote is Ritual's to word.
 */
export function smokeTestDetail(result: BinaryRunResult): SyncText {
  if (result.killed) return syncRef('cli.selfUpdate.smoke.timedOut')
  const stdout = quotedReply(result.stdout, MAX_QUOTED_OUTPUT_CHARS)
  if (result.exitCode === 0) {
    return stdout === '' ? syncRef('cli.selfUpdate.smoke.noOutput') : stdout
  }
  const output = quotedReply(result.stderr, MAX_QUOTED_OUTPUT_CHARS) || stdout
  return output === ''
    ? syncRef('cli.selfUpdate.smoke.exitedSilently', { exitCode: result.exitCode })
    : syncRef('cli.selfUpdate.smoke.exited', { exitCode: result.exitCode, output })
}

/** Run the new binary with `--version`; anything but exactly `expected` fails. */
async function smokeTest(env: SelfUpdateEnv, file: string, expected: string): Promise<void> {
  const result = await env.runBinary(file, ['--version'])
  if (result.exitCode === 0 && result.stdout.trim() === expected) return
  throw messageCommandError(
    'runtime_error',
    ExitCode.RuntimeError,
    syncMessage('cli.selfUpdate.error.smokeTest', { expected, detail: smokeTestDetail(result) }),
  )
}

/** How a swap ended when it did not succeed. */
type SwapFailure =
  /** Nothing moved: `target` is the old binary and the temporary file can go. */
  | { kind: 'unchanged'; cause: unknown }
  /** Windows only: the old binary is at `old` and could not be put back. */
  | { kind: 'stranded'; cause: unknown; old: string }

/**
 * Where the running Windows binary steps aside to: `<target>.old`, or — when an
 * earlier one cannot be deleted because it is still running (a long-lived
 * `ritual serve` started before the last update) — a fresh `<target>.<hex>.old`.
 */
async function asidePath(target: string): Promise<string> {
  const old = leftoverPath(target)
  try {
    await fs.rm(old, { force: true })
    return old
  } catch {
    return `${target}.${randomBytes(4).toString('hex')}.old`
  }
}

/**
 * Run `body` with Ctrl+C (and Windows' Ctrl+Break) ignored: between the two
 * renames of a Windows swap, an interrupt would leave no binary at the name.
 */
async function withoutInterrupts<T>(body: () => Promise<T>): Promise<T> {
  const signals: NodeJS.Signals[] =
    process.platform === 'win32' ? ['SIGINT', 'SIGBREAK'] : ['SIGINT']
  const ignore = (): void => {}
  for (const signal of signals) process.on(signal, ignore)
  try {
    return await body()
  } finally {
    for (const signal of signals) process.off(signal, ignore)
  }
}

/**
 * Move `source` into `target`'s place. POSIX renames over the running binary
 * atomically. Windows cannot overwrite a running executable but can rename it,
 * so the current binary steps aside first (removed on the next start by
 * {@link removeLeftoverBinary}) and is put back if the move fails; the two
 * renames run with interrupts ignored.
 */
async function swapInto(
  env: SelfUpdateEnv,
  source: string,
  target: string,
): Promise<SwapFailure | undefined> {
  if (env.platform !== 'win32') {
    try {
      await env.rename(source, target)
      return undefined
    } catch (cause) {
      return { kind: 'unchanged', cause }
    }
  }
  const old = await asidePath(target)
  return withoutInterrupts(async () => {
    try {
      await env.rename(target, old)
    } catch (cause) {
      return { kind: 'unchanged', cause }
    }
    try {
      // Windows refuses renames while antivirus scans a freshly written `.exe`.
      await renameWithRetry(source, target, { rename: env.rename, platform: env.platform })
      return undefined
    } catch (cause) {
      try {
        await env.rename(old, target)
        return { kind: 'unchanged', cause }
      } catch {
        return { kind: 'stranded', cause, old }
      }
    }
  })
}

/**
 * Download `release` beside `target`, verify and smoke-test it, and swap it in.
 * On any failure the temporary file is removed and `target` is left as it was —
 * except when a Windows rollback itself fails, where the verified new binary is
 * kept and the error names both files so the user can finish by hand.
 */
export async function installRelease(
  env: SelfUpdateEnv,
  release: Release,
  target: string,
): Promise<void> {
  const assets = requireAssets(env, release)
  const expectedDigest = await fetchExpectedDigest(env, assets)
  const mode = await installMode(target)
  await sweepStaleTemporaries(target)
  const temporary = temporaryPath(target, env.platform)
  // Only a file this run created is ever removed, and not one a stranded
  // Windows swap needs the user to keep.
  let removeTemporary = false
  try {
    const binary = await downloadBinary(env, assets, expectedDigest)
    await writeNewBinary(assets.archive.member, binary, temporary, mode, () => {
      removeTemporary = true
    })
    await smokeTest(env, temporary, release.version)
    const failure = await swapInto(env, temporary, target)
    if (failure?.kind === 'stranded') {
      removeTemporary = false
      throw messageCommandError(
        'runtime_error',
        ExitCode.RuntimeError,
        syncMessage('cli.selfUpdate.error.swapStranded', {
          target,
          old: failure.old,
          kept: temporary,
          error: errorParam(failure.cause),
        }),
      )
    }
    if (failure !== undefined) throw installFailed(target, failure.cause)
  } catch (error) {
    if (removeTemporary) await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Delete every replaced binary a Windows update left beside the executable
 * (`<name>.old`, and the `<name>.<hex>.old` used while an older one was still
 * running). Cheap, best-effort, and silent: one still in use is skipped, and it
 * never fails the command that happens to run it.
 */
export async function removeLeftoverBinary(
  execPath: string,
  platform: NodeJS.Platform,
): Promise<void> {
  if (platform !== 'win32') return
  try {
    const target = await resolveTargetBinary(execPath)
    const base = path.basename(target)
    const isLeftover = (name: string): boolean =>
      name.startsWith(`${base}.`) && /^(?:[0-9a-f]{8}\.)?old$/.test(name.slice(base.length + 1))
    for (const name of await fs.readdir(path.dirname(target))) {
      if (!isLeftover(name)) continue
      await fs.rm(path.join(path.dirname(target), name), { force: true }).catch(() => undefined)
    }
  } catch {
    // Not ours to read; the next start tries again.
  }
}
