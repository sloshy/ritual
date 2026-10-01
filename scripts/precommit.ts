#!/usr/bin/env bun
/**
 * Verification orchestrator (used by the Husky pre-commit hook, `bun run test`,
 * and `bun run verify`).
 *
 * Three modes:
 *   - staged (default): lint/format only the staged files. Fast, and the right
 *     scope for a commit — it verifies exactly what you're committing. Build,
 *     type check, and unit tests still run over the whole project (those can't
 *     be meaningfully scoped to a subset of files).
 *   - --test: type check, lint, and unit-test the entire repo (no format check).
 *     The frequent local command, exposed as `bun run test`. Lint runs with
 *     `--cache` for a fast edit loop.
 *   - --full: lint/format the entire repo. Full effectiveness; use before a
 *     push or in CI. Exposed as `bun run verify`. Lint runs cold (no cache) so
 *     the type-aware rules can't return a stale pass on a file whose type
 *     dependencies changed.
 *
 * All modes build assets only (`build:assets`) rather than the full
 * `--compile` binary — type checking and format checking read the bundled
 * CSS/JS and generated licenses, but never the compiled executable. The binary
 * is built only by `test:it` / `test:e2e`, which actually exercise it.
 *
 * Scheduling: `build:assets` writes the generated assets (`src/generated/*.ts`,
 * `*.compiled.js`, `*.compiled.css`). Only checks that READ those assets must
 * wait for it — flagged with `needsBuild`. Everything else (lint always ignores
 * the generated assets; unit tests don't touch them; staged-scoped format only
 * sees staged files, which never include the git-ignored generated assets) runs
 * concurrently with the build.
 *
 * Speed flags: unit tests run with `--parallel` (worker-per-core), tsc is
 * incremental (`"incremental": true` in tsconfig, dependency-graph aware so it
 * is safe everywhere), and lint uses `--concurrency auto` (multithreaded) plus
 * `--cache` in the local-loop modes.
 *
 * Stall guard: a check with `stallTimeoutMs` runs in its own process group; a
 * run that outlives the limit has the whole group killed and is retried once.
 */

import type { Subprocess } from 'bun'

type Mode = 'staged' | 'full' | 'test'

type Check = {
  name: string
  cmd: string[]
  // True if the check reads a build-generated asset and must wait for the build.
  needsBuild: boolean
  // Extra environment for the child, merged over this process's own.
  env?: Record<string, string>
  // A run still going after this long is stalled: its whole process group is
  // killed and the check retried once.
  stallTimeoutMs?: number
}

type CheckResult = {
  name: string
  ok: boolean
  durationMs: number
  output: string
  // Shown beside the check's summary line (e.g. that a stalled run was retried).
  note?: string
}

/** A run of a check's command that ended on its own. */
type ExitedAttempt = { kind: 'exited'; exitCode: number; output: string }

/** A run killed for outliving its check's `stallTimeoutMs`. */
type StalledAttempt = { kind: 'stalled'; limitMs: number; output: string }

type Attempt = ExitedAttempt | StalledAttempt

type Plan = {
  runBuild: boolean
  checks: Check[]
}

const CODE_FILE_PATTERN = /\.(js|ts|tsx)$/
const DISPLAY_ORDER = ['build', 'typecheck', 'lint', 'locales', 'test:unit', 'format']

/**
 * Message-catalog validation, blocking in all three modes. `needsBuild: false`
 * — it reads the hand-written English catalog and `locales/*.json`, never a
 * build artifact. (The build writes the generated pseudo-locale concurrently;
 * `generate-locales.ts` publishes it with a rename so this check can never see
 * a partial file.)
 *
 * Run with no flags, which since Phase 7 means dead-key detection is on: an
 * English key with no `t('…')` call site fails the run. `--allow-dead-keys`
 * exists for a branch that lands catalog entries ahead of their call sites.
 */
const LOCALES_CHECK: Check = {
  name: 'locales',
  cmd: ['bun', 'run', 'scripts/check-locales.ts'],
  needsBuild: false,
}

/**
 * The unit suite, run with missing message keys and missing plural/select
 * parameters made fatal (plan §10).
 *
 * `t()` degrades in production — a gap renders the key string rather than
 * throwing, because a missing translation must never take a command down. That
 * is exactly wrong for a verification run: the degradation is silent, and a test
 * asserting on rendered prose would pass against a key that was never wired.
 * `RITUAL_I18N_STRICT=1` flips the same seam `check-locales.ts` covers
 * statically into a runtime failure, so the two agree.
 *
 * Set here rather than in the shell so `bun run test`, `bun run verify` and the
 * Husky hook all get it; the Playwright suite gets it from `playwright.config.ts`.
 */
const UNIT_TEST_CHECK: Check = {
  name: 'test:unit',
  cmd: ['bun', 'test', 'test/unit', '--parallel'],
  needsBuild: false,
  env: { RITUAL_I18N_STRICT: '1' },
  // The suite takes well under 15s. Bun 1.4.2's `spawnSync` can spin a
  // `--parallel` worker forever (see `test/preload.ts`), and a spinning worker
  // never trips the per-test timeout — so a hang would otherwise stall the
  // commit (or the agent session running it) indefinitely.
  stallTimeoutMs: 60_000,
}

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
  // A `switch` with no `default` makes this exhaustive: `noImplicitReturns`
  // turns a newly-added `Mode` variant into a compile error here (mirroring the
  // guarantee the `Record<Mode, string>` summary label already provides).
  switch (mode) {
    case 'full':
      return {
        runBuild: true,
        checks: [
          { name: 'typecheck', cmd: ['bunx', 'tsc', '--noEmit'], needsBuild: true },
          // Cold (no --cache): type-aware rules can otherwise return a stale pass
          // for a file whose type dependencies changed but whose own bytes did not.
          { name: 'lint', cmd: ['bun', 'run', 'lint'], needsBuild: false },
          LOCALES_CHECK,
          UNIT_TEST_CHECK,
          // Whole-repo prettier reads `app.compiled.js` / admin compiled CSS,
          // which are not in `.prettierignore`, so it must wait for the build.
          { name: 'format', cmd: ['bun', 'run', 'check-format'], needsBuild: true },
        ],
      }

    case 'test':
      return {
        runBuild: true,
        checks: [
          { name: 'typecheck', cmd: ['bunx', 'tsc', '--noEmit'], needsBuild: true },
          // Local edit loop: --cache turns repeat runs from ~16s into <1s. The
          // stale-pass risk it carries for type-aware rules is acceptable here;
          // `verify` (full mode) runs cold as the correctness gate.
          { name: 'lint', cmd: ['bun', 'run', 'lint', '--cache'], needsBuild: false },
          LOCALES_CHECK,
          UNIT_TEST_CHECK,
        ],
      }

    case 'staged': {
      const staged = await getStagedFiles()
      const codeFiles = staged.filter((file) => CODE_FILE_PATTERN.test(file))
      const checks: Check[] = []

      if (staged.length > 0) {
        checks.push({
          name: 'format',
          cmd: ['bunx', 'prettier', '--check', '--ignore-unknown', ...staged],
          needsBuild: false,
        })
        // Not gated on code files: a translator's commit touches only
        // `locales/*.json`, and validation is the whole review gate for it.
        checks.push(LOCALES_CHECK)
      }
      if (codeFiles.length > 0) {
        checks.push(
          {
            name: 'lint',
            cmd: [
              'bunx',
              'eslint',
              '--cache',
              '--concurrency',
              'auto',
              '--no-warn-ignored',
              '--no-error-on-unmatched-pattern',
              ...codeFiles,
            ],
            needsBuild: false,
          },
          { name: 'typecheck', cmd: ['bunx', 'tsc', '--noEmit'], needsBuild: true },
          UNIT_TEST_CHECK,
        )
      }

      return { runBuild: codeFiles.length > 0, checks }
    }
  }
}

/**
 * Stall-guarded checks still running. Each runs detached (its own session), so
 * a terminal Ctrl-C or hangup no longer reaches it on its own — the signal
 * handlers below forward the kill. A SIGKILL of this script cannot be
 * forwarded: a guarded check outlives it, and so would a hung worker.
 */
const runningGuarded = new Set<Subprocess>()

/** SIGKILL a guarded check's whole process group, falling back to the child alone. */
function killGroup(proc: Subprocess): void {
  try {
    process.kill(-proc.pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return // group already gone
    proc.kill('SIGKILL')
  }
}

for (const [signal, code] of [
  ['SIGHUP', 129],
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  process.on(signal, () => {
    for (const proc of runningGuarded) killGroup(proc)
    process.exit(code)
  })
}

async function runAttempt(check: Check): Promise<Attempt> {
  const limitMs = check.stallTimeoutMs
  const proc = Bun.spawn(check.cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    // Bun.spawn replaces the environment wholesale when `env` is given, so the
    // parent's own variables are spread back in first.
    env: check.env === undefined ? undefined : { ...process.env, ...check.env },
    // A stall kill must reach the whole tree: `bun test` workers outlive a
    // killed coordinator, so the check gets its own process group to kill.
    detached: limitMs !== undefined,
  })
  let stalled = false
  const timer =
    limitMs === undefined
      ? undefined
      : setTimeout(() => {
          stalled = true
          killGroup(proc)
        }, limitMs)
  if (limitMs !== undefined) runningGuarded.add(proc)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    const output = stdout + stderr
    return stalled && limitMs !== undefined
      ? { kind: 'stalled', limitMs, output }
      : { kind: 'exited', exitCode, output }
  } finally {
    clearTimeout(timer)
    runningGuarded.delete(proc)
  }
}

/** The last few lines of a stalled run — which test files were still in flight. */
function stallTail(attempt: StalledAttempt): string {
  const tail = attempt.output.trimEnd().split('\n').slice(-5).join('\n  ')
  return `(first run stalled past ${formatSeconds(attempt.limitMs)}; retried. Its last output:\n  ${tail})`
}

async function runCheck(check: Check): Promise<CheckResult> {
  const start = performance.now()
  const first = await runAttempt(check)
  const attempt = first.kind === 'stalled' ? await runAttempt(check) : first
  return {
    name: check.name,
    ok: attempt.kind === 'exited' && attempt.exitCode === 0,
    durationMs: performance.now() - start,
    output:
      attempt.kind === 'stalled'
        ? `Stalled past ${formatSeconds(attempt.limitMs)} twice; killed both runs. Output of the second:\n${attempt.output}`
        : attempt.output,
    note: first.kind === 'stalled' ? stallTail(first) : undefined,
  }
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function printResult(result: CheckResult): void {
  const mark = result.ok ? '✓' : '✗'
  const note = result.note === undefined ? '' : ` ${result.note}`
  console.log(`${mark} ${result.name.padEnd(12)} ${formatSeconds(result.durationMs)}${note}`)
}

async function main(): Promise<void> {
  const start = performance.now()
  const args = process.argv.slice(2)
  const mode: Mode = args.includes('--full') ? 'full' : args.includes('--test') ? 'test' : 'staged'
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
    ? runCheck({ name: 'build', cmd: ['bun', 'run', 'build:assets'], needsBuild: false })
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

  const label: Record<Mode, string> = { full: 'verify', test: 'test', staged: 'pre-commit' }
  console.log(`\n${label[mode]} total: ${formatSeconds(performance.now() - start)}`)
  if (failed.length > 0) {
    process.exit(1)
  }
}

await main()
