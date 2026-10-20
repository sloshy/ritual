/**
 * Everything `ritual self-update` learns from, or does to, the world outside
 * its own logic — the network, the running executable, the platform, the build,
 * child processes, and the one filesystem call whose failure tests must be able
 * to force — gathered into one injectable value so the engine can be
 * unit-tested without GitHub and without replacing the real test binary.
 */

import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isReleaseBuild, version } from '../config/version'
import type { HttpClient } from '../util/interfaces'
import { defaultHttpClient } from '../util/http'
import { GITHUB_RELEASES_API } from './release-source'
import { ENV_VAR } from '../util/cli-tokens'

/** The running build, as `self-update` judges it. */
export type BuildIdentity = {
  version: string
  /** Built by the release workflow at a release tag — see `isReleaseBuild`. */
  release: boolean
}

/** What a captured child run produced. */
export type BinaryRunResult = {
  exitCode: number
  stdout: string
  stderr: string
  /** The run was killed (it outlived its timeout) rather than exiting. */
  killed: boolean
}

/** How Ritual was installed, from `RITUAL_INSTALL`: only Ritual's Docker image sets it. */
export type InstallKind = 'docker' | undefined

export type SelfUpdateEnv = {
  fetch: HttpClient['fetch']
  /** The running executable — `process.execPath`. */
  execPath: string
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
  build: BuildIdentity
  installKind: InstallKind
  /** `GITHUB_TOKEN`, sent to the releases API when set (raises the rate limit). */
  githubToken: string | undefined
  /** The repository's API root, e.g. `https://api.github.com/repos/sloshy/ritual`. */
  apiBase: string
  /** Run a binary to completion and capture its output (the `--version` smoke test). */
  runBinary: (file: string, args: readonly string[]) => Promise<BinaryRunResult>
  /** Run a binary with this terminal's stdio and resolve with its exit code. */
  runInherited: (file: string, args: readonly string[]) => Promise<number>
  /** `fs.rename` — injectable so the Windows swap's rollback can be exercised. */
  rename: (from: string, to: string) => Promise<void>
}

/**
 * The part of {@link SelfUpdateEnv} a releases API lookup needs — all the
 * update-available notice (`src/commands/update-notice.ts`) carries.
 */
export type ReleaseApiEnv = Pick<SelfUpdateEnv, 'fetch' | 'githubToken' | 'apiBase'>

/** How long the downloaded binary gets to answer `--version`. */
const SMOKE_TEST_TIMEOUT_MS = 30_000

/**
 * The smoke test's environment: the user's, minus anything that would point
 * the new binary at a workspace, and never prompting. `--version` exits before
 * any command runs today; this keeps it hermetic if a release ever does more
 * at startup.
 */
function smokeTestEnv(): NodeJS.ProcessEnv {
  const { RITUAL_BASE_DIR: _baseDir, ...rest } = process.env
  return { ...rest, [ENV_VAR.noInput]: '1' }
}

function runCaptured(file: string, args: readonly string[]): Promise<BinaryRunResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        encoding: 'utf8',
        timeout: SMOKE_TEST_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        windowsHide: true,
        cwd: tmpdir(),
        env: smokeTestEnv(),
      },
      (error, stdout, stderr) => {
        // A non-zero exit, a timeout, or a spawn failure all arrive as `error`;
        // the smoke test only needs "it did not answer correctly", and why.
        if (error === null) {
          resolve({ exitCode: 0, stdout, stderr, killed: false })
          return
        }
        resolve({
          exitCode: typeof error.code === 'number' ? error.code : 1,
          stdout,
          stderr: stderr || error.message,
          killed: error.killed === true,
        })
      },
    )
  })
}

function runWithTerminal(file: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** Parse `RITUAL_INSTALL`; any value but `docker` means an ordinary install. */
export function parseInstallKind(value: string | undefined): InstallKind {
  return nonEmpty(value) === 'docker' ? 'docker' : undefined
}

/** The real environment of this process. */
export function defaultSelfUpdateEnv(): SelfUpdateEnv {
  return {
    fetch: (url, init) => defaultHttpClient.fetch(url, init),
    execPath: process.execPath,
    platform: process.platform,
    arch: process.arch,
    build: { version, release: isReleaseBuild },
    installKind: parseInstallKind(process.env.RITUAL_INSTALL),
    githubToken: nonEmpty(process.env[ENV_VAR.githubToken]),
    apiBase: GITHUB_RELEASES_API,
    runBinary: runCaptured,
    runInherited: runWithTerminal,
    rename: (from, to) => fs.rename(from, to),
  }
}
