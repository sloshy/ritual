import { afterEach, describe, expect, test } from 'bun:test'
import yaml from 'js-yaml'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  defaultPriceSourceChoices,
  generateReadme,
  buildSiteCommand,
  servePreviewCommand,
} from '../../src/commands/init-site'
import {
  downloadsPinnedRelease,
  generatePublishForMeWorkflow,
  generateLocalBuildWorkflow,
  generateWorkflow,
  generateGitignoreEntries,
  gitignoreEntriesCovering,
  updateGitignore,
} from '../../src/migrate/managed-files'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { expectLocaleInForce, foreignLocales, withSyntheticLocale } from '../helpers/sync-text'
import type { InitSiteConfig } from '../../src/config/ritual-config'

type WorkflowStep = {
  name?: string
  id?: string
  uses?: string
  run?: string
  if?: string
  env?: Record<string, string>
  with?: Record<string, string | number>
}

type WorkflowJob = {
  'runs-on': string
  environment: { name: string; url: string }
  env?: Record<string, string>
  steps: WorkflowStep[]
}

type Workflow = {
  name: string
  on: { push: { branches: string[] }; workflow_dispatch: null }
  permissions: Record<string, string>
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: Record<string, WorkflowJob>
}

function parseWorkflow(raw: string): Workflow {
  return (yaml as { load: (s: string) => unknown }).load(raw) as Workflow
}

function findStep(steps: WorkflowStep[], name: string): WorkflowStep | undefined {
  return steps.find((s) => s.name === name)
}

function getJob(workflow: Workflow, name: string): WorkflowJob {
  const job = workflow.jobs[name]
  if (!job) throw new Error(`Job '${name}' not found in workflow`)
  return job
}

describe('generatePublishForMeWorkflow', () => {
  const workflow = parseWorkflow(generatePublishForMeWorkflow())
  const job = getJob(workflow, 'build-and-deploy')

  test('has exactly 10 steps in the expected order', () => {
    const stepNames = job.steps.map((s) => s.name ?? s.uses)
    expect(stepNames).toEqual([
      'actions/checkout@v7',
      'Get Ritual version',
      'Cache Ritual binary',
      'Download Ritual',
      'Generate card manifest',
      'Restore Scryfall cache',
      'Build site',
      'Setup Pages',
      'Upload artifact',
      'Deploy to GitHub Pages',
    ])
  })

  test('keeps the card cache in the checkout folder the cache step saves', () => {
    // Without the variable, Ritual would use the runner's per-user cache and the
    // restored cache/ folder would never be read or refilled.
    expect(job.env).toEqual({ RITUAL_CACHE_DIR: 'cache' })
    expect(findStep(job.steps, 'Restore Scryfall cache')?.with?.path).toBe('cache/')
  })

  test('writes the card manifest to an explicit --out file', () => {
    // list-all-cards prints to stdout by default, so the workflow must name
    // the cache-key file explicitly.
    const step = findStep(job.steps, 'Generate card manifest')
    expect(step?.run).toBe('./ritual list-all-cards --out all-cards.md')
  })

  test('checks each download against the release .sha256 before installing it', () => {
    // The .sha256 names the file, so each keeps its release name until the
    // check passes; a mismatch fails the step before `ritual` exists. Whole
    // lines, so a check made non-fatal (`|| true`) or a checksum fetched from
    // another tag does not pass. The archive comes first; the bare binary is
    // the fallback for a pinned release from before archives were published.
    // test/integration/release-downloads.test.ts runs the step itself.
    const run = findStep(job.steps, 'Download Ritual')?.run ?? ''
    const lines = run.split('\n').map((line) => line.trim())
    const expected = [
      'RELEASE="https://github.com/sloshy/ritual/releases/download/${VERSION}"',
      'ARCHIVE="ritual-linux-x86_64.tar.gz"',
      'if curl -fsSL -o "$ARCHIVE" "$RELEASE/$ARCHIVE"; then',
      'curl -fsSL -o "$ARCHIVE.sha256" "$RELEASE/$ARCHIVE.sha256"',
      'sha256sum -c "$ARCHIVE.sha256"',
      'tar -xzf "$ARCHIVE" ritual',
      'else',
      'ASSET="ritual-linux-x86_64"',
      'curl -fsSL -o "$ASSET" "$RELEASE/$ASSET"',
      'curl -fsSL -o "$ASSET.sha256" "$RELEASE/$ASSET.sha256"',
      'sha256sum -c "$ASSET.sha256"',
      'mv "$ASSET" ritual',
      'fi',
      'chmod +x ritual',
    ]
    expect(lines.filter((line) => expected.includes(line))).toEqual(expected)
  })
})

describe('the Get Ritual version step', () => {
  const steps = getJob(parseWorkflow(generatePublishForMeWorkflow()), 'build-and-deploy').steps
  const step = findStep(steps, 'Get Ritual version')
  const run = step?.run ?? ''

  test('the RITUAL_VERSION repository variable wins over the pin', () => {
    expect(step?.env?.RITUAL_VERSION).toBe('${{ vars.RITUAL_VERSION }}')
    expect(run).toMatch(/^VERSION="\$RITUAL_VERSION"\n/)
  })

  test('otherwise reads the pin from managed.version with jq', () => {
    // `// empty` turns an absent or null pin into an empty string, not "null".
    expect(run).toMatch(
      /if \[ -z "\$VERSION" \]; then\s+VERSION=\$\(jq -r '\.managed\.version \/\/ empty' ritual\.config\.json\)/,
    )
  })

  test('adds the v prefix release tags carry, to every source, without doubling it', () => {
    expect(run).toContain('v*) ;;')
    expect(run).toContain('*) VERSION="v$VERSION" ;;')
    expect(run.indexOf('case "$VERSION"')).toBeGreaterThan(run.indexOf('/releases?per_page=1'))
  })

  test('without a pin, tries the latest stable release, then the newest release', () => {
    const stable = run.indexOf('/releases/latest')
    const newest = run.indexOf('/releases?per_page=1')
    expect(stable).toBeGreaterThan(run.indexOf('jq -r'))
    expect(newest).toBeGreaterThan(stable)
    // The newest-release lookup runs only when no stable release resolved.
    expect(run.slice(stable, newest)).toMatch(
      /if \[ -z "\$VERSION" \]; then\s+VERSION=\$\(curl -s "[^"\n]*$/,
    )
  })

  test('warns with the tag it picked, only once one resolved', () => {
    expect(run).toMatch(
      /if \[ -n "\$VERSION" \]; then\s+echo "::warning::This workspace has no pinned Ritual release.*so \$VERSION \(the newest release\) is used.*ritual migrate/,
    )
    expect(run.indexOf('::warning::')).toBeGreaterThan(run.indexOf('/releases?per_page=1'))
  })

  test('fails the step when no release resolves at all', () => {
    expect(run).toMatch(/::error::.*\n\s*exit 1/)
  })

  test('the binary cache is keyed by the resolved version', () => {
    expect(step?.id).toBe('ritual-version')
    expect(findStep(steps, 'Cache Ritual binary')?.with?.key).toBe(
      'ritual-binary-${{ steps.ritual-version.outputs.version }}-ritual-linux-x86_64',
    )
  })
})

describe('downloadsPinnedRelease', () => {
  const github = { ciSystem: 'github-actions', distDir: 'dist', detectChanges: false } as const
  test.each([
    ['publish-for-me', { ...github, deployMode: 'publish-for-me' } as const, true],
    ['local-build', { ...github, deployMode: 'local-build' } as const, false],
    ['manual', { ciSystem: 'manual' } as const, false],
    ['no deploy config', null, false],
  ])('%s → %p', (_label, config, expected) => {
    expect(downloadsPinnedRelease(config)).toBe(expected)
  })
})

describe('generatePublishForMeWorkflow with detectChanges', () => {
  const config = {
    ciSystem: 'github-actions' as const,
    deployMode: 'publish-for-me' as const,
    distDir: 'dist',
    detectChanges: true,
  }
  const workflow = parseWorkflow(generatePublishForMeWorkflow(config))
  const job = getJob(workflow, 'build-and-deploy')

  test('grants contents: write and checks out full history for detect-changes', () => {
    expect(workflow.permissions.contents).toBe('write')
    const checkout = job.steps[0]
    expect(checkout?.uses).toBe('actions/checkout@v7')
    expect(checkout?.with?.['fetch-depth']).toBe(0)
  })

  test('build and deploy steps are conditional on no changes detected', () => {
    const conditionalSteps = [
      'Generate card manifest',
      'Restore Scryfall cache',
      'Build site',
      'Setup Pages',
      'Upload artifact',
      'Deploy to GitHub Pages',
    ]
    for (const name of conditionalSteps) {
      const step = findStep(job.steps, name)
      expect(step).toBeDefined()
      expect(step!.if).toBe("steps.detect-changes.outputs.has-changes != 'true'")
    }
  })

  test('has exactly 11 steps in the expected order', () => {
    const stepNames = job.steps.map((s) => s.name ?? s.uses)
    expect(stepNames).toEqual([
      'actions/checkout@v7',
      'Get Ritual version',
      'Cache Ritual binary',
      'Download Ritual',
      'Detect and commit changes',
      'Generate card manifest',
      'Restore Scryfall cache',
      'Build site',
      'Setup Pages',
      'Upload artifact',
      'Deploy to GitHub Pages',
    ])
  })

  test('writes the card manifest to an explicit --out file', () => {
    const step = findStep(job.steps, 'Generate card manifest')
    expect(step?.run).toBe('./ritual list-all-cards --out all-cards.md')
  })

  describe('the detect-and-commit step body', () => {
    const run = findStep(job.steps, 'Detect and commit changes')?.run ?? ''

    test('invokes the current command against the pushed-from commit', () => {
      expect(run).toContain('./ritual detect-changes "$BEFORE"')
      expect(run).not.toContain('git-detect-changes')
    })

    test('falls back to HEAD~1 when github.event.before is empty or all zeros', () => {
      expect(run).toContain('BEFORE="${{ github.event.before }}"')
      expect(run).toContain(
        'if [ -z "$BEFORE" ] || [ "$BEFORE" = "0000000000000000000000000000000000000000" ]',
      )
      expect(run).toContain('BEFORE="HEAD~1"')
    })

    test('commits before propagating a nonzero detect status', () => {
      // The step runs under `bash -e`, so an unguarded nonzero exit would abort
      // before the commit and strand the changelogs detection just wrote.
      expect(run).toContain('./ritual detect-changes "$BEFORE" || DETECT_STATUS=$?')
      expect(run.indexOf('git push')).toBeLessThan(run.indexOf('exit $DETECT_STATUS'))
    })
  })
})

describe('generateLocalBuildWorkflow', () => {
  const workflow = parseWorkflow(generateLocalBuildWorkflow('dist'))
  const job = getJob(workflow, 'deploy')

  test('deploys the user-specified directory', () => {
    const customWorkflow = parseWorkflow(generateLocalBuildWorkflow('build/output'))
    const customJob = getJob(customWorkflow, 'deploy')
    const step = findStep(customJob.steps, 'Upload artifact')
    expect(step!.with?.path).toBe('build/output')
  })

  test('has exactly 4 steps in the expected order', () => {
    const stepNames = job.steps.map((s) => s.name ?? s.uses)
    expect(stepNames).toEqual([
      'actions/checkout@v7',
      'Setup Pages',
      'Upload artifact',
      'Deploy to GitHub Pages',
    ])
  })
})

describe('generateWorkflow', () => {
  test('publish-for-me routes to the build-and-deploy job', () => {
    const workflow = parseWorkflow(
      generateWorkflow({
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
        detectChanges: false,
      }),
    )
    expect(Object.keys(workflow.jobs)).toEqual(['build-and-deploy'])
  })

  test('local-build routes to the deploy job', () => {
    const workflow = parseWorkflow(
      generateWorkflow({
        ciSystem: 'github-actions',
        deployMode: 'local-build',
        distDir: 'public',
        detectChanges: false,
      }),
    )
    expect(Object.keys(workflow.jobs)).toEqual(['deploy'])
  })
})

describe('generateReadme', () => {
  const baseConfig = {
    ciSystem: 'github-actions',
    deployMode: 'publish-for-me',
    distDir: 'dist',
    detectChanges: false,
  } as const

  test('publish-for-me mode documents the automated workflow without manual build steps', () => {
    const readme = generateReadme({ ...baseConfig, distDir: 'should-not-appear' })

    expect(readme).toContain('# My Ritual Site')
    expect(readme).toContain('github.com/sloshy/ritual')
    expect(readme).toContain('RITUAL_VERSION')
    expect(readme).toContain('automatically builds and')
    expect(readme).toContain('Settings → Pages')
    expect(readme).toContain('GitHub Actions')
    // The deploy flow is automated — no manual "Deploying" build/commit steps.
    expect(readme).not.toContain('Commit the built')
    // distDir is not interpolated into the README in this mode.
    expect(readme).not.toContain('should-not-appear')
  })

  test('publish-for-me mode says the workflow downloads the pinned release', () => {
    const readme = generateReadme(baseConfig)
    expect(readme).toContain('(`managed.version`)')
    expect(readme).toContain('`ritual migrate`')
  })

  test('local-build mode includes build instructions with the specified dist directory', () => {
    const readme = generateReadme({ ...baseConfig, deployMode: 'local-build', distDir: 'public' })

    expect(readme).toContain('ritual build-site')
    expect(readme).toContain('Commit the built')
    expect(readme).toContain('written to `public`')
    expect(readme).toContain('`public` directory')
    // A local build downloads no Ritual in CI, so there is no pin to explain.
    expect(readme).not.toContain('managed.version')
  })

  test('manual mode includes build instructions without GitHub Pages setup', () => {
    const readme = generateReadme({ ciSystem: 'manual' })

    expect(readme).toContain('# My Ritual Site')
    expect(readme).toContain('ritual build-site')
    expect(readme).not.toContain('Settings → Pages')
    expect(readme).not.toContain('RITUAL_VERSION')
  })

  test.each([
    ['publish-for-me', { ...baseConfig }],
    ['local-build', { ...baseConfig, deployMode: 'local-build' as const }],
    ['manual', { ciSystem: 'manual' as const }],
  ])('%s mode documents the edit workflow and links the docs', (_name, config) => {
    const readme = generateReadme(config)

    // The interactive editor is the documented way to build every list type.
    expect(readme).toContain('ritual edit')
    expect(readme).toContain('`decks/`')
    expect(readme).toContain('`collections/`')
    expect(readme).toContain('`wanted/`')
    // Link out to the full documentation site.
    expect(readme).toContain('https://ritual.rpeters.dev/')
    // Browser editor, local preview, and repo layout pointers.
    expect(readme).toContain('ritual admin')
    expect(readme).toContain('ritual serve --build')
    expect(readme).toContain('http://localhost:3000')
    expect(readme).toContain('ritual.config.json')
  })

  // The README is workspace content committed to the user's repository, like the
  // managed files: English by contract, whatever language the CLI speaks.
  const readmeConfigs: [string, InitSiteConfig][] = [
    ['publish-for-me', baseConfig],
    ['local-build', { ...baseConfig, deployMode: 'local-build', distDir: 'public' }],
    ['manual', { ciSystem: 'manual' }],
  ]
  describe.each(foreignLocales())('under $tag', ({ tag, catalog }) => {
    test.each(readmeConfigs)('%s mode writes the same bytes as English', (_name, config) => {
      const english = generateReadme(config)
      const localized = withSyntheticLocale(tag, catalog, (locale) => {
        expectLocaleInForce(locale)
        const readme = generateReadme(config)
        expectLocaleInForce(locale)
        return readme
      })
      expect(localized).toBe(english)
    })
  })
})

describe('generateGitignoreEntries', () => {
  test('each entry is on its own line', () => {
    const entries = generateGitignoreEntries()
    const lines = entries.split('\n').filter((l) => l.trim().length > 0 && !l.startsWith('#'))

    expect(lines).toEqual([
      'cache/',
      'dist/',
      'exports/',
      '.admin-dist/',
      '.logins/',
      // What `delete` and `migrate` keep a copy of, never meant for the repository.
      '.trash/',
      '.backups/',
      'all-cards.md',
      // Build scratch directories: every build makes one beside its output, and
      // an interrupted build leaves it there.
      '.dist-build-*',
      '.dist-old-*',
      '/ritual',
    ])
  })

  // The scaffolding matrix: only a local-build deploy commits its built site, so
  // only that mode may not ignore it. The generated README says so out loud, and
  // these two files have to agree.
  const lines = (config?: Parameters<typeof generateGitignoreEntries>[0]): string[] =>
    generateGitignoreEntries(config)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))

  test('a publish-for-me deploy still ignores the built site it never commits', () => {
    const config = {
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
      detectChanges: false,
    } as const
    expect(lines(config)).toContain('dist/')
    expect(lines(config).some((l) => l.startsWith('!'))).toBe(false)
    expect(generateReadme(config)).not.toContain('Commit the built')
  })

  test('a local-build deploy of dist/ neither ignores it nor contradicts the README', () => {
    const config = {
      ciSystem: 'github-actions',
      deployMode: 'local-build',
      distDir: 'dist',
      detectChanges: false,
    } as const
    expect(lines(config)).not.toContain('dist/')
    // An earlier init only ever appended, so the un-ignore un-does a stale line.
    expect(lines(config)).toContain('!dist/')
    const readme = generateReadme(config)
    expect(readme).toContain('Commit the built `dist` directory')
    expect(readme).not.toContain('`cache/`, `dist/`')
  })

  test('a local-build deploy of a custom directory un-ignores it and renders --out-dir', () => {
    const config = {
      ciSystem: 'github-actions',
      deployMode: 'local-build',
      distDir: 'out',
      detectChanges: false,
    } as const
    expect(lines(config)).toContain('dist/')
    expect(lines(config)).toContain('!out/')
    const readme = generateReadme(config)
    expect(readme).toContain('ritual build-site --out-dir out')
    expect(readme).toContain('ritual serve --build --out-dir out')
  })

  test('a manual (no CI) init ignores the default dist/', () => {
    expect(lines({ ciSystem: 'manual' })).toContain('dist/')
  })
})

describe('gitignoreEntriesCovering', () => {
  test('a plain entry is left to the appended un-ignore', () => {
    expect(gitignoreEntriesCovering('cache/\ndist/\n', 'dist')).toEqual([])
  })

  test('a wildcard the un-ignore cannot undo is reported', () => {
    expect(gitignoreEntriesCovering('di*\n', 'dist')).toEqual(['di*'])
  })

  // These are the patterns that actually defeat the appended `!<dir>/`: git
  // still ignores every file inside, so a local-build deploy commits nothing and
  // publishes an empty site. They never match the bare directory name, which is
  // why matching only that stayed silent about them.
  test.each([
    ['a directory-contents wildcard', 'dist/*\n', 'dist', 'dist/*'],
    ['a recursive wildcard', 'dist/**\n', 'dist', 'dist/**'],
    ['a non-default dist directory', 'out/*\n', 'out', 'out/*'],
  ])('%s is reported', (_label, existing, distDir, expected) => {
    expect(gitignoreEntriesCovering(existing, distDir)).toEqual([expected])
  })

  test('a nested dist path is covered by a parent-directory pattern', () => {
    expect(gitignoreEntriesCovering('build/**\n', 'build/output')).toEqual(['build/**'])
  })

  test('comments, negations, and unrelated entries are ignored', () => {
    expect(gitignoreEntriesCovering('# dist\n!dist/\ncache/\n', 'dist')).toEqual([])
  })
})

describe('command rendering', () => {
  test('the default dist directory needs no --out-dir', () => {
    expect(buildSiteCommand('dist')).toBe('ritual build-site')
    expect(servePreviewCommand('dist')).toBe('ritual serve --build')
  })

  test('any other directory renders the flag that actually writes there', () => {
    expect(buildSiteCommand('out')).toBe('ritual build-site --out-dir out')
    expect(servePreviewCommand('out')).toBe('ritual serve --build --out-dir out')
  })
})

describe('updateGitignore', () => {
  let ws: BoundWorkspace | null = null

  afterEach(async () => {
    await ws?.dispose()
    ws = null
  })

  /** A bare base dir — `updateGitignore` is about a repo root, not a list workspace. */
  async function useTempDir(): Promise<string> {
    ws = await bindWorkspace({ dirs: [], config: false })
    return ws.dir
  }

  test('creates a .gitignore containing the ritual binary when none exists', async () => {
    const dir = await useTempDir()

    const result = await updateGitignore(generateGitignoreEntries())

    expect(result).toBe('created')
    const written = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8')
    expect(written).toContain('/ritual')
  })

  test('adds missing entries to an existing .gitignore without disturbing custom lines', async () => {
    const dir = await useTempDir()
    const gitignorePath = path.join(dir, '.gitignore')
    await fs.writeFile(gitignorePath, 'cache/\nnode_modules/\n')

    const result = await updateGitignore(generateGitignoreEntries())

    expect(result).toBe('updated')
    const written = await fs.readFile(gitignorePath, 'utf-8')
    // The user's own entry is preserved.
    expect(written).toContain('node_modules/')
    // The new binary exclusion is added.
    expect(written).toContain('/ritual')
    // An entry that already existed is not duplicated.
    expect(written.split('\n').filter((l) => l === 'cache/')).toHaveLength(1)
  })

  test('is idempotent on a second run', async () => {
    const dir = await useTempDir()
    const gitignorePath = path.join(dir, '.gitignore')

    await updateGitignore(generateGitignoreEntries())
    const result = await updateGitignore(generateGitignoreEntries())

    expect(result).toBe('unchanged')
    const written = await fs.readFile(gitignorePath, 'utf-8')
    expect(written.split('\n').filter((l) => l === '/ritual')).toHaveLength(1)
    // Descriptive comments from the template survive the second run unduplicated.
    expect(written.split('\n').filter((l) => l === '# Ritual files')).toHaveLength(1)
    expect(
      written.split('\n').filter((l) => l === '# Ritual binary downloaded by the deploy workflow'),
    ).toHaveLength(1)
  })
})

describe('defaultPriceSourceChoices', () => {
  test('offers every store in canonical order, naming its currency, and marks the current one', () => {
    const choices = defaultPriceSourceChoices('tcgplayer')
    expect(choices.map((c) => c.value)).toEqual([
      'tcgplayer',
      'cardmarket',
      'cardkingdom',
      'cardhoarder',
    ])
    expect(choices[0]!.title).toBe('TCGplayer (current)')
    expect(choices[0]!.description).toContain('USD')
    expect(choices[1]!.description).toContain('EUR')
  })

  test('marks a non-default configured store', () => {
    const choices = defaultPriceSourceChoices('cardkingdom')
    expect(choices[2]!.title).toBe('Card Kingdom (current)')
    expect(choices[0]!.title).toBe('TCGplayer')
  })
})
