/**
 * Release facts that YAML, shell and the Dockerfile repeat because they cannot
 * import the TypeScript that owns them: each copy is held to its owner here.
 */
import { describe, expect, test } from 'bun:test'
import yaml from 'js-yaml'
import fs from 'node:fs'
import path from 'node:path'
import { generatePublishForMeWorkflow } from '../../src/migrate/managed-files'
import {
  archiveFor,
  RELEASE_ARCHIVE_NAMES,
  RELEASE_ASSET_NAMES,
} from '../../src/update/release-source'

const ROOT = path.resolve(import.meta.dir, '../..')
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), 'utf8')

type MatrixRow = { asset: string; archive?: string; member?: string }
type MatrixJob = { strategy: { matrix: { include: MatrixRow[] } } }
type Step = { uses?: string; run?: string; with?: Record<string, string | boolean> }
type StepsJob = { steps: Step[] }
type BuildBinariesWorkflow = {
  jobs: { build: MatrixJob & StepsJob; smoke: MatrixJob; sbom: StepsJob }
}
type DockerRow = { platform: string; runner: string }
type ReleaseWorkflow = {
  jobs: {
    publish: StepsJob
    docker: StepsJob & { 'runs-on': string; strategy: { matrix: { include: DockerRow[] } } }
    'docker-manifest': StepsJob & { needs: string[] }
  }
}

/** The steps of `job` that use the action `action` (any version). */
function uses(job: StepsJob, action: string): Step[] {
  return job.steps.filter((step) => step.uses?.startsWith(`${action}@`) === true)
}

/** A multi-line `with:` value, one trimmed entry per line. */
function lines(value: string | boolean | undefined): string[] {
  return String(value)
    .trim()
    .split('\n')
    .map((line) => line.trim())
}

function matrixAssets(job: MatrixJob): string[] {
  return job.strategy.matrix.include.map((row) => row.asset).sort()
}

describe('build-binaries.yml', () => {
  const workflow = yaml.load(read('.github/workflows/build-binaries.yml')) as BuildBinariesWorkflow
  const shipped = [...RELEASE_ASSET_NAMES].sort()

  test('builds every asset release-source.ts names, and only those', () => {
    expect(matrixAssets(workflow.jobs.build)).toEqual(shipped)
  })

  test('smoke-tests every asset it builds', () => {
    expect(matrixAssets(workflow.jobs.smoke)).toEqual(shipped)
  })

  test('names each archive, and the binary inside it, as release-source.ts does', () => {
    const expected = (row: MatrixRow): MatrixRow => ({
      asset: row.asset,
      archive: archiveFor(row.asset).name,
      member: archiveFor(row.asset).member,
    })
    const smoke = workflow.jobs.smoke.strategy.matrix.include
    const pick = ({ asset, archive, member }: MatrixRow): MatrixRow => ({ asset, archive, member })
    expect(smoke.map(pick)).toEqual(smoke.map(expected))
    const build = workflow.jobs.build.strategy.matrix.include
    expect(build.map((row) => row.archive)).toEqual(build.map((row) => archiveFor(row.asset).name))
    expect(build.map((row) => row.archive).sort()).toEqual([...RELEASE_ARCHIVE_NAMES].sort())
  })

  test('uploads each archive with its .sha256, and never the bare binary', () => {
    // Without the archive's .sha256, self-update refuses the release outright;
    // release.yml publishes exactly what is uploaded here.
    const uploads = uses(workflow.jobs.build, 'actions/upload-artifact')
    expect(uploads.flatMap((upload) => lines(upload.with?.path))).toEqual([
      '${{ matrix.archive }}',
      '${{ matrix.archive }}.sha256',
    ])
  })
})

describe('the release SBOM', () => {
  const build = yaml.load(read('.github/workflows/build-binaries.yml')) as BuildBinariesWorkflow
  const release = yaml.load(read('.github/workflows/release.yml')) as ReleaseWorkflow

  test('is the file build-binaries.yml writes and uploads, under the name release.yml attests', () => {
    const generate = build.jobs.sbom.steps.find((step) => step.run?.includes('scripts/sbom.sh'))
    const [upload] = uses(build.jobs.sbom, 'actions/upload-artifact')
    const sbomPath = String(uses(release.jobs.publish, 'actions/attest')[0]?.with?.['sbom-path'])
    const file = path.basename(sbomPath)
    expect(generate?.run).toStartWith(`bash scripts/sbom.sh ${file} `)
    expect(upload?.with?.path).toBe(file)
    const downloads = uses(release.jobs.publish, 'actions/download-artifact')
    expect(downloads.map((step) => step.with?.name)).toContain(upload?.with?.name)
  })
})

describe('release.yml', () => {
  const workflow = yaml.load(read('.github/workflows/release.yml')) as ReleaseWorkflow

  test('attests the provenance of the archives and the SBOM, not their checksums', () => {
    const [attest] = uses(workflow.jobs.publish, 'actions/attest-build-provenance')
    expect(lines(attest?.with?.['subject-path'])).toEqual([
      'assets/*.tar.gz',
      'assets/*.zip',
      'assets/ritual-sbom.cdx.json',
    ])
  })

  test('attests the SBOM against the archives it publishes', () => {
    const [attest] = uses(workflow.jobs.publish, 'actions/attest')
    expect(attest?.with?.['sbom-path']).toBe('assets/ritual-sbom.cdx.json')
    expect(attest?.with?.['subject-checksums']).toBe('subjects.sha256')
    const listing = workflow.jobs.publish.steps.find((step) =>
      step.run?.includes('subjects.sha256'),
    )
    expect(listing?.run).toBe('cat assets/*.sha256 > subjects.sha256')
  })

  test('builds each image architecture natively, never under emulation', () => {
    const rows = workflow.jobs.docker.strategy.matrix.include
    expect(rows.map(({ platform, runner }) => [platform, runner])).toEqual([
      ['linux/amd64', 'ubuntu-latest'],
      ['linux/arm64', 'ubuntu-24.04-arm'],
    ])
    expect(workflow.jobs.docker['runs-on']).toBe('${{ matrix.runner }}')
    const [build] = uses(workflow.jobs.docker, 'docker/build-push-action')
    expect(build?.with?.platforms).toBe('${{ matrix.platform }}')
    expect(read('.github/workflows/release.yml')).not.toContain('setup-qemu-action')
  })

  test('pushes each architecture by digest, with its SBOM, for the manifest job to tag', () => {
    const [build] = uses(workflow.jobs.docker, 'docker/build-push-action')
    expect(build?.with?.outputs).toContain('push-by-digest=true')
    expect(build?.with?.sbom).toBe(true)
    expect(build?.with?.tags).toBeUndefined()
    expect(workflow.jobs['docker-manifest'].needs).toContain('docker')
  })
})

test('the install scripts name the archives as release-source.ts does', () => {
  // install.sh is run for real in test/integration/release-downloads.test.ts;
  // PowerShell is not, so its copy of the naming rule is held here.
  const ps1 = read('scripts/install.ps1')
  const windows = archiveFor('ritual-windows-x86_64.exe')
  expect(ps1).toContain('$archiveName = [System.IO.Path]::ChangeExtension($assetName, ".zip")')
  expect(ps1).toContain(`$entries[0].Name -ne "${windows.member}"`)
  for (const asset of RELEASE_ASSET_NAMES.filter((name) => name.endsWith('.exe'))) {
    expect(ps1).toContain(`$assetName = "${asset}"`)
  }
})

test('the Dockerfile installs and runs the health check script', () => {
  const dockerfile = read('Dockerfile')
  expect(dockerfile).toContain(
    'COPY --chmod=755 scripts/docker-healthcheck.sh /usr/local/bin/ritual-healthcheck',
  )
  expect(dockerfile).toMatch(/^HEALTHCHECK .*\\\n\s+CMD \["ritual-healthcheck"\]$/m)
})

test('the Dockerfile builds with the Bun that .bun-version pins for CI', () => {
  const pinned = read('.bun-version').trim()
  expect(read('Dockerfile')).toMatch(
    new RegExp(`^ARG BUN_VERSION=${pinned.replaceAll('.', '\\.')}$`, 'm'),
  )
})

test("the generated deploy workflow uses the action majors this repository's workflows use", () => {
  // Dependabot bumps .github/ only; the template's copies would fall behind.
  const usesPattern = /uses: ([\w-]+\/[\w-]+)@(v\d+)/g
  const repoMajors = new Map<string, Set<string>>()
  for (const file of fs.readdirSync(path.join(ROOT, '.github/workflows'))) {
    for (const [, action, major] of read(`.github/workflows/${file}`).matchAll(usesPattern)) {
      repoMajors.set(action!, (repoMajors.get(action!) ?? new Set()).add(major!))
    }
  }
  const template = generatePublishForMeWorkflow({
    ciSystem: 'github-actions',
    deployMode: 'publish-for-me',
    distDir: 'dist',
    detectChanges: true,
  })
  const drifted = [...template.matchAll(usesPattern)]
    .filter(([, action, major]) => repoMajors.has(action!) && !repoMajors.get(action!)!.has(major!))
    .map(
      ([, action, major]) =>
        `${action}@${major} (repo: ${[...repoMajors.get(action!)!].join(', ')})`,
    )
  expect(drifted).toEqual([])
})
