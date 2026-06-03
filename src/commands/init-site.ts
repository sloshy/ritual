import { Command } from 'commander'
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
import type { ActiveManagedFile, ManagedFile, Migration } from '../managed-files'
import { computeMigrations, isActiveManagedFile } from '../managed-files'
import { compareVersions } from '../semver'
import { getBaseDir } from '../base-dir'
import { fileExists } from '../utils'
import { version as ritualVersion } from '../version'
import { SKILLS } from '../skills/catalog'
import { installSkills, refreshInstalledSkills, resolveSkillsDir } from '../skills/install'

export function generatePublishForMeWorkflow(config?: GitHubActionsSiteConfig): string {
  if (config?.detectChanges) {
    return generatePublishForMeWithDetectChanges()
  }
  return generatePublishForMeBase()
}

function generatePublishForMeBase(): string {
  return `name: Build and Deploy Ritual Site

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
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v6

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

      - name: Generate card manifest
        run: ./ritual list-all-cards

      - name: Restore Scryfall cache
        uses: actions/cache@v5
        with:
          path: cache/
          key: ritual-cache-\${{ hashFiles('all-cards.md') }}
          restore-keys: ritual-cache-

      - name: Build site
        run: ./ritual build-site --allow-refresh

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: dist

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`
}

function generatePublishForMeWithDetectChanges(): string {
  return `name: Build and Deploy Ritual Site

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write
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
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

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

      - name: Generate card manifest
        if: steps.detect-changes.outputs.has-changes != 'true'
        run: ./ritual list-all-cards

      - name: Restore Scryfall cache
        if: steps.detect-changes.outputs.has-changes != 'true'
        uses: actions/cache@v5
        with:
          path: cache/
          key: ritual-cache-\${{ hashFiles('all-cards.md') }}
          restore-keys: ritual-cache-

      - name: Build site
        if: steps.detect-changes.outputs.has-changes != 'true'
        run: ./ritual build-site --allow-refresh

      - name: Setup Pages
        if: steps.detect-changes.outputs.has-changes != 'true'
        uses: actions/configure-pages@v5

      - name: Upload artifact
        if: steps.detect-changes.outputs.has-changes != 'true'
        uses: actions/upload-pages-artifact@v4
        with:
          path: dist

      - name: Deploy to GitHub Pages
        if: steps.detect-changes.outputs.has-changes != 'true'
        id: deployment
        uses: actions/deploy-pages@v4
`
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
      - uses: actions/checkout@v6

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: ${distDir}

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`
}

export function generateWorkflow(config: GitHubActionsSiteConfig): string {
  if (config.deployMode === 'publish-for-me') {
    return generatePublishForMeWorkflow(config)
  }
  return generateLocalBuildWorkflow(config.distDir)
}

export function generateReadme(config: InitSiteConfig): string {
  if (config.ciSystem === 'manual') {
    return `# My Ritual Site

A Magic: The Gathering deck site built with [Ritual](https://github.com/sloshy/ritual).

## Getting Started

Add your decks to the \`decks/\` directory as Markdown files. For example:

\`\`\`sh
ritual new-deck "My Commander Deck"
\`\`\`

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

## Getting Started

Add your decks to the \`decks/\` directory as Markdown files. For example:

\`\`\`sh
ritual new-deck "My Commander Deck"
\`\`\`

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
export type InitSiteCommandOptions = { force?: boolean; upgrade?: boolean; skills?: boolean }

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
): Promise<'written' | 'skipped' | 'cancelled'> {
  if (!opts.force && (await fileExists(filePath))) {
    const shouldOverwrite = await promptOverwrite(filePath)
    if (!shouldOverwrite) return 'skipped'
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
const MANAGED_FILES: ManagedFile[] = [
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
    .option('--skills', 'Install Ritual agent skills into .claude/skills without prompting')
    .option('--no-skills', 'Skip installing Ritual agent skills (no prompt)')
    .action(async (options: InitSiteCommandOptions) => {
      // --force: ignore saved state, prompt fresh, overwrite everything
      if (options.force) {
        const config = await promptForConfig()
        if (!config) return
        await writeInitFiles(config, { force: true })
        await persistSiteConfigOrExit({ ...config, version: ritualVersion })
        await maybeInstallSkills(options, true)
        printNextSteps(config)
        return
      }

      const loaded = getSiteDeployConfig((await loadRitualConfig()).site)

      if (loaded !== null) {
        const cmp = compareVersions(ritualVersion, loaded.version)

        if (cmp === 0) {
          console.log(`Already initialized with the current version (${ritualVersion}).`)
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
          return
        }

        // Newer build: prompt unless --upgrade was passed
        if (!options.upgrade) {
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
            console.log('Skipped.')
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
        await persistSiteConfigOrExit(updatedSite)
        console.log(`✓ ritual.config.json site section updated to ${ritualVersion}`)

        // Refresh any already-installed agent skills so they track the new version.
        await refreshSkillsOnUpgrade(options)
        return
      }

      // Fresh init (no site config yet)
      const config = await promptForConfig()
      if (!config) return
      await writeInitFiles(config, { force: false })
      await persistSiteConfigOrExit({ ...config, version: ritualVersion })
      await maybeInstallSkills(options, false)
      printNextSteps(config)
    })
}

async function persistSiteConfigOrExit(deploy: SiteDeployConfig): Promise<void> {
  try {
    const config = await loadRitualConfig()
    // Preserve any existing public-site selection settings (or seed the `['*']`
    // defaults) so writing the init-site-managed deployment config never clobbers
    // them.
    config.site = { ...getSiteSelectionConfig(config.site), ...deploy }
    await saveRitualConfig(config)
    await reloadRitualConfig()
  } catch (err) {
    console.error(
      `Error: Failed to write ritual.config.json: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }
}

async function promptForConfig(): Promise<InitSiteConfig | null> {
  let cancelled = false
  const onCancel = () => {
    cancelled = true
  }

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
    console.log('Cancelled.')
    return null
  }

  const ciSystem: CISystem = ciResponse.ciSystem

  if (ciSystem === 'manual') {
    return { ciSystem }
  }

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
    console.log('Cancelled.')
    return null
  }

  const deployMode: DeployMode = modeResponse.deployMode
  let distDir = 'dist'

  if (deployMode === 'local-build') {
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
      console.log('Cancelled.')
      return null
    }

    distDir = dirResponse.distDir
  }

  let detectChanges = false
  if (deployMode === 'publish-for-me') {
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
      console.log('Cancelled.')
      return null
    }

    detectChanges = detectResponse.detectChanges === true
  }

  return { ciSystem, deployMode, distDir, detectChanges }
}

async function writeInitFiles(config: InitSiteConfig, opts: ForceOption): Promise<void> {
  // Write managed files filtered to the selected CI system
  for (const file of MANAGED_FILES) {
    if (!isActiveManagedFile(file)) continue
    if (file.ciSystem !== config.ciSystem) continue
    const currentRecord = file.paths.find((r) => r.until === undefined)
    if (!currentRecord) continue
    const filePath = path.join(getBaseDir(), currentRecord.path)
    const result = await writeFileWithOverwritePrompt(filePath, file.generate(config), opts)
    if (result === 'written') {
      console.log(`✓ Created ${currentRecord.path}`)
    } else {
      console.log(`⊘ Skipped ${currentRecord.path}`)
    }
  }

  // Write README (user-editable — always prompt, even with --force)
  const readmePath = path.join(getBaseDir(), 'README.md')
  const readmeResult = await writeFileWithOverwritePrompt(readmePath, generateReadme(config))
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
  console.log('  1. Add decks to the decks/ directory (ritual new-deck "My Deck")')

  if (config.ciSystem === 'manual') {
    console.log('  2. Run ritual build-site to build your site')
    console.log('  3. Deploy the dist/ directory to your hosting provider')
  } else {
    console.log('  2. Enable GitHub Pages in your repo: Settings → Pages → Source: GitHub Actions')
    console.log('  3. Push to main to trigger a deploy')

    if (config.deployMode === 'publish-for-me') {
      console.log()
      console.log(
        'Tip: Pin a specific Ritual version by setting a RITUAL_VERSION repository variable.',
      )
    }
  }
}
