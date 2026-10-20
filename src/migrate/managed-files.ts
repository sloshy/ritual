/**
 * The files `init-site` generates and `migrate` keeps current: the deploy
 * workflow templates, the `.gitignore` entries, and the registry of managed
 * files. The generated text is a repository artifact — English by contract,
 * like `.changes.md` — so nothing here goes through `t()`.
 *
 * A managed file that is renamed or retired is not described here: that is a
 * numbered migration (`src/migrate/migrations.ts`), so this registry only
 * ever names current paths.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  CISystem,
  GitHubActionsSiteConfig,
  InitSiteConfig,
  ManualSiteConfig,
} from '../config/ritual-config'
import { getBaseDir } from '../config/base-dir'
import { fileExists } from '../util/fs'
import {
  DEPLOY_WORKFLOW_ASSET,
  GITHUB_RELEASES_API,
  GITHUB_RELEASES_DOWNLOAD,
} from '../update/release-source'
import { writeFileAtomic } from '../util/atomic-write'
import { BACKUPS_DIR, TRASH_DIR } from '../util/safekeeping'
import { ENV_VAR } from '../util/cli-tokens'

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
 * Resolve the Ritual release the publish-for-me workflow downloads: the
 * `RITUAL_VERSION` repository variable when set, else the workspace's pin
 * (`managed.version`, which `ritual migrate` records from a release build).
 * The pin is stored without the `v` that release tags carry, so a missing
 * prefix is added to either source. A workspace only ever migrated by dev
 * builds has no pin; it falls back to the latest stable release, else (while
 * only prereleases exist) the newest non-draft release, with a warning naming
 * the tag picked, and fails only when neither resolves.
 */
const RITUAL_VERSION_STEP = `      - name: Get Ritual version
        id: ritual-version
        run: |
          VERSION="$${ENV_VAR.version}"
          if [ -z "$VERSION" ]; then
            VERSION=$(jq -r '.managed.version // empty' ritual.config.json)
          fi
          if [ -z "$VERSION" ]; then
            # No pin: the latest stable release, else (while only prereleases
            # exist) the newest release — the API omits drafts, newest first.
            VERSION=$(curl -s ${GITHUB_RELEASES_API}/releases/latest \\
              | grep '"tag_name"' | head -1 | cut -d'"' -f4)
            if [ -z "$VERSION" ]; then
              VERSION=$(curl -s "${GITHUB_RELEASES_API}/releases?per_page=1" \\
                | grep '"tag_name"' | head -1 | cut -d'"' -f4)
            fi
            if [ -n "$VERSION" ]; then
              echo "::warning::This workspace has no pinned Ritual release (managed.version in ritual.config.json), so $VERSION (the newest release) is used. Run 'ritual migrate' with a Ritual release build and commit ritual.config.json to pin one."
            fi
          fi
          if [ -z "$VERSION" ]; then
            echo "::error::Could not resolve a Ritual release to download. Pin one with 'ritual migrate' or set the ${ENV_VAR.version} repository variable."
            exit 1
          fi
          case "$VERSION" in
            v*) ;;
            *) VERSION="v$VERSION" ;;
          esac
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
        env:
          ${ENV_VAR.version}: \${{ vars.${ENV_VAR.version} }}`

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

${RITUAL_VERSION_STEP}

      - name: Cache Ritual binary
        id: ritual-cache
        uses: actions/cache@v6
        with:
          path: ritual
          key: ritual-binary-\${{ steps.ritual-version.outputs.version }}-${DEPLOY_WORKFLOW_ASSET}

      - name: Download Ritual
        if: steps.ritual-cache.outputs.cache-hit != 'true'
        run: |
          VERSION="\${{ steps.ritual-version.outputs.version }}"
          ASSET="${DEPLOY_WORKFLOW_ASSET}"
          curl -fsSL -o "$ASSET" "${GITHUB_RELEASES_DOWNLOAD}/\${VERSION}/$ASSET"
          curl -fsSL -o "$ASSET.sha256" "${GITHUB_RELEASES_DOWNLOAD}/\${VERSION}/$ASSET.sha256"
          sha256sum -c "$ASSET.sha256"
          mv "$ASSET" ritual
          rm "$ASSET.sha256"
          chmod +x ritual
${detectChanges ? DETECT_AND_COMMIT_STEP : ''}
      - name: Generate card manifest${guard}
        run: ./ritual list-all-cards --out all-cards.md

      - name: Restore Scryfall cache${guard}
        uses: actions/cache@v6
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
 * Whether a deploy's CI downloads Ritual — and so builds with the release
 * pinned in `managed.version`. Only a publish-for-me workflow runs Ritual.
 */
export function downloadsPinnedRelease(config: InitSiteConfig | null | undefined): boolean {
  return config?.ciSystem === 'github-actions' && config.deployMode === 'publish-for-me'
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
    `${TRASH_DIR}/`,
    `${BACKUPS_DIR}/`,
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

/** The non-blank, trimmed lines of a `.gitignore`-shaped block. */
function gitignoreLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** The workspace's `.gitignore` text, or `''` when there is none. */
export async function readWorkspaceGitignore(): Promise<string> {
  const gitignorePath = path.join(getBaseDir(), '.gitignore')
  return (await fileExists(gitignorePath)) ? fs.readFile(gitignorePath, 'utf-8') : ''
}

/** The lines of `entries` an existing `.gitignore` does not have yet, in order. */
export function missingGitignoreLines(existing: string, entries: string): string[] {
  const present = new Set(gitignoreLines(existing))
  return gitignoreLines(entries).filter((line) => !present.has(line))
}

/** What {@link updateGitignore} did to the workspace's `.gitignore`. */
export type GitignoreUpdate = 'created' | 'updated' | 'unchanged'

/** Append the lines of `entries` the workspace's `.gitignore` lacks. Existing lines are never removed. */
export async function updateGitignore(entries: string): Promise<GitignoreUpdate> {
  const existing = await readWorkspaceGitignore()
  const newLines = missingGitignoreLines(existing, entries)
  if (newLines.length === 0) return 'unchanged'

  const gitignorePath = path.join(getBaseDir(), '.gitignore')
  const suffix = newLines.join('\n') + '\n'
  if (existing.length === 0) {
    await writeFileAtomic(gitignorePath, suffix)
    return 'created'
  }
  const separator = existing.endsWith('\n') ? '' : '\n'
  await writeFileAtomic(gitignorePath, existing + separator + suffix)
  return 'updated'
}

/** What {@link refreshGitignore} did, and what it could not undo. */
export type GitignoreRefreshResult = {
  update: GitignoreUpdate
  /** The built-site directory the deploy commits, or null when it commits none. */
  committedDir: string | null
  /**
   * Pre-existing patterns that still ignore {@link committedDir} — a wildcard
   * the appended `!<dir>/` un-ignore cannot undo, which surfaces as an empty
   * deploy.
   */
  covering: string[]
}

/** Bring the workspace's `.gitignore` up to the current template for `deploy`. */
export async function refreshGitignore(deploy: InitSiteConfig): Promise<GitignoreRefreshResult> {
  const before = await readWorkspaceGitignore()
  const update = await updateGitignore(generateGitignoreEntries(deploy))
  const committedDir = committedDistDir(deploy)
  const covering = committedDir === null ? [] : gitignoreEntriesCovering(before, committedDir)
  return { update, committedDir, covering }
}

/** One generated file, path relative to the base dir (POSIX separators). */
export type GeneratedFile = { path: string; content: string }

/** Write a file under the base dir, creating its parent directories. */
export async function writeWorkspaceFile(relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(getBaseDir(), relativePath)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await writeFileAtomic(fullPath, content)
}

/** The deploy config each CI system's managed files are generated from. */
type DeployConfigByCI = {
  'github-actions': GitHubActionsSiteConfig
  manual: ManualSiteConfig
}

/** A file the current build generates for workspaces on CI system `C`. */
type ManagedFileFor<C extends CISystem> = {
  ciSystem: C
  /** Repository-relative path, POSIX separators. */
  path: string
  generate: (config: DeployConfigByCI[C]) => string
}

/** A file the current build generates, for whichever CI system it serves. */
export type ManagedFile = { [C in CISystem]: ManagedFileFor<C> }[CISystem]

/** Every file the current build generates. Retired paths are numbered migrations. */
export const MANAGED_FILES: readonly ManagedFile[] = [
  {
    ciSystem: 'github-actions',
    path: '.github/workflows/deploy-site.yml',
    generate: generateWorkflow,
  },
]

/** Render the managed files that apply to a deploy config, in registry order. */
export function renderManagedFiles(config: InitSiteConfig): GeneratedFile[] {
  return MANAGED_FILES.flatMap((file): GeneratedFile[] => {
    if (file.ciSystem === 'github-actions' && config.ciSystem === 'github-actions') {
      return [{ path: file.path, content: file.generate(config) }]
    }
    if (file.ciSystem === 'manual' && config.ciSystem === 'manual') {
      return [{ path: file.path, content: file.generate(config) }]
    }
    return []
  })
}
