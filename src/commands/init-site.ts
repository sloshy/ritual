import { Command, InvalidArgumentError } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  CISystem,
  DeployMode,
  InitSiteConfig,
  ManagedConfig,
  RitualConfig,
} from '../config/ritual-config'
import {
  getDefaultPriceSource,
  getSiteDeployConfig,
  getSiteSelectionConfig,
  loadRitualConfig,
  refreshRitualConfig,
  saveRitualConfig,
} from '../config/ritual-config'
import {
  PRICE_SOURCE_LABELS,
  VALID_PRICE_SOURCES,
  sourceCurrency,
  withPriceSource,
  type PriceSource,
} from '../pricing/price-source'
import {
  committedDistDir,
  downloadsPinnedRelease,
  refreshGitignore,
  renderManagedFiles,
  type GitignoreRefreshResult,
} from '../migrate/managed-files'
import { computeManagedOutput } from '../migrate/managed-output'
import { latestMigrationId } from '../migrate/migrations'
import {
  applyMigration,
  buildManagedStamp,
  hasPendingMigrations,
  hasPendingWork,
  planMigration,
  refusalError,
  RUNNING_BUILD,
  type MigrationPlan,
} from '../migrate/runner'
import { getBaseDir, workspaceRelative } from '../config/base-dir'
import { fileExists } from '../util/fs'
import { promptsUnavailable, requireInteractive } from '../util/no-input'
import { t } from '../i18n/t'
import type { MessageKey } from '../i18n/messages/en'
import { SKILLS } from '../skills/catalog'
import { installSkills, resolveSkillsDir } from '../skills/install'
import { printSkillsWriteSummary } from './skills'
import { localizedCommandError, ExitCode } from '../util/errors'
import { runCommandAction } from '../cli/action'
import { TEXT_ONLY } from '../cli/output'
import type { Choice } from 'prompts'
import { parseEnumFlag, parsePriceSourceFlag } from '../cli/options'
import { ask } from '../cli/prompts'
import { writeFileAtomic } from '../util/atomic-write'

/**
 * The build command the scaffolding tells the user to run.
 *
 * `build-site` publishes to `dist/` unless `--out-dir` says otherwise, so a
 * repository configured with any other `distDir` needs the flag spelled out —
 * the generated README used to print a bare `ritual build-site` and then claim
 * the site appeared in a directory nothing had written to.
 */
export function buildSiteCommand(distDir: string): string {
  return distDir === 'dist' ? 'ritual build-site' : `ritual build-site --out-dir ${distDir}`
}

/** The preview command, carrying the same `--out-dir` for a non-default distDir. */
export function servePreviewCommand(distDir: string): string {
  return distDir === 'dist' ? 'ritual serve --build' : `ritual serve --build --out-dir ${distDir}`
}

/**
 * The shared README preamble. `distDir` is the configured built-site directory
 * and `committed` says whether it is checked in (local-build deploys) rather
 * than gitignored — the two facts every command and layout line below depends on.
 */
function gettingStarted(distDir: string, committed: boolean): string {
  const generated = committed
    ? '`cache/`, `exports/`, and `all-cards.md` — generated artifacts (gitignored)'
    : `\`cache/\`, \`${distDir}/\`, \`exports/\`, and \`all-cards.md\` — generated artifacts (gitignored)`
  return `## Getting Started

Ritual manages three kinds of card lists as Markdown files in your repository:

- **Decks** in \`decks/\`
- **Collections** in \`collections/\`
- **Wanted lists** in \`wanted/\`

The easiest way to build any of them is the interactive editor:

\`\`\`sh
ritual edit
\`\`\`

\`ritual edit\` opens a single session over every list. From the menu you can
create a new deck, collection, or wanted list — or pick an existing one — and
then add, remove, and update cards. Your changes are written to disk when you
save on exit.

Prefer a browser? Run \`ritual admin\` to manage your lists from a local web
interface instead.

## Previewing Locally

Build and serve the site on your machine before you deploy:

\`\`\`sh
${servePreviewCommand(distDir)}
\`\`\`

Then open <http://localhost:3000> to preview it.

## Project Layout

- \`decks/\`, \`collections/\`, \`wanted/\` — your card lists as Markdown files
- \`ritual.config.json\` — site and pricing settings
- ${generated}${committed ? `\n- \`${distDir}/\` — your built site, committed so the deploy workflow can publish it` : ''}

## Documentation

For the full list of commands and features, see the
[Ritual documentation](https://ritual.rpeters.dev/).`
}

export function generateReadme(config: InitSiteConfig): string {
  // Only a local-build deploy has a configurable built-site directory (and is
  // the only mode that commits it); every other mode builds and ignores `dist/`.
  const committed = committedDistDir(config)
  const distDir = committed ?? 'dist'

  if (config.ciSystem === 'manual') {
    return `# My Ritual Site

A Magic: The Gathering deck site built with [Ritual](https://github.com/sloshy/ritual).

${gettingStarted(distDir, false)}

## Building

Install [Ritual](https://github.com/sloshy/ritual) and run:

\`\`\`sh
${buildSiteCommand(distDir)}
\`\`\`

The generated site is written to \`${distDir}/\`. Deploy it to any static hosting provider.
`
  }

  const buildInstructions =
    config.deployMode === 'publish-for-me'
      ? `## Deploying

This repository is configured with a GitHub Action that automatically builds and
deploys your site to GitHub Pages on every push to \`main\`.

The action downloads Ritual, fetches the latest card data from Scryfall, builds
your site, and deploys it. Both the Ritual binary and Scryfall cache are
persisted between runs so subsequent builds are fast.

### Ritual version

The action downloads the Ritual release pinned in \`ritual.config.json\`
(\`managed.version\`). The pin moves only when you run \`ritual migrate\` with a
newer Ritual release and commit the result. To override it, create a GitHub
Actions repository variable called \`RITUAL_VERSION\` set to a release tag
(e.g. \`v1.0.0\`).`
      : `## Building

Install [Ritual](https://github.com/sloshy/ritual) and run:

\`\`\`sh
${buildSiteCommand(distDir)}
\`\`\`

The generated site is written to \`${distDir}\`.

## Deploying

Commit the built \`${distDir}\` directory and push to \`main\`. The
included GitHub Action deploys it to GitHub Pages automatically. \`${distDir}/\`
is deliberately **not** gitignored for this deploy mode.`

  return `# My Ritual Site

A Magic: The Gathering deck site built with [Ritual](https://github.com/sloshy/ritual).

${gettingStarted(distDir, committed !== null)}

${buildInstructions}

## Setup

Make sure GitHub Pages is enabled in your repository settings:

1. Go to **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
`
}

async function promptOverwrite(filePath: string): Promise<boolean> {
  const relativePath = workspaceRelative(filePath)
  const overwrite = await ask<boolean>({
    type: 'confirm',
    message: t('cli.initSite.promptOverwrite', { path: relativePath }),
    initial: false,
  })
  return overwrite === true
}

type ForceOption = { force: boolean }

export type InitSiteCommandOptions = {
  force?: boolean
  skills?: boolean
  ci?: CISystem
  deploy?: DeployMode
  distDir?: string
  changeDetection?: boolean
  priceSource?: PriceSource
  overwriteReadme?: boolean
}

const CI_SYSTEMS = ['github-actions', 'manual'] as const satisfies readonly CISystem[]
const DEPLOY_MODES = ['publish-for-me', 'local-build'] as const satisfies readonly DeployMode[]

/** Commander argParser for `--ci`: only the two supported CI systems are valid. */
export function parseCISystemFlag(value: string): CISystem {
  return parseEnumFlag(value, CI_SYSTEMS, t('cli.initSite.fieldCiSystem'))
}

/** Commander argParser for `--deploy`: only the two deploy modes are valid. */
export function parseDeployModeFlag(value: string): DeployMode {
  return parseEnumFlag(value, DEPLOY_MODES, t('cli.initSite.fieldDeployMode'))
}

/** Commander argParser for `--dist-dir`: any non-empty path. */
export function parseDistDirFlag(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new InvalidArgumentError(t('cli.initSite.distDirRequired'))
  }
  return trimmed
}

/**
 * Install Ritual agent skills into the repository's `.claude/skills` so coding
 * agents working in the repo can drive Ritual. The decision is taken from the
 * `--skills`/`--no-skills` flags, falling back to an interactive prompt — a
 * headless run was already refused by {@link requireSkillsDecision} before any
 * file was written. `force` mirrors the init `--force` flag so existing skill
 * files are overwritten only when the rest of the generated files are.
 */
export async function maybeInstallSkills(
  options: InitSiteCommandOptions,
  force: boolean,
): Promise<void> {
  let install: boolean
  if (options.skills !== undefined) {
    install = options.skills
  } else {
    const answer = await ask<boolean>({
      type: 'confirm',
      message: t('cli.initSite.promptSkills'),
      initial: true,
    })
    install = answer === true
  }

  if (!install) return

  const skillsDir = resolveSkillsDir({})
  const relativeDir = workspaceRelative(skillsDir)
  const results = await installSkills(SKILLS, skillsDir, { force })
  printSkillsWriteSummary(results, {
    verb: 'installedIn',
    dir: relativeDir,
    noun: 'agentSkill',
    forceHint: t('cli.skills.forceHintInit'),
  })
}

async function writeFileWithOverwritePrompt(
  filePath: string,
  content: string,
  opts: ForceOption = { force: false },
): Promise<'written' | 'skipped'> {
  if (!opts.force && (await fileExists(filePath))) {
    if (promptsUnavailable()) {
      throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.initSite.fileExists', {
        path: path.relative(getBaseDir(), filePath),
      })
    }
    const shouldOverwrite = await promptOverwrite(filePath)
    if (!shouldOverwrite) return 'skipped'
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await writeFileAtomic(filePath, content)
  return 'written'
}

/** How `writeInitFiles` decides file overwrites: `--force` plus the README-specific flag. */
type WriteInitFilesOptions = ForceOption & {
  /** Explicit `--overwrite-readme`/`--no-overwrite-readme` decision, when given. */
  overwriteReadme?: boolean
}

/**
 * Write (or skip) the generated README. An explicit `--overwrite-readme` /
 * `--no-overwrite-readme` decides without prompting; otherwise `--force`
 * overwrites, and an existing file falls back to the interactive prompt.
 */
async function writeReadme(
  filePath: string,
  content: string,
  opts: WriteInitFilesOptions,
): Promise<'written' | 'skipped'> {
  if (await fileExists(filePath)) {
    const decision = opts.overwriteReadme ?? (opts.force ? true : undefined)
    if (decision === false) return 'skipped'
    if (decision === undefined) {
      if (promptsUnavailable()) {
        throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.initSite.readmeExists')
      }
      if (!(await promptOverwrite(filePath))) return 'skipped'
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await writeFileAtomic(filePath, content)
  return 'written'
}

export function registerInitSiteCommand(program: Command): void {
  program
    .command('init-site')
    .description(t('help.initSite.description'))
    .option('-f, --force', t('help.initSite.force'))
    .option('--ci <system>', t('help.initSite.ci'), parseCISystemFlag)
    .option('--deploy <mode>', t('help.initSite.deploy'), parseDeployModeFlag)
    .option('--dist-dir <dir>', t('help.initSite.distDir'), parseDistDirFlag)
    .option('--change-detection', t('help.initSite.changeDetection'))
    .option('--no-change-detection', t('help.initSite.noChangeDetection'))
    .option('--price-source <store>', t('help.initSite.priceSource'), parsePriceSourceFlag)
    .option('--overwrite-readme', t('help.initSite.overwriteReadme'))
    .option('--no-overwrite-readme', t('help.initSite.noOverwriteReadme'))
    .option('--skills', t('help.initSite.skills'))
    .option('--no-skills', t('help.initSite.noSkills'))
    .action(async (options: InitSiteCommandOptions) => {
      await runCommandAction(TEXT_ONLY, () => runInitSite(options))
    })
}

/**
 * The skills question is the one fresh-init prompt asked *after* the files are
 * written, so a headless run that cannot answer it is refused up front — before
 * anything is written — like every other missing flag.
 */
function requireSkillsDecision(options: InitSiteCommandOptions): void {
  if (options.skills === undefined) requireInteractive('--skills or --no-skills')
}

/** True when any flag that configures a fresh init was passed. */
function freshInitFlagsGiven(options: InitSiteCommandOptions): boolean {
  return (
    options.ci !== undefined ||
    options.deploy !== undefined ||
    options.distDir !== undefined ||
    options.changeDetection !== undefined ||
    options.priceSource !== undefined ||
    options.overwriteReadme !== undefined
  )
}

/**
 * Plan the workspace's pending migrations before an init writes anything, and
 * refuse a workspace this build cannot migrate (a newer Ritual updated it, or
 * its config cannot be made valid). Null when there is no config file yet.
 */
async function planInitMigrations(): Promise<MigrationPlan | null> {
  const outcome = await planMigration()
  if (outcome.kind === 'ahead' || outcome.kind === 'invalid') throw refusalError(outcome)
  return outcome.kind === 'plan' ? outcome : null
}

/**
 * Apply the planned migrations' ops before the init writes its own files, so
 * the migration counter it stamps never claims ops that did not run. No
 * refresh: the init regenerates every managed file itself.
 */
async function applyInitMigrations(plan: MigrationPlan | null): Promise<void> {
  if (plan !== null && hasPendingMigrations(plan)) {
    const { backupDir } = await applyMigration({ ...plan, refresh: null })
    if (backupDir !== null) {
      console.log(t('cli.migrate.backedUp', { path: workspaceRelative(backupDir) }))
    }
  }
}

async function runInitSite(options: InitSiteCommandOptions): Promise<void> {
  // --force: ignore saved state, resolve config fresh, overwrite everything
  if (options.force) {
    const migrations = await planInitMigrations()
    const config = await resolveConfig(options)
    if (!config) {
      process.exitCode = ExitCode.UsageError
      return
    }
    const priceSource = await resolveInitPriceSource(options)
    if (!priceSource) {
      console.error(t('cli.initSite.cancelled'))
      process.exitCode = ExitCode.UsageError
      return
    }
    requireSkillsDecision(options)
    await applyInitMigrations(migrations)
    const managedWritten = await writeInitFiles(config, {
      force: true,
      overwriteReadme: options.overwriteReadme,
    })
    if (!(await persistSiteConfig(config, priceSource, managedWritten))) {
      process.exitCode = ExitCode.RuntimeError
      return
    }
    await maybeInstallSkills(options, true)
    printNextSteps(config)
    return
  }

  const loaded = getSiteDeployConfig((await loadRitualConfig()).site)

  if (loaded !== null) {
    if (freshInitFlagsGiven(options)) {
      throw localizedCommandError(
        'usage_error',
        ExitCode.UsageError,
        'cli.initSite.alreadyInitializedFlags',
      )
    }

    // Bringing an initialized workspace up to date is `ritual migrate`'s job;
    // a re-run only reports whether one is due. Either way this is a success,
    // not a usage error: `init-site` is safe to run from a setup script that
    // just wants the repository initialized. A workspace `migrate` would refuse
    // is refused here the same way.
    const outcome = await planMigration()
    switch (outcome.kind) {
      case 'ahead':
      case 'invalid':
        throw refusalError(outcome)
      case 'plan':
        console.log(
          t(hasPendingWork(outcome) ? 'cli.migrate.pending' : 'cli.initSite.alreadyCurrent'),
        )
        return
      case 'no-config':
        console.log(t('cli.initSite.alreadyCurrent'))
        return
      default:
        outcome satisfies never
    }
    return
  }

  // Fresh init (no site config yet)
  const migrations = await planInitMigrations()
  const config = await resolveConfig(options)
  if (!config) {
    process.exitCode = ExitCode.UsageError
    return
  }
  const priceSource = await resolveInitPriceSource(options)
  if (!priceSource) {
    console.error(t('cli.initSite.cancelled'))
    process.exitCode = ExitCode.UsageError
    return
  }
  requireSkillsDecision(options)
  await applyInitMigrations(migrations)
  const managedWritten = await writeInitFiles(config, {
    force: false,
    overwriteReadme: options.overwriteReadme,
  })
  if (!(await persistSiteConfig(config, priceSource, managedWritten))) {
    process.exitCode = ExitCode.RuntimeError
    return
  }
  await maybeInstallSkills(options, false)
  printNextSteps(config)
}

/**
 * The `managed` stamp for a freshly initialized workspace: every migration
 * this build knows counts as applied (pending ones ran first, and the files
 * were just generated in their current shape). The output hash is recorded
 * only when every managed file was actually written — a workflow the user
 * kept leaves it unset, so `ritual migrate` offers the refresh.
 */
function freshManagedStamp(config: RitualConfig, managedWritten: boolean): ManagedConfig {
  const output = managedWritten ? computeManagedOutput(config) : null
  return buildManagedStamp({
    migration: latestMigrationId(),
    build: RUNNING_BUILD,
    recordedVersion: config.managed?.version,
    output: output?.hash,
  })
}

/**
 * Write the site deploy config and the `managed` stamp; on failure, print the
 * error and return false.
 */
async function persistSiteConfig(
  deploy: InitSiteConfig,
  priceSource: PriceSource,
  managedWritten: boolean,
): Promise<boolean> {
  try {
    const config = await loadRitualConfig()
    // Preserve any existing public-site selection settings (or seed the `['*']`
    // defaults) so writing the init-site-managed deployment config never clobbers
    // them.
    config.site = { ...getSiteSelectionConfig(config.site), ...deploy }
    config.defaultPriceSource = priceSource
    // The site can only open on a store it offers, so choosing one enables it.
    config.priceSources = withPriceSource(config.priceSources, priceSource, true)
    config.managed = freshManagedStamp(config, managedWritten)
    await saveRitualConfig(config)
    await refreshRitualConfig()
    return true
  } catch (err) {
    console.error(
      t('cli.initSite.configWriteFailed', {
        reason: err instanceof Error ? err.message : String(err),
      }),
    )
    return false
  }
}

/** Store choices for the init-site prompt, in canonical order with the current one marked. */
export function defaultPriceSourceChoices(current: PriceSource): Choice[] {
  return VALID_PRICE_SOURCES.map((source): Choice => {
    const name = t(PRICE_SOURCE_LABELS[source])
    return {
      title: source === current ? t('cli.initSite.priceSourceCurrent', { store: name }) : name,
      description: t('cli.initSite.priceSourceCurrency', {
        currency: sourceCurrency(source).toUpperCase(),
      }),
      value: source,
    }
  })
}

/**
 * Resolve the default price store: the `--price-source` flag when given,
 * otherwise the interactive prompt. When prompts are unavailable and the flag
 * is unset, a usage error naming `--price-source` is raised.
 */
async function resolveInitPriceSource(
  options: InitSiteCommandOptions,
): Promise<PriceSource | null> {
  if (options.priceSource !== undefined) return options.priceSource
  requireInteractive('--price-source <store>')
  return promptDefaultPriceSource()
}

/**
 * Ask which store price-touching surfaces should default to. Defaults to the
 * store currently in effect (TCGplayer out of the box). Returns null when the
 * prompt is cancelled.
 */
async function promptDefaultPriceSource(): Promise<PriceSource | null> {
  const current = getDefaultPriceSource(await loadRitualConfig())
  const source = await ask<PriceSource>({
    type: 'select',
    message: t('cli.initSite.promptPriceSource'),
    choices: defaultPriceSourceChoices(current),
    initial: Math.max(0, VALID_PRICE_SOURCES.indexOf(current)),
  })
  return source ?? null
}

/**
 * Resolve the init configuration from flags and prompts. Every value provided
 * by a flag skips its prompt; every value left unset prompts interactively.
 * When prompts are unavailable, an unset value raises a usage error naming the
 * missing flag. Returns null when a prompt is cancelled.
 */
async function resolveConfig(options: InitSiteCommandOptions): Promise<InitSiteConfig | null> {
  let ciSystem = options.ci
  if (ciSystem === undefined) {
    requireInteractive('--ci <system>')
    const picked = await ask<CISystem>({
      type: 'select',
      message: t('cli.initSite.promptCi'),
      choices: [
        {
          title: t('cli.initSite.ciGithubActions'),
          description: t('cli.initSite.ciGithubActionsHint'),
          value: 'github-actions',
        },
        {
          title: t('cli.initSite.ciManual'),
          description: t('cli.initSite.ciManualHint'),
          value: 'manual',
        },
      ],
    })

    if (picked === undefined) {
      console.error(t('cli.initSite.cancelled'))
      return null
    }
    ciSystem = picked
  }

  if (ciSystem === 'manual') {
    if (
      options.deploy !== undefined ||
      options.distDir !== undefined ||
      options.changeDetection !== undefined
    ) {
      throw localizedCommandError(
        'usage_error',
        ExitCode.UsageError,
        'cli.initSite.manualOnlyFlags',
      )
    }
    return { ciSystem }
  }

  let deployMode = options.deploy
  if (deployMode === undefined) {
    requireInteractive('--deploy <mode>')
    const picked = await ask<DeployMode>({
      type: 'select',
      message: t('cli.initSite.promptDeploy'),
      choices: [
        {
          title: t('cli.initSite.deployPublish'),
          description: t('cli.initSite.deployPublishHint'),
          value: 'publish-for-me',
        },
        {
          title: t('cli.initSite.deployLocal'),
          description: t('cli.initSite.deployLocalHint'),
          value: 'local-build',
        },
      ],
    })

    if (picked === undefined) {
      console.error(t('cli.initSite.cancelled'))
      return null
    }
    deployMode = picked
  }

  if (deployMode === 'local-build') {
    // Either explicit form is rejected, matching the `--ci manual` branch: the
    // generated local-build workflow has no detect-changes step to enable *or*
    // disable, so `--no-change-detection` was accepted and silently ignored.
    if (options.changeDetection !== undefined) {
      throw localizedCommandError(
        'usage_error',
        ExitCode.UsageError,
        'cli.initSite.changeDetectionScope',
      )
    }

    let distDir = options.distDir
    if (distDir === undefined) {
      requireInteractive('--dist-dir <dir>')
      const typed = await ask<string>({
        type: 'text',
        message: t('cli.initSite.promptDistDir'),
        initial: 'dist',
        // The same refusal `--dist-dir` gives an empty value, inline.
        validate: (value: string) => value.trim().length > 0 || t('cli.initSite.distDirRequired'),
      })

      if (typed === undefined) {
        console.error(t('cli.initSite.cancelled'))
        return null
      }
      distDir = typed.trim()
    }

    return { ciSystem, deployMode, distDir, detectChanges: false }
  }

  // publish-for-me
  if (options.distDir !== undefined) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.initSite.distDirScope')
  }

  const detectChanges = await resolveConfirmFlag(
    options.changeDetection,
    '--change-detection/--no-change-detection',
    'cli.initSite.promptChangeDetection',
  )
  if (detectChanges === null) return null

  return { ciSystem, deployMode, distDir: 'dist', detectChanges }
}

/**
 * Resolve a yes/no setting from its flag pair, else a default-no confirm
 * prompt. When prompts are unavailable and the flag is unset, a usage error
 * names `flags`. Returns null when the prompt is cancelled.
 */
async function resolveConfirmFlag(
  value: boolean | undefined,
  flags: string,
  message: MessageKey,
): Promise<boolean | null> {
  if (value !== undefined) return value
  requireInteractive(flags)
  const answer = await ask<boolean>({ type: 'confirm', message: t(message), initial: false })
  if (answer === undefined) {
    console.error(t('cli.initSite.cancelled'))
    return null
  }
  return answer
}

/**
 * Write the generated files. Returns whether every managed file was written
 * (false when the user kept an existing one at the overwrite prompt).
 */
async function writeInitFiles(
  config: InitSiteConfig,
  opts: WriteInitFilesOptions,
): Promise<boolean> {
  let managedWritten = true
  for (const file of renderManagedFiles(config)) {
    const filePath = path.join(getBaseDir(), file.path)
    const result = await writeFileWithOverwritePrompt(filePath, file.content, {
      force: opts.force,
    })
    if (result === 'skipped') managedWritten = false
    console.log(
      result === 'written'
        ? t('cli.initSite.created', { path: file.path })
        : t('cli.initSite.skipped', { path: file.path }),
    )
  }

  // Write README. --overwrite-readme/--no-overwrite-readme decides without
  // prompting; otherwise --force overwrites and an existing file prompts.
  const readmePath = path.join(getBaseDir(), 'README.md')
  const readmeResult = await writeReadme(readmePath, generateReadme(config), opts)
  console.log(
    readmeResult === 'written'
      ? t('cli.initSite.created', { path: 'README.md' })
      : t('cli.initSite.skipped', { path: 'README.md' }),
  )

  printGitignoreRefresh(await refreshGitignore(config), { reportUnchanged: true })
  return managedWritten
}

/** How {@link printGitignoreRefresh} reports a `.gitignore` that already had every entry. */
export type GitignoreReportOptions = { reportUnchanged: boolean }

/**
 * Report a `.gitignore` refresh (shared with `migrate`). When the deploy mode
 * commits the built site, an existing pattern that still covers that directory
 * is called out — the appended `!<dir>/` un-ignore cannot undo a wildcard, and
 * a swallowed ignore surfaces as an empty deploy.
 */
export function printGitignoreRefresh(
  result: GitignoreRefreshResult,
  options: GitignoreReportOptions,
): void {
  if (result.update === 'created') {
    console.log(t('cli.initSite.gitignoreCreated'))
  } else if (result.update === 'updated') {
    console.log(t('cli.initSite.gitignoreUpdated'))
  } else if (options.reportUnchanged) {
    console.log(t('cli.initSite.gitignoreUnchanged'))
  }
  if (result.committedDir !== null && result.covering.length > 0) {
    console.warn(
      t('cli.initSite.gitignoreStillIgnores', {
        dir: result.committedDir,
        patterns: result.covering.join(', '),
      }),
    )
  }
}

function printNextSteps(config: InitSiteConfig): void {
  console.log()
  const distDir = config.ciSystem === 'github-actions' ? config.distDir : 'dist'
  console.log(t('cli.initSite.nextSteps'))
  console.log(t('cli.initSite.stepAddDecks'))
  console.log(t('cli.initSite.stepPreview', { command: servePreviewCommand(distDir) }))

  if (config.ciSystem === 'manual') {
    console.log(t('cli.initSite.stepBuild', { command: buildSiteCommand(distDir) }))
    console.log(t('cli.initSite.stepDeployManual', { dir: distDir }))
  } else {
    console.log(t('cli.initSite.stepEnablePages'))
    if (config.deployMode === 'local-build') {
      // This mode deploys what you committed, so the build is a step the user
      // runs — with the flag that actually writes to the configured directory.
      console.log(
        t('cli.initSite.stepBuildAndCommit', {
          command: buildSiteCommand(distDir),
          dir: distDir,
        }),
      )
      console.log(t('cli.initSite.stepPushLocal'))
    } else {
      console.log(t('cli.initSite.stepPush'))
    }

    if (downloadsPinnedRelease(config)) {
      console.log()
      console.log(t('cli.initSite.pinVersionTip'))
    }
  }
}
