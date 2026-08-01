import { describe, expect, test } from 'bun:test'
import { binaryPath, ensureBinary, repoRoot } from './helpers/cli'

/**
 * `ritual … --output ndjson | head` is the standard scripting shape, and the
 * reader closing the pipe mid-stream is normal there — not a failure. This must
 * be driven through a real shell pipeline: the EPIPE only happens when a genuine
 * OS pipe is closed under the writer, which an in-process stdout stub cannot
 * reproduce.
 *
 * `dep-license --list` is the cheapest multi-hundred-row ndjson source in the
 * CLI, and it needs no workspace or network.
 */
describe('broken pipe on stdout (Integration)', () => {
  test('ndjson piped into an early-closing reader exits 0 with no stack trace', async () => {
    await ensureBinary()

    // `pipefail` makes the pipeline's status reflect ritual's own, which is the
    // thing under test — without it `head`'s 0 would mask any crash.
    const pipeline = Bun.spawn(
      [
        'bash',
        '-o',
        'pipefail',
        '-c',
        `"${binaryPath}" dep-license --list --output ndjson | head -2`,
      ],
      { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(pipeline.stdout).text(),
      new Response(pipeline.stderr).text(),
      pipeline.exited,
    ])

    expect(exitCode).toBe(0)
    // `head` got its two rows...
    expect(stdout.trim().split('\n')).toHaveLength(2)
    // ...and the writer said nothing about the pipe it lost.
    expect(stderr).not.toContain('EPIPE')
    expect(stderr).not.toContain('broken pipe')
  }, 60_000)
})
