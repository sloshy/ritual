export type PagerMode = 'interactive' | 'plain'

export function resolvePagerMode(
  plain: boolean,
  isTTY: boolean | undefined = process.stdout.isTTY,
): PagerMode {
  if (plain || !isTTY) return 'plain'
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
    proc.stdin.write(text)
    proc.stdin.end()
    await proc.exited
  } catch {
    // less not available — fall back to plain output
    process.stdout.write(text)
    if (!text.endsWith('\n')) process.stdout.write('\n')
  }
}
