import { describe, expect, test } from 'bun:test'
import yaml from 'js-yaml'
import {
  generatePublishForMeWorkflow,
  generateLocalBuildWorkflow,
  generateWorkflow,
  generateReadme,
  generateGitignoreEntries,
} from '../../src/commands/init-site'

type WorkflowStep = {
  name?: string
  id?: string
  uses?: string
  run?: string
  if?: string
  env?: Record<string, string>
  with?: Record<string, string>
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

  test('produces valid YAML that parses without error', () => {
    expect(workflow).toBeDefined()
  })

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
    expect(job.steps[0]?.uses).toBe('actions/checkout@v6')
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
    expect(step!.run).not.toContain('api.github.com')
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
    expect(step!.with?.key).toContain("hashFiles('decks/**', 'collections/**', 'wanted/**')")
    expect(step!.with?.['restore-keys']).toBe('ritual-cache-')
  })

  test('builds the site with -y to skip prompts', () => {
    const step = findStep(job.steps, 'Build site')
    expect(step).toBeDefined()
    expect(step!.run).toBe('./ritual build-site -y')
  })

  test('uploads dist directory as pages artifact', () => {
    const step = findStep(job.steps, 'Upload artifact')
    expect(step).toBeDefined()
    expect(step!.uses).toBe('actions/upload-pages-artifact@v4')
    expect(step!.with?.path).toBe('dist')
  })

  test('deploys to GitHub Pages as the final step', () => {
    const step = findStep(job.steps, 'Deploy to GitHub Pages')
    expect(step).toBeDefined()
    expect(step!.uses).toBe('actions/deploy-pages@v4')
    expect(step!.id).toBe('deployment')
  })

  test('has exactly 9 steps in the expected order', () => {
    const stepNames = job.steps.map((s) => s.name ?? s.uses)
    expect(stepNames).toEqual([
      'actions/checkout@v6',
      'Get Ritual version',
      'Cache Ritual binary',
      'Download Ritual',
      'Restore Scryfall cache',
      'Build site',
      'Setup Pages',
      'Upload artifact',
      'Deploy to GitHub Pages',
    ])
  })
})

describe('generateLocalBuildWorkflow', () => {
  test('has the correct workflow name', () => {
    const workflow = parseWorkflow(generateLocalBuildWorkflow('dist'))
    expect(workflow.name).toBe('Deploy Ritual Site')
  })

  test('triggers on push to main and workflow_dispatch', () => {
    const workflow = parseWorkflow(generateLocalBuildWorkflow('dist'))
    expect(workflow.on.push.branches).toEqual(['main'])
    expect(workflow.on).toHaveProperty('workflow_dispatch')
  })

  test('sets correct permissions', () => {
    const workflow = parseWorkflow(generateLocalBuildWorkflow('dist'))
    expect(workflow.permissions).toEqual({
      contents: 'read',
      pages: 'write',
      'id-token': 'write',
    })
  })

  test('deploys the user-specified directory', () => {
    const workflow = parseWorkflow(generateLocalBuildWorkflow('build/output'))
    const job = getJob(workflow, 'deploy')
    const step = findStep(job.steps, 'Upload artifact')
    expect(step!.with?.path).toBe('build/output')
  })

  test('deploys dist by default', () => {
    const workflow = parseWorkflow(generateLocalBuildWorkflow('dist'))
    const job = getJob(workflow, 'deploy')
    const step = findStep(job.steps, 'Upload artifact')
    expect(step!.with?.path).toBe('dist')
  })

  test('does not include build, cache, or download steps', () => {
    const workflow = parseWorkflow(generateLocalBuildWorkflow('dist'))
    const job = getJob(workflow, 'deploy')
    const stepNames = job.steps.map((s) => s.name ?? s.uses)
    expect(stepNames).not.toContain('Download Ritual')
    expect(stepNames).not.toContain('Build site')
    expect(stepNames).not.toContain('Restore Scryfall cache')
  })

  test('has exactly 4 steps in the expected order', () => {
    const workflow = parseWorkflow(generateLocalBuildWorkflow('dist'))
    const job = getJob(workflow, 'deploy')
    const stepNames = job.steps.map((s) => s.name ?? s.uses)
    expect(stepNames).toEqual([
      'actions/checkout@v6',
      'Setup Pages',
      'Upload artifact',
      'Deploy to GitHub Pages',
    ])
  })
})

describe('generateWorkflow', () => {
  test('publish-for-me produces the full build workflow', () => {
    const workflow = parseWorkflow(
      generateWorkflow({
        ciSystem: 'github-actions',
        deployMode: 'publish-for-me',
        distDir: 'dist',
      }),
    )
    expect(workflow.name).toBe('Build and Deploy Ritual Site')
    expect(getJob(workflow, 'build-and-deploy')).toBeDefined()
  })

  test('local-build produces the simple deploy workflow', () => {
    const workflow = parseWorkflow(
      generateWorkflow({
        ciSystem: 'github-actions',
        deployMode: 'local-build',
        distDir: 'public',
      }),
    )
    expect(workflow.name).toBe('Deploy Ritual Site')
    const job = getJob(workflow, 'deploy')
    const step = findStep(job.steps, 'Upload artifact')
    expect(step!.with?.path).toBe('public')
  })
})

describe('generateReadme', () => {
  test('includes project title and Ritual link', () => {
    const readme = generateReadme({
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
    })

    expect(readme).toContain('# My Ritual Site')
    expect(readme).toContain('github.com/sloshy/ritual')
  })

  test('publish-for-me mode includes RITUAL_VERSION docs', () => {
    const readme = generateReadme({
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
    })

    expect(readme).toContain('RITUAL_VERSION')
    expect(readme).toContain('automatically builds and')
  })

  test('publish-for-me mode does not include manual build instructions', () => {
    const readme = generateReadme({
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
    })

    expect(readme).not.toContain('ritual build-site')
  })

  test('local-build mode includes build instructions', () => {
    const readme = generateReadme({
      ciSystem: 'github-actions',
      deployMode: 'local-build',
      distDir: 'dist',
    })

    expect(readme).toContain('ritual build-site')
    expect(readme).toContain('Commit the built')
  })

  test('local-build mode uses specified dist directory', () => {
    const readme = generateReadme({
      ciSystem: 'github-actions',
      deployMode: 'local-build',
      distDir: 'public',
    })

    expect(readme).toContain('written to `public`')
    expect(readme).toContain('`public` directory')
  })

  test('includes GitHub Pages setup instructions for github-actions mode', () => {
    const readme = generateReadme({
      ciSystem: 'github-actions',
      deployMode: 'publish-for-me',
      distDir: 'dist',
    })

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
    const lines = entries.split('\n').filter((l) => l.trim().length > 0)

    expect(lines).toEqual(['cache/', 'dist/'])
  })
})
