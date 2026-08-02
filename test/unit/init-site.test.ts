import { afterEach, describe, expect, test } from 'bun:test'
import yaml from 'js-yaml'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  defaultCurrencyChoices,
  generatePublishForMeWorkflow,
  generateLocalBuildWorkflow,
  generateWorkflow,
  generateReadme,
  generateGitignoreEntries,
  updateGitignore,
} from '../../src/commands/init-site'
import { setBaseDir } from '../../src/base-dir'

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

  test('writes the card manifest to an explicit --out file', () => {
    // list-all-cards prints to stdout by default, so the workflow must name
    // the cache-key file explicitly.
    const step = findStep(job.steps, 'Generate card manifest')
    expect(step?.run).toBe('./ritual list-all-cards --out all-cards.md')
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

  test('local-build mode includes build instructions with the specified dist directory', () => {
    const readme = generateReadme({ ...baseConfig, deployMode: 'local-build', distDir: 'public' })

    expect(readme).toContain('ritual build-site')
    expect(readme).toContain('Commit the built')
    expect(readme).toContain('written to `public`')
    expect(readme).toContain('`public` directory')
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
      'all-cards.md',
      '/ritual',
    ])
  })
})

describe('updateGitignore', () => {
  const originalCwd = process.cwd()
  let tmpDir: string | null = null

  afterEach(async () => {
    setBaseDir(originalCwd)
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  async function useTempDir(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-gitignore-test-'))
    setBaseDir(tmpDir)
    return tmpDir
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

describe('defaultCurrencyChoices', () => {
  test('offers every currency with USD first and marks the current one', () => {
    const choices = defaultCurrencyChoices('usd')
    expect(choices.map((c) => c.value)).toEqual(['usd', 'eur', 'tix'])
    expect(choices[0]!.title).toBe('USD (current)')
    expect(choices[0]!.description).toContain('TCGplayer')
    expect(choices[1]!.title).toBe('EUR')
    expect(choices[1]!.description).toContain('Cardmarket')
  })

  test('marks a non-default configured currency', () => {
    const choices = defaultCurrencyChoices('tix')
    expect(choices[2]!.title).toBe('TIX (current)')
    expect(choices[0]!.title).toBe('USD')
  })
})
