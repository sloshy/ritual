/**
 * A fake GitHub release server and `self-update` environment, shared by the
 * engine and command suites. Nothing here touches the network or the real
 * Ritual binary: the "binaries" are small text files that name their own
 * version, and the fake `runBinary` answers `--version` by reading that name
 * back — so a smoke test passes exactly when the right bytes were installed.
 */

import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { BinaryRunResult, ReleaseApiEnv, SelfUpdateEnv } from '../../src/update/env'
import { archiveFor } from '../../src/update/release-source'
import { tarGz, zip } from './archives'
import { stubFetch, type StubbedFetch, type StubRoute } from './stub-fetch'

/** `sha256sum`'s digest of the exact bytes, as a release's `.sha256` file holds it. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** A release's `.sha256` file for `name`: one `sha256sum` line. */
export function sha256Line(name: string, bytes: string | Uint8Array): string {
  return `${sha256Hex(bytes)}  ${name}\n`
}

export const FAKE_API = 'https://api.github.test/repos/sloshy/ritual'
const DOWNLOADS = 'https://downloads.github.test'

/** The asset this suite's fake platform (linux/x64) installs. */
export const FAKE_ASSET = 'ritual-linux-x86_64'

/** The bytes of a fake binary that reports `version` from `--version`. */
export function fakeBinary(version: string): string {
  return `fake ritual ${version}`
}

/**
 * How a fake release differs from a well-formed one. A release carries the bare
 * binary, and with `archived` its archive too; the download options
 * (`checksum`, `listedSize`, `downloadStatus`) apply to the file `self-update`
 * downloads — the archive when there is one, else the bare binary.
 */
export type FakeReleaseOptions = {
  prerelease?: boolean
  draft?: boolean
  /** The binary's bytes; defaults to {@link fakeBinary} of the tag's version. */
  binary?: string
  /** Also publish the binary's archive (`.tar.gz`, or `.zip` for a `.exe` asset). */
  archived?: boolean
  /** The archive's bytes; defaults to one holding just the binary. Implies `archived`. */
  archive?: Uint8Array
  /** The download's `.sha256` text; defaults to a correct `sha256sum` line. `null` omits it. */
  checksum?: string | null
  /** The size the release lists for the download; defaults to its real size. */
  listedSize?: number
  /** The binary's asset name; defaults to {@link FAKE_ASSET}. */
  asset?: string
  /** Serve the download with this HTTP status instead of its bytes. */
  downloadStatus?: number
}

/** The archive a well-formed release publishes for `binary` under `asset`'s name. */
export function fakeArchive(asset: string, binary: string): Uint8Array {
  const { format, member } = archiveFor(asset)
  const entries = [{ name: member, data: binary }]
  return format === 'zip' ? zip(entries) : tarGz(entries)
}

/** A release as the API serves it, plus the download routes behind its assets. */
export type FakeRelease = {
  json: Record<string, unknown>
  routes: Record<string, StubRoute>
}

export function fakeRelease(tag: string, options: FakeReleaseOptions = {}): FakeRelease {
  const binary = options.binary ?? fakeBinary(tag.replace(/^v/, ''))
  const binaryName = options.asset ?? FAKE_ASSET
  const archived = options.archived === true || options.archive !== undefined
  const assets: Record<string, unknown>[] = []
  const routes: Record<string, StubRoute> = {}

  /** Publish `name` with its `.sha256`; `isDownload` applies the download options to it. */
  const publish = (name: string, bytes: string | Uint8Array, isDownload: boolean): void => {
    const url = `${DOWNLOADS}/${tag}/${name}`
    const status = isDownload ? options.downloadStatus : undefined
    assets.push({
      name,
      browser_download_url: url,
      size: (isDownload ? options.listedSize : undefined) ?? Buffer.byteLength(bytes),
    })
    routes[url] = () =>
      status === undefined ? new Response(Buffer.from(bytes)) : new Response('', { status })
    const checksum =
      isDownload && options.checksum !== undefined ? options.checksum : sha256Line(name, bytes)
    if (checksum === null) return
    assets.push({
      name: `${name}.sha256`,
      browser_download_url: `${url}.sha256`,
      size: Buffer.byteLength(checksum),
    })
    routes[`${url}.sha256`] = () => new Response(checksum)
  }

  // Beside an archive, the bare binary reports another version, so a test can
  // tell which one was installed.
  publish(binaryName, archived ? fakeBinary('0.0.0-bare') : binary, !archived)
  if (archived) {
    const archive = options.archive ?? fakeArchive(binaryName, binary)
    publish(archiveFor(binaryName).name, archive, true)
  }
  return {
    json: {
      tag_name: tag,
      draft: options.draft ?? false,
      prerelease: options.prerelease ?? false,
      assets,
    },
    routes,
  }
}

/** What the fake GitHub serves: the stable "latest", the full list, and tag lookups. */
export type FakeReleaseServer = {
  latest?: FakeRelease
  list?: FakeRelease[]
}

function json(body: unknown): Response {
  return Response.json(body)
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 })
}

/**
 * Install a stubbed `fetch` serving `server`. Every release reachable from it
 * is also served by tag; an unknown tag and a missing `latest` answer 404, as
 * GitHub does.
 */
export function serveReleases(server: FakeReleaseServer): StubbedFetch {
  const all = [...(server.list ?? []), ...(server.latest === undefined ? [] : [server.latest])]
  const tagPrefix = `${FAKE_API}/releases/tags/`
  const routes: Record<string, StubRoute> = {
    [`${FAKE_API}/releases/latest`]: () =>
      server.latest === undefined ? notFound() : json(server.latest.json),
    [`${FAKE_API}/releases?`]: () => json((server.list ?? []).map((release) => release.json)),
    // One route for every tag, matched exactly: by prefix, `v1.1.0` would
    // also serve a request for `v1.1.0-beta1`.
    [tagPrefix]: (request) => {
      const tag = decodeURIComponent(request.url.slice(tagPrefix.length))
      const release = all.find((candidate) => candidate.json.tag_name === tag)
      return release === undefined ? notFound() : json(release.json)
    },
  }
  for (const release of all) Object.assign(routes, release.routes)
  return stubFetch(routes)
}

/** The fake releases API reached through `fetch`, without a token. */
export function fakeReleaseApiEnv(fetch: ReleaseApiEnv['fetch']): ReleaseApiEnv {
  return { fetch, githubToken: undefined, apiBase: FAKE_API }
}

/**
 * A `fetch` that never answers until its request is aborted, then rejects as
 * `fetch` does — a network that hangs. `seen` receives each request's signal.
 */
export function hangingFetch(
  seen: (signal: AbortSignal | undefined) => void,
): ReleaseApiEnv['fetch'] {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal ?? undefined
      seen(signal)
      if (signal?.aborted === true) {
        reject(new Error('aborted'))
        return
      }
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
}

/** Every `--version` smoke test and inherited run the fake environment saw. */
export type FakeRuns = {
  smokeTests: string[]
  inherited: string[][]
}

export type FakeEnv = {
  env: SelfUpdateEnv
  runs: FakeRuns
}

/** The fake `--version`: read the file back and report the version its bytes name. */
async function answerVersion(file: string): Promise<BinaryRunResult> {
  const content = await fs.readFile(file, 'utf8')
  const match = content.match(/^fake ritual (.+)$/)
  return match === null
    ? { exitCode: 1, stdout: '', stderr: 'not a ritual binary', killed: false }
    : { exitCode: 0, stdout: `${match[1]}\n`, stderr: '', killed: false }
}

/**
 * A release build of `version` on linux/x64 whose executable is `execPath`.
 * `fetch` goes through `globalThis.fetch`, so {@link serveReleases} serves it.
 */
export function fakeEnv(execPath: string, overrides: Partial<SelfUpdateEnv> = {}): FakeEnv {
  const runs: FakeRuns = { smokeTests: [], inherited: [] }
  const env: SelfUpdateEnv = {
    ...fakeReleaseApiEnv((url, init) => globalThis.fetch(url, init)),
    execPath,
    platform: 'linux',
    arch: 'x64',
    build: { version: '1.0.0', release: true },
    installKind: undefined,
    runBinary: async (file) => {
      runs.smokeTests.push(file)
      return answerVersion(file)
    },
    runInherited: async (file, args) => {
      runs.inherited.push([file, ...args])
      return 0
    },
    rename: (from, to) => fs.rename(from, to),
    ...overrides,
  }
  return { env, runs }
}

/** A temp directory holding an installed fake binary of `version`, named `ritual`. */
export async function installedBinary(version: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-self-update-'))
  const file = path.join(dir, 'ritual')
  await fs.writeFile(file, fakeBinary(version), { mode: 0o755 })
  return file
}
