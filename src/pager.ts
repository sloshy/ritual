import { promptsUnavailable } from './no-input'

export type PagerMode = 'interactive' | 'plain'

/**
 * `less` waits for a keypress to advance and to quit, so it is an interactive
 * prompt by another name: a run with prompts unavailable (`--no-input`, or no
 * terminal on stdin) would block forever instead of printing the text.
 */
export function resolvePagerMode(plain: boolean): PagerMode {
  if (plain || !process.stdout.isTTY || promptsUnavailable()) return 'plain'
  return 'interactive'
}

export async function displayWithPager(text: string, mode: PagerMode): Promise<void> {
  if (mode === 'plain') {
    process.stdout.write(text)
    if (!text.endsWith('\n')) process.stdout.write('\n')
    return
  }

  try {
    const proc = Bun.spawn(['less', '-R'], {
      stdin: 'pipe',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await proc.stdin.write(text)
    await proc.stdin.end()
    await proc.exited
  } catch {
    // less not available — fall back to plain output
    process.stdout.write(text)
    if (!text.endsWith('\n')) process.stdout.write('\n')
  }
}
