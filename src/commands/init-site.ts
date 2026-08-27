import { Command, InvalidArgumentError } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  CISystem,
  DeployMode,
  GitHubActionsSiteConfig,
  InitSiteConfig,
  SiteDeployConfig,
} from '../config/ritual-config'
import {
  getSiteDeployConfig,
  getSiteSelectionConfig,
  loadRitualConfig,
  refreshRitualConfig,
  saveRitualConfig,
} from '../config/ritual-config'
import { VALID_CURRENCIES, type PriceCurrency } from '../pricing/price-currency'
import type { ActiveManagedFile, ManagedFile, Migration } from '../list/managed-files'
import { computeMigrations, isActiveManagedFile } from '../list/managed-files'
import { compareVersions } from '../config/semver'
import { getBaseDir } from '../config/base-dir'
import { fileExists } from '../util/fs'
import { promptsUnavailable, requireInteractive } from '../util/no-input'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'
import { version as ritualVersion } from '../config/version'
import { SKILLS } from '../skills/catalog'
import { installSkills, refreshInstalledSkills, resolveSkillsDir } from '../skills/install'
import { printSkillsWriteSummary } from './skills'
import { localizedCommandError, ExitCode } from '../util/errors'
import { runCommandAction } from '../cli/action'
import { TEXT_ONLY } from '../cli/output'
import type { Choice } from 'prompts'
import { parseEnumFlag } from '../cli/options'
import { ask } from '../cli/prompts'

/**
 * The `if:` guard stamped on every build/deploy step of the detect-changes
 * variant — when change detection pushes a new commit, that push re-triggers
 * the workflow, so the current run skips the build.
 */
const DETECT_CHANGES_GUARD = `\n        if: steps.detect-changes.outputs.has-changes != 'true'`

/** `with:` block appended to the checkout step so `detect-changes` can diff history. */
const FULL_HISTORY_CHECKOUT = `\n        with:\n          fetch-depth: 0`

/** Step inserted between "Download Ritual" and "Generate card manifest" in the detect-changes variant. */
const DETECT_AND_COMMIT_STEP = `
      - name: Detect and commit changes
        id: detect-changes
        run: |
          BEFORE="\${{ github.event.before }}"
          if [ -z "$BEFORE" ] || [ "$BEFORE" = "0000000000000000000000000000000000000000" ]; then
            BEFORE="HEAD~1"
          fi
          # A per-file problem (e.g. a list file missing from the tree) exits
          # nonzero after the other files' changelogs are already written, so
          # capture the status and still commit — then fail the step at the end.
          DETECT_STATUS=0
          ./ritual detect-changes "$BEFORE" || DETECT_STATUS=$?
          if [ -n "$(git status --porcelain)" ]; then
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            SHORT_SHA=$(git rev-parse --short HEAD)
            git add -A
            git commit -m "Generated changes from commit $SHORT_SHA"
            git push
            echo "has-changes=true" >> "$GITHUB_OUTPUT"
          fi
          exit $DETECT_STATUS
`

/**
 * The trailing Setup Pages / Upload artifact / Deploy steps shared by every
 * generated workflow. `guard` is an `if:` line prefix stamped on each step
 * (`''` for none).
 */
function generateDeploySteps(distDir: string, guard: string): string {
  return `      - name: Setup Pages${guard}
        uses: actions/configure-pages@v6

      - name: Upload artifact${guard}
        uses: actions/upload-pages-artifact@v5
        with:
          path: ${distDir}

      - name: Deploy to GitHub Pages${guard}
        id: deployment
        uses: actions/deploy-pages@v5
`
}

export function generatePublishForMeWorkflow(config?: GitHubActionsSiteConfig): string {
  const detectChanges = config?.detectChanges === true
  const guard = detectChanges ? DETECT_CHANGES_GUARD : ''
  return `name: Build and Deploy Ritual Site

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: ${detectChanges ? 'write' : 'read'}
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v7${detectChanges ? FULL_HISTORY_CHECKOUT : ''}

      - name: Get Ritual version
        id: ritual-version
        run: |
          VERSION="\${RITUAL_VERSION:-latest}"
          if [ "$VERSION" = "latest" ]; then
            VERSION=$(curl -s https://api.github.com/repos/sloshy/ritual/releases/latest \\
              | grep '"tag_name"' | head -1 | cut -d'"' -f4)
          fi
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
        env:
          RITUAL_VERSION: \${{ vars.RITUAL_VERSION }}

      - name: Cache Ritual binary
        id: ritual-cache
        uses: actions/cache@v5
        with:
          path: ritual
          key: ritual-binary-\${{ steps.ritual-version.outputs.version }}-linux-x86_64

      - name: Download Ritual
        if: steps.ritual-cache.outputs.cache-hit != 'true'
        run: |
          VERSION="\${{ steps.ritual-version.outputs.version }}"
          curl -L -o ritual "https://github.com/sloshy/ritual/releases/download/\${VERSION}/ritual-linux-x86_64"
          chmod +x ritual
${detectChanges ? DETECT_AND_COMMIT_STEP : ''}
      - name: Generate card manifest${guard}
        run: ./ritual list-all-cards --out all-cards.md

      - name: Restore Scryfall cache${guard}
        uses: actions/cache@v5
        with:
          path: cache/
          key: ritual-cache-\${{ hashFiles('all-cards.md') }}
          restore-keys: ritual-cache-

      - name: Build site${guard}
        run: ./ritual build-site --refresh auto

${generateDeploySteps('dist', guard)}`
}

export function generateLocalBuildWorkflow(distDir: string): string {
  return `name: Deploy Ritual Site

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v7

${generateDeploySteps(distDir, '')}`
}

export function generateWorkflow(config: GitHubActionsSiteConfig): string {
  if (config.deployMode === 'publish-for-me') {
    return generatePublishForMeWorkflow(config)
  }
  return generateLocalBuildWorkflow(config.distDir)
}

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

### Customizing the Ritual version

By default the action downloads the latest Ritual release. To pin a specific
version, create a GitHub Actions repository variable called \`RITUAL_VERSION\`
set to the release tag (e.g. \`v1.0.0\`).`
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

/**
 * The built-site directory the scaffolding commits rather than ignores, or null
 * when nothing is committed. Only a local-build deploy publishes a directory the
 * user builds and checks in.
 */
export function committedDistDir(config?: InitSiteConfig): string | null {
  if (config === undefined || config.ciSystem !== 'github-actions') return null
  return config.deployMode === 'local-build' ? config.distDir : null
}

/**
 * The `.gitignore` entries the scaffolding maintains.
 *
 * A local-build deploy **commits** its built site — the workflow uploads the
 * checked-in directory — so that directory must not be ignored. The default
 * `dist/` line is dropped when it is the committed directory, and an explicit
 * un-ignore is appended so a `dist/` line an earlier init already wrote (this
 * file is only ever appended to) stops covering it.
 *
 * `.dist-build-*`/`.dist-old-*` are the scratch directories every build writes
 * beside its output (see `src/site-build/publish.ts`); an interrupted build leaves one
 * behind for hours. They matter most under a local-build deploy, where `dist/`
 * is deliberately committed and they would otherwise be the one thing a
 * `git add -A` swept in.
 */
export function generateGitignoreEntries(config?: InitSiteConfig): string {
  const committed = committedDistDir(config)
  const generated = [
    'cache/',
    'dist/',
    'exports/',
    '.admin-dist/',
    '.logins/',
    'all-cards.md',
    '.dist-build-*',
    '.dist-old-*',
  ]
    .filter((entry) => entry !== `${committed}/`)
    .join('\n')
  const unignore =
    committed === null
      ? ''
      : `# The built site is committed so the deploy workflow can publish it\n!${committed}/\n`
  return `# Ritual files
${generated}
# Ritual binary downloaded by the deploy workflow
/ritual
${unignore}`
}

/**
 * Existing `.gitignore` lines that would keep the committed built-site directory
 * out of the repository. The appended `!<dir>/` un-ignore handles the plain
 * cases; anything else (a `*`-style pattern, a nested path) is reported so the
 * user can fix it rather than discovering it in a failed deploy.
 *
 * A pattern is tested against a **file inside** the directory as well as against
 * the directory itself, because that is the case the un-ignore cannot undo:
 * `dist/**` and `dist/*` never match the string `dist`, so matching only the
 * bare name stayed silent about exactly the lines that keep every built file
 * ignored and deploy an empty site.
 */
export function gitignoreEntriesCovering(existing: string, distDir: string): string[] {
  const direct = new Set([distDir, `${distDir}/`, `/${distDir}`, `/${distDir}/`])
  // A representative built file. Any name works — the patterns that matter
  // (`dist/*`, `dist/**`, `di*`) are about the path shape, not the file name.
  const inside = `${distDir}/index.html`
  return existing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'))
    .filter((line) => !direct.has(line))
    .filter((line) => {
      const pattern = line.replace(/\/$/, '')
      const glob = new Bun.Glob(pattern)
      return glob.match(distDir) || glob.match(inside)
    })
}

async function promptOverwrite(filePath: string): Promise<boolean> {
  const relativePath = path.relative(getBaseDir(), filePath)
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
  upgrade?: boolean
  skills?: boolean
  ci?: CISystem
  deploy?: DeployMode
  distDir?: string
  changeDetection?: boolean
  currency?: PriceCurrency
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

/** Commander argParser for `--currency`: one of the supported price currencies. */
export function parseCurrencyFlag(value: string): PriceCurrency {
  return parseEnumFlag(value.trim(), VALID_CURRENCIES, t('cli.initSite.fieldCurrency'))
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
  const relativeDir = path.relative(getBaseDir(), skillsDir)
  const results = await installSkills(SKILLS, skillsDir, { force })
  printSkillsWriteSummary(results, {
    verb: 'installedIn',
    dir: relativeDir,
    noun: 'agentSkill',
    forceHint: t('cli.skills.forceHintInit'),
  })
}

/**
 * Keep already-installed skills current during an upgrade, following the same
 * rules as `ritual skills update`: only the skills already present in
 * `.claude/skills` are refreshed (no prompting, and skills the user never
 * installed stay absent), and user-edited skill files are skipped rather than
 * clobbered. `--no-skills` opts out entirely; `--skills` forces a full
 * (re)install of every skill, matching the flag's meaning on a fresh init.
 */
export async function refreshSkillsOnUpgrade(options: InitSiteCommandOptions): Promise<void> {
  if (options.skills === false) return

  const skillsDir = resolveSkillsDir({})
  const relativeDir = path.relative(getBaseDir(), skillsDir)
  const results =
    options.skills === true
      ? await installSkills(SKILLS, skillsDir, { force: true })
      : await refreshInstalledSkills(SKILLS, skillsDir, { force: false })

  // A never-installed skill staying absent is the upgrade path's contract, not
  // something to report — so `reportAbsent` stays off here.
  printSkillsWriteSummary(results, {
    verb: 'updatedIn',
    dir: relativeDir,
    noun: 'agentSkill',
    forceHint: t('cli.skills.forceHintUpdate'),
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
  await fs.writeFile(filePath, content, 'utf-8')
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
  await fs.writeFile(filePath, content, 'utf-8')
  return 'written'
}

export async function updateGitignore(
  entries: string,
): Promise<'created' | 'updated' | 'unchanged'> {
  const gitignorePath = path.join(getBaseDir(), '.gitignore')
  const linesToAdd = entries
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  let existing = ''
  if (await fileExists(gitignorePath)) {
    existing = await fs.readFile(gitignorePath, 'utf-8')
  }

  const existingLines = new Set(
    existing
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  )
  const newLines = linesToAdd.filter((l) => !existingLines.has(l))

  if (newLines.length === 0) return 'unchanged'

  const suffix = newLines.join('\n') + '\n'
  if (existing.length === 0) {
    await fs.writeFile(gitignorePath, suffix, 'utf-8')
    return 'created'
  }

  const separator = existing.endsWith('\n') ? '' : '\n'
  await fs.writeFile(gitignorePath, existing + separator + suffix, 'utf-8')
  return 'updated'
}

// Registry of all files ever managed by `ritual init-site`.
// Active files are regenerated on version upgrade for matching CI systems.
// Historical files are deleted (or have their old path cleaned up on rename) during migration.
export const MANAGED_FILES: ManagedFile[] = [
  {
    ciSystem: 'github-actions',
    paths: [{ path: '.github/workflows/deploy-site.yml' }],
    generate: (config: InitSiteConfig): string => {
      if (config.ciSystem !== 'github-actions') throw new Error('invariant: wrong ciSystem')
      return generateWorkflow(config)
    },
  } satisfies ActiveManagedFile,
]

async function applyMigrations(migrations: Migration[]): Promise<void> {
  for (const migration of migrations) {
    const fullPath = path.join(getBaseDir(), migration.path)
    if (migration.type === 'write') {
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, migration.content, 'utf-8')
      console.log(t('cli.initSite.migrationUpdated', { path: migration.path }))
    } else {
      try {
        await fs.rm(fullPath)
        console.log(t('cli.initSite.migrationRemoved', { path: migration.path }))
      } catch {
        // File may not exist — that's fine
      }
    }
  }
}

export function registerInitSiteCommand(program: Command): void {
  program
    .command('init-site')
    .description(t('help.initSite.description'))
    .option('-f, --force', t('help.initSite.force'))
    .option('-u, --upgrade', t('help.initSite.upgrade'))
    .option('--ci <system>', t('help.initSite.ci'), parseCISystemFlag)
    .option('--deploy <mode>', t('help.initSite.deploy'), parseDeployModeFlag)
    .option('--dist-dir <dir>', t('help.initSite.distDir'), parseDistDirFlag)
    .option('--change-detection', t('help.initSite.changeDetection'))
    .option('--no-change-detection', t('help.initSite.noChangeDetection'))
    .option('--currency <currency>', t('help.initSite.currency'), parseCurrencyFlag)
    .option('--overwrite-readme', t('help.initSite.overwriteReadme'))
    .option('--no-overwrite-readme', t('help.initSite.noOverwriteReadme'))
    .option('--skills', t('help.initSite.skills'))
    .option('--no-skills', t('help.initSite.noSkills'))
    .action(async (options: InitSiteCommandOptions) => {
      await runCommandAction(TEXT_ONLY, () => runInitSite(options))
    })
}

/** What re-running `init-site` in an already-initialized repository means. */
export type InitRerun = 'current' | 'upgrade' | 'downgrade'

/**
 * Classify a re-run against the version that last initialized the repository:
 * the same version is a no-op, a newer build regenerates managed files, and an
 * older build refuses rather than downgrading generated output.
 */
export function classifyInitRerun(currentVersion: string, initializedWith: string): InitRerun {
  const cmp = compareVersions(currentVersion, initializedWith)
  if (cmp === 0) return 'current'
  return cmp > 0 ? 'upgrade' : 'downgrade'
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
    options.currency !== undefined ||
    options.overwriteReadme !== undefined
  )
}

async function runInitSite(options: InitSiteCommandOptions): Promise<void> {
  // --force: ignore saved state, resolve config fresh, overwrite everything
  if (options.force) {
    const config = await resolveConfig(options)
    if (!config) {
      process.exitCode = ExitCode.UsageError
      return
    }
    const defaultCurrency = await resolveDefaultCurrency(options)
    if (!defaultCurrency) {
      console.error(t('cli.initSite.cancelled'))
      process.exitCode = ExitCode.UsageError
      return
    }
    requireSkillsDecision(options)
    await writeInitFiles(config, { force: true, overwriteReadme: options.overwriteReadme })
    if (!(await persistSiteConfig({ ...config, version: ritualVersion }, defaultCurrency))) {
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

    const rerun = classifyInitRerun(ritualVersion, loaded.version)

    if (rerun === 'current') {
      // The success state, not a usage error: `init-site` is safe to run from a
      // setup script that just wants the repository initialized.
      console.log(t('cli.initSite.alreadyCurrent', { version: ritualVersion }))
      return
    }

    if (rerun === 'downgrade') {
      console.warn(
        t('cli.initSite.downgrade', {
          current: ritualVersion,
          initialized: loaded.version,
        }),
      )
      console.warn(t('cli.initSite.downgradeAdvice'))
      process.exitCode = ExitCode.RuntimeError
      return
    }

    // Newer build (`rerun === 'upgrade'`): prompt unless --upgrade was passed
    if (!options.upgrade) {
      if (promptsUnavailable()) {
        throw localizedCommandError(
          'usage_error',
          ExitCode.UsageError,
          'cli.initSite.upgradeRequired',
          { from: loaded.version, to: ritualVersion },
        )
      }
      const confirm = await ask<boolean>({
        type: 'confirm',
        message: t('cli.initSite.promptUpgrade', {
          from: loaded.version,
          to: ritualVersion,
        }),
        initial: true,
      })
      if (!confirm) {
        console.error(t('cli.initSite.cancelled'))
        process.exitCode = ExitCode.UsageError
        return
      }
    }

    console.log(t('cli.initSite.upgrading', { from: loaded.version, to: ritualVersion }))
    const { version: _version, ...config } = loaded
    const migrations = computeMigrations(loaded.version, ritualVersion, MANAGED_FILES, config)
    await applyMigrations(migrations)

    // Keep .gitignore in sync with the current template. This is idempotent
    // (only missing entries are added), so upgrades pick up new exclusions
    // such as the downloaded /ritual binary.
    await writeGitignore(config)

    const updatedSite: SiteDeployConfig = { ...config, version: ritualVersion }
    if (!(await persistSiteConfig(updatedSite))) {
      process.exitCode = ExitCode.RuntimeError
      return
    }
    console.log(t('cli.initSite.configUpdated', { version: ritualVersion }))

    // Refresh any already-installed agent skills so they track the new version.
    await refreshSkillsOnUpgrade(options)
    return
  }

  // Fresh init (no site config yet)
  const config = await resolveConfig(options)
  if (!config) {
    process.exitCode = ExitCode.UsageError
    return
  }
  const defaultCurrency = await resolveDefaultCurrency(options)
  if (!defaultCurrency) {
    console.error(t('cli.initSite.cancelled'))
    process.exitCode = ExitCode.UsageError
    return
  }
  requireSkillsDecision(options)
  await writeInitFiles(config, { force: false, overwriteReadme: options.overwriteReadme })
  if (!(await persistSiteConfig({ ...config, version: ritualVersion }, defaultCurrency))) {
    process.exitCode = ExitCode.RuntimeError
    return
  }
  await maybeInstallSkills(options, false)
  printNextSteps(config)
}

/** Write the site deploy config; on failure, print the error and return false. */
async function persistSiteConfig(
  deploy: SiteDeployConfig,
  defaultCurrency?: PriceCurrency,
): Promise<boolean> {
  try {
    const config = await loadRitualConfig()
    // Preserve any existing public-site selection settings (or seed the `['*']`
    // defaults) so writing the init-site-managed deployment config never clobbers
    // them.
    config.site = { ...getSiteSelectionConfig(config.site), ...deploy }
    if (defaultCurrency !== undefined) config.defaultCurrency = defaultCurrency
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

/** Currency choices for the init-site prompt, USD first so it is the default. */
export function defaultCurrencyChoices(current: PriceCurrency): Choice[] {
  const descriptions = {
    usd: 'cli.initSite.currencyUsd',
    eur: 'cli.initSite.currencyEur',
    tix: 'cli.initSite.currencyTix',
  } as const satisfies Record<PriceCurrency, MessageKey>
  return VALID_CURRENCIES.map((currency): Choice => {
    const code = currency.toUpperCase()
    return {
      title: currency === current ? t('cli.initSite.currencyCurrent', { currency: code }) : code,
      description: t(descriptions[currency]),
      value: currency,
    }
  })
}

/**
 * Resolve the default price currency: the `--currency` flag when given,
 * otherwise the interactive prompt. When prompts are unavailable and the flag
 * is unset, a usage error naming `--currency` is raised.
 */
async function resolveDefaultCurrency(
  options: InitSiteCommandOptions,
): Promise<PriceCurrency | null> {
  if (options.currency !== undefined) return options.currency
  requireInteractive('--currency <currency>')
  return promptDefaultCurrency()
}

/**
 * Ask which currency price-touching surfaces should default to. Defaults to
 * the currently configured value (USD out of the box). Returns null when the
 * prompt is cancelled.
 */
async function promptDefaultCurrency(): Promise<PriceCurrency | null> {
  const current = (await loadRitualConfig()).defaultCurrency
  const currency = await ask<PriceCurrency>({
    type: 'select',
    message: t('cli.initSite.promptCurrency'),
    choices: defaultCurrencyChoices(current),
    initial: Math.max(0, VALID_CURRENCIES.indexOf(current)),
  })
  return currency ?? null
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

  let detectChanges = options.changeDetection
  if (detectChanges === undefined) {
    requireInteractive('--change-detection/--no-change-detection')
    const answer = await ask<boolean>({
      type: 'confirm',
      message: t('cli.initSite.promptChangeDetection'),
      initial: false,
    })

    if (answer === undefined) {
      console.error(t('cli.initSite.cancelled'))
      return null
    }

    detectChanges = answer
  }

  return { ciSystem, deployMode, distDir: 'dist', detectChanges }
}

async function writeInitFiles(config: InitSiteConfig, opts: WriteInitFilesOptions): Promise<void> {
  // Write managed files filtered to the selected CI system
  for (const file of MANAGED_FILES) {
    if (!isActiveManagedFile(file)) continue
    if (file.ciSystem !== config.ciSystem) continue
    const currentRecord = file.paths.find((r) => r.until === undefined)
    if (!currentRecord) continue
    const filePath = path.join(getBaseDir(), currentRecord.path)
    const result = await writeFileWithOverwritePrompt(filePath, file.generate(config), {
      force: opts.force,
    })
    console.log(
      result === 'written'
        ? t('cli.initSite.created', { path: currentRecord.path })
        : t('cli.initSite.skipped', { path: currentRecord.path }),
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

  // Update .gitignore
  await writeGitignore(config, { reportUnchanged: true })
}

/** How `writeGitignore` reports a `.gitignore` that already had every entry. */
type WriteGitignoreOptions = { reportUnchanged?: boolean }

/**
 * Bring `.gitignore` up to the current template and report what happened. When
 * the deploy mode commits the built site, an existing pattern that still covers
 * that directory is called out — the appended `!<dir>/` un-ignore cannot undo a
 * wildcard, and a swallowed ignore surfaces as an empty deploy.
 */
async function writeGitignore(
  config: InitSiteConfig,
  options: WriteGitignoreOptions = {},
): Promise<void> {
  const gitignorePath = path.join(getBaseDir(), '.gitignore')
  const before = (await fileExists(gitignorePath)) ? await fs.readFile(gitignorePath, 'utf-8') : ''

  const result = await updateGitignore(generateGitignoreEntries(config))
  if (result === 'created') {
    console.log(t('cli.initSite.gitignoreCreated'))
  } else if (result === 'updated') {
    console.log(t('cli.initSite.gitignoreUpdated'))
  } else if (options.reportUnchanged === true) {
    console.log(t('cli.initSite.gitignoreUnchanged'))
  }

  const committed = committedDistDir(config)
  if (committed === null) return
  const covering = gitignoreEntriesCovering(before, committed)
  if (covering.length > 0) {
    console.warn(
      t('cli.initSite.gitignoreStillIgnores', {
        dir: committed,
        patterns: covering.join(', '),
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

    if (config.deployMode === 'publish-for-me') {
      console.log()
      console.log(t('cli.initSite.pinVersionTip'))
    }
  }
}
