#!/usr/bin/env bun
/**
 * Pre-commit orchestrator.
 *
 * Runs the same checks as `bun run test` + format/lint, but:
 *   - skips the duplicate lint pass the old hook performed,
 *   - runs the independent read-only checks concurrently instead of serially.
 *
 * Ordering constraint: `bun run build` writes the generated `*.compiled.js` /
 * `*.compiled.css` assets, and both `tsc` (via `allowJs`) and `prettier
 * --check .` read those files. So the build must finish before the parallel
 * group starts — otherwise a check could read a half-written asset.
 */

type Check = {
  name: string
  cmd: string[]
}

type CheckResult = {
  name: string
  ok: boolean
  durationMs: number
  output: string
}

const CODE_FILE_PATTERN = /\.(js|ts|tsx)$/

async function getStagedFiles(): Promise<string[]> {
  const proc = Bun.spawn(['git', 'diff', '--cached', '--name-only'], {
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out.split('\n').filter((line) => line.length > 0)
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
  const staged = await getStagedFiles()
  const hasCode = staged.some((file) => CODE_FILE_PATTERN.test(file))

  // `build` mutates generated assets the other checks read, so it cannot run
  // concurrently with them. Run it first and bail early if it fails.
  if (hasCode) {
    const build = await runCheck({ name: 'build', cmd: ['bun', 'run', 'build'] })
    printResult(build)
    if (!build.ok) {
      console.error(`\n──── build output ────\n${build.output}`)
      process.exit(1)
    }
  }

  const checks: Check[] = hasCode
    ? [
        { name: 'typecheck', cmd: ['bunx', 'tsc', '--noEmit'] },
        { name: 'lint', cmd: ['bun', 'run', 'lint'] },
        { name: 'test:unit', cmd: ['bun', 'test', 'test/unit'] },
        { name: 'format', cmd: ['bun', 'run', 'check-format'] },
      ]
    : [{ name: 'format', cmd: ['bun', 'run', 'check-format'] }]

  const results = await Promise.all(checks.map(runCheck))
  for (const result of results) {
    printResult(result)
  }

  const failed = results.filter((result) => !result.ok)
  for (const result of failed) {
    console.error(`\n──── ${result.name} output ────\n${result.output}`)
  }

  console.log(`\nTotal: ${formatSeconds(performance.now() - start)}`)
  if (failed.length > 0) {
    process.exit(1)
  }
}

await main()
