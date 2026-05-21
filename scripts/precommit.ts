#!/usr/bin/env bun
/**
 * Verification orchestrator (used by the Husky pre-commit hook and `bun run verify`).
 *
 * Two modes:
 *   - staged (default): lint/format only the staged files. Fast, and the right
 *     scope for a commit — it verifies exactly what you're committing. Build,
 *     type check, and unit tests still run over the whole project (those can't
 *     be meaningfully scoped to a subset of files).
 *   - --full: lint/format the entire repo. Full effectiveness; use before a
 *     push or in CI. Exposed as `bun run verify`.
 *
 * Scheduling: `build` writes the generated assets (`src/generated/*.ts`,
 * `*.compiled.js`, `*.compiled.css`). Only checks that READ those assets must
 * wait for it — flagged with `needsBuild`. Everything else (lint always ignores
 * the generated assets; unit tests don't touch them; staged-scoped format only
 * sees staged files, which never include the git-ignored generated assets) runs
 * concurrently with the build.
 */

type Mode = 'staged' | 'full'

type Check = {
  name: string
  cmd: string[]
  // True if the check reads a build-generated asset and must wait for the build.
  needsBuild: boolean
}

type CheckResult = {
  name: string
  ok: boolean
  durationMs: number
  output: string
}

type Plan = {
  runBuild: boolean
  checks: Check[]
}

const CODE_FILE_PATTERN = /\.(js|ts|tsx)$/
const DISPLAY_ORDER = ['build', 'typecheck', 'lint', 'test:unit', 'format']

async function getStagedFiles(): Promise<string[]> {
  // --diff-filter=ACMR excludes deletions, whose paths no longer exist on disk.
  const proc = Bun.spawn(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out.split('\n').filter((line) => line.length > 0)
}

async function planChecks(mode: Mode): Promise<Plan> {
  if (mode === 'full') {
    return {
      runBuild: true,
      checks: [
        { name: 'typecheck', cmd: ['bunx', 'tsc', '--noEmit'], needsBuild: true },
        { name: 'lint', cmd: ['bun', 'run', 'lint'], needsBuild: false },
        { name: 'test:unit', cmd: ['bun', 'test', 'test/unit'], needsBuild: false },
        // Whole-repo prettier reads `app.compiled.js` / admin compiled CSS,
        // which are not in `.prettierignore`, so it must wait for the build.
        { name: 'format', cmd: ['bun', 'run', 'check-format'], needsBuild: true },
      ],
    }
  }

  const staged = await getStagedFiles()
  const codeFiles = staged.filter((file) => CODE_FILE_PATTERN.test(file))
  const checks: Check[] = []

  if (staged.length > 0) {
    checks.push({
      name: 'format',
      cmd: ['bunx', 'prettier', '--check', '--ignore-unknown', ...staged],
      needsBuild: false,
    })
  }
  if (codeFiles.length > 0) {
    checks.push(
      {
        name: 'lint',
        cmd: [
          'bunx',
          'eslint',
          '--no-warn-ignored',
          '--no-error-on-unmatched-pattern',
          ...codeFiles,
        ],
        needsBuild: false,
      },
      { name: 'typecheck', cmd: ['bunx', 'tsc', '--noEmit'], needsBuild: true },
      { name: 'test:unit', cmd: ['bun', 'test', 'test/unit'], needsBuild: false },
    )
  }

  return { runBuild: codeFiles.length > 0, checks }
}

async function runCheck(check: Check): Promise<CheckResult> {
  const start = performance.now()
  const proc = Bun.spawn(check.cmd, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return {
    name: check.name,
    ok: exitCode === 0,
    durationMs: performance.now() - start,
    output: stdout + stderr,
  }
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function printResult(result: CheckResult): void {
  const mark = result.ok ? '✓' : '✗'
  console.log(`${mark} ${result.name.padEnd(12)} ${formatSeconds(result.durationMs)}`)
}

async function main(): Promise<void> {
  const start = performance.now()
  const mode: Mode = process.argv.slice(2).includes('--full') ? 'full' : 'staged'
  const { runBuild, checks } = await planChecks(mode)

  if (checks.length === 0) {
    console.log('Nothing to verify (no relevant staged files).')
    return
  }

  const independent = checks.filter((check) => !check.needsBuild)
  const dependent = checks.filter((check) => check.needsBuild)

  // Build (if needed) runs alongside the build-independent checks. The
  // build-dependent checks start only once the build has succeeded.
  const buildPromise: Promise<CheckResult | null> = runBuild
    ? runCheck({ name: 'build', cmd: ['bun', 'run', 'build'], needsBuild: false })
    : Promise.resolve(null)

  const dependentPromise: Promise<CheckResult[]> = buildPromise.then((build) =>
    build && !build.ok
      ? [] // Build failed: dependent checks would be racy/meaningless.
      : Promise.all(dependent.map(runCheck)),
  )

  const [buildResult, independentResults, dependentResults] = await Promise.all([
    buildPromise,
    Promise.all(independent.map(runCheck)),
    dependentPromise,
  ])

  const results: CheckResult[] = [
    ...(buildResult ? [buildResult] : []),
    ...independentResults,
    ...dependentResults,
  ].sort((a, b) => DISPLAY_ORDER.indexOf(a.name) - DISPLAY_ORDER.indexOf(b.name))

  for (const result of results) {
    printResult(result)
  }

  const failed = results.filter((result) => !result.ok)
  for (const result of failed) {
    console.error(`\n──── ${result.name} output ────\n${result.output}`)
  }
  if (buildResult && !buildResult.ok && dependent.length > 0) {
    console.error('\n(skipped type check / format check because the build failed)')
  }

  console.log(
    `\n${mode === 'full' ? 'verify' : 'pre-commit'} total: ${formatSeconds(performance.now() - start)}`,
  )
  if (failed.length > 0) {
    process.exit(1)
  }
}

await main()
