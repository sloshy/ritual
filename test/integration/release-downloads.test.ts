/**
 * The shell that downloads a release — `scripts/install.sh` and the generated
 * deploy workflow's "Download Ritual" step — run for real against a fake
 * release directory, through a stand-in `curl` that serves files from it. Also
 * `scripts/archive-binary.sh`, whose archives `self-update`'s reader must take.
 *
 * Every download is checked against its `.sha256`, the compressed archive is
 * preferred, and the bare binary is the fallback for a release from before
 * archives were published.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import yaml from 'js-yaml'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generatePublishForMeWorkflow } from '../../src/migrate/managed-files'
import { isMessageParseError } from '../../src/sync/message'
import { extractBinary } from '../../src/update/archive'
import { archiveFor, assetNameFor, DEPLOY_WORKFLOW_ASSET } from '../../src/update/release-source'
import { fakeArchive, sha256Line } from '../helpers/fake-release'
import { repoRoot, spawnCapture, type CliResult } from './helpers/cli'

const TAG = 'v1.1.0'
const BINARY = 'fake ritual 1.1.0\n'

/**
 * A `curl` that serves `$FAKE_RELEASES/<path after /releases/>`. A miss acts
 * as GitHub's 404 does: with `--fail` (or `-f` in a group such as `-fsSL`) an
 * error and exit 22, without it the "Not Found" page saved and exit 0 — so a
 * script that dropped `--fail` would be caught.
 */
const FAKE_CURL = `#!/usr/bin/env bash
out=''; url=''; fail=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o | --output) out=$2; shift ;;
    -H) shift ;;
    --fail) fail=1 ;;
    --*) ;;
    -*f*) fail=1 ;;
    -*) ;;
    *) url=$1 ;;
  esac
  shift
done
file="$FAKE_RELEASES/\${url#https://github.com/sloshy/ritual/releases/}"
if [ ! -f "$file" ]; then
  if [ "$fail" = 1 ]; then echo "curl: (22) 404 for $url" >&2; exit 22; fi
  file=/dev/stdin
  exec <<< 'Not Found'
fi
if [ -n "$out" ]; then cat "$file" > "$out"; else cat "$file"; fi
`

let dir: string | undefined
afterEach(async () => {
  if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true })
  dir = undefined
})

type ReleaseDir = {
  /** Where the commands run. */
  work: string
  /** The environment that puts the fake `curl` first on PATH. */
  env: Record<string, string>
}

type ReleaseFiles = Record<string, string | Uint8Array>

/** A release of `files` (each `.sha256` written correctly unless given), served as `TAG` and `latest`. */
async function releaseDir(files: ReleaseFiles): Promise<ReleaseDir> {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-release-'))
  const releases = path.join(dir, 'releases')
  const tagged = path.join(releases, 'download', TAG)
  await fs.mkdir(tagged, { recursive: true })
  for (const [name, bytes] of Object.entries(files)) {
    await fs.writeFile(path.join(tagged, name), bytes)
    if (!name.endsWith('.sha256') && files[`${name}.sha256`] === undefined) {
      await fs.writeFile(path.join(tagged, `${name}.sha256`), sha256Line(name, bytes))
    }
  }
  await fs.mkdir(path.join(releases, 'latest'))
  await fs.symlink(tagged, path.join(releases, 'latest', 'download'))
  const bin = path.join(dir, 'bin')
  await fs.mkdir(bin)
  await fs.writeFile(path.join(bin, 'curl'), FAKE_CURL, { mode: 0o755 })
  const work = path.join(dir, 'work')
  await fs.mkdir(work)
  return {
    work,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: work,
      FAKE_RELEASES: releases,
    },
  }
}

function run(argv: string[], cwd: string, env: Record<string, string>): Promise<CliResult> {
  return spawnCapture(argv, { cwd, env })
}

/** The files of a release for `asset` (a Linux or macOS binary). */
type ReleaseShape = (asset: string) => ReleaseFiles

/** The archive and the bare binary, as from 0.1.0 on. */
const CURRENT: ReleaseShape = (asset) => ({
  [asset]: BINARY,
  [archiveFor(asset).name]: fakeArchive(asset, BINARY),
})

/** The archive alone, so only it can have produced what was installed. */
const ARCHIVE_ONLY: ReleaseShape = (asset) => {
  const { [asset]: _bare, ...rest } = CURRENT(asset)
  return rest
}

/** A release from before 0.1.0: the bare binary only. */
const BARE_ONLY: ReleaseShape = (asset) => ({ [asset]: BINARY })

/** An archive that does not match its `.sha256`. */
const TAMPERED: ReleaseShape = (asset) => {
  const { name } = archiveFor(asset)
  return { ...CURRENT(asset), [`${name}.sha256`]: sha256Line(name, 'something else') }
}

// install.sh picks the asset for the machine it runs on.
const hostAsset = assetNameFor(process.platform, process.arch)

/** An install.sh run, and where it installs to. */
type InstallRun = CliResult & { installed: string }

/** A Download Ritual step run, and the directory it ran in. */
type DownloadRun = CliResult & { work: string }

type WorkflowStep = { name?: string; run?: string }
type WorkflowJob = { steps: WorkflowStep[] }
type Workflow = { jobs: Record<string, WorkflowJob> }

describe.skipIf(hostAsset === undefined || process.platform === 'win32')('install.sh', () => {
  /**
   * Run install.sh for `version` (`TAG`, or the latest release when undefined),
   * installing into `<work>/bin` (already on PATH, so no profile edit).
   */
  async function install(
    shape: ReleaseShape,
    version: string | undefined = TAG,
  ): Promise<InstallRun> {
    const release = await releaseDir(shape(hostAsset!))
    const installDir = path.join(release.work, 'bin')
    const env = {
      ...release.env,
      PATH: `${installDir}:${release.env.PATH}`,
      RITUAL_INSTALL_DIR: installDir,
    }
    const result = await run(
      [
        'bash',
        path.join(repoRoot, 'scripts/install.sh'),
        ...(version === undefined ? [] : ['--version', version]),
      ],
      release.work,
      env,
    )
    return { ...result, installed: path.join(installDir, 'ritual') }
  }

  test('installs the binary from the archive', async () => {
    const result = await install(ARCHIVE_ONLY)
    expect(result.exitCode).toBe(0)
    expect(await fs.readFile(result.installed, 'utf8')).toBe(BINARY)
    expect((await fs.stat(result.installed)).mode & 0o111).not.toBe(0)
  })

  test('installs the latest release when no version is given', async () => {
    const result = await install(ARCHIVE_ONLY, undefined)
    expect(result.exitCode).toBe(0)
    expect(await fs.readFile(result.installed, 'utf8')).toBe(BINARY)
  })

  test('falls back to the bare binary for a release without an archive', async () => {
    const result = await install(BARE_ONLY)
    expect(result.exitCode).toBe(0)
    expect(await fs.readFile(result.installed, 'utf8')).toBe(BINARY)
  })

  test('refuses an archive that does not match its .sha256, installing nothing', async () => {
    const result = await install(TAMPERED)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(`Checksum mismatch for ${archiveFor(hostAsset!).name}`)
    expect(await Bun.file(result.installed).exists()).toBeFalse()
  })
})

describe('the generated workflow’s Download Ritual step', () => {
  const workflow = yaml.load(generatePublishForMeWorkflow()) as Workflow
  const script = workflow.jobs['build-and-deploy']!.steps.find(
    (step) => step.name === 'Download Ritual',
  )!.run!.replace('${{ steps.ritual-version.outputs.version }}', TAG)

  /** Run the step as Actions does (`bash -e`) in a checkout-like directory. */
  async function download(shape: ReleaseShape): Promise<DownloadRun> {
    const release = await releaseDir(shape(DEPLOY_WORKFLOW_ASSET))
    const result = await run(['bash', '-e', '-c', script], release.work, release.env)
    return { ...result, work: release.work }
  }

  test.each<[string, ReleaseShape]>([
    ['the archive', ARCHIVE_ONLY],
    ['the bare binary, for a release without an archive', BARE_ONLY],
  ])('installs ./ritual from %s, leaving nothing else', async (_label, shape) => {
    const result = await download(shape)
    expect(result.exitCode).toBe(0)
    expect(await fs.readdir(result.work)).toEqual(['ritual'])
    expect(await fs.readFile(path.join(result.work, 'ritual'), 'utf8')).toBe(BINARY)
  })

  test('fails the step on an archive that does not match its .sha256', async () => {
    const result = await download(TAMPERED)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('WARNING: 1 computed checksum did NOT match')
    expect(await Bun.file(path.join(result.work, 'ritual')).exists()).toBeFalse()
  })
})

describe.skipIf(process.platform !== 'linux')('scripts/archive-binary.sh', () => {
  /** Pack `asset` in a fresh directory; the archive's bytes. */
  async function pack(asset: string): Promise<Buffer> {
    dir ??= await fs.mkdtemp(path.join(tmpdir(), 'ritual-archive-'))
    await fs.writeFile(path.join(dir, asset), BINARY)
    const { name } = archiveFor(asset)
    const result = await run(
      ['bash', path.join(repoRoot, 'scripts/archive-binary.sh'), asset],
      dir,
      { PATH: process.env.PATH ?? '' },
    )
    expect(result).toMatchObject({ exitCode: 0, stdout: `${name}\n` })
    const archive = await fs.readFile(path.join(dir, name))
    expect(await fs.readFile(path.join(dir, `${name}.sha256`), 'utf8')).toBe(
      sha256Line(name, archive),
    )
    return archive
  }

  /** Pack `asset` and read it back the way self-update does. */
  async function packAndRead(asset: string): Promise<void> {
    const { format, member } = archiveFor(asset)
    const archive = await pack(asset)
    const unpacked = extractBinary(archive, format, member)
    expect(
      isMessageParseError(unpacked) ? unpacked.error : new TextDecoder().decode(unpacked),
    ).toBe(BINARY)
    // The same binary always packs to the same bytes.
    expect(await pack(asset)).toEqual(archive)
  }

  test('packs a tarball self-update reads, with a matching .sha256, executable inside', async () => {
    await packAndRead('ritual-linux-arm64')
    const listing = await run(['tar', '-tvzf', 'ritual-linux-arm64.tar.gz'], dir!, {
      PATH: process.env.PATH ?? '',
    })
    expect(listing.stdout).toStartWith('-rwxr-xr-x 0/0')
  })

  // The release build job runs it on Linux, where zip is installed.
  test.skipIf(Bun.which('zip') === null)(
    'packs a zip self-update reads, with a matching .sha256',
    async () => {
      await packAndRead('ritual-windows-x86_64.exe')
    },
  )
})
