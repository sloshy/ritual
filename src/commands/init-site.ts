import { Command } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import prompts from 'prompts'

type DeployMode = 'publish-for-me' | 'local-build'

type InitSiteConfig = {
  deployMode: DeployMode
  distDir: string
}

export function generatePublishForMeWorkflow(): string {
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
        run: echo "version=\${RITUAL_VERSION:-latest}" >> "\$GITHUB_OUTPUT"
        env:
          RITUAL_VERSION: \${{ vars.RITUAL_VERSION }}

      - name: Download Ritual
        run: |
          VERSION="\${{ steps.ritual-version.outputs.version }}"
          if [ "\$VERSION" = "latest" ]; then
            DOWNLOAD_URL=\$(curl -s https://api.github.com/repos/sloshy/ritual/releases/latest \\
              | grep browser_download_url | grep linux-x86_64 | head -1 | cut -d'"' -f4)
          else
            DOWNLOAD_URL="https://github.com/sloshy/ritual/releases/download/\${VERSION}/ritual-linux-x86_64"
          fi
          curl -L -o ritual "\$DOWNLOAD_URL"
          chmod +x ritual

      - name: Restore Scryfall cache
        uses: actions/cache@v5
        with:
          path: cache/
          key: ritual-cache-\${{ hashFiles('decks/**', 'collections/**', 'wanted/**') }}
          restore-keys: ritual-cache-

      - name: Build site
        run: ./ritual build-site -y

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

export function generateWorkflow(config: InitSiteConfig): string {
  if (config.deployMode === 'publish-for-me') {
    return generatePublishForMeWorkflow()
  }
  return generateLocalBuildWorkflow(config.distDir)
}

export function generateReadme(config: InitSiteConfig): string {
  const buildInstructions =
    config.deployMode === 'publish-for-me'
      ? `## Deploying

This repository is configured with a GitHub Action that automatically builds and
deploys your site to GitHub Pages on every push to \`main\`.

The action downloads Ritual, fetches the latest card data from Scryfall, builds
your site, and deploys it. The Scryfall cache is persisted between runs so
subsequent builds are fast.

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
  return `cache/
dist/
`
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function promptOverwrite(filePath: string): Promise<boolean> {
  const relativePath = path.relative(process.cwd(), filePath)
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

async function writeFileWithOverwritePrompt(
  filePath: string,
  content: string,
): Promise<'written' | 'skipped' | 'cancelled'> {
  if (await fileExists(filePath)) {
    const shouldOverwrite = await promptOverwrite(filePath)
    if (!shouldOverwrite) return 'skipped'
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
  return 'written'
}

async function updateGitignore(entries: string): Promise<'created' | 'updated' | 'unchanged'> {
  const gitignorePath = path.join(process.cwd(), '.gitignore')
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

export function registerInitSiteCommand(program: Command) {
  program
    .command('init-site')
    .description('Initialize the current directory for publishing a Ritual site to GitHub Pages')
    .action(async () => {
      let cancelled = false
      const onCancel = () => {
        cancelled = true
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
        return
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
          return
        }

        distDir = dirResponse.distDir
      }

      const config: InitSiteConfig = { deployMode, distDir }

      // Generate and write workflow
      const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'deploy-site.yml')
      const workflowContent = generateWorkflow(config)
      const workflowResult = await writeFileWithOverwritePrompt(workflowPath, workflowContent)

      if (workflowResult === 'written') {
        console.log('✓ Created .github/workflows/deploy-site.yml')
      } else {
        console.log('⊘ Skipped .github/workflows/deploy-site.yml')
      }

      // Generate and write README
      const readmePath = path.join(process.cwd(), 'README.md')
      const readmeContent = generateReadme(config)
      const readmeResult = await writeFileWithOverwritePrompt(readmePath, readmeContent)

      if (readmeResult === 'written') {
        console.log('✓ Created README.md')
      } else {
        console.log('⊘ Skipped README.md')
      }

      // Update .gitignore
      const gitignoreEntries = generateGitignoreEntries()
      const gitignoreResult = await updateGitignore(gitignoreEntries)

      if (gitignoreResult === 'created') {
        console.log('✓ Created .gitignore')
      } else if (gitignoreResult === 'updated') {
        console.log('✓ Updated .gitignore')
      } else {
        console.log('⊘ .gitignore already up to date')
      }

      // Print next steps
      console.log()
      console.log('Your site is ready! Next steps:')
      console.log('  1. Add decks to the decks/ directory (ritual new-deck "My Deck")')
      console.log(
        '  2. Enable GitHub Pages in your repo: Settings → Pages → Source: GitHub Actions',
      )
      console.log('  3. Push to main to trigger a deploy')

      if (deployMode === 'publish-for-me') {
        console.log()
        console.log(
          'Tip: Pin a specific Ritual version by setting a RITUAL_VERSION repository variable.',
        )
      }
    })
}
