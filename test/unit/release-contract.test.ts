/**
 * Release facts that YAML, shell and the Dockerfile repeat because they cannot
 * import the TypeScript that owns them: each copy is held to its owner here.
 */
import { describe, expect, test } from 'bun:test'
import yaml from 'js-yaml'
import fs from 'node:fs'
import path from 'node:path'
import { generatePublishForMeWorkflow } from '../../src/migrate/managed-files'
import { RELEASE_ASSET_NAMES } from '../../src/update/release-source'

const ROOT = path.resolve(import.meta.dir, '../..')
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), 'utf8')

type MatrixRow = { asset: string }
type MatrixJob = { strategy: { matrix: { include: MatrixRow[] } } }
type BuildBinariesWorkflow = { jobs: { build: MatrixJob; smoke: MatrixJob } }

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
