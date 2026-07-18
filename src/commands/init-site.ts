import { Command, InvalidArgumentError } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import prompts from 'prompts'
import type {
  CISystem,
  DeployMode,
  GitHubActionsSiteConfig,
  InitSiteConfig,
  SiteDeployConfig,
} from '../ritual-config'
import {
  getSiteDeployConfig,
  getSiteSelectionConfig,
  loadRitualConfig,
  reloadRitualConfig,
  saveRitualConfig,
} from '../ritual-config'
import { VALID_CURRENCIES, type PriceCurrency } from '../price-currency'
import type { ActiveManagedFile, ManagedFile, Migration } from '../managed-files'
import { computeMigrations, isActiveManagedFile } from '../managed-files'
import { compareVersions } from '../semver'
import { getBaseDir } from '../base-dir'
import { fileExists } from '../utils'
import { isNoInput } from '../no-input'
import { version as ritualVersion } from '../version'
import { SKILLS } from '../skills/catalog'
import { installSkills, refreshInstalledSkills, resolveSkillsDir } from '../skills/install'
import { CardCommandError } from '../errors'
import { runCommandAction } from './card-target'
import { ExitCode, normalizeScriptingOptions, parseEnumFlag } from './scripting'

/**
 * The `if:` guard stamped on every build/deploy step of the detect-changes
 * variant — when change detection pushes a new commit, that push re-triggers
 * the workflow, so the current run skips the build.
 */
const DETECT_CHANGES_GUARD = `\n        if: steps.detect-changes.outputs.has-changes != 'true'`

/** `with:` block appended to the checkout step so `git-detect-changes` can diff history. */
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
          ./ritual git-detect-changes "$BEFORE"
          if [ -n "$(git status --porcelain)" ]; then
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            SHORT_SHA=$(git rev-parse --short HEAD)
            git add -A
            git commit -m "Generated changes from commit $SHORT_SHA"
            git push
            echo "has-changes=true" >> "$GITHUB_OUTPUT"
          fi
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

const GETTING_STARTED = `## Getting Started

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
ritual serve --build
\`\`\`

Then open <http://localhost:3000> to preview it.

## Project Layout

- \`decks/\`, \`collections/\`, \`wanted/\` — your card lists as Markdown files
- \`ritual.config.json\` — site and pricing settings
- \`cache/\`, \`dist/\`, and \`all-cards.md\` — generated artifacts (gitignored)

## Documentation

For the full list of commands and features, see the
[Ritual documentation](https://ritual.rpeters.dev/).`

export function generateReadme(config: InitSiteConfig): string {
  if (config.ciSystem === 'manual') {
    return `# My Ritual Site

A Magic: The Gathering deck site built with [Ritual](https://github.com/sloshy/ritual).

${GETTING_STARTED}

## Building

Install [Ritual](https://github.com/sloshy/ritual) and run:

\`\`\`sh
ritual build-site
\`\`\`

The generated site is written to \`dist/\`. Deploy it to any static hosting provider.
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
ritual build-site
\`\`\`

The generated site is written to \`${config.distDir}\`.

## Deploying

Commit the built \`${config.distDir}\` directory and push to \`main\`. The
included GitHub Action deploys it to GitHub Pages automatically.`

  return `# My Ritual Site

A Magic: The Gathering deck site built with [Ritual](https://github.com/sloshy/ritual).

${GETTING_STARTED}

${buildInstructions}

## Setup

Make sure GitHub Pages is enabled in your repository settings:

1. Go to **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
`
}

export function generateGitignoreEntries(): string {
  return `# Ritual files
cache/
dist/
.admin-dist/
.logins/
all-cards.md
# Ritual binary downloaded by the deploy workflow
/ritual
`
}

async function promptOverwrite(filePath: string): Promise<boolean> {
  const relativePath = path.relative(getBaseDir(), filePath)
  let cancelled = false
  const response = await prompts(
    {
      type: 'confirm',
      name: 'overwrite',
      message: `${relativePath} already exists. Overwrite?`,
      initial: false,
    },
    {
      onCancel: () => {
        cancelled = true
      },
    },
  )
  if (cancelled) return false
  return response.overwrite === true
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

/** Whether interactive prompts can run: prompting enabled and stdin is a terminal. */
function promptsAvailable(): boolean {
  return !isNoInput() && process.stdin.isTTY === true
}

/** The usage error raised when a prompt is needed but prompts are unavailable. */
function missingFlagError(flag: string, what: string): CardCommandError {
  return new CardCommandError(
    'usage_error',
    `${what} is required and prompts are unavailable; pass ${flag}.`,
    ExitCode.UsageError,
  )
}

function usageError(message: string): CardCommandError {
  return new CardCommandError('usage_error', message, ExitCode.UsageError)
}

const CI_SYSTEMS = ['github-actions', 'manual'] as const satisfies readonly CISystem[]
const DEPLOY_MODES = ['publish-for-me', 'local-build'] as const satisfies readonly DeployMode[]

/** Commander argParser for `--ci`: only the two supported CI systems are valid. */
export function parseCISystemFlag(value: string): CISystem {
  return parseEnumFlag(value, CI_SYSTEMS, 'CI system')
}

/** Commander argParser for `--deploy`: only the two deploy modes are valid. */
export function parseDeployModeFlag(value: string): DeployMode {
  return parseEnumFlag(value, DEPLOY_MODES, 'deploy mode')
}

/** Commander argParser for `--dist-dir`: any non-empty path. */
export function parseDistDirFlag(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new InvalidArgumentError('Expected a directory path for --dist-dir.')
  }
  return trimmed
}

/** Commander argParser for `--currency`: one of the supported price currencies. */
export function parseCurrencyFlag(value: string): PriceCurrency {
  return parseEnumFlag(value.trim(), VALID_CURRENCIES, 'currency')
}

/**
 * Install Ritual agent skills into the repository's `.claude/skills` so coding
 * agents working in the repo can drive Ritual. The decision is taken from the
 * `--skills`/`--no-skills` flags, falling back to an interactive prompt; in a
 * non-interactive context the prompt cancels and skills are skipped. `force`
 * mirrors the init `--force` flag so existing skill files are overwritten only
 * when the rest of the generated files are.
 */
export async function maybeInstallSkills(
  options: InitSiteCommandOptions,
  force: boolean,
): Promise<void> {
  let install: boolean
  if (options.skills !== undefined) {
    install = options.skills
  } else {
    let cancelled = false
    const response = await prompts(
      {
        type: 'confirm',
        name: 'install',
        message:
          'Install Ritual agent skills into .claude/skills so coding agents can work with this repository?',
        initial: true,
      },
      {
        onCancel: () => {
          cancelled = true
        },
      },
    )
    install = !cancelled && response.install === true
  }

  if (!install) return

  const skillsDir = resolveSkillsDir({})
  const relativeDir = path.relative(getBaseDir(), skillsDir)
  const results = await installSkills(SKILLS, skillsDir, { force })
  const written = results.filter((result) => result.status === 'written').length
  const skipped = results.filter((result) => result.status === 'skipped').length

  if (written > 0) {
    console.log(
      `✓ Installed ${written} Ritual agent skill${written === 1 ? '' : 's'} in ${relativeDir}`,
    )
  }
  if (skipped > 0) {
    console.log(
      `⊘ ${skipped} Ritual agent skill${skipped === 1 ? '' : 's'} already present in ${relativeDir} (use --force to refresh)`,
    )
  }
}

/**
 * Keep already-installed skills current during an upgrade. By default only the
 * skills already present in `.claude/skills` are overwritten with the current
 * version (no prompting, and skills the user never installed stay absent).
 * `--no-skills` opts out entirely; `--skills` forces a full (re)install of every
 * skill, matching the flag's meaning on a fresh init.
 */
export async function refreshSkillsOnUpgrade(options: InitSiteCommandOptions): Promise<void> {
  if (options.skills === false) return

  const skillsDir = resolveSkillsDir({})
  const relativeDir = path.relative(getBaseDir(), skillsDir)
  const results =
    options.skills === true
      ? await installSkills(SKILLS, skillsDir, { force: true })
      : await refreshInstalledSkills(SKILLS, skillsDir)

  const updated = results.filter((result) => result.status === 'written').length
  if (updated > 0) {
    console.log(
      `✓ Updated ${updated} Ritual agent skill${updated === 1 ? '' : 's'} in ${relativeDir}`,
    )
  }
}

async function writeFileWithOverwritePrompt(
  filePath: string,
  content: string,
  opts: ForceOption = { force: false },
): Promise<'written' | 'skipped'> {
  if (!opts.force && (await fileExists(filePath))) {
    if (!promptsAvailable()) {
      throw usageError(
        `${path.relative(getBaseDir(), filePath)} already exists and prompts are unavailable; ` +
          'pass --force to overwrite generated files.',
      )
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
      if (!promptsAvailable()) {
        throw usageError(
          'README.md already exists and prompts are unavailable; ' +
            'pass --overwrite-readme or --no-overwrite-readme.',
        )
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
      console.log(`↻ Updated ${migration.path}`)
    } else {
      try {
        await fs.rm(fullPath)
        console.log(`✕ Removed ${migration.path}`)
      } catch {
        // File may not exist — that's fine
      }
    }
  }
}

export function registerInitSiteCommand(program: Command): void {
  program
    .command('init-site')
    .description('Initialize the current directory for publishing a Ritual site')
    .option(
      '-f, --force',
      'Re-initialize and overwrite all generated files, ignoring the existing site config',
    )
    .option('-u, --upgrade', 'Upgrade tracked workflows to the current version without prompting')
    .option(
      '--ci <system>',
      "CI system for a fresh init: 'github-actions' or 'manual'",
      parseCISystemFlag,
    )
    .option(
      '--deploy <mode>',
      "Deploy mode for a fresh init: 'publish-for-me' or 'local-build' (github-actions only)",
      parseDeployModeFlag,
    )
    .option(
      '--dist-dir <dir>',
      'Directory containing your locally built site (local-build deploys only)',
      parseDistDirFlag,
    )
    .option(
      '--change-detection',
      'Enable automatic change detection in the generated workflow (publish-for-me only)',
    )
    .option('--no-change-detection', 'Disable automatic change detection (no prompt)')
    .option(
      '--currency <currency>',
      "Default price currency: 'usd', 'eur', or 'tix'",
      parseCurrencyFlag,
    )
    .option('--overwrite-readme', 'Overwrite an existing README.md without prompting')
    .option('--no-overwrite-readme', 'Keep an existing README.md as-is (no prompt)')
    .option('--skills', 'Install Ritual agent skills into .claude/skills without prompting')
    .option('--no-skills', 'Skip installing Ritual agent skills (no prompt)')
    .action(async (options: InitSiteCommandOptions) => {
      await runCommandAction(normalizeScriptingOptions({}), () => runInitSite(options))
    })
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
      console.error('Cancelled.')
      process.exitCode = ExitCode.UsageError
      return
    }
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
      throw usageError(
        'This repository is already initialized; --ci, --deploy, --dist-dir, ' +
          '--change-detection, --currency, and --overwrite-readme only apply to a fresh init. ' +
          'Use --force to re-initialize with new settings.',
      )
    }

    const cmp = compareVersions(ritualVersion, loaded.version)

    if (cmp === 0) {
      console.error(`Already initialized with the current version (${ritualVersion}).`)
      process.exitCode = ExitCode.UsageError
      return
    }

    if (cmp < 0) {
      console.warn(
        `Warning: The current Ritual build (${ritualVersion}) is older than the version ` +
          `last used to initialize this repository (${loaded.version}).`,
      )
      console.warn(
        'Use --force to re-initialize with current settings, or remove the "site" key from ' +
          'ritual.config.json if you want to use this older version.',
      )
      process.exitCode = ExitCode.RuntimeError
      return
    }

    // Newer build: prompt unless --upgrade was passed
    if (!options.upgrade) {
      if (!promptsAvailable()) {
        throw usageError(
          `Ritual has been upgraded (${loaded.version} → ${ritualVersion}) and prompts are ` +
            'unavailable; pass --upgrade to regenerate tracked managed files.',
        )
      }
      let cancelled = false
      const response = await prompts(
        {
          type: 'confirm',
          name: 'confirm',
          message: `Ritual has been upgraded (${loaded.version} → ${ritualVersion}). Regenerate tracked managed files?`,
          initial: true,
        },
        {
          onCancel: () => {
            cancelled = true
          },
        },
      )
      if (cancelled || !response.confirm) {
        console.error('Cancelled.')
        process.exitCode = ExitCode.UsageError
        return
      }
    }

    console.log(`Upgrading from ${loaded.version} to ${ritualVersion}...`)
    const { version: _version, ...config } = loaded
    const migrations = computeMigrations(loaded.version, ritualVersion, MANAGED_FILES, config)
    await applyMigrations(migrations)

    // Keep .gitignore in sync with the current template. This is idempotent
    // (only missing entries are added), so upgrades pick up new exclusions
    // such as the downloaded /ritual binary.
    const gitignoreResult = await updateGitignore(generateGitignoreEntries())
    if (gitignoreResult === 'created') {
      console.log('✓ Created .gitignore')
    } else if (gitignoreResult === 'updated') {
      console.log('✓ Updated .gitignore')
    }

    const updatedSite: SiteDeployConfig = { ...config, version: ritualVersion }
    if (!(await persistSiteConfig(updatedSite))) {
      process.exitCode = ExitCode.RuntimeError
      return
    }
    console.log(`✓ ritual.config.json site section updated to ${ritualVersion}`)

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
    console.error('Cancelled.')
    process.exitCode = ExitCode.UsageError
    return
  }
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
    await reloadRitualConfig()
    return true
  } catch (err) {
    console.error(
      `Error: Failed to write ritual.config.json: ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}

/** Currency choices for the init-site prompt, USD first so it is the default. */
export function defaultCurrencyChoices(current: PriceCurrency): prompts.Choice[] {
  const descriptions: Record<PriceCurrency, string> = {
    usd: 'US Dollars (TCGplayer)',
    eur: 'Euros (Cardmarket)',
    tix: 'MTGO tickets',
  }
  return VALID_CURRENCIES.map((currency) => ({
    title: currency.toUpperCase() + (currency === current ? ' (current)' : ''),
    description: descriptions[currency],
    value: currency,
  }))
}

type DefaultCurrencyPromptResponse = { currency?: PriceCurrency }

/**
 * Resolve the default price currency: the `--currency` flag when given,
 * otherwise the interactive prompt. When prompts are unavailable and the flag
 * is unset, a usage error naming `--currency` is raised.
 */
async function resolveDefaultCurrency(
  options: InitSiteCommandOptions,
): Promise<PriceCurrency | null> {
  if (options.currency !== undefined) return options.currency
  if (!promptsAvailable()) {
    throw missingFlagError('--currency <currency>', 'A default price currency')
  }
  return promptDefaultCurrency()
}

/**
 * Ask which currency price-touching surfaces should default to. Defaults to
 * the currently configured value (USD out of the box). Returns null when the
 * prompt is cancelled.
 */
async function promptDefaultCurrency(): Promise<PriceCurrency | null> {
  const current = (await loadRitualConfig()).defaultCurrency
  let cancelled = false
  const response = (await prompts(
    {
      type: 'select',
      name: 'currency',
      message: 'Default price currency?',
      choices: defaultCurrencyChoices(current),
      initial: Math.max(0, VALID_CURRENCIES.indexOf(current)),
    },
    {
      onCancel: () => {
        cancelled = true
      },
    },
  )) as DefaultCurrencyPromptResponse
  if (cancelled || response.currency === undefined) return null
  return response.currency
}

/**
 * Resolve the init configuration from flags and prompts. Every value provided
 * by a flag skips its prompt; every value left unset prompts interactively.
 * When prompts are unavailable, an unset value raises a usage error naming the
 * missing flag. Returns null when a prompt is cancelled.
 */
async function resolveConfig(options: InitSiteCommandOptions): Promise<InitSiteConfig | null> {
  let cancelled = false
  const onCancel = () => {
    cancelled = true
  }

  let ciSystem = options.ci
  if (ciSystem === undefined) {
    if (!promptsAvailable()) throw missingFlagError('--ci <system>', 'A CI system')
    const ciResponse = await prompts(
      {
        type: 'select',
        name: 'ciSystem',
        message: 'Which CI system are you using?',
        choices: [
          {
            title: 'GitHub Actions',
            description: 'Generate a GitHub Actions workflow that builds and deploys automatically',
            value: 'github-actions',
          },
          {
            title: 'Manual / None',
            description: 'No CI integration — build and deploy manually',
            value: 'manual',
          },
        ],
      },
      { onCancel },
    )

    if (cancelled || ciResponse.ciSystem === undefined) {
      console.error('Cancelled.')
      return null
    }
    ciSystem = ciResponse.ciSystem as CISystem
  }

  if (ciSystem === 'manual') {
    if (
      options.deploy !== undefined ||
      options.distDir !== undefined ||
      options.changeDetection !== undefined
    ) {
      throw usageError(
        '--deploy, --dist-dir, and --change-detection only apply with --ci github-actions.',
      )
    }
    return { ciSystem }
  }

  let deployMode = options.deploy
  if (deployMode === undefined) {
    if (!promptsAvailable()) throw missingFlagError('--deploy <mode>', 'A deploy mode')
    const modeResponse = await prompts(
      {
        type: 'select',
        name: 'deployMode',
        message: 'How would you like to deploy your site?',
        choices: [
          {
            title: 'Publish for me',
            description:
              'Generate a GitHub Action that builds your site and deploys it automatically',
            value: 'publish-for-me',
          },
          {
            title: 'Deploy my local build',
            description:
              'Generate a GitHub Action that deploys a directory you build locally with build-site',
            value: 'local-build',
          },
        ],
      },
      { onCancel },
    )

    if (cancelled || modeResponse.deployMode === undefined) {
      console.error('Cancelled.')
      return null
    }
    deployMode = modeResponse.deployMode as DeployMode
  }

  if (deployMode === 'local-build') {
    if (options.changeDetection === true) {
      throw usageError('--change-detection only applies with --deploy publish-for-me.')
    }

    let distDir = options.distDir
    if (distDir === undefined) {
      if (!promptsAvailable())
        throw missingFlagError('--dist-dir <dir>', 'The built-site directory')
      const dirResponse = await prompts(
        {
          type: 'text',
          name: 'distDir',
          message: 'Which directory contains your built site?',
          initial: 'dist',
        },
        { onCancel },
      )

      if (cancelled || dirResponse.distDir === undefined) {
        console.error('Cancelled.')
        return null
      }
      distDir = dirResponse.distDir as string
    }

    return { ciSystem, deployMode, distDir, detectChanges: false }
  }

  // publish-for-me
  if (options.distDir !== undefined) {
    throw usageError('--dist-dir only applies with --deploy local-build.')
  }

  let detectChanges = options.changeDetection
  if (detectChanges === undefined) {
    if (!promptsAvailable()) {
      throw missingFlagError(
        '--change-detection/--no-change-detection',
        'Automatic change detection',
      )
    }
    const detectResponse = await prompts(
      {
        type: 'confirm',
        name: 'detectChanges',
        message: 'Enable automatic change detection? (commits changelogs when list files change)',
        initial: false,
      },
      { onCancel },
    )

    if (cancelled) {
      console.error('Cancelled.')
      return null
    }

    detectChanges = detectResponse.detectChanges === true
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
    if (result === 'written') {
      console.log(`✓ Created ${currentRecord.path}`)
    } else {
      console.log(`⊘ Skipped ${currentRecord.path}`)
    }
  }

  // Write README. --overwrite-readme/--no-overwrite-readme decides without
  // prompting; otherwise --force overwrites and an existing file prompts.
  const readmePath = path.join(getBaseDir(), 'README.md')
  const readmeResult = await writeReadme(readmePath, generateReadme(config), opts)
  if (readmeResult === 'written') {
    console.log('✓ Created README.md')
  } else {
    console.log('⊘ Skipped README.md')
  }

  // Update .gitignore
  const gitignoreResult = await updateGitignore(generateGitignoreEntries())
  if (gitignoreResult === 'created') {
    console.log('✓ Created .gitignore')
  } else if (gitignoreResult === 'updated') {
    console.log('✓ Updated .gitignore')
  } else {
    console.log('⊘ .gitignore already up to date')
  }
}

function printNextSteps(config: InitSiteConfig): void {
  console.log()
  console.log('Your site is ready! Next steps:')
  console.log('  1. Add decks to the decks/ directory (ritual new deck "My Deck")')
  console.log('  2. Preview locally with ritual serve --build')

  if (config.ciSystem === 'manual') {
    console.log('  3. Run ritual build-site to build your site')
    console.log('  4. Deploy the dist/ directory to your hosting provider')
  } else {
    console.log('  3. Enable GitHub Pages in your repo: Settings → Pages → Source: GitHub Actions')
    console.log('  4. Push to main to trigger a deploy')

    if (config.deployMode === 'publish-for-me') {
      console.log()
      console.log(
        'Tip: Pin a specific Ritual version by setting a RITUAL_VERSION repository variable.',
      )
    }
  }
}
