import { afterEach, describe, expect, test } from 'bun:test'
import yaml from 'js-yaml'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
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

  test('has the correct workflow name', () => {
    expect(workflow.name).toBe('Build and Deploy Ritual Site')
  })

  test('triggers on push to main and workflow_dispatch', () => {
    expect(workflow.on.push.branches).toEqual(['main'])
    expect(workflow.on).toHaveProperty('workflow_dispatch')
  })

  test('sets correct permissions', () => {
    expect(workflow.permissions).toEqual({
      contents: 'read',
      pages: 'write',
      'id-token': 'write',
    })
  })

  test('configures concurrency to avoid parallel deploys', () => {
    expect(workflow.concurrency).toEqual({
      group: 'pages',
      'cancel-in-progress': false,
    })
  })

  test('runs on ubuntu-latest with github-pages environment', () => {
    expect(job['runs-on']).toBe('ubuntu-latest')
    expect(job.environment.name).toBe('github-pages')
  })

  test('checks out the repository as the first step', () => {
    expect(job.steps[0]?.uses).toBe('actions/checkout@v7')
  })

  test('resolves Ritual version from RITUAL_VERSION variable, falling back to latest release', () => {
    const step = findStep(job.steps, 'Get Ritual version')
    expect(step).toBeDefined()
    expect(step!.id).toBe('ritual-version')
    expect(step!.env?.RITUAL_VERSION).toBe('${{ vars.RITUAL_VERSION }}')
    expect(step!.run).toContain('RITUAL_VERSION:-latest')
    expect(step!.run).toContain('tag_name')
  })

  test('caches Ritual binary keyed by resolved version', () => {
    const step = findStep(job.steps, 'Cache Ritual binary')
    expect(step).toBeDefined()
    expect(step!.id).toBe('ritual-cache')
    expect(step!.uses).toBe('actions/cache@v5')
    expect(step!.with?.path).toBe('ritual')
    expect(step!.with?.key).toBe(
      'ritual-binary-${{ steps.ritual-version.outputs.version }}-linux-x86_64',
    )
  })

  test('downloads Ritual binary from sloshy/ritual releases', () => {
    const step = findStep(job.steps, 'Download Ritual')
    expect(step).toBeDefined()
    expect(step!.if).toBe("steps.ritual-cache.outputs.cache-hit != 'true'")
    expect(step!.run).toContain(
      'github.com/sloshy/ritual/releases/download/${VERSION}/ritual-linux-x86_64',
    )
    expect(step!.run).toContain('chmod +x ritual')
  })

  test('restores Scryfall cache with content-based key', () => {
    const step = findStep(job.steps, 'Restore Scryfall cache')
    expect(step).toBeDefined()
    expect(step!.uses).toBe('actions/cache@v5')
    expect(step!.with?.path).toBe('cache/')
    expect(step!.with?.key).toContain('ritual-cache-')
    expect(step!.with?.key).toContain("hashFiles('all-cards.md')")
    expect(step!.with?.['restore-keys']).toBe('ritual-cache-')
  })

  test('builds the site with --allow-refresh to skip prompts', () => {
    const step = findStep(job.steps, 'Build site')
    expect(step).toBeDefined()
    expect(step!.run).toBe('./ritual build-site --allow-refresh')
  })

  test('uploads dist directory as pages artifact', () => {
    const step = findStep(job.steps, 'Upload artifact')
    expect(step).toBeDefined()
    expect(step!.uses).toBe('actions/upload-pages-artifact@v5')
    expect(step!.with?.path).toBe('dist')
  })

  test('deploys to GitHub Pages as the final step', () => {
    const step = findStep(job.steps, 'Deploy to GitHub Pages')
    expect(step).toBeDefined()
    expect(step!.uses).toBe('actions/deploy-pages@v5')
    expect(step!.id).toBe('deployment')
  })

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

  test('generates card manifest before cache restore', () => {
    const step = findStep(job.steps, 'Generate card manifest')
    expect(step).toBeDefined()
    expect(step!.run).toBe('./ritual list-all-cards')
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

  test('has the correct workflow name', () => {
    expect(workflow.name).toBe('Build and Deploy Ritual Site')
  })

  test('sets contents: write permission for git push', () => {
    expect(workflow.permissions.contents).toBe('write')
  })

  test('checks out with full history for git-detect-changes', () => {
    const checkout = job.steps[0]
    expect(checkout?.uses).toBe('actions/checkout@v7')
    expect(checkout?.with?.['fetch-depth']).toBe(0)
  })

  test('includes detect-and-commit-changes step after Ritual download', () => {
    const step = findStep(job.steps, 'Detect and commit changes')
    expect(step).toBeDefined()
    expect(step!.id).toBe('detect-changes')
    expect(step!.run).toContain('git-detect-changes')
    expect(step!.run).toContain('github.event.before')
    expect(step!.run).toContain('git commit')
    expect(step!.run).toContain('Generated changes from commit')
    expect(step!.run).toContain('has-changes=true')
  })

  test('falls back to HEAD~1 when github.event.before is empty or zeroed', () => {
    const step = findStep(job.steps, 'Detect and commit changes')
    expect(step!.run).toContain('BEFORE="HEAD~1"')
    expect(step!.run).toContain('0000000000000000000000000000000000000000')
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

  test('generates card manifest before cache restore', () => {
    const step = findStep(job.steps, 'Generate card manifest')
    expect(step).toBeDefined()
    expect(step!.run).toBe('./ritual list-all-cards')
  })
})

describe('generateLocalBuildWorkflow', () => {
  const workflow = parseWorkflow(generateLocalBuildWorkflow('dist'))
  const job = getJob(workflow, 'deploy')

  test('has the correct workflow name', () => {
    expect(workflow.name).toBe('Deploy Ritual Site')
  })

  test('triggers on push to main and workflow_dispatch', () => {
    expect(workflow.on.push.branches).toEqual(['main'])
    expect(workflow.on).toHaveProperty('workflow_dispatch')
  })

  test('sets correct permissions', () => {
    expect(workflow.permissions).toEqual({
      contents: 'read',
      pages: 'write',
      'id-token': 'write',
    })
  })

  test('deploys the user-specified directory', () => {
    const customWorkflow = parseWorkflow(generateLocalBuildWorkflow('build/output'))
    const customJob = getJob(customWorkflow, 'deploy')
    const step = findStep(customJob.steps, 'Upload artifact')
    expect(step!.with?.path).toBe('build/output')
  })

  test('deploys dist by default', () => {
    const step = findStep(job.steps, 'Upload artifact')
    expect(step!.with?.path).toBe('dist')
  })

  test('does not include build, cache, or download steps', () => {
    const stepNames = job.steps.map((s) => s.name ?? s.uses)
    expect(stepNames).not.toContain('Download Ritual')
    expect(stepNames).not.toContain('Build site')
    expect(stepNames).not.toContain('Restore Scryfall cache')
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

  test('includes project title and Ritual link', () => {
    const readme = generateReadme({ ...baseConfig })

    expect(readme).toContain('# My Ritual Site')
    expect(readme).toContain('github.com/sloshy/ritual')
  })

  test('publish-for-me mode includes RITUAL_VERSION docs', () => {
    const readme = generateReadme({ ...baseConfig })

    expect(readme).toContain('RITUAL_VERSION')
    expect(readme).toContain('automatically builds and')
  })

  test('publish-for-me mode does not include manual build instructions', () => {
    const readme = generateReadme({ ...baseConfig })

    expect(readme).not.toContain('ritual build-site')
  })

  test('publish-for-me mode does not interpolate distDir into the README', () => {
    const readme = generateReadme({ ...baseConfig, distDir: 'should-not-appear' })

    expect(readme).not.toContain('should-not-appear')
  })

  test('local-build mode includes build instructions', () => {
    const readme = generateReadme({ ...baseConfig, deployMode: 'local-build' })

    expect(readme).toContain('ritual build-site')
    expect(readme).toContain('Commit the built')
  })

  test('local-build mode uses specified dist directory', () => {
    const readme = generateReadme({ ...baseConfig, deployMode: 'local-build', distDir: 'public' })

    expect(readme).toContain('written to `public`')
    expect(readme).toContain('`public` directory')
  })

  test('includes GitHub Pages setup instructions for github-actions mode', () => {
    const readme = generateReadme({ ...baseConfig })

    expect(readme).toContain('Settings → Pages')
    expect(readme).toContain('GitHub Actions')
  })

  test('manual mode includes project title and build instructions', () => {
    const readme = generateReadme({ ciSystem: 'manual' })

    expect(readme).toContain('# My Ritual Site')
    expect(readme).toContain('ritual build-site')
  })

  test('manual mode does not include GitHub Pages setup', () => {
    const readme = generateReadme({ ciSystem: 'manual' })

    expect(readme).not.toContain('Settings → Pages')
    expect(readme).not.toContain('RITUAL_VERSION')
  })
})

describe('generateGitignoreEntries', () => {
  test('includes cache/ and dist/', () => {
    const entries = generateGitignoreEntries()

    expect(entries).toContain('cache/')
    expect(entries).toContain('dist/')
  })

  test('each entry is on its own line', () => {
    const entries = generateGitignoreEntries()
    const lines = entries.split('\n').filter((l) => l.trim().length > 0 && !l.startsWith('#'))

    expect(lines).toEqual([
      'cache/',
      'dist/',
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
  })

  test('preserves descriptive comments from the template after the first write', async () => {
    const dir = await useTempDir()
    const gitignorePath = path.join(dir, '.gitignore')

    await updateGitignore(generateGitignoreEntries())
    const result = await updateGitignore(generateGitignoreEntries())

    expect(result).toBe('unchanged')
    const written = await fs.readFile(gitignorePath, 'utf-8')
    expect(written.split('\n').filter((l) => l === '# Ritual files')).toHaveLength(1)
    expect(
      written.split('\n').filter((l) => l === '# Ritual binary downloaded by the deploy workflow'),
    ).toHaveLength(1)
  })
})
