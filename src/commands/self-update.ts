import { InvalidArgumentError, Option, type Command } from 'commander'
import { runCommandAction } from '../cli/action'
import { TEXT_ONLY } from '../cli/output'
import { ask } from '../cli/prompts'
import { getBaseDir } from '../config/base-dir'
import { getRitualConfigPath } from '../config/ritual-config'
import { t } from '../i18n/t'
import { defaultSelfUpdateEnv, type SelfUpdateEnv } from '../update/env'
import { requireAssetName } from '../update/install'
import { parseReleaseTag, type ChannelFlags } from '../update/release'
import {
  assertSelfUpdatable,
  installUpdate,
  planUpdate,
  prepareInstall,
  type UpdatePlan,
  type UpdateRequest,
} from '../update/self-update'
import { ExitCode, getErrorMessage } from '../util/errors'
import { fileExists } from '../util/fs'
import { isNoInput, requireFlag } from '../util/no-input'
import { isParseError } from '../util/parse-error'

/**
 * The exact-release flag is `--tag`, not `--version`: the root program owns
 * `--version`, and Commander lets a root option win anywhere on the command line.
 */
export type SelfUpdateCommandOptions = ChannelFlags & {
  /** The release tag, already normalized to `v…` by its argParser. */
  tag?: string
  check?: boolean
  yes?: boolean
}

/** Commander argParser for `--tag`: a value that is not a release version exits 2. */
function parseTagOption(value: string): string {
  const tag = parseReleaseTag(value)
  if (isParseError(tag)) {
    throw new InvalidArgumentError(t('cli.selfUpdate.error.invalidTag', { tag: value.trim() }))
  }
  return tag
}

/** `--check`: report, write nothing, and exit 4 when an update is available. */
function reportCheck(plan: UpdatePlan): void {
  if (plan.change === 'none') {
    console.log(
      t('cli.selfUpdate.upToDate', { current: plan.current, latest: plan.release.version }),
    )
    return
  }
  const params = { current: plan.current, latest: plan.release.version }
  console.log(
    plan.change === 'downgrade'
      ? t('cli.selfUpdate.downgradeAvailable', params)
      : t('cli.selfUpdate.available', params),
  )
  // A differing --tag is pending work either way, downgrade or not.
  process.exitCode = ExitCode.UpdatesPending
}

/** Whether the user agreed to the install; `--yes` agrees up front. */
async function confirmInstall(plan: UpdatePlan, yes: boolean): Promise<boolean> {
  if (yes) return true
  requireFlag('--yes')
  const confirmed = await ask<boolean>({
    type: 'confirm',
    message: t(
      plan.change === 'downgrade' ? 'cli.selfUpdate.confirmDowngrade' : 'cli.selfUpdate.confirm',
      { current: plan.current, target: plan.release.version },
    ),
    initial: plan.change !== 'downgrade',
  })
  return confirmed === true
}

/**
 * Inside a workspace, show what the *new* release would change: only it knows
 * its migrations, so its own `migrate --dry-run` runs, and nothing is applied.
 * Advisory — a failure to run it is a warning, never the update's failure.
 */
async function previewWorkspace(
  env: SelfUpdateEnv,
  binary: string,
  version: string,
): Promise<void> {
  if (!(await fileExists(getRitualConfigPath()))) return
  console.log(t('cli.selfUpdate.checkingWorkspace', { version }))
  const args = ['migrate', '--dry-run', '--base-dir', getBaseDir()]
  if (isNoInput()) args.push('--no-input')
  let failure: string | undefined
  try {
    const exitCode = await env.runInherited(binary, args)
    // `migrate --dry-run` exits 0 whether or not work is pending.
    if (exitCode !== ExitCode.Success) failure = t('cli.selfUpdate.previewExit', { exitCode })
  } catch (error) {
    failure = getErrorMessage(error)
  }
  if (failure !== undefined) {
    console.warn(t('cli.selfUpdate.workspaceCheckFailed', { error: failure }))
  }
}

function requestOf(options: SelfUpdateCommandOptions): UpdateRequest {
  return { prerelease: options.prerelease, stable: options.stable, tag: options.tag }
}

export async function runSelfUpdate(
  env: SelfUpdateEnv,
  options: SelfUpdateCommandOptions,
): Promise<void> {
  assertSelfUpdatable(env)
  if (options.check) {
    requireAssetName(env)
    reportCheck(await planUpdate(env, requestOf(options)))
    return
  }

  const target = await prepareInstall(env)
  const plan = await planUpdate(env, requestOf(options))
  if (plan.change === 'none') {
    console.log(
      options.tag === undefined
        ? t('cli.selfUpdate.upToDate', { current: plan.current, latest: plan.release.version })
        : t('cli.selfUpdate.alreadyInstalled', { version: plan.current }),
    )
    return
  }

  if (!(await confirmInstall(plan, options.yes === true))) {
    console.error(t('cli.selfUpdate.cancelled'))
    process.exitCode = ExitCode.UsageError
    return
  }

  console.log(t('cli.selfUpdate.downloading', { tag: plan.release.tag }))
  await installUpdate(env, plan, target)
  console.log(
    t('cli.selfUpdate.updated', {
      current: plan.current,
      target: plan.release.version,
      path: target,
    }),
  )
  await previewWorkspace(env, target, plan.release.version)
}

export function registerSelfUpdateCommand(
  program: Command,
  env: () => SelfUpdateEnv = defaultSelfUpdateEnv,
): void {
  program
    .command('self-update')
    .description(t('help.selfUpdate.description'))
    .addOption(
      new Option('--prerelease', t('help.selfUpdate.prerelease')).conflicts(['stable', 'tag']),
    )
    .addOption(new Option('--stable', t('help.selfUpdate.stable')).conflicts(['tag']))
    .addOption(new Option('--tag <tag>', t('help.selfUpdate.tag')).argParser(parseTagOption))
    .addOption(new Option('--check', t('help.selfUpdate.check')).conflicts(['yes']))
    .option('-y, --yes', t('help.selfUpdate.yes'))
    .action(async (options: SelfUpdateCommandOptions) => {
      await runCommandAction(TEXT_ONLY, () => runSelfUpdate(env(), options))
    })
}
