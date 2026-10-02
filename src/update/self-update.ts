/**
 * The `ritual self-update` engine: decide whether this binary may update
 * itself, find the release to install, and install it. The command module
 * (`src/commands/self-update.ts`) owns prompting and printing; everything that
 * touches the outside world arrives through {@link SelfUpdateEnv}.
 */

import { compareVersions } from '../config/semver'
import { ExitCode, localizedCommandError } from '../util/errors'
import type { SelfUpdateEnv } from './env'
import {
  assertWritableTarget,
  installRelease,
  requireAssetName,
  resolveTargetBinary,
} from './install'
import { fetchRelease, resolveChannel, type ChannelFlags, type Release } from './release'

/** What the user asked for. */
export type UpdateRequest = ChannelFlags & {
  /** An exact release tag (already normalized to `v…`); overrides the channel. */
  tag?: string
}

/**
 * What installing the resolved release would do to the running build. A
 * channel lookup only ever offers an `upgrade`; an exact tag may be older.
 */
export type UpdateChange = 'none' | 'upgrade' | 'downgrade'

/** The release a run resolved, compared with the running build. */
export type UpdatePlan = {
  current: string
  release: Release
  change: UpdateChange
}

/**
 * Refuse a build that cannot update itself, in every mode (`--check` too).
 * Ritual's Docker image comes first: the image, not the binary, is the unit of
 * update (and an image may or may not hold a release build), so checking the
 * release identity first would hide the advice that applies. Otherwise only a compiled release
 * build knows which asset it is and has a release version to compare against;
 * a dev `bun run` or a local build would be replaced by something it is not.
 */
export function assertSelfUpdatable(env: SelfUpdateEnv): void {
  if (env.installKind === 'docker') {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.selfUpdate.refuse.docker')
  }
  if (env.build.release) return
  throw localizedCommandError(
    'usage_error',
    ExitCode.UsageError,
    'cli.selfUpdate.refuse.notRelease',
    { version: env.build.version },
  )
}

/**
 * Refuse an install that could not replace the binary, before any download:
 * an unsupported platform, or a directory the binary cannot be written into.
 * Resolves with the file the update will replace.
 */
export async function prepareInstall(env: SelfUpdateEnv): Promise<string> {
  requireAssetName(env)
  const target = await resolveTargetBinary(env.execPath)
  await assertWritableTarget(target)
  return target
}

/** Look up the release `request` names and compare it with the running build. */
export async function planUpdate(env: SelfUpdateEnv, request: UpdateRequest): Promise<UpdatePlan> {
  const current = env.build.version
  const release = await fetchRelease(
    env,
    request.tag === undefined
      ? { kind: 'channel', channel: resolveChannel(current, request) }
      : { kind: 'tag', tag: request.tag },
  )
  const order = compareVersions(release.version, current)
  const change: UpdateChange =
    order > 0 ? 'upgrade' : order < 0 && request.tag !== undefined ? 'downgrade' : 'none'
  return { current, release, change }
}

/** Download, verify, smoke-test, and swap `plan.release` into `target`. */
export async function installUpdate(
  env: SelfUpdateEnv,
  plan: UpdatePlan,
  target: string,
): Promise<void> {
  await installRelease(env, plan.release, target)
}
